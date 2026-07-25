import type { CancellationToken } from './cancellation';

/**
 * Reusable retry policies. Execution services consume a policy rather than
 * implementing retry logic themselves, so backoff behavior is defined once and
 * tested in isolation.
 */

export type RetryKind = 'none' | 'fixed' | 'exponential';

export interface RetryPolicy {
  kind: RetryKind;
  /** Total attempts including the first (>= 1). */
  maxAttempts: number;
  /** Base delay between attempts, ms (fixed/exponential). */
  baseDelayMs: number;
  /** Ceiling for exponential backoff, ms. */
  maxDelayMs: number;
}

export const NO_RETRY: RetryPolicy = {
  kind: 'none',
  maxAttempts: 1,
  baseDelayMs: 0,
  maxDelayMs: 0,
};

export function fixedRetry(maxAttempts = 3, delayMs = 200): RetryPolicy {
  return { kind: 'fixed', maxAttempts, baseDelayMs: delayMs, maxDelayMs: delayMs };
}

export function exponentialRetry(
  maxAttempts = 3,
  baseDelayMs = 200,
  maxDelayMs = 5_000,
): RetryPolicy {
  return { kind: 'exponential', maxAttempts, baseDelayMs, maxDelayMs };
}

/** The delay before `attempt` (1-indexed), or `null` if no more attempts remain. */
export function delayForAttempt(policy: RetryPolicy, attempt: number): number | null {
  if (attempt >= policy.maxAttempts) return null;
  switch (policy.kind) {
    case 'none':
      return null;
    case 'fixed':
      return policy.baseDelayMs;
    case 'exponential':
      return Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
  }
}

export interface RunWithRetryOptions {
  /** Whether a thrown error is worth retrying (default: never). */
  isRetryable?: (error: unknown) => boolean;
  /** Abort between attempts. */
  token?: CancellationToken;
  /** Injected sleep (deterministic under test). Defaults to real `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Called after a failed, retryable attempt (for event logging). */
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` under a retry policy. Returns the result and the attempt count, or
 * rethrows the last error once attempts are exhausted / the error is not
 * retryable / cancellation is requested.
 */
export async function runWithRetry<T>(
  fn: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  options: RunWithRetryOptions = {},
): Promise<{ value: T; attempts: number }> {
  const { isRetryable = () => false, token, sleep = realSleep, onRetry } = options;
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      return { value: await fn(attempt), attempts: attempt };
    } catch (error) {
      const delay = delayForAttempt(policy, attempt);
      if (delay === null || !isRetryable(error) || token?.isCancelled) throw error;
      onRetry?.(attempt, delay, error);
      await sleep(delay);
    }
  }
}
