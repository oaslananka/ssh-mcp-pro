import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const dockerWorkflowPath = ".github/workflows/docker.yml";
const uploadArtifactAction = "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a";

function readText(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("Docker release workflow", () => {
  test("publishes a verified multi-platform GHCR image without Docker JavaScript actions", () => {
    const workflow = readText(dockerWorkflowPath);

    expect(workflow).toContain("PLATFORMS: linux/amd64,linux/arm64");
    expect(workflow).toContain("docker buildx create --name ssh-mcp-pro-check");
    expect(workflow).toContain('docker buildx build --check --platform "${PLATFORMS}" .');
    expect(workflow).toContain("docker buildx create --name ssh-mcp-pro-release");
    expect(workflow).toContain("Build and push multi-platform image");
    expect(workflow).toContain('--platform "${PLATFORMS}"');
    expect(workflow).toContain("--metadata-file artifacts/ghcr-image-metadata.json");
    expect(workflow).toContain("--provenance=true");
    expect(workflow).toContain("--sbom=true");
    expect(workflow).toContain("--push");
    expect(workflow).toContain("docker buildx imagetools inspect");
    expect(workflow).toContain(
      "/users/${GITHUB_REPOSITORY_OWNER}/packages/container/ssh-mcp-pro/versions",
    );
    expect(workflow).toContain(uploadArtifactAction);
    expect(workflow).not.toMatch(
      /docker\/(?:build-push|metadata|setup-buildx|setup-qemu)-action@/u,
    );
  });

  test("documents GHCR tag policy and digest-pinned usage", () => {
    const readme = readText("README.md");
    const dockerDocs = readText("docs/docker.md");

    expect(readme).toContain("ghcr.io/oaslananka/ssh-mcp-pro:1.0.0");
    expect(readme).toContain("digest-pinned");
    expect(dockerDocs).toContain("linux/amd64");
    expect(dockerDocs).toContain("linux/arm64");
    expect(dockerDocs).toContain("does not publish a mutable `latest` tag");
    expect(dockerDocs).toContain("ghcr.io/oaslananka/ssh-mcp-pro@sha256:<release-digest>");
    expect(dockerDocs).toContain("queries the GHCR package version metadata");
  });
});
