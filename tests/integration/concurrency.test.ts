import { describe, expect, it } from 'vitest';

import { SupabaseLeasedJobStore } from '@/services/jobs/supabase-job-store';
import { SupabaseWorkflowRepository } from '@/services/workflows/supabase-workflow-repository';
import { resetDb, WS_A } from './helpers';
import { PRODUCTION_VALIDATION } from './setup';

const now = '2026-08-01T00:00:00.000Z';

/**
 * Concurrency & idempotency against REAL concurrent database connections. The
 * point is that Postgres — not application code — enforces the invariants
 * (`FOR UPDATE SKIP LOCKED`, unique claims). We deliberately fire the competing
 * operations in parallel; nothing serializes them in JS.
 */
(PRODUCTION_VALIDATION ? describe : describe.skip)('concurrency & idempotency', () => {
  it('two workers racing claimDue never double-lease a job (SKIP LOCKED)', async () => {
    await resetDb();
    const store = new SupabaseLeasedJobStore();
    // 20 jobs, two workers each trying to grab up to 20 at the same instant.
    for (let i = 0; i < 20; i++) {
      await store.enqueue({ workspaceId: WS_A, kind: 'k', payload: { i } });
    }
    const [a, b] = await Promise.all([
      store.claimDue('worker-a', 30_000, now, 20),
      store.claimDue('worker-b', 30_000, now, 20),
    ]);
    const ids = [...a, ...b].map((j) => j.id);
    expect(ids.length).toBe(20); // all claimed
    expect(new Set(ids).size).toBe(20); // …with no overlap
  });

  it('concurrent duplicate trigger claims yield exactly one winner', async () => {
    await resetDb();
    const repo = new SupabaseWorkflowRepository();
    // run_id is a uuid column; give each racer a distinct valid uuid.
    const attempts = Array.from({ length: 8 }, (_, i) =>
      repo.claimTrigger({
        workspaceId: WS_A,
        triggerKey: 'dup',
        runId: `00000000-0000-0000-0000-00000000000${i}`,
        createdAt: now,
      }),
    );
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
  });

  it('lease ownership guards completion: only the current holder can complete', async () => {
    await resetDb();
    const store = new SupabaseLeasedJobStore();
    await store.enqueue({ workspaceId: WS_A, kind: 'k', payload: {} });
    const [job] = await store.claimDue('w1', 1, now, 1); // 1ms lease
    // Lease expires, another worker reclaims.
    await store.reclaimExpired('2026-08-01T00:00:01.000Z');
    const [job2] = await store.claimDue('w2', 30_000, '2026-08-01T00:00:01.000Z', 1);
    expect(job2!.id).toBe(job!.id);
    // The original worker lost the lease: its completion matches no row and is a no-op.
    await store.complete(job!.id, 'w1', '2026-08-01T00:00:02.000Z');
    expect(
      (await store.get(job!.id))!.status,
      'lost-lease worker must not complete the job',
    ).not.toBe('done');
    // The current holder completes it.
    await store.complete(job2!.id, 'w2', '2026-08-01T00:00:02.000Z');
    expect((await store.get(job2!.id))!.status).toBe('done');
    // renewLease by a non-holder is rejected outright.
    expect(await store.renewLease(job!.id, 'w1', 30_000, '2026-08-01T00:00:03.000Z')).toBe(false);
  });
});
