import { afterEach, beforeEach, describe, expect, vi, test } from "vitest";
import {
  LogLevel,
  Logger,
  Timer,
  createTimer,
  redactErrorMessage,
  redactSensitiveData,
} from "../../src/logging.js";

describe("logging utilities", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vi.useRealTimers();
  });

  test("redactSensitiveData redacts nested sensitive fields", () => {
    const result = redactSensitiveData({
      username: "demo",
      password: "secret",
      authToken: "token-value",
      nested: {
        privateKey: "pem-data",
        apiKey: "api-key",
        values: [{ sudoPassword: "pw" }],
      },
    });

    expect(result).toEqual({
      username: "demo",
      password: "****",
      authToken: "****",
      nested: {
        privateKey: "****",
        apiKey: "****",
        values: [{ sudoPassword: "****" }],
      },
    });
  });

  test("redactSensitiveData preserves nullish and empty sensitive values", () => {
    expect(redactSensitiveData(null)).toBeNull();
    expect(redactSensitiveData(undefined)).toBeUndefined();
    expect(
      redactSensitiveData({
        password: "",
        nested: {
          token: null,
          values: [undefined, "plain"],
        },
      }),
    ).toEqual({
      password: "",
      nested: {
        token: null,
        values: [undefined, "plain"],
      },
    });
  });

  test("redactSensitiveData redacts sensitive numbers and preserves booleans", () => {
    expect(
      redactSensitiveData({
        token: 0,
        authEnabled: false,
        bearer: true,
      }),
    ).toEqual({
      token: "****",
      authEnabled: false,
      bearer: true,
    });
  });

  test("redactErrorMessage removes sensitive patterns and keeps benign text", () => {
    const message =
      "Authentication failed password=secret key=my-key bearer abc123 pem=inline path=/tmp/value";
    const redacted = redactErrorMessage(message);

    expect(redacted).toContain("****");
    expect(redacted).toContain("path=/tmp/value");
    expect(redacted).not.toContain("secret");
    expect(redacted).not.toContain("my-key");
    expect(redacted).not.toContain("abc123");
  });

  test("Logger respects log level filtering and redacts payloads", () => {
    const logger = new Logger(LogLevel.WARN);

    logger.info("skipped", { password: "secret" });
    expect(stderrSpy).not.toHaveBeenCalled();

    logger.error("password=secret", { password: "secret" });
    expect(stderrSpy).toHaveBeenCalledTimes(1);

    const output = String(stderrSpy.mock.calls[0][0]);
    expect(output).toContain("ERROR");
    expect(output).toContain("****");
    expect(output).not.toContain("secret");
  });

  test("Logger supports silent filtering", () => {
    const logger = new Logger(LogLevel.SILENT);

    logger.error("hidden", { sessionId: "abc123" });
    logger.warn("hidden", { sessionId: "abc123" });

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  test("Logger emits structured JSON when configured", () => {
    const logger = new Logger(LogLevel.INFO, "json");

    logger.info("session opened", { password: "secret", sessionId: "abc123" });

    expect(stderrSpy).toHaveBeenCalledTimes(1);

    const output = String(stderrSpy.mock.calls[0][0]).trim();
    const parsed = JSON.parse(output) as {
      timestamp: string;
      level: string;
      message: string;
      data: { password: string; sessionId: string };
    };

    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("session opened");
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.data).toEqual({ password: "****", sessionId: "abc123" });
  });

  test("Timer and createTimer measure elapsed time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T00:00:00Z"));

    const timer = new Timer();
    vi.setSystemTime(new Date("2026-03-22T00:00:01Z"));
    expect(timer.elapsed()).toBe(1000);

    timer.reset();
    vi.setSystemTime(new Date("2026-03-22T00:00:01.500Z"));
    expect(timer.elapsed()).toBe(500);

    const created = createTimer();
    vi.setSystemTime(new Date("2026-03-22T00:00:02Z"));
    expect(created.elapsed()).toBe(500);
  });
});
