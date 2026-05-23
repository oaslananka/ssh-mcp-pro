#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const readiness = JSON.parse(readFileSync("apps/chatgpt/app-readiness.json", "utf8"));

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
  "ChatGPT serverName must match package mcpName.",
);
assert(
  readiness.mcp?.packageName === packageJson.name,
  "ChatGPT packageName must match package name.",
);
assert(
  readiness.mcp?.version === packageJson.version,
  "ChatGPT version must match package version.",
);
assert(readiness.app?.defaultProfile === "chatgpt", "ChatGPT default profile must be chatgpt.");
assert(existsSync(readiness.app?.icon), "ChatGPT icon file must exist.");

console.log("validate-chatgpt-app: readiness metadata is consistent.");
