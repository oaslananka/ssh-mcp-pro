import { logger } from "./logging.js";

/**
 * Configuration for rate limiter
 */
export interface RateLimiterConfig {
  /** Maximum number of requests in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Whether to block requests that exceed the limit */
  blockOnLimit: boolean;
}

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
  blocked: boolean;
}

export type RateLimitCheckOptions = Partial<Pick<RateLimiterConfig, "maxRequests" | "windowMs">>;

/**
 * Rate limiter using the Sliding Window Log algorithm.
 */
export class RateLimiter {
  private readonly logs = new Map<string, number[]>();
  private readonly keyWindowMs = new Map<string, number>();
  private readonly config: RateLimiterConfig;
  private cleanupTimer: NodeJS.Timeout | undefined;
  private destroyed = false;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = {
      maxRequests: config.maxRequests ?? 100,
      windowMs: config.windowMs ?? 60_000,
      blockOnLimit: config.blockOnLimit ?? true,
    };

    this.cleanupTimer = setInterval(() => this.pruneExpiredLogs(), this.config.windowMs);
    this.cleanupTimer.unref?.();
  }

  /**
   * Check if request is allowed under the rate limit
   */
  check(key: string, options: RateLimitCheckOptions = {}): RateLimitResult {
    if (this.destroyed) {
      logger.warn("Rate limit check attempted after limiter destroy", { key });
      return {
        allowed: false,
        remaining: 0,
        resetIn: 0,
        blocked: true,
      };
    }

    const maxRequests = options.maxRequests ?? this.config.maxRequests;
    const windowMs = options.windowMs ?? this.config.windowMs;
    const now = Date.now();
    const cutoff = now - windowMs;
    this.keyWindowMs.set(key, windowMs);

    let log = this.logs.get(key);
    if (!log) {
      log = [];
      this.logs.set(key, log);
    }

    let index = 0;
    while (index < log.length && (log[index] ?? 0) <= cutoff) {
      index++;
    }
    if (index > 0) {
      log.splice(0, index);
    }

    const count = log.length;
    if (count >= maxRequests) {
      const oldestInWindow = log[0] ?? now;
      const resetIn = oldestInWindow + windowMs - now;

      logger.warn("Rate limit exceeded (sliding window)", {
        key,
        count,
        max: maxRequests,
        resetIn,
      });

      return {
        allowed: !this.config.blockOnLimit,
        remaining: 0,
        resetIn,
        blocked: this.config.blockOnLimit,
      };
    }

    log.push(now);

    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - log.length),
      resetIn: windowMs,
      blocked: false,
    };
  }

  /**
   * Reset rate limit for a specific key
   */
  reset(key: string): void {
    this.logs.delete(key);
    this.keyWindowMs.delete(key);
    logger.debug("Rate limit reset", { key });
  }

  /**
   * Get current usage for a key
   */
  getUsage(
    key: string,
    options: RateLimitCheckOptions = {},
  ): { count: number; remaining: number; resetIn: number } | null {
    const maxRequests = options.maxRequests ?? this.config.maxRequests;
    const windowMs = options.windowMs ?? this.keyWindowMs.get(key) ?? this.config.windowMs;
    const now = Date.now();
    const cutoff = now - windowMs;
    const log = this.logs.get(key);
    if (!log) {
      return null;
    }

    const activeLog = log.filter((timestamp) => timestamp > cutoff);
    if (activeLog.length === 0) {
      return null;
    }

    const oldestInWindow = activeLog[0] ?? now;
    return {
      count: activeLog.length,
      remaining: Math.max(0, maxRequests - activeLog.length),
      resetIn: oldestInWindow + windowMs - now,
    };
  }

  /**
   * Cleanup expired logs
   */
  private pruneExpiredLogs(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, log] of this.logs) {
      const windowMs = this.keyWindowMs.get(key) ?? this.config.windowMs;
      const keyCutoff = now - windowMs;
      const activeLog = log.filter((timestamp) => timestamp > keyCutoff);
      if (activeLog.length === 0) {
        this.logs.delete(key);
        this.keyWindowMs.delete(key);
        cleaned++;
        continue;
      }
      this.logs.set(key, activeLog);
    }

    if (cleaned > 0) {
      logger.debug("Rate limiter cleanup", { cleaned });
    }
  }

  /**
   * Destroy the rate limiter
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.logs.clear();
    this.keyWindowMs.clear();
    this.destroyed = true;
  }
}
