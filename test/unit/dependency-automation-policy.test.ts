import fs from "node:fs";
import { describe, expect, test } from "vitest";

const renovate = JSON.parse(fs.readFileSync("renovate.json", "utf8")) as {
  prConcurrentLimit: number;
  branchConcurrentLimit: number;
  automerge: boolean;
  lockFileMaintenance: { automerge: boolean; addLabels: string[] };
  vulnerabilityAlerts: { labels: string[] };
  packageRules: Array<{
    description: string;
    matchUpdateTypes?: string[];
    matchManagers?: string[];
    matchDepTypes?: string[];
    matchCurrentVersion?: string;
    matchPackageNames?: string[];
    addLabels?: string[];
  }>;
};
const mergify = fs.readFileSync(".mergify.yml", "utf8");

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

  test("delegates stable minor dev updates and weekly lockfile maintenance to Mergify", () => {
    const safeMinor = rule(
      "Delegate stable minor development dependency updates to Mergify after CI.",
    );
    expect(safeMinor.matchManagers).toEqual(["npm"]);
    expect(safeMinor.matchDepTypes).toEqual(["devDependencies"]);
    expect(safeMinor.matchUpdateTypes).toEqual(["minor"]);
    expect(safeMinor.matchCurrentVersion).toBe("!/^0/");
    expect(safeMinor.addLabels).toEqual(expect.arrayContaining(["automerge:enabled", "risk:low"]));
    expect(renovate.lockFileMaintenance.automerge).toBe(false);
    expect(renovate.lockFileMaintenance.addLabels).toEqual(
      expect.arrayContaining(["lockfile", "automerge:enabled", "risk:low"]),
    );
    expect(renovate.lockFileMaintenance.addLabels).not.toContain("requires-review");
    expect(renovate.automerge).toBe(false);
  });

  test("keeps runtime, major and vulnerability changes out of automatic merges", () => {
    const sensitive = rule("MCP SDK and SSH/runtime-affecting dependencies require manual review.");
    for (const dependency of ["@modelcontextprotocol/server", "node-ssh", "jose", "ws", "zod"]) {
      expect(sensitive.matchPackageNames).toContain(dependency);
    }
    expect(sensitive.addLabels).toContain("runtime-risk");
    expect(sensitive.addLabels).toContain("requires-review");
    const major = rule("Require explicit approval for major version changes.");
    expect(major.addLabels).toContain("requires-review");
    expect(renovate.vulnerabilityAlerts.labels).toContain("security");
    expect(mergify).toContain("- -label = runtime-risk");
    expect(mergify).toContain("- -label = requires-review");
    expect(mergify).toContain("- -label = security");
    expect(mergify).toContain("- '-files ~= ^Dockerfile$'");
    expect(mergify).toContain("- '-files ~= ^\\.github/'");
  });
});
