import type { ServerResponse } from "node:http";
import { afterEach, describe, expect, test, vi } from "vitest";
import { buildRateLimitHeaders, attachRateLimitHeaders } from "../../src/http-rate-limit.js";
import type { ServerConfig } from "../../src/config.js";
import { RateLimiter } from "../../src/rate-limiter.js";

const rateLimitConfig: ServerConfig["rateLimit"] = {
  enabled: true,
  maxRequests: 100,
  windowMs: 60_000,
  perSession: {
    enabled: true,
    maxRequests: 50,
    windowMs: 60_000,
  },
};

describe("HTTP rate limit headers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("builds X-RateLimit headers from global RateLimiter usage", () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const limiter = new RateLimiter({
      maxRequests: rateLimitConfig.maxRequests,
      windowMs: rateLimitConfig.windowMs,
      blockOnLimit: true,
    });

    try {
      for (let count = 0; count < 13; count += 1) {
        limiter.check("global");
      }

      const usage = limiter.getUsage("global", {
        maxRequests: rateLimitConfig.maxRequests,
        windowMs: rateLimitConfig.windowMs,
      });
      expect(usage).not.toBeNull();

      expect(buildRateLimitHeaders(limiter, rateLimitConfig, "global", now)).toEqual({
        "X-RateLimit-Limit": String(rateLimitConfig.maxRequests),
        "X-RateLimit-Remaining": String(usage?.remaining),
        "X-RateLimit-Reset": String(Math.ceil((now + (usage?.resetIn ?? 0)) / 1000)),
      });
    } finally {
      limiter.destroy();
    }
  });

  test("applies headers at write time so usage includes the current request", () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const limiter = new RateLimiter({
      maxRequests: rateLimitConfig.maxRequests,
      windowMs: rateLimitConfig.windowMs,
      blockOnLimit: true,
    });
    const response = {
      headersSent: false,
      setHeader: vi.fn(),
      writeHead: vi.fn(function writeHead() {
        response.headersSent = true;
        return response;
      }),
      end: vi.fn(function end() {
        response.headersSent = true;
        return response;
      }),
    } as unknown as ServerResponse;

    try {
      attachRateLimitHeaders(response, () =>
        buildRateLimitHeaders(limiter, rateLimitConfig, "global", now),
      );
      limiter.check("global");
      response.writeHead(200);

      expect(response.setHeader).toHaveBeenCalledWith("X-RateLimit-Limit", "100");
      expect(response.setHeader).toHaveBeenCalledWith("X-RateLimit-Remaining", "99");
      expect(response.setHeader).toHaveBeenCalledWith("X-RateLimit-Reset", "1700000060");
    } finally {
      limiter.destroy();
    }
  });
});
