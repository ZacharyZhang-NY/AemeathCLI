/**
 * Retry with exponential backoff per PRD section 20.2
 * Provider failover: If primary model fails, auto-fallback to configured backup.
 */

import { logger } from "./logger.js";

export interface IRetryOptions {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly shouldRetry?: (error: unknown, attempt: number) => boolean;
}

const DEFAULT_RETRY_OPTIONS: IRetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};

/**
 * Execute a function with exponential backoff retry.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<IRetryOptions>,
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      if (attempt === opts.maxRetries) {
        break;
      }

      if (opts.shouldRetry && !opts.shouldRetry(error, attempt)) {
        break;
      }

      const delay = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt) + Math.random() * 1_000,
        opts.maxDelayMs,
      );

      logger.warn(
        { attempt: attempt + 1, maxRetries: opts.maxRetries, delayMs: delay },
        "Retrying after error",
      );

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Sleep for a specified duration.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error indicates a rate limit (should retry after delay).
 */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes("rate limit") || message.includes("429") || message.includes("too many requests");
  }
  return false;
}

/**
 * Check if an error is transient (network issues, timeouts).
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("timeout") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("socket hang up") ||
      message.includes("503") ||
      message.includes("502")
    );
  }
  return false;
}
