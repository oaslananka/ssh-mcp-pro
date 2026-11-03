#!/usr/bin/env node
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const readiness = JSON.parse(readFileSync("apps/google/gemini-app-readiness.json", "utf8"));

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
  "Gemini serverName must match package mcpName.",
);
assert(
  readiness.mcp?.packageName === packageJson.name,
  "Gemini packageName must match package name.",
);
assert(
  readiness.mcp?.version === packageJson.version,
  "Gemini version must match package version.",
);
assert(readiness.connector?.runtimeProfile === "gemini", "Gemini runtime profile must be gemini.");

console.log("validate-google-app: readiness metadata is consistent.");
