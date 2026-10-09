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

    expect(packageJson.packageManager).toMatch(/^pnpm@11\.28\.5/u);
    expect(dockerfile).not.toContain("pnpm@11.5.1");
    expect(workflows).not.toContain("pnpm@11.5.1");
    expect(workflows).not.toContain("PNPM_VERSION: 11.5.1");
    expect(
      dockerfile.match(
        /node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1/gu,
      ) ?? [],
    ).toHaveLength(1);
    expect(dockerfile).toContain("RUN apk add --no-cache 'zlib>=1.3.2-r1'");
    expect(dockerfile).toContain("FROM alpine-patched AS build");
    expect(dockerfile).toContain("FROM alpine-patched AS runtime");
    expect(dockerfile).not.toContain(
      "sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd",
    );
    expect(dockerfile).toContain("pnpm@11.28.5");
    expect(supportedVersionDocs).toContain("pnpm 11.28.5");
    expect(supportedVersionDocs).not.toMatch(/pnpm (?:11\.0\.9|`?\^11\.5\.1)/u);
    expect(dockerfile).toContain("rm -rf /usr/local/lib/node_modules/npm");
    expect(dockerfile).toContain("rm -rf /usr/local/lib/node_modules/corepack");
    expect(dockerfile).toContain("rm -rf /opt/yarn-v*");
    expect(dockerfile).toContain("/usr/local/bin/yarn /usr/local/bin/yarnpkg");
  });

  test("pins policy and MCP publishing checkout actions to Node 24", () => {
    const pinnedCheckout = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
    const legacyCheckout = "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5";
    const affectedWorkflows = [
      readText(".github/workflows/publish-mcp-registry.yml"),
      readText(".github/workflows/ssh-safety-policy.yml"),
      readText(".github/workflows/agent-runtime-config.yml"),
    ];

    for (const contents of affectedWorkflows) {
      expect(contents).toContain(pinnedCheckout);
      expect(contents).not.toContain(legacyCheckout);
    }
    const checkoutRefs = [
      ...affectedWorkflows.join("\n").matchAll(/actions\/checkout@([^\s#]+)/gu),
    ];
    expect(checkoutRefs.length).toBe(4);
    for (const [, ref] of checkoutRefs) {
      expect(ref).toMatch(/^[a-f0-9]{40}$/u);
    }
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
