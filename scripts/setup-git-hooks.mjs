#!/usr/bin/env node
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const hooksDir = ".githooks";

function run(command, args) {
  return spawnSync(command, args, { encoding: "utf8", stdio: "pipe" });
}

const gitDir = run("git", ["rev-parse", "--git-dir"]);
if (gitDir.status !== 0) {
  console.log("setup-git-hooks: not a git checkout; skipping hook setup.");
  process.exit(0);
}

if (!existsSync(hooksDir)) {
  console.log(`setup-git-hooks: ${hooksDir} not found; skipping hook setup.`);
  process.exit(0);
}

const config = run("git", ["config", "core.hooksPath", hooksDir]);
if (config.status !== 0) {
  process.stderr.write(config.stderr || "setup-git-hooks: failed to configure hooks.\n");
  process.exit(config.status ?? 1);
}

for (const entry of readdirSync(hooksDir, { withFileTypes: true })) {
  if (entry.isFile()) {
    chmodSync(join(hooksDir, entry.name), 0o755);
  }
}

console.log(`setup-git-hooks: configured core.hooksPath=${hooksDir}`);
