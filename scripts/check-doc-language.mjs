#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const files = ["AGENTS.md", "INSTALL.md", "examples/README.md", "apps/chatgpt/README.md"];
const forbidden = /\b(TODO|TBD|lorem ipsum)\b/iu;

for (const file of files) {
  const text = readFileSync(join(process.cwd(), file), "utf8");
  if (forbidden.test(text)) {
    throw new Error(`${file} contains placeholder documentation text.`);
  }
}

console.log(`check-doc-language: checked ${files.length} documentation file(s).`);
