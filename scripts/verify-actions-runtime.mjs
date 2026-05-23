#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const roots = [".github/workflows", ".github/actions"];
const deprecatedPattern =
  /::set-output|::save-state|ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION|node12|node16|node20/u;

function collectYamlFiles(root) {
  if (!existsSync(root)) {
    return [];
  }

  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return collectYamlFiles(path);
    }
    return /\.(ya?ml)$/u.test(entry.name) ? [path] : [];
  });
}

const files = roots.flatMap(collectYamlFiles);
const failures = [];

for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (deprecatedPattern.test(line)) {
      failures.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  throw new Error("Deprecated GitHub Actions runtime or command usage found.");
}

console.log(`verify-actions-runtime: scanned ${files.length} workflow/action file(s).`);
