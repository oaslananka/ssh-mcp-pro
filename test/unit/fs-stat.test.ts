import { describe, expect, test, vi } from "vitest";
import { createStatFileInternal } from "../../src/fs-stat.js";

describe("SFTP and shell stat extraction", () => {
  test("rejects a missing session without remote execution", async () => {
    const execFallback = vi.fn();
    const stat = createStatFileInternal({
      sessionManager: { getSession: () => undefined } as any,
      execFallback,
      shellQuote: (value) => JSON.stringify(value),
    });
    await expect(stat("missing", "/tmp/a")).rejects.toThrow("Session missing not found or expired");
    expect(execFallback).not.toHaveBeenCalled();
  });

  test.each([
    ["directory", 0o040755, "directory"],
    ["symlink", 0o120777, "symlink"],
    ["isFile helper", 0, "file"],
    ["isDirectory helper", 0, "directory"],
    ["isSymbolicLink helper", 0, "symlink"],
  ] as const)("classifies %s from SFTP metadata", async (caseName, mode, expected) => {
    const attrs = {
      mode,
      size: 19,
      mtime: 1700000000,
      isFile: () => caseName === "isFile helper",
      isDirectory: () => caseName === "isDirectory helper",
      isSymbolicLink: () => caseName === "isSymbolicLink helper",
    };
    const sftp = {
      stat: (_path: string, cb: (error: Error | null, result: typeof attrs) => void) =>
        cb(null, attrs),
    };
    const execFallback = vi.fn();
    const stat = createStatFileInternal({
      sessionManager: { getSession: () => ({ sftp, ssh: {} }) } as any,
      execFallback,
      shellQuote: (value) => JSON.stringify(value),
    });
    await expect(stat("valid", "/data/item")).resolves.toEqual({
      size: 19,
      mtime: new Date(1700000000 * 1000),
      mode,
      type: expected,
    });
    expect(execFallback).not.toHaveBeenCalled();
  });

  test("falls back to safe metadata defaults when SFTP attributes are missing", async () => {
    const sftp = {
      stat: (_path: string, cb: (error: Error | null, data: object) => void) => cb(null, {}),
    };
    const stat = createStatFileInternal({
      sessionManager: { getSession: () => ({ sftp, ssh: {} }) } as any,
      execFallback: vi.fn(),
      shellQuote: (value) => JSON.stringify(value),
    });
    await expect(stat("valid", "/data/incomplete")).resolves.toEqual({
      size: 0,
      mtime: expect.any(Date),
      mode: 0,
      type: "other",
    });
  });
});
