import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../..");

function writeSilentPnpm(binDir: string): void {
  if (process.platform === "win32") {
    writeFileSync(join(binDir, "pnpm.cmd"), "@echo off\r\nexit /b 0\r\n");
    return;
  }

  const pnpmPath = join(binDir, "pnpm");
  writeFileSync(pnpmPath, "#!/bin/sh\nexit 0\n");
  chmodSync(pnpmPath, 0o755);
}

describe("license check script", () => {
  test("rejects empty license output without allowing PATH shims to shadow bundled Corepack", () => {
    const binDir = mkdtempSync(join(tmpdir(), "ssh-mcp-pro-pnpm-"));

    try {
      writeSilentPnpm(binDir);

      const result = spawnSync(process.execPath, ["scripts/check-licenses.mjs"], {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 15_000,
        env: {
          ...process.env,
          PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        },
      });

      // On Windows, a bundled trusted Corepack entrypoint takes priority over PATH.
      const bundledCorepack = join(
        dirname(process.execPath),
        "node_modules",
        "corepack",
        "dist",
        "pnpm.js",
      );
      if (process.platform === "win32" && existsSync(bundledCorepack)) {
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("check-licenses: accepted");
      } else {
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("succeeded without JSON output");
      }
      expect(result.stderr).not.toContain("ERR_INVALID_ARG_TYPE");
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  }, 20_000);
});
