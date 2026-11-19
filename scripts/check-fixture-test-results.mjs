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

// The standard fixture deliberately disables SSH forwarding. Only the two
// named opt-in forwarding tests may be skipped; all other fixture cases must run.
const optInForwardingTests = new Map([
  [
    "opens real SSH local forwarding and releases the port with a connected TCP client",
    "RUN_SSH_TUNNEL_INTEGRATION",
  ],
  [
    "closes actual remote SSH forwarding and releases the remote listener",
    "RUN_SSH_REMOTE_TUNNEL_INTEGRATION",
  ],
]);

function skippedCaseNames(xml, suiteName) {
  return [...xml.matchAll(/<testcase\b[^>]*>[\s\S]*?<\/testcase>/gu)]
    .filter(([caseXml]) => /<skipped(?:\s|\/|>)/u.test(caseXml))
    .flatMap(([caseXml]) => {
      const tag = caseXml.slice(0, caseXml.indexOf(">") + 1);
      const className = (attribute(tag, "classname") ?? "").replaceAll("\\", "/");
      const inSuite = className === suiteName || className.endsWith("/" + suiteName);
      return inSuite ? [attribute(tag, "name") ?? "unnamed test"] : [];
    });
}

function allowedFixtureSkips(xml, suiteName, skippedCount) {
  if (suiteName !== "test/integration/session.integration.test.ts") return false;
  const names = skippedCaseNames(xml, suiteName);
  if (names.length !== skippedCount) {
    fail(suiteName + " reported " + skippedCount + " skipped test(s) without matching JUnit cases");
  }
  for (const name of names) {
    const optInFlag = [...optInForwardingTests].find(([title]) => name.endsWith(title))?.[1];
    if (!optInFlag || process.env[optInFlag] === "1") {
      fail(suiteName + " reported " + skippedCount + " skipped test(s): " + name);
    }
  }
  return true;
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
  if (result.skipped > 0 && !allowedFixtureSkips(xml, expectedName, result.skipped)) {
    fail(expectedName + " reported " + result.skipped + " skipped test(s)");
  }
  executed += suiteExecuted;
}

console.log(`${suiteName}: ${executed} fixture-backed test(s) executed`);
