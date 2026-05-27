import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../..");

function writeFailingPnpm(binDir: string): void {
  if (process.platform === "win32") {
    writeFileSync(join(binDir, "pnpm.cmd"), "@echo off\r\nexit /b 1\r\n");
    return;
  }

  const pnpmPath = join(binDir, "pnpm");
  writeFileSync(pnpmPath, "#!/bin/sh\nexit 1\n");
  chmodSync(pnpmPath, 0o755);
}

describe("license check script", () => {
  test("reports an actionable error when pnpm license output is empty", () => {
    const binDir = mkdtempSync(join(tmpdir(), "ssh-mcp-pro-pnpm-"));

    try {
      writeFailingPnpm(binDir);

      const result = spawnSync(process.execPath, ["scripts/check-licenses.mjs"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("pnpm licenses list --json failed");
      expect(result.stderr).not.toContain("ERR_INVALID_ARG_TYPE");
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });
});
