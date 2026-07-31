import { describe, expect, it } from 'vitest';

import { SupabaseLeasedJobStore } from '@/services/jobs/supabase-job-store';
import { resetDb, WS_A } from './helpers';
import { PRODUCTION_VALIDATION } from './setup';

const now = '2026-08-01T00:00:00.000Z';
const plus = (ms: number) => new Date(Date.parse(now) + ms).toISOString();

/**
 * Failure & recovery against the real database. Every scenario drives the store
 * through a fault and asserts the SYSTEM invariant afterwards: no stranded work,
 * no unauthorized completion after lease loss, bounded retries, correct terminal
 * state.
 */
(PRODUCTION_VALIDATION ? describe : describe.skip)('failure & recovery', () => {
  it('worker crash: an expired lease is recovered and the job runs again', async () => {
    await resetDb();
    const store = new SupabaseLeasedJobStore();
    await store.enqueue({ workspaceId: WS_A, kind: 'k', payload: {} });
    const [job] = await store.claimDue('crashed', 5_000, now, 1);
    expect(job!.status).toBe('running');
    // Worker never heartbeats; lease expires; recovery re-queues it.
    expect(await store.reclaimExpired(plus(6_000))).toBe(1);
    const [again] = await store.claimDue('healthy', 30_000, plus(6_000), 1);
    expect(again!.id).toBe(job!.id);
    expect(again!.attempts).toBe(2); // recovery counts as a fresh attempt
  });

  it('retry backoff then exhaustion: a job fails bounded times, then terminal', async () => {
    await resetDb();
    const store = new SupabaseLeasedJobStore();
    await store.enqueue({ workspaceId: WS_A, kind: 'k', payload: {}, maxAttempts: 3 });
    for (let attempt = 1; attempt <= 3; attempt++) {
      const [j] = await store.claimDue('w', 30_000, plus(attempt * 60_000), 1);
      expect(j, `attempt ${attempt} should be claimable`).toBeDefined();
      await store.fail(j!.id, 'w', 'boom', plus(attempt * 60_000));
    }
    // After maxAttempts the job is terminally failed and never claimed again.
    const drained = await store.claimDue('w', 30_000, plus(999_000), 1);
    expect(drained).toHaveLength(0);
  });

  it('a handler that completes after losing its lease cannot mark the job done', async () => {
    await resetDb();
    const store = new SupabaseLeasedJobStore();
    await store.enqueue({ workspaceId: WS_A, kind: 'k', payload: {} });
    const [job] = await store.claimDue('slow', 1_000, now, 1);
    await store.reclaimExpired(plus(2_000));
    await store.claimDue('other', 30_000, plus(2_000), 1); // reassigned
    // Slow handler finally returns and tries to complete — must be a no-op.
    await store.complete(job!.id, 'slow', plus(3_000));
    expect((await store.get(job!.id))!.status).not.toBe('done');
  });

  it('no stranded work: every enqueued job reaches a terminal or reclaimable state', async () => {
    await resetDb();
    const store = new SupabaseLeasedJobStore();
    await store.enqueue({ workspaceId: WS_A, kind: 'k', payload: {} });
    const [job] = await store.claimDue('w', 100, now, 1);
    // Simulate total loss (no complete, no fail). Recovery must still surface it.
    expect(await store.reclaimExpired(plus(1_000))).toBe(1);
    expect((await store.get(job!.id))!.status).toBe('queued');
  });
});
