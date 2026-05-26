#!/usr/bin/env node
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { parsePnpmPackOutput } from "./pack-json.mjs";
import { capture, failFromResult, printResultOutput } from "./lib/command.mjs";

function run(command, args, cwd, { printSuccess = false } = {}) {
  const result = capture(command, args, {
    cwd,
  });
  if (result.status !== 0) {
    failFromResult(result, command);
  }
  if (printSuccess) {
    printResultOutput(result);
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
