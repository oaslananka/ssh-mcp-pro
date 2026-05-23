import { describe, expect, jest, test } from "@jest/globals";
import { EnsureToolProvider } from "../../../src/tools/ensure.provider.js";

describe("EnsureToolProvider", () => {
  test("dispatches ensure and patch tools", async () => {
    const provider = new EnsureToolProvider({
      ensureService: {
        ensurePackage: jest.fn(async () => ({ ok: true })),
        ensureService: jest.fn(async () => ({ ok: true })),
        ensureLinesInFile: jest.fn(async () => ({ ok: true, added: 1 })),
        applyPatch: jest.fn(async () => ({ ok: true, changed: true })),
      } as any,
    });

    await expect(
      provider.handleTool("ensure_package", {
        sessionId: "s",
        name: "curl",
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      provider.handleTool("ensure_service", {
        sessionId: "s",
        name: "nginx",
        state: "started",
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      provider.handleTool("ensure_lines_in_file", {
        sessionId: "s",
        path: "/tmp/demo",
        lines: ["x"],
      }),
    ).resolves.toEqual({ ok: true, added: 1 });
    await expect(
      provider.handleTool("patch_apply", {
        sessionId: "s",
        path: "/tmp/demo",
        diff: "@@ -1 +1 @@",
      }),
    ).resolves.toEqual({ ok: true, changed: true });
  });
});
