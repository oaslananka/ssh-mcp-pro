#!/usr/bin/env node
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";
import { parsePnpmPackOutput } from "./pack-json.mjs";

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
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
  copyFileSync(join(process.cwd(), "pnpm-workspace.yaml"), join(workspace, "pnpm-workspace.yaml"));
  run("pnpm", ["add", tarball], workspace);
  run("node", ["node_modules/ssh-mcp-pro/dist/index.js", "--version"], workspace);

  console.log("check-package-install-smoke: package installs and CLI starts.");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
