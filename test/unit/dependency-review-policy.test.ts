import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const workflowsDir = path.join(repoRoot, ".github/workflows");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function dependencyReviewJob(ci: string): string {
  const start = ci.indexOf("  dependency-review:");
  const end = ci.indexOf("\n  reuse:", start + 1);
  if (start < 0 || end < 0) {
    throw new Error("Unable to locate canonical dependency-review job in ci.yml");
  }
  return ci.slice(start, end);
}

function workflowFiles(): string[] {
  return fs
    .readdirSync(workflowsDir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map((name) => path.join(workflowsDir, name));
}

describe("canonical dependency review policy", () => {
  test("runs dependency-review-action exactly once per pull request", () => {
    const invocations = workflowFiles().flatMap((file) => {
      const contents = fs.readFileSync(file, "utf8");
      return contents.includes("actions/dependency-review-action@") ? [path.basename(file)] : [];
    });

    expect(invocations).toEqual(["ci.yml"]);
    expect(fs.existsSync(path.join(workflowsDir, "dependency-review.yml"))).toBe(false);
  });

  test("uses the moderate severity and shared license allowlist with least privilege", () => {
    const job = dependencyReviewJob(read(".github/workflows/ci.yml"));

    expect(job).toContain("name: Dependency Review");
    expect(job).toContain("if: ${{ github.event_name == 'pull_request' }}");
    expect(job).toContain("contents: read");
    expect(job).toContain("pull-requests: read");
    expect(job).not.toContain("pull-requests: write");
    expect(job).toContain(
      "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294",
    );
    expect(job).toContain("fail-on-severity: moderate");
    expect(job).toContain("allow-licenses: >-");
  });

  test("requires only the canonical Dependency Review context", () => {
    const ruleset = read(".github/rulesets/main-protection.json");
    const parsed = JSON.parse(ruleset) as {
      rules: Array<{
        type: string;
        parameters?: { required_status_checks?: Array<{ context: string }> };
      }>;
    };
    const contexts =
      parsed.rules
        .find((rule) => rule.type === "required_status_checks")
        ?.parameters?.required_status_checks?.map((check) => check.context) ?? [];

    expect(contexts).toContain("Dependency Review");
    expect(contexts).not.toContain("dependency-review");
  });

  test("documents the single blocking severity and license policy", () => {
    const guide = read("docs/development/dependency-management.md");

    expect(guide).toMatch(/single\s+canonical dependency review/u);
    expect(guide).toContain("moderate, high, or critical");
    expect(guide).toContain("license allowlist");
    expect(guide).toContain("Dependency Review");
  });
});
