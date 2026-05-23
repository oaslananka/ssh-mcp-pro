import { describe, expect, jest, test } from "@jest/globals";
import { retry, retryable, withRetry } from "../../src/retry.js";

describe("withRetry", () => {
  test("returns result on first success", async () => {
    const result = await withRetry(async () => 42, { maxAttempts: 3 });

    expect(result.success).toBe(true);
    expect(result.result).toBe(42);
    expect(result.attempts).toBe(1);
  });

  test("retries retryable errors", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) {
          throw new Error("ETIMEDOUT");
        }
        return "ok";
      },
      {
        maxAttempts: 3,
        initialDelayMs: 1,
        maxDelayMs: 1,
        backoffMultiplier: 1,
        jitter: false,
      },
    );

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
  });

  test("does not retry non-retryable errors", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        throw new Error("auth failed");
      },
      {
        maxAttempts: 3,
        isRetryable: () => false,
      },
    );

    expect(result.success).toBe(false);
    expect(calls).toBe(1);
  });

  test.each([
    "timeout while connecting",
    "ECONNRESET",
    "ECONNREFUSED",
    "EPIPE",
    "network unreachable",
    "socket hang up",
  ])("retries default transient error: %s", async (message) => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls === 1) {
          throw new Error(message);
        }
        return "ok";
      },
      {
        maxAttempts: 2,
        initialDelayMs: 1,
        maxDelayMs: 1,
        backoffMultiplier: 1,
        jitter: false,
      },
    );

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  test("records retry callbacks and caps jittered delays", async () => {
    const originalRandom = Math.random;
    Math.random = jest.fn(() => 1) as unknown as typeof Math.random;
    const onRetry = jest.fn();
    let calls = 0;

    try {
      const result = await withRetry(
        async () => {
          calls++;
          if (calls === 1) {
            throw new Error("network");
          }
          return "ok";
        },
        {
          maxAttempts: 2,
          initialDelayMs: 10,
          maxDelayMs: 5,
          backoffMultiplier: 3,
          jitter: true,
          onRetry,
        },
      );

      expect(result.success).toBe(true);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), 6.25);
    } finally {
      Math.random = originalRandom;
    }
  });

  test("returns failure for non-error values", async () => {
    const result = await withRetry(
      async () => {
        throw "plain";
      },
      { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1 },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("plain");
    expect(result.attempts).toBe(2);
  });
});

describe("retry", () => {
  test("throws the last error on failure", async () => {
    await expect(
      retry(
        async () => {
          throw new Error("oops");
        },
        { maxAttempts: 1 },
      ),
    ).rejects.toThrow("oops");
  });
});

describe("retryable decorator", () => {
  test("wraps a method with retry behavior", async () => {
    class Example {
      public attempts = 0;

      async run(): Promise<string> {
        this.attempts++;
        if (this.attempts < 2) {
          throw new Error("network");
        }
        return "done";
      }
    }

    const descriptor = Object.getOwnPropertyDescriptor(Example.prototype, "run");
    if (!descriptor) {
      throw new Error("descriptor missing");
    }

    const decorated = retryable({
      maxAttempts: 2,
      initialDelayMs: 1,
      maxDelayMs: 1,
      backoffMultiplier: 1,
      jitter: false,
    })(Example.prototype, "run", descriptor);
    Object.defineProperty(Example.prototype, "run", decorated);

    const example = new Example();
    await expect(example.run()).resolves.toBe("done");
    expect(example.attempts).toBe(2);
  });

  test("leaves descriptors without values unchanged", () => {
    const descriptor: TypedPropertyDescriptor<(...args: unknown[]) => Promise<unknown>> = {};

    expect(retryable()(ExampleTarget.prototype, "missing", descriptor)).toBe(descriptor);
  });
});

class ExampleTarget {}
