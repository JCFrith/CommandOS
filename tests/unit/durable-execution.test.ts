import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryLeasedJobStore } from '@/services/jobs/in-memory-job-store';
import { LeasedBackgroundWorker } from '@/services/jobs/worker';
import type { JobHandler } from '@/lib/platform/background';

/** A controllable clock so lease expiry is deterministic. */
function clock(startMs = Date.UTC(2026, 7, 1)) {
  let t = startMs;
  return {
    iso: () => new Date(t).toISOString(),
    advance: (ms: number) => {
      t += ms;
    },
  };
}
function ids(prefix: string) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

let c: ReturnType<typeof clock>;
let store: InMemoryLeasedJobStore;

beforeEach(() => {
  c = clock();
  store = new InMemoryLeasedJobStore({ id: ids('job'), now: c.iso });
});

describe('LeasedJobStore — claim, lease, recovery', () => {
  it('claims a due job with a lease and increments attempts', async () => {
    await store.enqueue({ workspaceId: 'ws-1', kind: 'k', payload: {} });
    const claimed = await store.claimDue('w1', 30_000, c.iso(), 5);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.status).toBe('running');
    expect(claimed[0]!.leaseWorker).toBe('w1');
    expect(claimed[0]!.attempts).toBe(1);
  });

  it('does not claim a job scheduled for the future until it is due', async () => {
    const future = new Date(new Date(c.iso()).getTime() + 60_000).toISOString();
    await store.schedule({ workspaceId: 'ws-1', kind: 'k', payload: {} }, future);
    expect(await store.claimDue('w1', 30_000, c.iso(), 5)).toHaveLength(0);
    c.advance(61_000);
    expect(await store.claimDue('w1', 30_000, c.iso(), 5)).toHaveLength(1);
  });

  it('reclaims an expired lease (crash/stale recovery)', async () => {
    await store.enqueue({ workspaceId: 'ws-1', kind: 'k', payload: {} });
    const [job] = await store.claimDue('w1', 10_000, c.iso(), 1);
    // Worker "crashes" — never completes. Advance past the lease.
    c.advance(11_000);
    expect(await store.reclaimExpired(c.iso())).toBe(1);
    // Now claimable again (attempt 2).
    const [again] = await store.claimDue('w2', 10_000, c.iso(), 1);
    expect(again!.id).toBe(job!.id);
    expect(again!.attempts).toBe(2);
  });

  it('renewLease extends the lease and rejects a lost lease', async () => {
    await store.enqueue({ workspaceId: 'ws-1', kind: 'k', payload: {} });
    const [job] = await store.claimDue('w1', 10_000, c.iso(), 1);
    expect(await store.renewLease(job!.id, 'w1', 10_000, c.iso())).toBe(true);
    expect(await store.renewLease(job!.id, 'someone-else', 10_000, c.iso())).toBe(false);
  });

  it('fail re-queues with backoff until maxAttempts, then marks failed', async () => {
    await store.enqueue({ workspaceId: 'ws-1', kind: 'k', payload: {}, maxAttempts: 2 });
    const [j1] = await store.claimDue('w1', 10_000, c.iso(), 1);
    await store.fail(j1!.id, 'w1', 'boom', c.iso());
    expect((await store.get(j1!.id))!.status).toBe('queued'); // retry queued
    c.advance(5_000);
    const [j2] = await store.claimDue('w1', 10_000, c.iso(), 1);
    expect(j2!.attempts).toBe(2);
    await store.fail(j2!.id, 'w1', 'boom', c.iso());
    expect((await store.get(j2!.id))!.status).toBe('failed'); // terminal
  });

  it('complete is idempotent and stats reflect the queue', async () => {
    await store.enqueue({ workspaceId: 'ws-1', kind: 'k', payload: {} });
    const [job] = await store.claimDue('w1', 10_000, c.iso(), 1);
    await store.complete(job!.id, 'w1', c.iso());
    await store.complete(job!.id, 'w1', c.iso()); // no-op
    expect((await store.get(job!.id))!.status).toBe('done');
    const stats = await store.stats(c.iso());
    expect(stats.running).toBe(0);
    expect(stats.queued).toBe(0);
  });
});

describe('LeasedBackgroundWorker — stateless tick', () => {
  function worker(handled: string[]): LeasedBackgroundWorker {
    const w = new LeasedBackgroundWorker(store, {
      id: ids('sig'),
      now: c.iso,
      workerId: 'worker-1',
      leaseMs: 30_000,
      batchSize: 10,
    });
    const handler: JobHandler = { kind: 'ok', handle: async (job) => void handled.push(job.id) };
    w.register(handler);
    return w;
  }

  it('drains due jobs, runs the handler, and completes them', async () => {
    const handled: string[] = [];
    const w = worker(handled);
    await store.enqueue({ workspaceId: 'ws-1', kind: 'ok', payload: {} });
    const result = await w.tick();
    expect(result).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    expect(handled).toHaveLength(1);
  });

  it('fails a job with no registered handler', async () => {
    const w = worker([]);
    await store.enqueue({ workspaceId: 'ws-1', kind: 'unknown', payload: {} });
    const result = await w.tick();
    expect(result.failed).toBe(1);
  });

  it('recovers a crashed job on a later tick (at-least-once)', async () => {
    const handled: string[] = [];
    // First handler throws (simulated crash mid-run) then succeeds.
    const w = new LeasedBackgroundWorker(store, {
      id: ids('sig'),
      now: c.iso,
      workerId: 'worker-1',
      leaseMs: 10_000,
      batchSize: 10,
    });
    let calls = 0;
    w.register({
      kind: 'flaky',
      handle: async (job) => {
        calls += 1;
        if (calls === 1) throw new Error('crash');
        handled.push(job.id);
      },
    });
    await store.enqueue({ workspaceId: 'ws-1', kind: 'flaky', payload: {}, maxAttempts: 3 });

    const first = await w.tick(); // throws → fail → re-queued with backoff
    expect(first.failed).toBe(1);
    c.advance(5_000);
    const second = await w.tick(); // retried → completes
    expect(second.completed).toBe(1);
    expect(handled).toHaveLength(1);
  });
});
