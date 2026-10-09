import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const renovate = JSON.parse(fs.readFileSync(path.join(repoRoot, "renovate.json"), "utf8")) as {
  prConcurrentLimit: number;
  branchConcurrentLimit: number;
  lockFileMaintenance: { addLabels: string[] };
  vulnerabilityAlerts: { labels: string[] };
  packageRules: Array<{
    description: string;
    matchUpdateTypes?: string[];
    matchPackageNames?: string[];
    addLabels?: string[];
  }>;
};
const mergify = fs.readFileSync(path.join(repoRoot, ".mergify.yml"), "utf8");

function rule(description: string) {
  const match = renovate.packageRules.find((r) => r.description === description);
  if (!match) throw new Error(`Missing Renovate policy: ${description}`);
  return match;
}

describe("Renovate and Mergify dependency convergence", () => {
  test("limits concurrent bot PRs and delegates safe patches to protected merge", () => {
    expect(renovate.prConcurrentLimit).toBeLessThanOrEqual(3);
    expect(renovate.branchConcurrentLimit).toBeLessThanOrEqual(3);
    const safe = rule("Delegate low-risk dependency merging to Mergify.");
    expect(safe.matchUpdateTypes).toEqual(["patch", "digest", "pin"]);
    expect(safe.addLabels).toContain("automerge:enabled");
    expect(mergify).toContain("author = renovate[bot]");
    expect(mergify).toContain("label = automerge:enabled");
    expect(mergify).toContain("branch_protection_injection_mode: queue");
  });

  test("keeps runtime, lockfile and vulnerability changes out of automatic merges", () => {
    const sensitive = rule("MCP SDK and SSH/runtime-affecting dependencies require manual review.");
    for (const dependency of ["@modelcontextprotocol/sdk", "node-ssh", "jose", "ws", "zod"]) {
      expect(sensitive.matchPackageNames).toContain(dependency);
    }
    expect(sensitive.addLabels).toContain("runtime-risk");
    expect(sensitive.addLabels).toContain("requires-review");
    expect(renovate.lockFileMaintenance.addLabels).toContain("requires-review");
    expect(renovate.lockFileMaintenance.addLabels).not.toContain("automerge:enabled");
    expect(renovate.vulnerabilityAlerts.labels).toContain("security");
    expect(mergify).toContain("- -label = runtime-risk");
    expect(mergify).toContain("- -label = requires-review");
    expect(mergify).toContain("- -label = security");
    expect(mergify).toContain("- '-files ~= ^Dockerfile$'");
    expect(mergify).toContain("- '-files ~= ^\\.github/'");
  });
});
