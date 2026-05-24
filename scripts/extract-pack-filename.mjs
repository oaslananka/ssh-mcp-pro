#!/usr/bin/env node
import { basename } from "node:path";
import { parsePnpmPackOutput } from "./pack-json.mjs";

let input = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const pack = parsePnpmPackOutput(input);
  const filename = pack.filename || pack.name;
  if (!filename) {
    throw new Error("pnpm pack JSON did not include a filename.");
  }
  process.stdout.write(`${basename(filename)}\n`);
});
