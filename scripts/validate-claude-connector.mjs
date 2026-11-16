#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { validateAppReadiness } from "./lib/validate-app-readiness.mjs";

validateAppReadiness({
  file: "apps/claude/connector-readiness.json",
  displayName: "Claude",
  profile: "claude",
  kind: "connector",
});

if (!existsSync("apps/claude/claude-plugin.json")) {
  throw new Error("apps/claude/claude-plugin.json must exist for Claude Plugin packaging.");
}

const plugin = JSON.parse(readFileSync("apps/claude/claude-plugin.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

if (plugin.name !== pkg.name) {
  throw new Error(
    `claude-plugin.json name '${plugin.name}' must match package.json name '${pkg.name}'.`,
  );
}
if (plugin.version !== pkg.version) {
  throw new Error(
    `claude-plugin.json version '${plugin.version}' must match package.json version '${pkg.version}'.`,
  );
}

for (const skill of plugin.skills ?? []) {
  const skillFile = `apps/claude/${skill.path}`;
  if (!existsSync(skillFile)) {
    throw new Error(`Referenced skill file '${skillFile}' does not exist.`);
  }
}

console.log("validate-claude-connector: readiness metadata and claude-plugin are consistent.");
