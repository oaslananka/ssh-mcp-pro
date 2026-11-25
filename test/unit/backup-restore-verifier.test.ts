import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hasTools =
  process.platform !== "win32" &&
  ["python3", "openssl", "age", "age-keygen"].every(
    (tool) => spawnSync("sh", ["-c", "command -v " + tool], { timeout: 2_000 }).status === 0,
  );

const required = process.env.SSH_MCP_REQUIRE_BACKUP_TESTS === "true";

describe.skipIf(!hasTools && !required)("offline encrypted backup recovery", () => {
  test("runs the synthetic age/tar/SQLite/Ed25519 success and fail-closed checks", () => {
    expect(hasTools, "Required backup recovery tools are missing").toBe(true);
    const result = spawnSync("python3", ["test/unit/backup_restore_verifier_test.py"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 90_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("OK");
  }, 95_000);
});
