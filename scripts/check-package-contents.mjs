#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { failWithCommandResult, runCommand } from "./lib/command.mjs";
import { parsePnpmPackOutput } from "./pack-json.mjs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const requiredFiles = ["dist/index.js", "dist/index.d.ts", "LICENSE", "mcp.json", "server.json"];

for (const file of packageJson.files ?? []) {
  if (
    file.startsWith("!") ||
    file === "docs" ||
    file === "dist" ||
    file === "examples" ||
    file === "registry"
  ) {
    continue;
  }
  requiredFiles.push(file);
}

const missing = [...new Set(requiredFiles)].filter((file) => !existsSync(file));
if (missing.length > 0) {
  console.error(missing.join("\n"));
  throw new Error("Package files list references missing files.");
}

const pack = runCommand("pnpm", ["pack", "--dry-run", "--json"]);
if (pack.status !== 0) {
  failWithCommandResult("pnpm pack --dry-run", pack);
}

const packed = parsePnpmPackOutput(pack.stdout);
const files = new Set(packed.files.map((file) => file.path));
for (const file of [...new Set(requiredFiles)]) {
  if (!files.has(file)) {
    throw new Error(`Packed artifact is missing ${file}.`);
  }
}

console.log(`check-package-contents: dry-run package includes ${files.size} files.`);
