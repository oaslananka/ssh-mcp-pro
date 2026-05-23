#!/usr/bin/env node
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const readiness = JSON.parse(readFileSync("apps/claude/connector-readiness.json", "utf8"));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  readiness.sourceRepository ===
    packageJson.repository.url.replace(/^git\+/u, "").replace(/\.git$/u, ""),
  "sourceRepository must match package repository.",
);
assert(
  readiness.mcp?.serverName === packageJson.mcpName,
  "Claude serverName must match package mcpName.",
);
assert(
  readiness.mcp?.packageName === packageJson.name,
  "Claude packageName must match package name.",
);
assert(
  readiness.mcp?.version === packageJson.version,
  "Claude version must match package version.",
);
assert(readiness.connector?.runtimeProfile === "claude", "Claude runtime profile must be claude.");

console.log("validate-claude-connector: readiness metadata is consistent.");
