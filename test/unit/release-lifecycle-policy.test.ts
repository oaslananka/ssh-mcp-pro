import fs from "node:fs";
import { describe, expect, test } from "vitest";

const release = fs.readFileSync(".github/workflows/release.yml", "utf8");
const docker = fs.readFileSync(".github/workflows/docker.yml", "utf8");
const registry = fs.readFileSync(".github/workflows/publish-mcp-registry.yml", "utf8");

function section(text: string, start: string, end: string) {
  const begin = text.indexOf(start);
  const finish = text.indexOf(end, begin + start.length);
  if (begin < 0 || finish < 0) throw new Error(`Missing workflow section ${start}`);
  return text.slice(begin, finish);
}

describe("gated release lifecycle", () => {
  test("preflights package, SBOM and provenance before release-please creates a tag", () => {
    const preflight = section(release, "  release-preflight:", "  release:\n");
    expect(preflight).toContain("pnpm run check:freshness");
    expect(preflight).toContain("pnpm run check\n");
    expect(preflight).toContain("pnpm run sbom");
    expect(preflight).toContain("pnpm pack --pack-destination artifacts");
    expect(preflight).toContain("Attest package before release creation");
    expect(preflight).toContain("release-preflight-artifacts");
    const releaseJob = section(release, "  release:\n", "  release-assets:\n");
    expect(releaseJob).toContain("needs: release-preflight");
    expect(releaseJob).toContain("needs.release-preflight.result == 'success'");
  });

  test("ships exactly the preflight-tested artifact and blocks repeat staging", () => {
    const publishing = release.slice(release.indexOf("  release-assets:"));
    expect(publishing).toContain("release-preflight-artifacts");
    expect(publishing).toContain("sha256sum -c");
    expect(publishing).toContain("gh release upload");
    expect(publishing).toContain("git rev-parse HEAD");
    expect(publishing).toContain("Trigger immutable-tag GHCR publication");
    expect(publishing).toContain("gh workflow run docker.yml");
    expect(publishing).toContain("gh workflow run publish-mcp-registry.yml");
    expect(publishing).not.toContain("npm stage publish");
    expect(publishing).toContain(
      "github.event_name != 'workflow_dispatch' && vars.AUTO_RELEASE_PUBLISH == 'true'",
    );
    expect(publishing).toContain("0180a3961a8b105aa8003c93da1f3af93769a211");
  });

  test("never publishes container or registry entries for an unverified tag/version", () => {
    expect(docker).toContain('gh release view "${VERSION_TAG}"');
    expect(docker).toContain("ghcr-release-verification");
    expect(registry).toContain("Verify immutable source and GitHub release");
    expect(registry).toContain('test "$RELEASE_TAG" = "ssh-mcp-pro-v${VERSION}"');
    expect(registry).toContain("Verify npm package exists");
    expect(registry).toContain("Check whether version is already in MCP Registry");
    expect(registry).toContain("steps.registry.outputs.exists == 'false'");
    expect(registry).toContain("github.event_name == 'schedule'");
    expect(registry).toContain("ref=${TAG}");
  });
});
