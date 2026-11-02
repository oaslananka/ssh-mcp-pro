import fs from "node:fs";
import { describe, expect, test } from "vitest";

const recovery = fs.readFileSync(".github/workflows/recover-v130-release-assets.yml", "utf8");

describe("v1.3.0 release asset recovery", () => {
  test("is explicit manual-only and restricted to the intended repository/main", () => {
    expect(recovery).toContain("workflow_dispatch:");
    expect(recovery).not.toContain("  push:");
    expect(recovery).not.toContain("  pull_request:");
    expect(recovery).toContain("github.repository == 'oaslananka/ssh-mcp-pro'");
    expect(recovery).toContain("github.ref == 'refs/heads/main'");
  });

  test("pins the published immutable tag and original successful preflight source", () => {
    expect(recovery).toContain("RECOVERY_TAG: ssh-mcp-pro-v1.3.0");
    expect(recovery).toContain("RECOVERY_TAG_SHA: a7929197bcc367a9d47cd728b0d0c051a74ec097");
    expect(recovery).toContain("RECOVERY_SOURCE_SHA: f262e93c10465a96a002ee27c8dd77e69ad62dcb");
    expect(recovery).toContain('RECOVERY_RUN_ID: "41403107666"');
    expect(recovery).toContain("git merge-base --is-ancestor");
  });

  test("allows only the two reviewed non-package freshness files to differ", () => {
    expect(recovery).toContain("scripts/check-dependency-freshness.mjs");
    expect(recovery).toContain("test/unit/dependency-freshness.test.ts");
    expect(recovery).toContain('test "$CHANGED" = "$EXPECTED"');
  });

  test("requires original checksums, verified provenance and byte-identical package rebuild", () => {
    expect(recovery).toContain("sha256sum -c ssh-mcp-pro-1.3.0.tgz.sha256");
    expect(recovery).toContain("sha256sum -c sbom.cdx.json.sha256");
    expect(recovery).toContain("gh attestation verify");
    expect(recovery).toContain('cmp "$PACKAGE_FILE" ../preflight-artifacts/ssh-mcp-pro-1.3.0.tgz');
    expect(recovery).toContain("delete rebuilt.serialNumber");
    expect(recovery).toContain("delete attested.serialNumber");
  });

  test("uploads only the four release assets and never starts npm/container/registry publication", () => {
    expect(recovery).toContain("gh release upload");
    expect(recovery).toContain('test "$(gh release view');
    expect(recovery).toContain("ssh-mcp-pro-1.3.0.tgz.sha256");
    expect(recovery).not.toContain("npm publish");
    expect(recovery).not.toContain("docker.yml");
    expect(recovery).not.toContain("publish-mcp-registry.yml");
  });
});
