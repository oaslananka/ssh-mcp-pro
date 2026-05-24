import { readFileSync } from "node:fs";
import { SpanStatusCode, trace, type Span, type SpanOptions } from "@opentelemetry/api";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  getTelemetryConfig,
  initTelemetry,
  isTelemetryEnabled,
  normalizeOtlpEndpoint,
  shutdownTelemetry,
  withSpan,
} from "../../src/telemetry.js";

function createMockSpan(): Span {
  return {
    addEvent: vi.fn(),
    addLink: vi.fn(),
    addLinks: vi.fn(),
    end: vi.fn(),
    isRecording: vi.fn(() => true),
    recordException: vi.fn(),
    setAttribute: vi.fn(),
    setAttributes: vi.fn(),
    setStatus: vi.fn(),
    spanContext: vi.fn(() => ({
      spanId: "1234567890abcdef",
      traceFlags: 1,
      traceId: "1234567890abcdef1234567890abcdef",
    })),
    updateName: vi.fn(),
  } as unknown as Span;
}

function mockTracerWithSpan(span: Span) {
  const startActiveSpan = vi.fn(
    (_name: string, _options: SpanOptions, work: (activeSpan: Span) => unknown) => work(span),
  );

  vi.spyOn(trace, "getTracer").mockReturnValue({
    startActiveSpan,
  } as unknown as ReturnType<typeof trace.getTracer>);

  return startActiveSpan;
}

describe("telemetry helpers", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_SERVICE_NAME;
    delete process.env.OTEL_SERVICE_VERSION;
    delete process.env.NODE_ENV;
    await shutdownTelemetry();
    initTelemetry();
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

  test("uses non-deprecated semantic convention constants", () => {
    const source = readFileSync(new URL("../../src/telemetry.ts", import.meta.url), "utf8");

    expect(source).not.toContain("SEMRESATTRS_");
    expect(source).toContain("ATTR_SERVICE_NAME");
    expect(source).toContain("ATTR_SERVICE_VERSION");
    expect(source).toContain("ATTR_DEPLOYMENT_ENVIRONMENT_NAME");
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

  test("withSpan calls work with the active span and returns its value", async () => {
    const span = createMockSpan();
    const startActiveSpan = mockTracerWithSpan(span);
    const work = vi.fn().mockResolvedValue("span result");
    const options = { attributes: { "ssh.session_id": "session-1" } };

    await expect(withSpan("ssh.test", work, options)).resolves.toBe("span result");

    expect(trace.getTracer).toHaveBeenCalledWith("ssh-mcp-pro");
    expect(startActiveSpan).toHaveBeenCalledWith("ssh.test", options, expect.any(Function));
    expect(work).toHaveBeenCalledWith(span);
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  test("withSpan sets error status and rethrows the original error", async () => {
    const span = createMockSpan();
    mockTracerWithSpan(span);
    const error = new Error("span failed");

    await expect(
      withSpan("ssh.error", () => {
        throw error;
      }),
    ).rejects.toBe(error);

    expect(span.recordException).toHaveBeenCalledWith(error);
    expect(span.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: "span failed",
    });
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  test("withSpan records errors and rethrows them", async () => {
    await expect(
      withSpan("test.error", () => {
        throw new Error("span failed");
      }),
    ).rejects.toThrow("span failed");
  });
});
