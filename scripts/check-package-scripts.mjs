#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const allowedPendingScripts = new Set([
  "scripts/release-state.mjs",
  "scripts/validate-release-please.mjs",
]);
const removedScripts = new Set(["dev:agent", "dev:control-plane", "setup:chatgpt"]);
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const scriptEntries = Object.entries(packageJson.scripts ?? {});
const missing = [];

for (const scriptName of removedScripts) {
  if (packageJson.scripts?.[scriptName]) {
    missing.push(`${scriptName} should not point to an obsolete helper.`);
  }
}

for (const [scriptName, command] of scriptEntries) {
  for (const target of scriptTargets(command)) {
    if (!existsSync(target) && !allowedPendingScripts.has(target)) {
      missing.push(`${scriptName} references missing ${target}.`);
    }
  }
}

if (missing.length > 0) {
  console.error(missing.join("\n"));
  throw new Error("Package script entrypoint validation failed.");
}

console.log(`check-package-scripts: validated ${scriptEntries.length} package script(s).`);

function scriptTargets(command) {
  return [...command.matchAll(/\bnode\s+(scripts\/[^\s"'&|;]+\.mjs)\b/gu)].map((match) => match[1]);
}
