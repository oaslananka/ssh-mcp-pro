import { describe, expect, vi, test } from "vitest";
import { FsToolProvider } from "../../../src/tools/fs.provider.js";

describe("FsToolProvider", () => {
  test("dispatches filesystem tools", async () => {
    const provider = new FsToolProvider({
      fsService: {
        readFile: vi.fn(async () => "hello"),
        writeFile: vi.fn(async () => true),
        statFile: vi.fn(async () => ({
          type: "file",
          size: 5,
          mode: 0o644,
          mtime: new Date(0),
        })),
        listDirectory: vi.fn(async () => ({ entries: [] })),
        makeDirectories: vi.fn(async () => true),
        removeRecursive: vi.fn(async () => true),
        renameFile: vi.fn(async () => true),
      } as any,
    });

    await expect(
      provider.handleTool("fs_read", { sessionId: "s", path: "/tmp/a" }),
    ).resolves.toEqual({
      content: [{ type: "text", text: "hello" }],
      structuredContent: { content: "hello" },
    });
    await expect(
      provider.handleTool("fs_write", {
        sessionId: "s",
        path: "/tmp/a",
        data: "x",
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      provider.handleTool("fs_stat", { sessionId: "s", path: "/tmp/a" }),
    ).resolves.toEqual(
      expect.objectContaining({ type: "file", mtime: "1970-01-01T00:00:00.000Z" }),
    );
    await expect(provider.handleTool("fs_list", { sessionId: "s", path: "/tmp" })).resolves.toEqual(
      { entries: [] },
    );
    await expect(
      provider.handleTool("fs_mkdirp", { sessionId: "s", path: "/tmp/a" }),
    ).resolves.toEqual({ ok: true });
    await expect(
      provider.handleTool("fs_rmrf", { sessionId: "s", path: "/tmp/a" }),
    ).resolves.toEqual({ ok: true });
    await expect(
      provider.handleTool("fs_rename", {
        sessionId: "s",
        from: "/tmp/a",
        to: "/tmp/b",
      }),
    ).resolves.toEqual({ ok: true });
  });
});
