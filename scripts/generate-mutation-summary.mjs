#!/usr/bin/env node

import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mutationScoreSymbol } from "./lib/maintenance-cli-input.mjs";
import { summarizeMutationReport } from "./lib/mutation-report.mjs";

const reportPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "reports",
  "mutation",
  "mutation.json",
);
function emit(output) {
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, output + "\n");
  console.log(output);
}

try {
  if (!existsSync(reportPath)) throw new Error("No mutation report found");
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const result = summarizeMutationReport(report);
  const score = result.score === null ? "N/A" : result.score.toFixed(1) + "%";
  const lines = [
    "## Mutation Test Report",
    "",
    result.valid
      ? "**" + mutationScoreSymbol(result.score) + " Mutation Score: " + score + "**"
      : "**Invalid mutation evidence. Reported score: " + score + " (not a validated result).**",
    "",
    "| Metric | Count |",
    "|---|---:|",
    ...[
      ["Killed", result.killed],
      ["Survived", result.survived],
      ["Timed out", result.timedOut],
      ["No coverage", result.noCoverage],
      ["Compile errors", result.compileErrors],
      ["Runtime errors", result.runtimeErrors],
      ["Ignored", result.ignored],
      ["Pending", result.pending],
      ["Zero-test killed/survived mutants", result.zeroTestMutants],
      ["Completed tests", result.testsCompleted],
      ["Total mutants", result.total],
    ].map(([name, count]) => "| " + name + " | " + count + " |"),
    "",
    "### Per-File Results",
    "",
    "| File | Score | Killed | Survived | Total |",
    "|---|---:|---:|---:|---:|",
    ...result.files.map(
      (f) =>
        "| `" +
        f.path +
        "` | " +
        (f.score === null ? "N/A" : f.score.toFixed(1) + "%") +
        " | " +
        f.killed +
        " | " +
        f.survived +
        " | " +
        f.total +
        " |",
    ),
    "",
  ];
  if (report.thresholds) {
    lines.push("### Thresholds", "", "| Threshold | Value |", "|---|---:|");
    const { high, low, break: breakThreshold } = report.thresholds;
    for (const [name, value] of [
      ["high", high],
      ["low", low],
      ["break", breakThreshold],
    ]) {
      if (value != null) lines.push("| " + name + " | " + value + " |");
    }
  }
  lines.push("", "---", "", "_Report generated from `reports/mutation/mutation.json`_", "");
  emit(lines.join("\n"));
  if (!result.valid) process.exitCode = 1;
} catch (error) {
  emit("## Mutation Test Report\n\n**Invalid mutation evidence:** " + error.message);
  process.exitCode = 1;
}
