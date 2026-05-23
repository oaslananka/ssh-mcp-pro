#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const rulesetDir = ".github/rulesets";

if (!existsSync(rulesetDir)) {
  console.log("check-rulesets: no ruleset directory found; skipping.");
  process.exit(0);
}

const files = readdirSync(rulesetDir).filter((file) => file.endsWith(".json"));
for (const file of files) {
  const path = join(rulesetDir, file);
  const ruleset = JSON.parse(readFileSync(path, "utf8"));
  if (!ruleset.name || !Array.isArray(ruleset.rules)) {
    throw new Error(`${path} must include a name and rules array.`);
  }
}

console.log(`check-rulesets: validated ${files.length} ruleset file(s).`);
