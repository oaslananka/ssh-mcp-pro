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

function normalizeOutput(value) {
  if (typeof value === "string") {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  return "";
}

function writeIfPresent(stream, value) {
  const output = normalizeOutput(value);

  if (output.length === 0) {
    return;
  }

  stream.write(output.endsWith("\n") ? output : `${output}\n`);
}

function describeFailure(result) {
  const details = [];

  if (result.status !== null) {
    details.push(`status ${result.status}`);
  }

  if (result.signal) {
    details.push(`signal ${result.signal}`);
  }

  if (result.error instanceof Error) {
    details.push(result.error.message);
  }

  return details.length > 0 ? details.join(", ") : "unknown failure";
}

const result = spawnSync("pnpm", ["licenses", "list", "--json"], {
  encoding: "utf8",
  stdio: "pipe",
});

if (result.status !== 0) {
  console.error(`check-licenses: pnpm licenses list --json failed (${describeFailure(result)}).`);
  writeIfPresent(process.stdout, result.stdout);
  writeIfPresent(process.stderr, result.stderr);
  process.exit(result.status ?? 1);
}

const licenseReport = normalizeOutput(result.stdout).trim();

if (licenseReport.length === 0) {
  console.error("check-licenses: pnpm licenses list --json succeeded without JSON output.");
  process.exit(1);
}

let report;

try {
  report = JSON.parse(licenseReport);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`check-licenses: pnpm licenses list --json returned invalid JSON: ${message}`);
  process.exit(1);
}

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
