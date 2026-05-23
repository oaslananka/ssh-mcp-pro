const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

class JUnitReporter {
  constructor(_globalConfig, options = {}) {
    this.outputDirectory = options.outputDirectory || "test-results";
    this.outputName = options.outputName || "junit.xml";
  }

  onRunComplete(_contexts, results) {
    const testCases = [];
    let failureCount = 0;
    let skippedCount = 0;

    for (const suite of results.testResults) {
      for (const assertion of suite.testResults) {
        const className = assertion.ancestorTitles.join(" ");
        const name = assertion.title;
        const time = Math.max((assertion.duration || 0) / 1000, 0);
        const fullName = [className, name].filter(Boolean).join(" ");

        if (assertion.status === "failed") {
          failureCount += 1;
          const message = assertion.failureMessages.join("\n");
          testCases.push(
            `<testcase classname="${escapeXml(className)}" name="${escapeXml(name)}" time="${time}"><failure message="${escapeXml(fullName)}">${escapeXml(message)}</failure></testcase>`,
          );
        } else if (assertion.status === "pending" || assertion.status === "skipped") {
          skippedCount += 1;
          testCases.push(
            `<testcase classname="${escapeXml(className)}" name="${escapeXml(name)}" time="${time}"><skipped /></testcase>`,
          );
        } else {
          testCases.push(
            `<testcase classname="${escapeXml(className)}" name="${escapeXml(name)}" time="${time}" />`,
          );
        }
      }
    }

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<testsuite name="jest" tests="${results.numTotalTests}" failures="${failureCount}" skipped="${skippedCount}" time="${results.startTime ? Math.max((Date.now() - results.startTime) / 1000, 0) : 0}">`,
      ...testCases,
      "</testsuite>",
      "",
    ].join("\n");

    mkdirSync(this.outputDirectory, { recursive: true });
    writeFileSync(join(this.outputDirectory, this.outputName), xml);
  }
}

module.exports = JUnitReporter;
