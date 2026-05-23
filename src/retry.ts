import { logger } from "./logging.js";

/**
 * Retry configuration options
 */
export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Initial delay between retries in milliseconds */
  initialDelayMs: number;
  /** Maximum delay between retries in milliseconds */
  maxDelayMs: number;
  /** Multiplier for exponential backoff */
  backoffMultiplier: number;
  /** Whether to add jitter to delays */
  jitter: boolean;
  /** Function to determine if error is retryable */
  isRetryable?: (error: unknown) => boolean;
  /** Callback on each retry attempt */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

/**
 * Result of a retry operation
 */
export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: unknown;
  attempts: number;
  totalTimeMs: number;
}

type DecoratedAsyncMethod = (...args: unknown[]) => Promise<unknown>;

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Default retry predicate - retries on network and timeout errors
 */
function defaultIsRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Retry on transient errors
    return (
      message.includes("timeout") ||
      message.includes("etimedout") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("epipe") ||
      message.includes("network") ||
      message.includes("socket hang up")
    );
  }
  return false;
}

/**
 * Calculate delay with optional jitter
 */
function calculateDelay(attempt: number, options: RetryOptions): number {
  const exponentialDelay =
    options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, options.maxDelayMs);

  if (options.jitter) {
    // Add random jitter: ±25% of the delay
    const jitterRange = cappedDelay * 0.25;
    const jitter = (Math.random() * 2 - 1) * jitterRange;
    return Math.max(0, cappedDelay + jitter);
  }

  return cappedDelay;
}

/**
 * Sleep for a given duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic
 * Uses exponential backoff with optional jitter
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<RetryResult<T>> {
  const opts: RetryOptions = { ...DEFAULT_OPTIONS, ...options };
  const isRetryable = opts.isRetryable ?? defaultIsRetryable;

  const startTime = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const result = await fn();
      return {
        success: true,
        result,
        attempts: attempt,
        totalTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt >= opts.maxAttempts || !isRetryable(error)) {
        logger.debug("Retry: giving up", {
          attempt,
          maxAttempts: opts.maxAttempts,
          retryable: isRetryable(error),
        });
        break;
      }

      const delayMs = calculateDelay(attempt, opts);

      logger.debug("Retry: scheduling retry", { attempt, delayMs });

      if (opts.onRetry) {
        opts.onRetry(attempt, error, delayMs);
      }

      await sleep(delayMs);
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: opts.maxAttempts,
    totalTimeMs: Date.now() - startTime,
  };
}

/**
 * Decorator-style retry wrapper for class methods
 */
export function retryable(options: Partial<RetryOptions> = {}) {
  return function (
    _target: object,
    _propertyKey: string,
    descriptor: TypedPropertyDescriptor<DecoratedAsyncMethod>,
  ) {
    const originalMethod = descriptor.value;
    if (!originalMethod) {
      return descriptor;
    }

    descriptor.value = async function (...args: unknown[]) {
      const result = await withRetry(() => originalMethod.apply(this, args), options);

      if (!result.success) {
        throw result.error;
      }

      return result.result;
    };

    return descriptor;
  };
}

/**
 * Simple retry wrapper that throws on failure
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const result = await withRetry(fn, options);

  if (!result.success) {
    throw result.error;
  }

  return result.result!;
}
