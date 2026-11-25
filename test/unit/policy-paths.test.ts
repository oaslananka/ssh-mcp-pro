import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import {
  isPathUnder,
  isSegmentBoundaryPathMatch,
  normalizeLocalPolicyPath,
  normalizePolicyPaths,
  normalizeRemotePosixPath,
} from "../../src/policy-paths.js";
import * as publicPolicy from "../../src/policy.js";

describe("policy path normalization", () => {
  test("preserves remote POSIX normalization and rejects NUL", () => {
    expect(normalizeRemotePosixPath("tmp\\work\\..\\safe\\")).toBe("/tmp/safe");
    expect(normalizeRemotePosixPath("/../")).toBe("/");
    expect(normalizeRemotePosixPath("")).toBe("/");
    expect(() => normalizeRemotePosixPath("/tmp/\0bad")).toThrow("Path contains NUL byte");
  });

  test("matches whole path segments and root prefixes", () => {
    expect(isSegmentBoundaryPathMatch("/tmp/work", "/tmp", "/")).toBe(true);
    expect(isSegmentBoundaryPathMatch("/tmp", "/tmp", "/")).toBe(true);
    expect(isSegmentBoundaryPathMatch("/tmp-other", "/tmp", "/")).toBe(false);
    expect(isPathUnder("/tmp-other", "/tmp", "/")).toBe(false);
    expect(isPathUnder("/tmp-other", "/", "/")).toBe(true);
    const root = path.parse(path.resolve(".")).root;
    expect(isPathUnder(path.join(root, "work"), root, path.sep)).toBe(true);
  });

  test("deduplicates normalized prefixes and handles absent policy lists", () => {
    expect(normalizePolicyPaths(undefined, normalizeRemotePosixPath)).toEqual([]);
    expect(
      normalizePolicyPaths(["/tmp/", "tmp", "/tmp/a/..", "/var"], normalizeRemotePosixPath),
    ).toEqual(["/tmp", "/var"]);
  });

  test("resolves existing local links even when the remaining path does not exist", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "ssh-policy-path-"));
    try {
      const target = path.join(base, "target");
      const link = path.join(base, "link");
      fs.mkdirSync(target);
      fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
      const realTarget = fs.realpathSync.native(target);
      expect(normalizeLocalPolicyPath(link)).toBe(realTarget);
      expect(normalizeLocalPolicyPath(path.join(link, "new", "file"))).toBe(
        path.join(realTarget, "new", "file"),
      );
      expect(() => normalizeLocalPolicyPath(path.join(base, "\0bad"))).toThrow(
        "Path contains NUL byte",
      );
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("retains existing public policy exports", () => {
    expect(publicPolicy.normalizeRemotePosixPath).toBe(normalizeRemotePosixPath);
    expect(publicPolicy.isSegmentBoundaryPathMatch).toBe(isSegmentBoundaryPathMatch);
  });
});
