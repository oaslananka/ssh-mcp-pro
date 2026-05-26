#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const lintOnly = process.argv.includes("--lint-only");

const repoRoot = process.cwd();

const TOOLS = {
  prettier: path.join(repoRoot, "node_modules", "prettier", "bin", "prettier.cjs"),
  eslint: path.join(repoRoot, "node_modules", "eslint", "bin", "eslint.js"),
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });

  if (result.error) {
    console.error(
      `run-staged-checks: failed to spawn ${command} ${args.join(" ")}: ${result.error.message}`,
    );
    process.exit(1);
  }

  if (result.signal) {
    console.error(
      `run-staged-checks: ${command} ${args.join(" ")} terminated by signal ${result.signal}`,
    );
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(
      `run-staged-checks: ${command} ${args.join(" ")} exited with ${result.status ?? 1}`,
    );
    process.exit(result.status ?? 1);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  });

  if (result.error) {
    console.error(
      `run-staged-checks: failed to spawn ${command} ${args.join(" ")}: ${result.error.message}`,
    );
    process.exit(1);
  }

  return result;
}

function requireTool(name, filePath) {
  if (!existsSync(filePath)) {
    console.error(`run-staged-checks: missing ${name} at ${filePath}. Run "pnpm install" first.`);
    process.exit(1);
  }
}

const gitCheck = capture("git", ["rev-parse", "--is-inside-work-tree"]);

if (gitCheck.status !== 0) {
  console.log("run-staged-checks: not a git checkout; skipping.");
  process.exit(0);
}

const diff = capture("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);

if (diff.status !== 0) {
  process.stderr.write(diff.stderr);
  process.exit(diff.status ?? 1);
}

const files = diff.stdout
  .split("\n")
  .map((file) => file.trim())
  .filter(Boolean);

if (files.length === 0) {
  console.log("run-staged-checks: no staged files.");
  process.exit(0);
}

const prettierFiles = files.filter((file) =>
  /\.(cjs|css|html|json|jsonc|md|mjs|ts|tsx|yaml|yml)$/u.test(file),
);

const eslintFiles = files.filter((file) => /\.(ts|tsx|mjs|cjs)$/u.test(file));

if (!lintOnly && prettierFiles.length > 0) {
  requireTool("prettier", TOOLS.prettier);
  run(process.execPath, [TOOLS.prettier, "--write", ...prettierFiles]);
  run("git", ["add", ...prettierFiles]);
}

if (eslintFiles.length > 0) {
  requireTool("eslint", TOOLS.eslint);
  run(process.execPath, [TOOLS.eslint, ...eslintFiles]);
}

console.log(`run-staged-checks: checked ${files.length} staged file(s).`);
