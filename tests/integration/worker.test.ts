import { describe, expect, it } from 'vitest';

import type { Job } from '@/lib/platform/background';
import { SupabaseLeasedJobStore } from '@/services/jobs/supabase-job-store';
import { LeasedBackgroundWorker } from '@/services/jobs/worker';
import { resetDb, WS_A } from './helpers';
import { PRODUCTION_VALIDATION } from './setup';

// A controllable clock so a test can advance past the store's retry backoff
// (fail() re-queues with scheduled_for = now + 1000ms * attempts). Base is a
// fixed future instant so DB-assigned created_at (real "now") is always due.
const BASE = Date.parse('2027-01-01T00:00:00.000Z');
function makeDeps() {
  let clock = BASE;
  let seq = 0;
  return {
    deps: {
      workerId: 'itest-worker',
      leaseMs: 30_000,
      batchSize: 10,
      id: () => `00000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`,
      now: () => new Date(clock).toISOString(),
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

/** The durable worker driving the REAL leased store end-to-end. */
(PRODUCTION_VALIDATION ? describe : describe.skip)('LeasedBackgroundWorker × Supabase', () => {
  it('claims, runs, and completes a job in a single tick', async () => {
    await resetDb();
    const store = new SupabaseLeasedJobStore();
    const worker = new LeasedBackgroundWorker(store, makeDeps().deps);
    const handled: string[] = [];
    worker.register({ kind: 'itest.ok', handle: async (j: Job) => void handled.push(j.id) });

    await store.enqueue({ workspaceId: WS_A, kind: 'itest.ok', payload: { n: 1 } });
    const result = await worker.tick();
    expect(result).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    expect(handled).toHaveLength(1);
    expect((await store.get(handled[0]!))!.status).toBe('done');
  });

  it('a throwing handler retries, then exhausts to failed (idempotent handler contract)', async () => {
    await resetDb();
    const store = new SupabaseLeasedJobStore();
    const { deps, advance } = makeDeps();
    const worker = new LeasedBackgroundWorker(store, deps);
    worker.register({
      kind: 'itest.boom',
      handle: async () => {
        throw new Error('nope');
      },
    });

    await store.enqueue({ workspaceId: WS_A, kind: 'itest.boom', payload: {}, maxAttempts: 2 });
    const first = await worker.tick();
    expect(first).toMatchObject({ claimed: 1, failed: 1 });
    // Advance past the retry backoff so the second tick reclaims and exhausts it.
    advance(10_000);
    const second = await worker.tick();
    expect(second.failed).toBe(1);
    advance(10_000);
    const third = await worker.tick();
    expect(third.claimed).toBe(0); // terminally failed, nothing left
  });

  it('an unknown job kind fails closed rather than stranding the job', async () => {
    await resetDb();
    const store = new SupabaseLeasedJobStore();
    const worker = new LeasedBackgroundWorker(store, makeDeps().deps);
    await store.enqueue({
      workspaceId: WS_A,
      kind: 'itest.no-handler',
      payload: {},
      maxAttempts: 1,
    });
    const result = await worker.tick();
    expect(result.failed).toBe(1);
  });
});
