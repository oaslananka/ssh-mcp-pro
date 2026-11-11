import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { searchAuthorizedFileNames } from "../../src/remote/agent-file-search.js";
import { mergeCustomPolicy } from "../../src/remote/policy.js";

function workspace() {
  const root = mkdtempSync(path.join(os.tmpdir(), "ssh-search-"));
  const allowed = path.join(root, "allowed");
  const denied = path.join(allowed, "private");
  const outside = path.join(root, "outside");
  mkdirSync(path.join(allowed, "src"), { recursive: true });
  mkdirSync(denied);
  mkdirSync(outside);
  writeFileSync(path.join(allowed, "config.json"), "{}");
  writeFileSync(path.join(allowed, "src", "config-prod.json"), "{}");
  writeFileSync(path.join(allowed, "src", "other.txt"), "ok");
  writeFileSync(path.join(allowed, ".secret-config.json"), "{}");
  writeFileSync(path.join(denied, "config-secret.json"), "{}");
  writeFileSync(path.join(outside, "config-outside.json"), "{}");
  const policy = mergeCustomPolicy({
    capabilities: { "files.read": true },
    allowPaths: [allowed.replaceAll("\\", "/")],
    denyPaths: [denied.replaceAll("\\", "/")],
    maxOutputBytes: 100_000,
  });
  return {
    root,
    allowed,
    denied,
    outside,
    policy,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("bounded authorized remote file discovery", () => {
  test("finds nested filenames without reading content or exposing denied/hidden paths", async () => {
    const env = workspace();
    try {
      const result = await searchAuthorizedFileNames(env.policy, { name_pattern: "*config*.json" });
      expect(result.matches.map(({ name }) => name).sort()).toEqual(
        ["config-prod.json", "config.json"].sort(),
      );
      expect(result.matches.every(({ path: file }) => file.startsWith(env.allowed))).toBe(true);
      expect(
        result.matches.some(
          ({ path: file }) => file.includes("private") || file.includes("outside"),
        ),
      ).toBe(false);
      expect(result.truncated).toBe(false);
    } finally {
      env.cleanup();
    }
  });

  test("honors max_depth, hidden-file opt-in and result limits", async () => {
    const env = workspace();
    try {
      const top = await searchAuthorizedFileNames(env.policy, {
        name_pattern: "*config*",
        max_depth: 0,
      });
      expect(top.matches.map(({ name }) => name)).toEqual(["config.json"]);
      const hidden = await searchAuthorizedFileNames(env.policy, {
        name_pattern: "*config*",
        include_hidden: true,
        max_depth: 0,
      });
      expect(hidden.matches.map(({ name }) => name)).toContain(".secret-config.json");
      const limited = await searchAuthorizedFileNames(env.policy, {
        name_pattern: "*config*",
        max_results: 1,
      });
      expect(limited.matches).toHaveLength(1);
      expect(limited.truncated).toBe(true);
    } finally {
      env.cleanup();
    }
  });

  test.skipIf(process.platform === "win32")(
    "skips symlink escapes even when names match",
    async () => {
      const env = workspace();
      try {
        symlinkSync(env.outside, path.join(env.allowed, "external"), "dir");
        symlinkSync(
          path.join(env.outside, "config-outside.json"),
          path.join(env.allowed, "config-link.json"),
          "file",
        );
        const result = await searchAuthorizedFileNames(env.policy, { name_pattern: "*config*" });
        expect(result.matches.map(({ name }) => name)).not.toContain("config-outside.json");
        expect(result.matches.map(({ name }) => name)).not.toContain("config-link.json");
      } finally {
        env.cleanup();
      }
    },
  );

  test("denies a requested root outside policy and validates parameters", async () => {
    const env = workspace();
    try {
      await expect(
        searchAuthorizedFileNames(env.policy, { name_pattern: "*", root_path: env.outside }),
      ).rejects.toMatchObject({ code: "POLICY_DENIED" });
      await expect(
        searchAuthorizedFileNames(env.policy, { name_pattern: "", root_path: env.allowed }),
      ).rejects.toMatchObject({ code: "POLICY_DENIED" });
      await expect(
        searchAuthorizedFileNames(env.policy, { name_pattern: "*", max_depth: 40 }),
      ).rejects.toMatchObject({ code: "POLICY_DENIED" });
      await expect(
        searchAuthorizedFileNames(env.policy, { name_pattern: "*", max_results: -1 }),
      ).rejects.toMatchObject({ code: "POLICY_DENIED" });
    } finally {
      env.cleanup();
    }
  });

  test("caps output by local policy without returning partial JSON", async () => {
    const env = workspace();
    try {
      const policy = { ...env.policy, maxOutputBytes: 130 };
      const result = await searchAuthorizedFileNames(policy, { name_pattern: "*config*" });
      expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(130);
      expect(result.truncated).toBe(true);
      expect(result.matches).toHaveLength(0);
    } finally {
      env.cleanup();
    }
  });
});
