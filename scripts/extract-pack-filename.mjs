#!/usr/bin/env node
let input = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const parsed = JSON.parse(input);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  const filename = first?.filename || first?.name;
  if (!filename) {
    throw new Error("pnpm pack JSON did not include a filename.");
  }
  process.stdout.write(`${filename}\n`);
});
