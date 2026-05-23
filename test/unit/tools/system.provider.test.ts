import { describe, expect, jest, test } from "@jest/globals";
import { SystemToolProvider } from "../../../src/tools/system.provider.js";

describe("SystemToolProvider", () => {
  test("detects OS and returns metrics in both formats", async () => {
    const provider = new SystemToolProvider({
      sessionManager: {
        getOSInfo: jest.fn(async () => ({
          platform: "linux",
          distro: "ubuntu",
          version: "22.04",
          arch: "x64",
          shell: "bash",
          packageManager: "apt",
          init: "systemd",
          defaultShell: "bash",
        })),
      } as any,
      metrics: {
        getMetrics: jest.fn(() => ({ sessions: { active: 1 } })),
        exportPrometheus: jest.fn(() => "ssh_mcp_sessions_active 1"),
      } as any,
    });

    await expect(provider.handleTool("os_detect", { sessionId: "s" })).resolves.toEqual(
      expect.objectContaining({ platform: "linux" }),
    );
    await expect(provider.handleTool("get_metrics", {})).resolves.toEqual({
      sessions: { active: 1 },
    });
    await expect(provider.handleTool("get_metrics", { format: "prometheus" })).resolves.toBe(
      "ssh_mcp_sessions_active 1",
    );
    await expect(provider.handleTool("get_metrics", undefined)).resolves.toEqual({
      sessions: { active: 1 },
    });
    expect(provider.handleTool("missing", {})).toBeUndefined();
  });
});
