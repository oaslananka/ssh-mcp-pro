import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const scriptPath = resolve(repoRoot, "scripts/check-fixture-test-results.mjs");

interface SuiteResult {
  readonly name: string;
  readonly tests: number;
  readonly skipped: number;
}

function junitXml(suites: readonly SuiteResult[]): string {
  const totalTests = suites.reduce((sum, suite) => sum + suite.tests, 0);
  const totalSkipped = suites.reduce((sum, suite) => sum + suite.skipped, 0);
  const body = suites
    .map(
      (suite) =>
        `<testsuite name="${suite.name}" tests="${suite.tests}" failures="0" errors="0" skipped="${suite.skipped}" time="0.1"></testsuite>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?><testsuites tests="${totalTests}" failures="0" errors="0" skipped="${totalSkipped}">${body}</testsuites>`;
}

function runCheck(
  suite: "integration" | "e2e" | "windows" | "perf",
  xml: string,
  env: NodeJS.ProcessEnv = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "ssh-mcp-pro-junit-"));
  const report = join(dir, "junit.xml");
  writeFileSync(report, xml);
  try {
    return spawnSync(process.execPath, [scriptPath, suite, report], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("fixture-backed JUnit execution guard", () => {
  test("rejects integration reports when fixture suites are skipped", () => {
    const result = runCheck(
      "integration",
      junitXml([
        { name: "test/integration/mcp.integration.test.ts", tests: 2, skipped: 2 },
        { name: "test/integration/session.integration.test.ts", tests: 3, skipped: 3 },
      ]),
      { RUN_SSH_INTEGRATION: "1" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("did not execute any tests");
  });

  test("accepts integration reports only when every fixture suite executed", () => {
    const result = runCheck(
      "integration",
      junitXml([
        { name: "test/integration/mcp.integration.test.ts", tests: 2, skipped: 0 },
        { name: "test/integration/session.integration.test.ts", tests: 3, skipped: 0 },
      ]),
      { RUN_SSH_INTEGRATION: "1" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("integration: 5 fixture-backed test(s) executed");
  });

  test("rejects partially skipped fixture suites", () => {
    const result = runCheck(
      "e2e",
      junitXml([{ name: "test/e2e/server.test.ts", tests: 11, skipped: 1 }]),
      { RUN_SSH_E2E: "1" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("reported 1 skipped test");
  });

  test("accepts Windows JUnit paths with native separators", () => {
    const result = runCheck(
      "windows",
      junitXml([
        {
          name: "D:\\a\\ssh-mcp-pro\\test\\integration\\windows-ssh.integration.test.ts",
          tests: 3,
          skipped: 0,
        },
      ]),
      { RUN_WINDOWS_SSH_INTEGRATION: "1" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("windows: 3 fixture-backed test(s) executed");
  });

  test("rejects missing activation flags and missing expected suites", () => {
    const missingFlag = runCheck(
      "e2e",
      junitXml([{ name: "test/e2e/server.test.ts", tests: 11, skipped: 0 }]),
    );
    expect(missingFlag.status).toBe(1);
    expect(missingFlag.stderr).toContain("RUN_SSH_E2E=1");

    const missingSuite = runCheck("windows", junitXml([]), {
      RUN_WINDOWS_SSH_INTEGRATION: "1",
    });
    expect(missingSuite.status).toBe(1);
    expect(missingSuite.stderr).toContain("windows-ssh.integration.test.ts");
  });
});
