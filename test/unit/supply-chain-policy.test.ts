import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function readText(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("supply-chain policy", () => {
  test("blocks exotic transitive dependencies at install time", () => {
    const workspace = readText("pnpm-workspace.yaml");

    expect(workspace).toMatch(/^blockExoticSubdeps: true$/mu);
  });

  test("uses the package-manager pin consistently and strips build tooling from runtime images", () => {
    const packageJson = JSON.parse(readText("package.json")) as { packageManager: string };
    const dockerfile = readText("Dockerfile");
    const supportedVersionDocs = [
      readText("CONTRIBUTING.md"),
      readText("docs/reference/compatibility.md"),
      readText("docs/repo-maturity-report.md"),
    ].join("\n");
    const workflows = fs
      .readdirSync(path.join(repoRoot, ".github/workflows"))
      .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
      .map((name) => readText(path.join(".github/workflows", name)))
      .join("\n");

    expect(packageJson.packageManager).toMatch(/^pnpm@11\.9\.0/u);
    expect(dockerfile).not.toContain("pnpm@11.5.1");
    expect(workflows).not.toContain("pnpm@11.5.1");
    expect(workflows).not.toContain("PNPM_VERSION: 11.5.1");
    expect(
      dockerfile.match(
        /node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd/gu,
      ) ?? [],
    ).toHaveLength(2);
    expect(dockerfile).not.toContain(
      "sha256:2bdb65ed1dab192432bc31c95f94155ca5ad7fc1392fb7eb7526ab682fa5bf14",
    );
    expect(dockerfile).toContain("pnpm@11.9.0");
    expect(supportedVersionDocs).toContain("pnpm 11.9.0");
    expect(supportedVersionDocs).not.toMatch(/pnpm (?:11\.0\.9|`?\^11\.5\.1)/u);
    expect(dockerfile).toContain("rm -rf /usr/local/lib/node_modules/npm");
    expect(dockerfile).toContain("rm -rf /usr/local/lib/node_modules/corepack");
    expect(dockerfile).toContain("rm -rf /opt/yarn-v*");
    expect(dockerfile).toContain("/usr/local/bin/yarn /usr/local/bin/yarnpkg");
  });

  test("holds dependency updates for seven days by default", () => {
    const renovate = JSON.parse(readText("renovate.json")) as {
      minimumReleaseAge?: string;
    };
    const raw = readText("renovate.json");

    expect(renovate.minimumReleaseAge).toBe("7 days");
    expect(raw).not.toContain('"minimumReleaseAge": "3 days"');
  });
});
