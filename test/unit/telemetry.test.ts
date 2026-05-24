import { afterEach, describe, expect, test } from "vitest";
import {
  getTelemetryConfig,
  initTelemetry,
  isTelemetryEnabled,
  normalizeOtlpEndpoint,
  shutdownTelemetry,
  withSpan,
} from "../../src/telemetry.js";

describe("telemetry helpers", () => {
  afterEach(async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_SERVICE_NAME;
    delete process.env.OTEL_SERVICE_VERSION;
    delete process.env.NODE_ENV;
    await shutdownTelemetry();
  });

  test("derives disabled config when OTLP endpoint is missing", () => {
    const config = getTelemetryConfig({});

    expect(config.enabled).toBe(false);
    expect(config.serviceName).toBe("ssh-mcp-pro");
  });

  test("normalizes OTLP trace endpoints", () => {
    expect(normalizeOtlpEndpoint("http://localhost:4318")).toBe("http://localhost:4318/v1/traces");
    expect(normalizeOtlpEndpoint("http://localhost:4318/v1/traces")).toBe(
      "http://localhost:4318/v1/traces",
    );
  });

  test("derives enabled config from env and trims override values", () => {
    const config = getTelemetryConfig(
      {
        OTEL_EXPORTER_OTLP_ENDPOINT: " http://collector:4318/ ",
        OTEL_SERVICE_NAME: " env-service ",
        OTEL_SERVICE_VERSION: " 1.2.3 ",
        NODE_ENV: " production ",
      },
      {
        serviceName: " override-service ",
      },
    );

    expect(config).toEqual({
      enabled: true,
      endpoint: "http://collector:4318/v1/traces",
      serviceName: "override-service",
      serviceVersion: "1.2.3",
      environment: "production",
    });
  });

  test("does not enable telemetry without an endpoint", () => {
    expect(initTelemetry()).toBe(false);
    expect(isTelemetryEnabled()).toBe(false);
  });

  test("enables and shuts down telemetry when an OTLP endpoint is configured", async () => {
    expect(
      initTelemetry({
        endpoint: "http://localhost:4318",
        serviceName: "test-service",
        serviceVersion: "1.0.0",
        environment: "test",
      }),
    ).toBe(true);
    expect(initTelemetry()).toBe(true);
    expect(isTelemetryEnabled()).toBe(true);

    await shutdownTelemetry();
    expect(isTelemetryEnabled()).toBe(false);
  });

  test("withSpan executes work even when telemetry is inactive", async () => {
    const result = await withSpan("test.span", async (span) => {
      span.setAttribute("example", "value");
      return 42;
    });

    expect(result).toBe(42);
  });

  test("withSpan records errors and rethrows them", async () => {
    await expect(
      withSpan("test.error", () => {
        throw new Error("span failed");
      }),
    ).rejects.toThrow("span failed");
  });
});
