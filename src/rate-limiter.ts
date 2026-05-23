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

/**
 * Rate limiter using the Sliding Window Log algorithm.
 */
export class RateLimiter {
  private readonly logs = new Map<string, number[]>();
  private readonly config: RateLimiterConfig;
  private cleanupTimer: NodeJS.Timeout | undefined;

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
  check(key: string): RateLimitResult {
    const now = Date.now();
    const cutoff = now - this.config.windowMs;

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
    if (count >= this.config.maxRequests) {
      const oldestInWindow = log[0] ?? now;
      const resetIn = oldestInWindow + this.config.windowMs - now;

      logger.warn("Rate limit exceeded (sliding window)", {
        key,
        count,
        max: this.config.maxRequests,
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
      remaining: Math.max(0, this.config.maxRequests - log.length),
      resetIn: this.config.windowMs,
      blocked: false,
    };
  }

  /**
   * Reset rate limit for a specific key
   */
  reset(key: string): void {
    this.logs.delete(key);
    logger.debug("Rate limit reset", { key });
  }

  /**
   * Get current usage for a key
   */
  getUsage(key: string): { count: number; remaining: number; resetIn: number } | null {
    const now = Date.now();
    const cutoff = now - this.config.windowMs;
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
      remaining: Math.max(0, this.config.maxRequests - activeLog.length),
      resetIn: oldestInWindow + this.config.windowMs - now,
    };
  }

  /**
   * Cleanup expired logs
   */
  private pruneExpiredLogs(): void {
    const cutoff = Date.now() - this.config.windowMs;
    let cleaned = 0;

    for (const [key, log] of this.logs) {
      const activeLog = log.filter((timestamp) => timestamp > cutoff);
      if (activeLog.length === 0) {
        this.logs.delete(key);
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
  }
}
