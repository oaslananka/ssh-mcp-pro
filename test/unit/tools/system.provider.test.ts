import { describe, expect, vi, test } from "vitest";
import { SystemToolProvider } from "../../../src/tools/system.provider.js";

describe("SystemToolProvider", () => {
  test("detects OS and returns metrics in both formats", async () => {
    const provider = new SystemToolProvider({
      sessionManager: {
        getOSInfo: vi.fn(async () => ({
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
        getMetrics: vi.fn(() => ({ sessions: { active: 1 } })),
        exportPrometheus: vi.fn(() => "ssh_mcp_sessions_active 1"),
      } as any,
    });

    await expect(provider.handleTool("os_detect", { sessionId: "s" })).resolves.toEqual(
      expect.objectContaining({ platform: "linux" }),
    );
    await expect(provider.handleTool("get_metrics", {})).resolves.toEqual({
      sessions: { active: 1 },
    });
    await expect(provider.handleTool("get_metrics", { format: "prometheus" })).resolves.toEqual({
      content: [{ type: "text", text: "ssh_mcp_sessions_active 1" }],
      structuredContent: {
        format: "prometheus",
        metrics: "ssh_mcp_sessions_active 1",
      },
    });
    await expect(provider.handleTool("get_metrics", undefined)).resolves.toEqual({
      sessions: { active: 1 },
    });
    expect(provider.handleTool("missing", {})).toBeUndefined();
  });

  test("sanitizes service names and quotes commands", async () => {
    const execCommand = vi.fn(async (_sid: string, cmd: string) => ({
      code: 0,
      stdout: "ok",
      stderr: "",
      durationMs: 10,
    }));
    const provider = new SystemToolProvider({
      sessionManager: {
        getSession: vi.fn(() => ({ info: { policyMode: "enforce" } })),
      } as any,
      metrics: {
        recordCommand: vi.fn(),
      } as any,
      processService: {
        execCommand,
      } as any,
    });

    await provider.handleTool("service_status", { sessionId: "s", name: "nginx" });
    expect(execCommand).toHaveBeenCalledWith("s", "systemctl status 'nginx' --no-pager");

    await provider.handleTool("service_restart", { sessionId: "s", name: "docker.service" });
    expect(execCommand).toHaveBeenCalledWith("s", "systemctl restart 'docker.service'");

    await provider.handleTool("service_stop", { sessionId: "s", name: "user@1000.service" });
    expect(execCommand).toHaveBeenCalledWith("s", "systemctl stop 'user@1000.service'");

    await provider.handleTool("service_logs", { sessionId: "s", name: "nginx", lines: 25 });
    expect(execCommand).toHaveBeenCalledWith("s", "journalctl -u 'nginx' -n 25 --no-pager");

    // Rejects injection attempts
    await expect(
      provider.handleTool("service_status", { sessionId: "s", name: "nginx; id; #" }),
    ).rejects.toThrow();

    await expect(
      provider.handleTool("service_restart", { sessionId: "s", name: "nginx$(whoami)" }),
    ).rejects.toThrow();
  });

  test("asserts policy and shell-quotes paths in disk_usage and log_tail", async () => {
    const execCommand = vi.fn(async (_sid: string, cmd: string) => ({
      code: 0,
      stdout: "ok",
      stderr: "",
      durationMs: 10,
    }));
    const assertAllowed = vi.fn();
    const provider = new SystemToolProvider({
      sessionManager: {
        getSession: vi.fn(() => ({ info: { policyMode: "enforce" } })),
      } as any,
      metrics: {
        recordCommand: vi.fn(),
      } as any,
      processService: {
        execCommand,
      } as any,
      policy: {
        assertAllowed,
      } as any,
    });

    await provider.handleTool("disk_usage", { sessionId: "s", path: "/var/log" });
    expect(assertAllowed).toHaveBeenCalledWith({
      action: "fs.read",
      path: "/var/log",
      mode: "enforce",
    });
    expect(execCommand).toHaveBeenCalledWith("s", "df -h '/var/log'");

    await provider.handleTool("log_tail", { sessionId: "s", path: "/var/log/syslog", lines: 10 });
    expect(assertAllowed).toHaveBeenCalledWith({
      action: "fs.read",
      path: "/var/log/syslog",
      mode: "enforce",
    });
    expect(execCommand).toHaveBeenCalledWith("s", "tail -n 10 '/var/log/syslog'");
  });
});
