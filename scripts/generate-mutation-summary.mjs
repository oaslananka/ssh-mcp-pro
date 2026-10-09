#!/usr/bin/env node

import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportPath = join(__dirname, "..", "reports", "mutation", "mutation.json");

if (!existsSync(reportPath)) {
  console.log(
    "## Mutation Test Report\n\nNo mutation report found at `reports/mutation/mutation.json`.",
  );
  process.exit(0);
}

const report = JSON.parse(readFileSync(reportPath, "utf-8"));

const score = report.mutationScore ?? report.framework?.mutationScore ?? 0;
const totalDetected = (report.killed ?? 0) + (report.timedOut ?? 0);
const totalUndetected = (report.survived ?? 0) + (report.noCoverage ?? 0);
const total = totalDetected + totalUndetected;
const scoreFormatted = score.toFixed(1);

const status = score >= 80 ? "✅" : score >= 60 ? "⚠️" : "❌";

const lines = [
  "## Mutation Test Report",
  "",
  `**${status} Mutation Score: ${scoreFormatted}%**`,
  "",
  "| Metric | Count |",
  "|---|---:|",
  `| **Killed** | ${report.killed ?? 0} |`,
  `| **Survived** | ${report.survived ?? 0} |`,
  `| **Timed out** | ${report.timedOut ?? 0} |`,
  `| **No coverage** | ${report.noCoverage ?? 0} |`,
  `| **Total mutants** | ${total} |`,
  "",
];

if (report.files && Object.keys(report.files).length > 0) {
  lines.push("### Per-File Results", "", "| File | Score | Killed | Survived |");
  lines.push("|---|---:|---:|---:|");

  for (const [filePath, fileResult] of Object.entries(report.files)) {
    if (!fileResult) continue;
    const fileScore = fileResult.mutationScore ?? 0;
    const fileKilled = fileResult.killed ?? 0;
    const fileSurvived = fileResult.survived ?? 0;
    lines.push(`| \`${filePath}\` | ${fileScore.toFixed(1)}% | ${fileKilled} | ${fileSurvived} |`);
  }
  lines.push("");
}

if (report.thresholds) {
  const thresholds = report.thresholds;
  if (thresholds.high != null || thresholds.low != null || thresholds.break != null) {
    lines.push("### Thresholds", "", "| Threshold | Value |");
    lines.push("|---|---:|");
    if (thresholds.high != null) lines.push(`| High | ${thresholds.high} |`);
    if (thresholds.low != null) lines.push(`| Low | ${thresholds.low} |`);
    if (thresholds.break != null) lines.push(`| Break | ${thresholds.break} |`);
    lines.push("");
  }
}

lines.push("---", "", "_Report generated from `reports/mutation/mutation.json`_", "");

const output = lines.join("\n");

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, output + "\n");
  console.log("Mutation summary appended to $GITHUB_STEP_SUMMARY");
} else {
  console.log(output);
}
