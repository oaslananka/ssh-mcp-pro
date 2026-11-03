import fs from "node:fs";
import { describe, expect, test } from "vitest";

const release = fs.readFileSync(".github/workflows/release.yml", "utf8");
const docker = fs.readFileSync(".github/workflows/docker.yml", "utf8");
const registry = fs.readFileSync(".github/workflows/publish-mcp-registry.yml", "utf8");
const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");

function section(text: string, start: string, end: string) {
  const begin = text.indexOf(start);
  const finish = text.indexOf(end, begin + start.length);
  if (begin < 0 || finish < 0) throw new Error(`Missing workflow section ${start}`);
  return text.slice(begin, finish);
}

describe("gated release lifecycle", () => {
  test("avoids duplicate feature branch push and PR CI runs", () => {
    const triggers = section(ci, "on:\n", "permissions:\n");
    expect(triggers).toContain("  pull_request:");
    expect(triggers).toContain("      - main");
    expect(triggers).not.toContain("fix/**");
    expect(triggers).not.toContain("chore/**");
    expect(triggers).not.toContain("feature/**");
  });

  test("keeps Node 24/26 on PRs and verifies Node 22 weekly and before releases", () => {
    const matrix = section(ci, "  unit:\n", "  node22-compatibility:\n");
    expect(matrix).toContain("node: 24.15.0");
    expect(matrix).toContain("node: 26.3.0");
    expect(matrix).not.toContain("node: 22.22.2");
    expect(matrix).toContain("pnpm run test:coverage");

    const compatibility = section(ci, "  node22-compatibility:\n", "  integration:\n");
    expect(compatibility).toContain("github.event_name == 'schedule'");
    expect(compatibility).toContain("github.event_name == 'workflow_dispatch'");
    expect(compatibility).toContain("node-version: 22.22.2");
    expect(compatibility).toContain("pnpm run build");
    expect(compatibility).toContain("pnpm run test:coverage");

    const preflight = section(release, "  release-preflight:\n", "  release:\n");
    expect(preflight).toContain("Verify Node 22 release compatibility");
    expect(preflight).toContain("node-version: 22.22.2");
    expect(preflight).toContain("Restore Node 26 for release packaging");
    expect(preflight.indexOf("Verify Node 22 release compatibility")).toBeLessThan(
      preflight.indexOf("Build package, SBOM and checksums"),
    );
  });

  test("gets SonarCloud credentials from Doppler without exposing every secret to later steps", () => {
    const matrix = section(ci, "  unit:\n", "  node22-compatibility:\n");
    expect(matrix).toContain("id: doppler_sonar");
    expect(matrix).toContain("dopplerhq/secrets-fetch-action@");
    expect(matrix).toContain("doppler-token: ${{ secrets.DOPPLER_TOKEN }}");
    expect(matrix).toContain("steps.doppler_sonar.outputs.SONAR_TOKEN");
    expect(matrix).not.toContain("inject-env-vars: true");
    expect(matrix).not.toContain("secrets.DOPPLER_TOKEN !=");
    expect(matrix).not.toContain("secrets.SONAR_TOKEN");
  });

  test("preflights package, SBOM and provenance before release-please creates a tag", () => {
    const preflight = section(release, "  release-preflight:", "  release:\n");
    expect(preflight).toContain("pnpm run check:freshness");
    expect(preflight).toContain("pnpm run check\n");
    expect(preflight).toContain("pnpm run sbom");
    expect(preflight).toContain('cd artifacts && sha256sum "${PACKAGE_FILE}"');
    expect(preflight).toContain("cd artifacts && sha256sum sbom.cdx.json");
    expect(preflight).toContain("pnpm pack --pack-destination artifacts");
    expect(preflight).toContain("Attest package before release creation");
    expect(preflight).toContain("release-preflight-artifacts");
    const releaseJob = section(release, "  release:\n", "  release-assets:\n");
    expect(releaseJob).toContain("needs: release-preflight");
    expect(releaseJob).toContain("needs.release-preflight.result == 'success'");
  });

  test("push releases attach only preflight-verified artifacts and trigger Docker", () => {
    const publishing = section(release, "  release-assets:", "  publish-npm:");
    expect(publishing).toContain("release-preflight-artifacts");
    expect(publishing).toContain("sha256sum -c");
    expect(publishing).toContain("commits/${RELEASE_TAG}");
    expect(publishing).toContain("gh release upload");
    expect(publishing).toContain("Trigger immutable-tag Docker publication");
    expect(publishing).toContain("gh workflow run docker.yml");
    expect(publishing).not.toContain("npm publish");
    expect(publishing).not.toContain("npm stage publish");
  });

  test("manual Release publishes the existing checked artifact directly via OIDC", () => {
    const publishing = release.slice(release.indexOf("  publish-npm:"));
    expect(publishing).toContain("github.event_name == 'workflow_dispatch'");
    expect(publishing).toContain("github.ref == 'refs/heads/main'");
    expect(publishing).toContain("id-token: write");
    expect(publishing).toContain("gh release download");
    expect(publishing).toContain("sha256sum -c");
    expect(publishing).toContain("gh attestation verify");
    expect(publishing).toContain("commits/${TAG}");
    expect(publishing).toContain("git merge-base --is-ancestor");
    expect(publishing).toContain("already_published == 'false'");
    expect(publishing).toContain("npm publish");
    expect(publishing).not.toContain("npm stage publish");
    expect(publishing).not.toContain("AUTO_RELEASE_PUBLISH");
    expect(publishing).not.toContain("gh release upload");
    expect(publishing).toContain("gh workflow run publish-mcp-registry.yml");
  });

  test("never publishes container or registry entries for an unverified tag/version", () => {
    expect(docker).toContain('gh release view "${VERSION_TAG}"');
    expect(docker).toContain("ghcr-release-verification");
    expect(registry).toContain("Verify immutable source and GitHub release");
    expect(registry).toContain('test "$RELEASE_TAG" = "ssh-mcp-pro-v${VERSION}"');
    expect(registry).toContain("Verify npm package exists");
    expect(registry).toContain("Check whether version is already in MCP Registry");
    expect(registry).toContain("steps.registry.outputs.exists == 'false'");
    expect(registry).not.toContain("github.event_name == 'schedule'");
    expect(registry).not.toContain("  reconcile:");
  });
});
