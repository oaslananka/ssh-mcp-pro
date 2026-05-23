import { describe, expect, test } from "@jest/globals";
import { ConfigManager } from "../../src/config.js";
import { createContainer, createTestContainer } from "../../src/container.js";
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
