import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

// Git hooks export GIT_DIR and related variables, which would otherwise make
// fixture commands operate on the real repository instead of the temporary one.
function fixtureGitEnv() {
  const env = { ...process.env };
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  ]) {
    delete env[key];
  }
  return env;
}

const cli = (script: string, args: string[], cwd?: string) =>
  spawnSync(process.execPath, [resolve("scripts", script), ...args], {
    encoding: "utf8",
    timeout: 5_000,
    cwd,
    env: { ...fixtureGitEnv(), COMMIT_RANGE: "" },
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
      execFileSync("git", ["init", "--quiet"], { cwd: repo, env: fixtureGitEnv() });
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
        { cwd: repo, env: fixtureGitEnv() },
      );
      const result = cli("lint-commits.mjs", ["HEAD"], repo);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("lint-commits: validated 1 commit subject");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
