import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const helper = path.join(root, "scripts/bootstrap-node-lts.sh");
const installer = path.join(root, "scripts/install-agent.sh");

describe.skipIf(process.platform === "win32")("verified user-local Node LTS bootstrap", () => {
  test("helper has valid Bash syntax and a non-mutating help path", () => {
    expect(spawnSync("bash", ["-n", helper]).status).toBe(0);
    const result = spawnSync("bash", [helper, "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Node 26");
  });

  test("selects only the official signed-manifest archive matching the host architecture", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ssh-mcp-node-manifest-"));
    try {
      const manifest = path.join(dir, "SHASUMS256.txt");
      const x64 = "a".repeat(64);
      const arm64 = "b".repeat(64);
      writeFileSync(
        manifest,
        [
          arm64 + "  node-v26.13.1-linux-arm64.tar.xz",
          x64 + "  node-v26.13.1-linux-x64.tar.xz",
          "c".repeat(64) + "  node-v26.13.1-linux-x64.tar.xz.evil",
        ].join("\n") + "\n",
      );
      const run = (arch: string) =>
        spawnSync(
          "bash",
          ["-c", 'source "$1"; select_archive_entry "$2" "$3"', "test", helper, manifest, arch],
          {
            encoding: "utf8",
          },
        );
      expect(run("x64")).toMatchObject({
        status: 0,
        stdout: x64 + " node-v26.13.1-linux-x64.tar.xz\n",
      });
      expect(run("arm64")).toMatchObject({
        status: 0,
        stdout: arm64 + " node-v26.13.1-linux-arm64.tar.xz\n",
      });
      expect(run("ppc64le").status).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects malformed manifest entries rather than accepting injection", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ssh-mcp-invalid-manifest-"));
    try {
      const manifest = path.join(dir, "SHASUMS256.txt");
      writeFileSync(manifest, "z".repeat(64) + "  node-v26.13.1-linux-x64.tar.xz\n");
      const r = spawnSync(
        "bash",
        ["-c", 'source "$1"; select_archive_entry "$2" x64', "test", helper, manifest],
        {
          encoding: "utf8",
        },
      );
      expect(r.status).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("installer bootstraps only user runtimes, never system-managed root binaries", () => {
    const code = readFileSync(installer, "utf8");
    expect(code).toContain('if [[ "$SCOPE" == "user" ]]');
    expect(code).toContain("bootstrap-node-lts.sh");
    expect(code).toContain("NPM_CONFIG_PREFIX");
    expect(code).toContain('trusted_system_path "$NODE_BIN"');
  });

  test("requires PGP-signed checksums and a private installation directory", () => {
    const code = readFileSync(helper, "utf8");
    expect(code).toContain("gpgv");
    expect(code).toContain("SHASUMS256.txt.asc");
    expect(code).toContain("sha256sum");
    expect(code).toContain("nodejs/release-keys");
    expect(code).toContain("nodejs.org/dist/latest-v26.x");
    expect(code).toContain("mktemp -d");
    expect(code).not.toContain("sudo ");
  });
});
