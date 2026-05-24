import fc from "fast-check";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RateLimiter, type RateLimitResult } from "../../src/rate-limiter.js";

const ASSERT_OPTIONS = { numRuns: 75 };

describe("RateLimiter property invariants", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("more than maxRequests in one window rejects at least one request", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 1, max: 10 }),
        (maxRequests, extraRequests) => {
          const limiter = new RateLimiter({
            maxRequests,
            windowMs: 60_000,
            blockOnLimit: true,
          });

          try {
            const totalRequests = maxRequests + extraRequests;
            const results = Array.from({ length: totalRequests }, () => limiter.check("key"));

            expect(results.some((result) => !result.allowed || result.blocked)).toBe(true);
          } finally {
            limiter.destroy();
          }
        },
      ),
      ASSERT_OPTIONS,
    );
  });

  test("destroy followed by check fails closed or throws a controlled error", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 32 }), (key) => {
        const limiter = new RateLimiter({
          maxRequests: 5,
          windowMs: 60_000,
          blockOnLimit: true,
        });
        limiter.destroy();

        let result: RateLimitResult | undefined;
        let thrown: unknown;
        try {
          result = limiter.check(key);
        } catch (error) {
          thrown = error;
        }

        if (thrown !== undefined) {
          expect(thrown).toBeInstanceOf(Error);
        } else {
          expect(result).toEqual(expect.objectContaining({ allowed: false, blocked: true }));
        }
      }),
      ASSERT_OPTIONS,
    );
  });

  test("requests up to maxRequests remain allowed in a fresh window", () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 0, max: 20 }),
        (maxRequests, requestedCount) => {
          const limiter = new RateLimiter({
            maxRequests,
            windowMs: 60_000,
            blockOnLimit: true,
          });

          try {
            const count = Math.min(maxRequests, requestedCount);
            const results = Array.from({ length: count }, () => limiter.check("key"));

            expect(results.every((result) => result.allowed && !result.blocked)).toBe(true);
          } finally {
            limiter.destroy();
          }
        },
      ),
      ASSERT_OPTIONS,
    );
  });

  test("independent keys do not consume each other's remaining quota", () => {
    vi.spyOn(Date, "now").mockReturnValue(3_000);

    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (maxRequests) => {
        const limiter = new RateLimiter({
          maxRequests,
          windowMs: 60_000,
          blockOnLimit: true,
        });

        try {
          for (let index = 0; index < maxRequests; index++) {
            limiter.check("first");
          }

          expect(limiter.check("second").allowed).toBe(true);
        } finally {
          limiter.destroy();
        }
      }),
      ASSERT_OPTIONS,
    );
  });
});
