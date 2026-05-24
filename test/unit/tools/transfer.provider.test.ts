import { describe, expect, vi, test } from "vitest";
import { TransferToolProvider } from "../../../src/tools/transfer.provider.js";

describe("TransferToolProvider", () => {
  test("dispatches upload and download tools", async () => {
    const provider = new TransferToolProvider({
      transferService: {
        uploadFileWithProgress: vi.fn(async () => ({ success: true })),
        downloadFileWithProgress: vi.fn(async () => ({ success: true })),
      } as any,
    });

    await expect(
      provider.handleTool("file_upload", {
        sessionId: "s",
        localPath: "a",
        remotePath: "b",
      }),
    ).resolves.toEqual({ success: true });
    await expect(
      provider.handleTool("file_download", {
        sessionId: "s",
        remotePath: "b",
        localPath: "a",
      }),
    ).resolves.toEqual({ success: true });
    expect(provider.handleTool("missing", {})).toBeUndefined();
  });
});
