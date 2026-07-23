import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function readText(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function jobBlock(workflow: string, job: string, nextJob: string): string {
  const start = workflow.indexOf(`  ${job}:`);
  const end = workflow.indexOf(`  ${nextJob}:`, start + 1);
  if (start < 0 || end < 0) {
    throw new Error(`Unable to locate ${job} job block`);
  }
  return workflow.slice(start, end);
}

describe("fixture-backed CI execution contract", () => {
  test("declares reusable fixture verification and result guard scripts", () => {
    const pkg = JSON.parse(readText("package.json")) as { scripts: Record<string, string> };

    expect(pkg.scripts["docker:ssh-fixture:verify"]).toBe(
      "node scripts/docker-ssh-fixture.mjs verify",
    );
    expect(pkg.scripts["docker:ssh-fixture:diagnostics"]).toBe(
      "node scripts/docker-ssh-fixture.mjs diagnostics",
    );
    expect(pkg.scripts["check:fixture-results"]).toBe(
      "node scripts/check-fixture-test-results.mjs",
    );
  });

  test("guards Linux integration and E2E execution and retains failure evidence", () => {
    const workflow = readText(".github/workflows/ci.yml");
    const integration = jobBlock(workflow, "integration", "integration-windows");
    const e2e = jobBlock(workflow, "e2e", "perf");

    for (const [job, suite] of [
      [integration, "integration"],
      [e2e, "e2e"],
    ] as const) {
      expect(job).toContain("runs-on: ubuntu-24.04");
      expect(job).toContain("pnpm run docker:ssh-fixture:verify");
      expect(job).toContain(`pnpm run check:fixture-results ${suite}`);
      expect(job).toContain(
        `pnpm run docker:ssh-fixture:diagnostics artifacts/ssh-fixture/${suite}`,
      );
      expect(job).toContain("if: ${{ failure() }}");
      expect(job).toContain("if: ${{ always() }}");
      expect(job).toContain(`artifacts/ssh-fixture/${suite}/**`);
      expect(job).toContain("retention-days: 14");
    }
  });
});
