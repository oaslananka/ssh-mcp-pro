import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const setupScript = resolve("scripts/setup-git-hooks.mjs");
let root: string;
let env: NodeJS.ProcessEnv;

function git(...args: string[]) {
  const result = spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

function prepare() {
  const result = spawnSync(process.execPath, [setupScript], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout + result.stderr;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ssh-mcp-hooks-"));
  const globalConfig = join(root, "global.gitconfig");
  writeFileSync(globalConfig, "");
  env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
  };
  delete env.GIT_CONFIG_COUNT;
  delete env.GIT_CONFIG_PARAMETERS;
  git("init", "--quiet");
  mkdirSync(join(root, ".githooks"));
  writeFileSync(join(root, ".githooks", "pre-commit"), "#!/bin/sh\nexit 0\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("prepare Git hooks", () => {
  test("installs repository hooks for a fresh clone and is idempotent", () => {
    prepare();
    prepare();
    expect(git("config", "--local", "--get", "core.hooksPath")).toBe(".githooks");
  });

  test("preserves inherited global hooks and explains repository checks", () => {
    git("config", "--global", "core.hooksPath", "/existing/global-hooks");
    const output = prepare();
    prepare();
    expect(git("config", "--get", "core.hooksPath")).toBe("/existing/global-hooks");
    expect(git("config", "--global", "--get", "core.hooksPath")).toBe("/existing/global-hooks");
    expect(output).toContain("pnpm run check");
  });

  test("preserves an explicit local hook provider", () => {
    git("config", "--local", "core.hooksPath", "custom-hooks");
    prepare();
    expect(git("config", "--local", "--get", "core.hooksPath")).toBe("custom-hooks");
  });
});
