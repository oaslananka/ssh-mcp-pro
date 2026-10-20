import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const cli = (script: string, args: string[], cwd?: string) =>
  spawnSync(process.execPath, [resolve("scripts", script), ...args], {
    encoding: "utf8",
    timeout: 5_000,
    cwd,
    env: { ...process.env, COMMIT_RANGE: "" },
  });

describe("maintenance CLI option boundaries", () => {
  test.each([
    "--registry=https://invalid.example",
    "--",
    "package;echo",
    "@scope/-malformed",
    "../sibling",
    "unsafe\nname",
  ])("rejects unsafe npm name %s before invoking npm", (value) => {
    const result = cli("check-npm-name.mjs", [value]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("valid-package-name");
    expect(result.stdout).toBe("");
  });

  test.each(["--exec=echo", "-c", "HEAD;echo", "HEAD\nother", "HEAD --all"])(
    "rejects untrusted git revision %s before invoking git",
    (value) => {
      const result = cli("lint-commits.mjs", [value]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("invalid revision range");
      expect(result.stdout).toBe("");
    },
  );

  test("permits HEAD when the revision points to a conventional commit", () => {
    const repo = mkdtempSync(join(tmpdir(), "ssh-mcp-cli-revision-"));
    try {
      execFileSync("git", ["init", "--quiet"], { cwd: repo });
      execFileSync(
        "git",
        [
          "-c",
          "user.name=CI",
          "-c",
          "user.email=ci@example.invalid",
          "commit",
          "--allow-empty",
          "-m",
          "test: validate revisions",
        ],
        { cwd: repo },
      );
      const result = cli("lint-commits.mjs", ["HEAD"], repo);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("lint-commits: validated 1 commit subject");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
