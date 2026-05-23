#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const allowedLicenses = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "Python-2.0",
  "Unlicense",
]);

const result = spawnSync("pnpm", ["licenses", "list", "--json"], {
  encoding: "utf8",
  stdio: "pipe",
});

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const report = JSON.parse(result.stdout);
const denied = [];

for (const [license, packages] of Object.entries(report)) {
  const parts = license
    .split(/\s+OR\s+|\s+AND\s+|\s*\/\s*/u)
    .map((part) => part.replace(/[()]/gu, "").trim())
    .filter(Boolean);
  const accepted = parts.some((part) => allowedLicenses.has(part));

  if (!accepted) {
    for (const item of packages) {
      denied.push(`${item.name}@${item.versions.join(",")} (${license})`);
    }
  }
}

if (denied.length > 0) {
  console.error(denied.join("\n"));
  throw new Error("Disallowed dependency licenses found.");
}

console.log(`check-licenses: accepted ${Object.keys(report).length} license group(s).`);
