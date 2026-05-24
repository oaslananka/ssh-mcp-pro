import { describe, expect, vi, test } from "vitest";
import { ConfigManager } from "../../src/config.js";
import { createContainer } from "../../src/container.js";
import { createTestContainer } from "./helpers.js";
import { MetricsCollector } from "../../src/metrics.js";

describe("createContainer", () => {
  test("creates all required services", async () => {
    const container = createContainer();

    expect(container.config).toBeDefined();
    expect(container.rateLimiter).toBeDefined();
    expect(container.metrics).toBeDefined();
    expect(container.sessionManager).toBeDefined();
    expect(container.tunnelService).toBeDefined();

    container.rateLimiter.destroy();
    await container.sessionManager.destroy();
  });

  test("applies config overrides", async () => {
    const container = createContainer({ maxSessions: 7 });

    expect(container.config.get("maxSessions")).toBe(7);

    container.rateLimiter.destroy();
    await container.sessionManager.destroy();
  });

  test("records policy decisions in production audit and metrics services", async () => {
    const container = createContainer();

    container.policy.assertAllowed({
      action: "ssh.open",
      host: "example.com",
      username: "deploy",
    });
    container.policy.assertAllowed({
      action: "fs.read",
      path: "/tmp/app.log",
    });
    container.policy.assertAllowed({
      action: "proc.exec",
      command: "pwd",
    });

    expect(container.metrics.getMetrics().policy.allowed).toBe(3);
    expect(container.auditLog.list(3)).toMatchObject([
      {
        action: "ssh.open",
        host: "example.com",
        username: "deploy",
        allowed: true,
        mode: "enforce",
      },
      {
        action: "fs.read",
        target: "/tmp/app.log",
        allowed: true,
        mode: "enforce",
      },
      {
        action: "proc.exec",
        target: "pwd",
        allowed: true,
        mode: "enforce",
      },
    ]);

    container.rateLimiter.destroy();
    await container.sessionManager.destroy();
  });

  test("closes tunnels when production sessions close", async () => {
    const container = createContainer();
    const closeSessionTunnels = vi
      .spyOn(container.tunnelService, "closeSessionTunnels")
      .mockResolvedValue(1);
    const dispose = vi.fn();
    const now = Date.now();

    (
      container.sessionManager as unknown as {
        sessions: Map<string, unknown>;
      }
    ).sessions.set("session-1", {
      ssh: { dispose },
      info: {
        sessionId: "session-1",
        host: "example.com",
        username: "deploy",
        port: 22,
        createdAt: now,
        expiresAt: now + 60_000,
        lastUsed: now,
        policyMode: "enforce",
        hostKeyPolicy: "strict",
      },
    });

    await expect(container.sessionManager.closeSession("session-1")).resolves.toBe(true);
    expect(closeSessionTunnels).toHaveBeenCalledWith("session-1");
    expect(dispose).toHaveBeenCalledTimes(1);

    closeSessionTunnels.mockRestore();
    container.rateLimiter.destroy();
    await container.sessionManager.destroy();
  });
});

describe("createTestContainer", () => {
  test("uses a non-blocking rate limiter by default", async () => {
    const container = createTestContainer();

    for (let index = 0; index < 200; index++) {
      expect(container.rateLimiter.check("x").allowed).toBe(true);
    }

    container.rateLimiter.destroy();
    await container.sessionManager.destroy();
  });

  test("accepts partial overrides", async () => {
    const customMetrics = new MetricsCollector();
    const customConfig = new ConfigManager({ maxSessions: 11 });
    const container = createTestContainer({
      metrics: customMetrics,
      config: customConfig,
    });

    expect(container.metrics).toBe(customMetrics);
    expect(container.config).toBe(customConfig);
    expect(container.tunnelService).toBeDefined();
    expect(container.sessionManager.getActiveSessions()).toEqual([]);

    container.rateLimiter.destroy();
    await container.sessionManager.destroy();
  });
});
