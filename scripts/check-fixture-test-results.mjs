#!/usr/bin/env node
import { readFileSync } from "node:fs";

const suites = {
  integration: {
    activation: ["RUN_SSH_INTEGRATION", "1"],
    expected: [
      "test/integration/mcp.integration.test.ts",
      "test/integration/session.integration.test.ts",
    ],
  },
  e2e: {
    activation: ["RUN_SSH_E2E", "1"],
    expected: ["test/e2e/server.test.ts"],
  },
  windows: {
    activation: ["RUN_WINDOWS_SSH_INTEGRATION", "1"],
    expected: ["test/integration/windows-ssh.integration.test.ts"],
  },
  perf: {
    activation: undefined,
    expected: ["test/perf/baseline.test.ts"],
  },
};

function fail(message) {
  console.error(`check-fixture-test-results: ${message}`);
  process.exit(1);
}

function attribute(tag, name) {
  const marker = ` ${name}="`;
  const start = tag.indexOf(marker);
  if (start < 0) {
    return undefined;
  }
  const valueStart = start + marker.length;
  const end = tag.indexOf('"', valueStart);
  return end < 0 ? undefined : tag.slice(valueStart, end);
}

function parseCount(tag, name) {
  const raw = attribute(tag, name);
  if (raw === undefined || !/^\d+$/u.test(raw)) {
    fail(`invalid or missing ${name} attribute in JUnit testsuite`);
  }
  return Number.parseInt(raw, 10);
}

function parseTestSuites(xml) {
  return [...xml.matchAll(/<testsuite\b[^>]*>/gu)].map(([tag]) => ({
    name: attribute(tag, "name") ?? "",
    tests: parseCount(tag, "tests"),
    skipped: parseCount(tag, "skipped"),
  }));
}

const [suiteName, reportPath = "test-results/junit.xml"] = process.argv.slice(2);
const suite = suites[suiteName];
if (!suite) {
  fail(`usage: check-fixture-test-results.mjs <${Object.keys(suites).join("|")}> [junit-path]`);
}

if (suite.activation) {
  const [name, expectedValue] = suite.activation;
  if (process.env[name] !== expectedValue) {
    fail(`${name}=${expectedValue} is required for the ${suiteName} execution guard`);
  }
}

let xml;
try {
  xml = readFileSync(reportPath, "utf8");
} catch (error) {
  fail(`unable to read ${reportPath}: ${error instanceof Error ? error.message : String(error)}`);
}

const results = parseTestSuites(xml);
let executed = 0;
for (const expectedName of suite.expected) {
  const result = results.find((candidate) => {
    const normalizedName = candidate.name.replaceAll("\\", "/");
    return normalizedName === expectedName || normalizedName.endsWith(`/${expectedName}`);
  });
  if (!result) {
    fail(`expected JUnit suite ${expectedName} was not reported`);
  }

  const suiteExecuted = result.tests - result.skipped;
  if (suiteExecuted <= 0) {
    fail(`${expectedName} did not execute any tests`);
  }
  if (result.skipped > 0) {
    fail(`${expectedName} reported ${result.skipped} skipped test(s)`);
  }
  executed += suiteExecuted;
}

console.log(`${suiteName}: ${executed} fixture-backed test(s) executed`);
