#!/usr/bin/env node
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";
import { parsePnpmPackOutput } from "./pack-json.mjs";

/** Quote a single shell argument if it contains spaces. */
function shellQuote(arg) {
  return arg.includes(" ") ? `"${arg}"` : arg;
}

function run(command, args, cwd) {
  // On Windows, tools like pnpm are .cmd wrappers that need shell resolution.
  // To avoid Node v24 DEP0190, pass the full command string rather than an
  // args array when shell is enabled.
  const isWin = process.platform === "win32";
  const result = isWin
    ? spawnSync([command, ...args.map(shellQuote)].join(" "), {
        cwd,
        encoding: "utf8",
        stdio: "pipe",
        shell: true,
      })
    : spawnSync(command, args, {
        cwd,
        encoding: "utf8",
        stdio: "pipe",
      });
  if (result.error) {
    console.error(`spawn error: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

const workspace = mkdtempSync(join(tmpdir(), "ssh-mcp-pro-install-smoke-"));
try {
  const packOutput = run(
    "pnpm",
    ["pack", "--pack-destination", workspace, "--json"],
    process.cwd(),
  );
  const packed = parsePnpmPackOutput(packOutput);
  const tarball = isAbsolute(packed.filename) ? packed.filename : join(workspace, packed.filename);

  writeFileSync(
    join(workspace, "package.json"),
    `${JSON.stringify({ name: "ssh-mcp-pro-install-smoke", version: "0.0.0", private: true }, null, 2)}\n`,
  );
  const workspaceYaml = join(process.cwd(), "pnpm-workspace.yaml");
  if (existsSync(workspaceYaml)) {
    copyFileSync(workspaceYaml, join(workspace, "pnpm-workspace.yaml"));
  }
  run("pnpm", ["add", tarball], workspace);
  run("node", ["node_modules/ssh-mcp-pro/dist/index.js", "--version"], workspace);

  console.log("check-package-install-smoke: package installs and CLI starts.");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
