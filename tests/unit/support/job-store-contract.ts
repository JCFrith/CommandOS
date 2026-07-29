import { beforeEach, describe, expect, it } from 'vitest';

import type { ExecutionQueue, LeasedJobStore, Scheduler } from '@/lib/platform/background';

/** A durable store is a leased store that is also a queue + scheduler. */
export type DurableJobStore = LeasedJobStore & ExecutionQueue & Scheduler;

/**
 * The reusable {@link LeasedJobStore} CONTRACT. Every implementation — the dev
 * `InMemoryLeasedJobStore` and the production `SupabaseLeasedJobStore` — must
 * satisfy it identically. Time is supplied explicitly to the lease/claim methods
 * (`nowIso`), so the same suite is deterministic against an in-memory store AND a
 * real database (no reliance on wall-clock timing).
 *
 * `make()` returns a fresh, empty store per assertion.
 */
export function describeJobStoreContract(
  name: string,
  make: () => DurableJobStore,
  reset?: () => Promise<void>,
): void {
  describe(`LeasedJobStore contract — ${name}`, () => {
    const T0 = '2026-08-01T00:00:00.000Z';
    const at = (ms: number) => new Date(Date.parse(T0) + ms).toISOString();

    // A durable store shares one table; reset() (e.g. TRUNCATE) isolates each
    // assertion. The in-memory store makes a fresh instance instead, so reset is
    // a no-op there.
    beforeEach(async () => {
      if (reset) await reset();
    });

    it('enqueue → claimDue returns a running, leased job with attempts=1', async () => {
      const s = make();
      await s.enqueue({
        workspaceId: '00000000-0000-0000-0000-0000000000ff',
        kind: 'k',
        payload: { n: 1 },
      });
      const claimed = await s.claimDue('w1', 30_000, T0, 5);
      expect(claimed).toHaveLength(1);
      expect(claimed[0]!.status).toBe('running');
      expect(claimed[0]!.leaseWorker).toBe('w1');
      expect(claimed[0]!.attempts).toBe(1);
    });

    it('a future-scheduled job is not claimed until due', async () => {
      const s = make();
      await s.schedule(
        { workspaceId: '00000000-0000-0000-0000-0000000000ff', kind: 'k', payload: {} },
        at(60_000),
      );
      expect(await s.claimDue('w1', 30_000, T0, 5)).toHaveLength(0);
      expect(await s.claimDue('w1', 30_000, at(61_000), 5)).toHaveLength(1);
    });

    it('an expired lease is reclaimed and re-claimable (crash recovery)', async () => {
      const s = make();
      await s.enqueue({
        workspaceId: '00000000-0000-0000-0000-0000000000ff',
        kind: 'k',
        payload: {},
      });
      const [job] = await s.claimDue('w1', 10_000, T0, 1);
      expect(await s.reclaimExpired(at(11_000))).toBe(1);
      const [again] = await s.claimDue('w2', 10_000, at(11_000), 1);
      expect(again!.id).toBe(job!.id);
      expect(again!.attempts).toBe(2);
    });

    it('complete is idempotent; a lost lease cannot renew', async () => {
      const s = make();
      await s.enqueue({
        workspaceId: '00000000-0000-0000-0000-0000000000ff',
        kind: 'k',
        payload: {},
      });
      const [job] = await s.claimDue('w1', 10_000, T0, 1);
      await s.complete(job!.id, 'w1', T0);
      await s.complete(job!.id, 'w1', T0);
      expect((await s.get(job!.id))!.status).toBe('done');
      expect(await s.renewLease(job!.id, 'intruder', 10_000, T0)).toBe(false);
    });

    it('fail retries until maxAttempts, then marks failed', async () => {
      const s = make();
      await s.enqueue({
        workspaceId: '00000000-0000-0000-0000-0000000000ff',
        kind: 'k',
        payload: {},
        maxAttempts: 2,
      });
      const [j1] = await s.claimDue('w1', 10_000, T0, 1);
      await s.fail(j1!.id, 'w1', 'boom', T0);
      expect((await s.get(j1!.id))!.status).toBe('queued');
      const [j2] = await s.claimDue('w1', 10_000, at(10_000), 1);
      await s.fail(j2!.id, 'w1', 'boom', at(10_000));
      expect((await s.get(j2!.id))!.status).toBe('failed');
    });
  });
}
