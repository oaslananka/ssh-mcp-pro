import { describe, expect, test } from "vitest";

type TaxonomyFixture = ReturnType<typeof taxonomyFixture>;
type Label = { name: string; color?: string; description?: string };
type Issue = { number: number; labels?: Array<{ name: string }> | null };
type GhFailureResult = { status: number | null; stderr?: string; stdout?: string; error?: Error };
type GovernanceModule = {
  PROJECT_SCOPE_HINT: string;
  getRequiredLabels(taxonomy: TaxonomyFixture): Label[];
  validateLabels(actualLabels: Label[] | null | undefined, taxonomy: TaxonomyFixture): string[];
  validateIssueTaxonomy(issues: Issue[] | null | undefined, taxonomy: TaxonomyFixture): string[];
  validateProjectFields(
    fieldsPayload: { fields: Array<{ name: string }> } | null | undefined,
    taxonomy: TaxonomyFixture,
  ): string[];
  extractProjectItemIssueNumbers(projectPayload: unknown): Set<number>;
  validateProjectItems(projectPayload: unknown, issues: Issue[] | null | undefined): string[];
  formatGhFailure(args: string[], result: GhFailureResult): string;
};

async function loadGovernanceCheck(): Promise<GovernanceModule> {
  const scriptUrl = new URL("../../scripts/check-governance.mjs", import.meta.url);
  const module = await import(scriptUrl.href);
  return module as GovernanceModule;
}

function taxonomyFixture() {
  return {
    project: {
      requiredFields: ["Product", "Area", "Priority", "Phase", "Status", "Risk"],
    },
    labelGroups: {
      priority: [
        {
          name: "priority:P2",
          color: "fbca04",
          description: "Medium-priority scheduled work",
        },
      ],
      area: [
        {
          name: "area:governance",
          color: "1d76db",
          description: "Governance, labels, triage, projects, policies, and compliance",
        },
      ],
      type: [
        {
          name: "type:task",
          color: "cfd3d7",
          description: "Operational or maintenance task",
        },
      ],
      risk: [
        {
          name: "risk:medium",
          color: "fbca04",
          description: "Moderate implementation or operational risk",
        },
      ],
    },
  };
}

describe("governance check", () => {
  test("validates canonical labels from the taxonomy manifest", async () => {
    const { getRequiredLabels, validateLabels } = await loadGovernanceCheck();
    const taxonomy = taxonomyFixture();

    expect(validateLabels(getRequiredLabels(taxonomy), taxonomy)).toEqual([]);

    expect(validateLabels([], taxonomy)).toContain("Missing label priority:P2.");
    expect(
      validateLabels([{ name: "priority:P2", color: "000000", description: "wrong" }], taxonomy),
    ).toEqual([
      "Label priority:P2 color is 000000; expected fbca04.",
      "Label priority:P2 description does not match the governance taxonomy.",
      "Missing label area:governance.",
      "Missing label type:task.",
      "Missing label risk:medium.",
    ]);
  });

  test("requires exactly one canonical label in every group for each open issue", async () => {
    const { validateIssueTaxonomy } = await loadGovernanceCheck();
    const taxonomy = taxonomyFixture();

    const failures = validateIssueTaxonomy(
      [
        {
          number: 50,
          labels: [{ name: "priority:P2" }, { name: "type:task" }],
        },
      ],
      taxonomy,
    );

    expect(failures).toEqual([
      "Issue #50 has 0 area labels; expected exactly one.",
      "Issue #50 has 0 risk labels; expected exactly one.",
    ]);
  });

  test("validates required GitHub Project fields", async () => {
    const { validateProjectFields } = await loadGovernanceCheck();

    expect(
      validateProjectFields(
        { fields: [{ name: "Product" }, { name: "Area" }, { name: "Priority" }] },
        taxonomyFixture(),
      ),
    ).toEqual([
      "Project is missing required field Phase.",
      "Project is missing required field Status.",
      "Project is missing required field Risk.",
    ]);
  });

  test("handles incomplete GitHub payloads without throwing", async () => {
    const {
      extractProjectItemIssueNumbers,
      validateIssueTaxonomy,
      validateLabels,
      validateProjectFields,
      validateProjectItems,
    } = await loadGovernanceCheck();
    const taxonomy = taxonomyFixture();

    expect(validateLabels(undefined, taxonomy)).toContain("Missing label priority:P2.");
    expect(validateIssueTaxonomy([{ number: 50, labels: null }], taxonomy)).toContain(
      "Issue #50 has 0 priority labels; expected exactly one.",
    );
    expect(validateProjectFields(undefined, taxonomy)).toContain(
      "Project is missing required field Product.",
    );
    expect(extractProjectItemIssueNumbers(undefined)).toEqual(new Set());
    expect(validateProjectItems(undefined, undefined)).toEqual([]);
  });

  test("extracts issue numbers from GitHub Project items", async () => {
    const { extractProjectItemIssueNumbers } = await loadGovernanceCheck();

    expect(
      extractProjectItemIssueNumbers({
        items: [
          { content: { number: 50 } },
          { content: { url: "https://github.com/oaslananka/ssh-mcp-pro/issues/48" } },
        ],
      }),
    ).toEqual(new Set([50, 48]));
  });

  test("explains the project auth scope needed by the GitHub CLI", async () => {
    const { PROJECT_SCOPE_HINT, formatGhFailure } = await loadGovernanceCheck();

    expect(
      formatGhFailure(["project", "item-list", "5"], {
        status: 1,
        stderr: "error: your authentication token is missing required scopes [read:project]",
        stdout: "",
      }),
    ).toContain(PROJECT_SCOPE_HINT);
  });

  test("explains when the GitHub CLI cannot be executed", async () => {
    const { formatGhFailure } = await loadGovernanceCheck();

    expect(
      formatGhFailure(["label", "list"], {
        status: null,
        error: new Error("spawn gh ENOENT"),
      }),
    ).toBe("Failed to execute gh: spawn gh ENOENT");
  });
});
