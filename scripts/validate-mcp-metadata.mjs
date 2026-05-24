#!/usr/bin/env node
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const mcp = JSON.parse(readFileSync("mcp.json", "utf8"));
const registry = JSON.parse(readFileSync("registry/ssh-mcp-pro/mcp.json", "utf8"));
const server = JSON.parse(readFileSync("server.json", "utf8"));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

for (const [label, metadata] of [
  ["mcp.json", mcp],
  ["registry/ssh-mcp-pro/mcp.json", registry],
]) {
  assert(metadata.name === packageJson.name, `${label} name must match package.json name.`);
  assert(
    metadata.version === packageJson.version,
    `${label} version must match package.json version.`,
  );
  assert(
    metadata.entrypoint === packageJson.main,
    `${label} entrypoint must match package.json main.`,
  );
  assert(
    Array.isArray(metadata.platforms) && metadata.platforms.length > 0,
    `${label} must declare platforms.`,
  );
  assert(metadata.capabilities?.tools === true, `${label} must declare tool capability.`);
}

assert(server.name === packageJson.mcpName, "server.json name must match package.json mcpName.");
assert(
  server.version === packageJson.version,
  "server.json version must match package.json version.",
);
assert(
  Array.isArray(server.packages) && server.packages.length > 0,
  "server.json must declare packages.",
);

console.log("validate-mcp-metadata: metadata files are consistent.");
