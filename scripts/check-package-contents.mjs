#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const isWindows = process.platform === "win32";

function write(stream, value) {
  if (typeof value === "string" && value.length > 0) {
    stream.write(value);
  }
}

function fail(message) {
  process.stderr.write(`check-package-contents: ${message}\n`);
  process.exit(1);
}

function normalizePackagePath(filePath) {
  return filePath.replaceAll("\\\\", "/").replace(/^\.\//u, "");
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  if (result.error) {
    fail(`failed to spawn ${command} ${args.join(" ")}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    write(process.stdout, result.stdout);
    write(process.stderr, result.stderr);
    fail(`${command} ${args.join(" ")} exited with ${result.status ?? 1}`);
  }

  return result;
}

function runNpm(args) {
  // On Windows, npm is usually exposed through npm.cmd. Node cannot reliably
  // spawn .cmd files directly with shell:false, so execute the fixed npm command
  // through cmd.exe. The argument list here is constant and does not include
  // user-controlled filenames, so this does not create a shell-injection surface.
  if (isWindows) {
    return run("cmd.exe", ["/d", "/s", "/c", `npm ${args.join(" ")}`]);
  }

  return run("npm", args);
}

function parseNpmPackJson(stdout) {
  const text = stdout.trim();
  if (text.length === 0) {
    fail("npm pack --json returned empty stdout");
  }

  try {
    return JSON.parse(text);
  } catch {
    const arrayStart = text.indexOf("[");
    const arrayEnd = text.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      const candidate = text.slice(arrayStart, arrayEnd + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        // fall through to the diagnostic below
      }
    }

    process.stderr.write("check-package-contents: unable to parse npm pack JSON output\n");
    process.stderr.write("--- npm stdout start ---\n");
    process.stderr.write(text.slice(0, 20_000));
    process.stderr.write("\n--- npm stdout end ---\n");
    process.exit(1);
  }
}

function readPackageJson() {
  try {
    return JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`failed to read package.json: ${message}`);
  }
}

function requirePacked(fileSet, filePath) {
  const normalized = normalizePackagePath(filePath);
  if (!fileSet.has(normalized)) {
    fail(`missing expected package file: ${normalized}`);
  }
}

function rejectPacked(files, predicate, reason) {
  const matches = files.filter(predicate);
  if (matches.length > 0) {
    fail(`${reason}: ${matches.slice(0, 20).join(", ")}`);
  }
}

const packageJson = readPackageJson();

const pack = runNpm(["pack", "--dry-run", "--json", "--ignore-scripts"]);
const parsed = parseNpmPackJson(pack.stdout);

if (!Array.isArray(parsed) || parsed.length === 0 || !Array.isArray(parsed[0]?.files)) {
  fail("unexpected npm pack --json shape; expected an array with files[]");
}

const files = parsed[0].files
  .map((entry) => normalizePackagePath(String(entry.path ?? "")))
  .filter(Boolean)
  .sort((a, b) => a.localeCompare(b));

const fileSet = new Set(files);

for (const required of ["package.json", "README.md", "LICENSE"]) {
  requirePacked(fileSet, required);
}

if (typeof packageJson.main === "string") {
  requirePacked(fileSet, packageJson.main);
}

if (typeof packageJson.types === "string") {
  requirePacked(fileSet, packageJson.types);
}

if (packageJson.bin && typeof packageJson.bin === "object") {
  for (const binTarget of Object.values(packageJson.bin)) {
    if (typeof binTarget === "string") {
      requirePacked(fileSet, binTarget);
    }
  }
}

rejectPacked(
  files,
  (file) =>
    file.startsWith("src/") ||
    file.startsWith("test/") ||
    file.startsWith("coverage/") ||
    file.startsWith("test-results/") ||
    file.startsWith("node_modules/") ||
    file.startsWith(".git/") ||
    file.startsWith(".github/") ||
    file === "pnpm-lock.yaml" ||
    file === "package-lock.json" ||
    file === "yarn.lock" ||
    file.endsWith(".tsbuildinfo"),
  "unexpected development-only file(s) in package",
);

console.log(
  `check-package-contents: ${packageJson.name ?? "package"}@${packageJson.version ?? "0.0.0"} includes ${files.length} file(s).`,
);
