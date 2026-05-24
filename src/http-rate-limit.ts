import type { ServerResponse } from "node:http";
import type { ServerConfig } from "./config.js";
import type { RateLimiter } from "./rate-limiter.js";

const rateLimitHeaderNames = {
  limit: "X-RateLimit-Limit",
  remaining: "X-RateLimit-Remaining",
  reset: "X-RateLimit-Reset",
} as const;

type RateLimitResponseConfig = Pick<
  ServerConfig["rateLimit"],
  "enabled" | "maxRequests" | "windowMs"
>;
type RateLimitUsageSource = Pick<RateLimiter, "getUsage">;

export function buildRateLimitHeaders(
  rateLimiter: RateLimitUsageSource,
  rateLimit: RateLimitResponseConfig,
  key = "global",
  now = Date.now(),
): Record<string, string> {
  if (!rateLimit.enabled) {
    return {};
  }

  const usage = rateLimiter.getUsage(key, {
    maxRequests: rateLimit.maxRequests,
    windowMs: rateLimit.windowMs,
  });
  const resetIn = Math.max(0, usage?.resetIn ?? rateLimit.windowMs);

  return {
    [rateLimitHeaderNames.limit]: String(rateLimit.maxRequests),
    [rateLimitHeaderNames.remaining]: String(usage?.remaining ?? rateLimit.maxRequests),
    [rateLimitHeaderNames.reset]: String(Math.ceil((now + resetIn) / 1000)),
  };
}

export function attachRateLimitHeaders(
  res: ServerResponse,
  buildHeaders: () => Record<string, string>,
): void {
  const originalWriteHead = res.writeHead;
  const originalEnd = res.end;

  const applyHeaders = () => {
    if (res.headersSent) {
      return;
    }

    for (const [name, value] of Object.entries(buildHeaders())) {
      res.setHeader(name, value);
    }
  };

  res.writeHead = function writeHeadWithRateLimitHeaders(this: ServerResponse, ...args: unknown[]) {
    applyHeaders();
    return Reflect.apply(originalWriteHead, this, args);
  } as ServerResponse["writeHead"];

  res.end = function endWithRateLimitHeaders(this: ServerResponse, ...args: unknown[]) {
    applyHeaders();
    return Reflect.apply(originalEnd, this, args);
  } as ServerResponse["end"];
}
