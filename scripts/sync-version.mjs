#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const checkOnly = process.argv.includes("--check");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const version = packageJson.version;

const jsonTargets = [
  ["mcp.json", ["version"]],
  ["server.json", ["version"], ["packages", 0, "version"], ["packages", 1, "version"]],
  ["registry/ssh-mcp-pro/mcp.json", ["version"]],
  ["apps/chatgpt/app-readiness.json", ["mcp", "version"]],
  ["apps/claude/connector-readiness.json", ["mcp", "version"]],
];

const textTargets = [["src/mcp.ts", /export const SERVER_VERSION = "([^"]+)";/u]];
const mismatches = [];

function getPath(object, path) {
  return path.reduce((value, part) => value?.[part], object);
}

function setPath(object, path, nextValue) {
  const last = path.at(-1);
  const parent = path.slice(0, -1).reduce((value, part) => value[part], object);
  parent[last] = nextValue;
}

for (const [file, ...paths] of jsonTargets) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  let changed = false;

  for (const path of paths) {
    const current = getPath(data, path);
    if (current !== version) {
      mismatches.push(`${file} ${path.join(".")}=${current}`);
      setPath(data, path, version);
      changed = true;
    }
  }

  if (changed && !checkOnly) {
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  }
}

for (const [file, pattern] of textTargets) {
  const text = readFileSync(file, "utf8");
  const match = text.match(pattern);
  if (!match) {
    throw new Error(`${file} does not contain SERVER_VERSION.`);
  }
  if (match[1] !== version) {
    mismatches.push(`${file} SERVER_VERSION=${match[1]}`);
    if (!checkOnly) {
      writeFileSync(file, text.replace(pattern, `export const SERVER_VERSION = "${version}";`));
    }
  }
}

if (mismatches.length > 0 && checkOnly) {
  console.error(mismatches.join("\n"));
  throw new Error(`Version metadata is not synchronized with package.json ${version}.`);
}

console.log(`sync-version: ${checkOnly ? "checked" : "synchronized"} version ${version}.`);
