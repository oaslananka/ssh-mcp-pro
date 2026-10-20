import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const cli = (script: string, args: string[]) =>
  spawnSync(process.execPath, [resolve("scripts", script), ...args], {
    encoding: "utf8",
    timeout: 5_000,
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

  test("permits the existing conventional commit range", () => {
    const result = cli("lint-commits.mjs", ["HEAD"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("lint-commits: validated");
  });
});
