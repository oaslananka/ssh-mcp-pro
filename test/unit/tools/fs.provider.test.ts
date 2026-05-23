import { describe, expect, jest, test } from "@jest/globals";
import { FsToolProvider } from "../../../src/tools/fs.provider.js";

describe("FsToolProvider", () => {
  test("dispatches filesystem tools", async () => {
    const provider = new FsToolProvider({
      fsService: {
        readFile: jest.fn(async () => "hello"),
        writeFile: jest.fn(async () => true),
        statFile: jest.fn(async () => ({
          type: "file",
          size: 5,
          mode: 0o644,
          mtime: new Date(0),
        })),
        listDirectory: jest.fn(async () => ({ entries: [] })),
        makeDirectories: jest.fn(async () => true),
        removeRecursive: jest.fn(async () => true),
        renameFile: jest.fn(async () => true),
      } as any,
    });

    await expect(provider.handleTool("fs_read", { sessionId: "s", path: "/tmp/a" })).resolves.toBe(
      "hello",
    );
    await expect(
      provider.handleTool("fs_write", {
        sessionId: "s",
        path: "/tmp/a",
        data: "x",
      }),
    ).resolves.toBe(true);
    await expect(
      provider.handleTool("fs_stat", { sessionId: "s", path: "/tmp/a" }),
    ).resolves.toEqual(expect.objectContaining({ type: "file" }));
    await expect(provider.handleTool("fs_list", { sessionId: "s", path: "/tmp" })).resolves.toEqual(
      { entries: [] },
    );
    await expect(
      provider.handleTool("fs_mkdirp", { sessionId: "s", path: "/tmp/a" }),
    ).resolves.toBe(true);
    await expect(provider.handleTool("fs_rmrf", { sessionId: "s", path: "/tmp/a" })).resolves.toBe(
      true,
    );
    await expect(
      provider.handleTool("fs_rename", {
        sessionId: "s",
        from: "/tmp/a",
        to: "/tmp/b",
      }),
    ).resolves.toBe(true);
  });
});
