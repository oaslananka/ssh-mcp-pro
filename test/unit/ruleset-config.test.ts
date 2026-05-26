import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const rulesetPath = ".github/rulesets/main-protection.json";
const requiredProtectionContexts = [
  "Quality Gates",
  "Unit Tests (Node 22)",
  "Unit Tests (Node 24)",
  "SSH Integration",
  "Windows Integration",
  "SSH E2E",
  "Build, SBOM, and Pack",
  "Build and smoke image",
  "Analyze TypeScript",
  "Validate MCP Registry metadata",
] as const;

interface RequiredStatusCheck {
  readonly context: string;
  readonly integration_id?: number;
}

interface RulesetRule {
  readonly type: string;
  readonly parameters?: {
    readonly allowed_merge_methods?: readonly string[];
    readonly dismiss_stale_reviews_on_push?: boolean;
    readonly require_code_owner_review?: boolean;
    readonly require_last_push_approval?: boolean;
    readonly required_approving_review_count?: number;
    readonly required_review_thread_resolution?: boolean;
    readonly do_not_enforce_on_create?: boolean;
    readonly required_status_checks?: readonly RequiredStatusCheck[];
    readonly strict_required_status_checks_policy?: boolean;
  };
}

interface BranchRuleset {
  readonly name: string;
  readonly target: string;
  readonly enforcement: string;
  readonly bypass_actors: readonly unknown[];
  readonly conditions: {
    readonly ref_name: {
      readonly include: readonly string[];
      readonly exclude: readonly string[];
    };
  };
  readonly rules: readonly RulesetRule[];
}

function readText(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readText(relativePath)) as T;
}

function readRuleset() {
  return readJson<BranchRuleset>(rulesetPath);
}

function ruleOfType(ruleset: BranchRuleset, type: string) {
  const rule = ruleset.rules.find((candidate) => candidate.type === type);
  if (!rule) {
    throw new Error(`Missing ${type} rule in ${rulesetPath}`);
  }
  return rule;
}

function extractWorkflowJobNames(workflows: string) {
  return [...workflows.matchAll(/^ {4}name:\s+(.+)$/gm)].map((match) =>
    match[1].trim().replace(/^["'](.*)["']$/, "$1"),
  );
}

describe("GitHub branch protection ruleset configuration", () => {
  test("commits an active ruleset targeting the default branch", () => {
    expect(fs.existsSync(path.join(repoRoot, rulesetPath))).toBe(true);

    const ruleset = readRuleset();
    expect(ruleset).toMatchObject({
      name: "main branch protection",
      target: "branch",
      enforcement: "active",
      bypass_actors: [],
      conditions: {
        ref_name: {
          include: ["~DEFAULT_BRANCH"],
          exclude: [],
        },
      },
    });
  });

  test("requires pull requests, linear history, and blocks destructive changes", () => {
    const ruleset = readRuleset();
    const ruleTypes = ruleset.rules.map((rule) => rule.type);

    expect(ruleTypes).toEqual(
      expect.arrayContaining([
        "pull_request",
        "required_status_checks",
        "non_fast_forward",
        "required_linear_history",
        "deletion",
      ]),
    );

    expect(ruleOfType(ruleset, "pull_request").parameters).toMatchObject({
      allowed_merge_methods: ["squash", "rebase"],
      dismiss_stale_reviews_on_push: true,
      require_code_owner_review: false,
      require_last_push_approval: false,
      required_approving_review_count: 1,
      required_review_thread_resolution: true,
    });
  });

  test("requires protected status contexts that map to workflow job names", () => {
    const workflows = [
      readText(".github/workflows/ci.yml"),
      readText(".github/workflows/docker.yml"),
      readText(".github/workflows/codeql.yml"),
      readText(".github/workflows/mcp-registry.yml"),
    ].join("\n");
    const workflowJobNames = extractWorkflowJobNames(workflows);
    const statusRule = ruleOfType(readRuleset(), "required_status_checks");
    const contexts =
      statusRule.parameters?.required_status_checks?.map((check) => check.context) ?? [];

    expect(statusRule.parameters).toMatchObject({
      do_not_enforce_on_create: false,
      strict_required_status_checks_policy: true,
    });
    expect(contexts).toEqual([...requiredProtectionContexts]);

    expect(workflowJobNames).toEqual(
      expect.arrayContaining([
        "Quality Gates",
        "Unit Tests (Node ${{ matrix.node_major }})",
        "SSH Integration",
        "Windows Integration",
        "SSH E2E",
        "Build, SBOM, and Pack",
        "Build and smoke image",
        "Analyze TypeScript",
        "Validate MCP Registry metadata",
      ]),
    );
  });

  test("documents the version-controlled ruleset import path", () => {
    const contributing = readText("CONTRIBUTING.md");

    expect(contributing).toContain(rulesetPath);
    expect(contributing).toContain("https://docs.github.com");
    expect(contributing).toContain("Rulesets");
    expect(contributing).toContain("Administrators are enforced");
  });
});
