import { describe, expect, test } from "@jest/globals";
import { createTestContainer } from "../../../src/container.js";
import { createToolRegistry } from "../../../src/tools/index.js";

describe("createToolRegistry", () => {
  test("assembles the default providers", async () => {
    const container = createTestContainer();
    const registry = createToolRegistry(container);
    const toolNames = registry.getAllTools().map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "ssh_open_session",
        "proc_exec",
        "fs_read",
        "ensure_package",
        "get_metrics",
        "file_upload",
        "tunnel_local_forward",
      ]),
    );
    expect(registry.getAllTools()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "fs_read",
          annotations: expect.objectContaining({ readOnlyHint: true }),
          outputSchema: expect.objectContaining({ type: "object" }),
          title: expect.any(String),
        }),
        expect.objectContaining({
          name: "fs_rmrf",
          annotations: expect.objectContaining({ destructiveHint: true }),
          outputSchema: expect.objectContaining({ type: "object" }),
        }),
        expect.objectContaining({
          name: "proc_sudo",
          annotations: expect.objectContaining({ openWorldHint: true }),
        }),
      ]),
    );

    container.rateLimiter.destroy();
    await container.sessionManager.destroy();
  });
});
