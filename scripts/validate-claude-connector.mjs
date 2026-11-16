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

const knownSkills = new Set(["skills/ssh-inspect/SKILL.md", "skills/ssh-plan-mutation/SKILL.md"]);

for (const skill of plugin.skills ?? []) {
  if (!knownSkills.has(skill.path)) {
    throw new Error(`Referenced skill file '${skill.path}' is not in known skills.`);
  }
}

if (
  !existsSync("apps/claude/skills/ssh-inspect/SKILL.md") ||
  !existsSync("apps/claude/skills/ssh-plan-mutation/SKILL.md")
) {
  throw new Error("Required Claude skill markdown files do not exist.");
}

console.log("validate-claude-connector: readiness metadata and claude-plugin are consistent.");
