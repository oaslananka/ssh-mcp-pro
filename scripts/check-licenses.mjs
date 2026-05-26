#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

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

const result = runPnpm(["licenses", "list", "--json"]);

if (result.status !== 0) {
  failFromResult(result, "pnpm licenses list");
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

function runPnpm(args) {
  const pnpm = pnpmInvocation(args);
  return spawnSync(pnpm.command, pnpm.args, {
    encoding: "utf8",
    stdio: "pipe",
  });
}

function pnpmInvocation(args) {
  if (process.platform !== "win32") {
    return { command: "pnpm", args };
  }
  const cli = join(dirname(process.execPath), "node_modules", "corepack", "dist", "pnpm.js");
  if (existsSync(cli)) {
    return { command: process.execPath, args: [cli, ...args] };
  }
  return { command: "pnpm.cmd", args };
}

function failFromResult(result, label) {
  writeIfPresent(process.stdout, result.stdout);
  writeIfPresent(process.stderr, result.stderr);
  if (result.error) {
    process.stderr.write(`${label} failed to start: ${result.error.message}\n`);
  }
  process.exit(result.status ?? 1);
}

function writeIfPresent(stream, value) {
  if (typeof value === "string" && value.length > 0) {
    stream.write(value);
  }
}
