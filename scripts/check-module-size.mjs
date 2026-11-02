#!/usr/bin/env node

/**
 * check-module-size.mjs
 *
 * Checks source files exceed a line-count threshold and reports them.
 * Fails (exit 1) when the "max" threshold is exceeded.
 */

import { globSync, readFileSync } from "node:fs";

const WARN_THRESHOLD = 400;
const MAX_THRESHOLD = 600;

const srcFiles = globSync("src/**/*.ts", { ignore: ["src/**/*.test.ts", "src/**/*.d.ts"] });

let exitCode = 0;
const overLimit = [];

for (const file of srcFiles) {
  const content = readFileSync(file, "utf-8");
  const lines = content.split("\n").length;

  if (lines > MAX_THRESHOLD) {
    overLimit.push({ file, lines, severity: "ERROR" });
    exitCode = 1;
  } else if (lines > WARN_THRESHOLD) {
    overLimit.push({ file, lines, severity: "WARN" });
  }
}

if (overLimit.length > 0) {
  console.log(
    `\nModule size report (threshold: warn > ${WARN_THRESHOLD}, fail > ${MAX_THRESHOLD} lines):\n`,
  );
  for (const { file, lines, severity } of overLimit) {
    const icon = severity === "ERROR" ? "❌" : "⚠️";
    console.log(`  ${icon} [${severity}] ${file} (${lines} lines)`);
  }
  console.log("");
}

if (exitCode !== 0) {
  console.error(
    `FAIL: ${overLimit.filter((r) => r.severity === "ERROR").length} file(s) exceeded ${MAX_THRESHOLD} lines.`,
  );
}

process.exit(exitCode);
