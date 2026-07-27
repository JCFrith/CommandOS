import { describe, expect, it } from 'vitest';

import {
  NO_RETRY,
  delayForAttempt,
  exponentialRetry,
  fixedRetry,
  runWithRetry,
} from '@/lib/platform/retry';

describe('retry policies', () => {
  it('computes delays per kind and stops at maxAttempts', () => {
    expect(delayForAttempt(NO_RETRY, 1)).toBeNull();
    expect(delayForAttempt(fixedRetry(3, 100), 1)).toBe(100);
    expect(delayForAttempt(fixedRetry(3, 100), 3)).toBeNull();
    const exp = exponentialRetry(4, 100, 1000);
    expect(delayForAttempt(exp, 1)).toBe(100);
    expect(delayForAttempt(exp, 2)).toBe(200);
    expect(delayForAttempt(exp, 3)).toBe(400);
  });

  it('caps exponential backoff at maxDelayMs', () => {
    const exp = exponentialRetry(10, 100, 300);
    expect(delayForAttempt(exp, 4)).toBe(300);
  });
});

describe('runWithRetry', () => {
  const noSleep = async () => {};

  it('does not retry when the error is not retryable', async () => {
    let calls = 0;
    await expect(
      runWithRetry(
        async () => {
          calls++;
          throw new Error('nope');
        },
        fixedRetry(3, 1),
        { isRetryable: () => false, sleep: noSleep },
      ),
    ).rejects.toThrow('nope');
    expect(calls).toBe(1);
  });

  it('retries retryable errors up to maxAttempts, then throws', async () => {
    let calls = 0;
    await expect(
      runWithRetry(
        async () => {
          calls++;
          throw new Error('transient');
        },
        fixedRetry(3, 1),
        { isRetryable: () => true, sleep: noSleep },
      ),
    ).rejects.toThrow('transient');
    expect(calls).toBe(3);
  });

  it('returns on the first success and reports the attempt count', async () => {
    let calls = 0;
    const { value, attempts } = await runWithRetry(
      async () => {
        calls++;
        if (calls < 2) throw new Error('once');
        return 'ok';
      },
      exponentialRetry(4, 1, 4),
      { isRetryable: () => true, sleep: noSleep },
    );
    expect(value).toBe('ok');
    expect(attempts).toBe(2);
  });
});
