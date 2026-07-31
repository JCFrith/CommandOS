import { beforeAll, describe, expect, it } from 'vitest';

import type { ExecutionQueue } from '@/lib/platform/background';
import { createSignal } from '@/lib/signals/signal';
import { assertSupabaseBindings, resetDb, WS_A } from './helpers';
import { PRODUCTION_VALIDATION } from './setup';

/**
 * Production smoke — the full app running against Supabase-backed bindings. It
 * FIRST prints and asserts the active adapter per interface (failing if any
 * expected binding is still in-memory), then drives a representative end-to-end
 * slice across Operations, the durable queue/worker, and Signals through the
 * production singletons (not fresh adapter instances).
 */
(PRODUCTION_VALIDATION ? describe : describe.skip)('production smoke', () => {
  beforeAll(async () => {
    await resetDb();
    console.log('Active repository bindings under production validation:');
    await assertSupabaseBindings();
  });

  it('every repository binding is Supabase-backed (no in-memory fallback)', async () => {
    await assertSupabaseBindings(); // asserts /^Supabase/ for all six interfaces
  });

  it('Operations round-trips through the production repository singleton', async () => {
    const { operationsRepository } =
      await import('@/services/operations/in-memory-operations-repository');
    const now = '2026-08-01T00:00:00.000Z';
    const id = '00000000-0000-0000-0000-00000000da01';
    await operationsRepository.create({
      id,
      workspaceId: WS_A,
      title: 'smoke',
      description: null,
      status: 'draft',
      priority: 'medium',
      createdBy: '00000000-0000-0000-0000-0000000a0001',
      updatedBy: '00000000-0000-0000-0000-0000000a0001',
      createdAt: now,
      updatedAt: now,
    });
    const list = await operationsRepository.listByWorkspace(WS_A);
    expect(list.some((o) => o.id === id)).toBe(true);
  });

  it('the durable queue + worker execute a job through the production singletons', async () => {
    const { jobStore, backgroundWorker } = await import('@/services/jobs');
    const queue = jobStore as unknown as ExecutionQueue;
    const handled: string[] = [];
    backgroundWorker.register({ kind: 'smoke.job', handle: async (j) => void handled.push(j.id) });
    await queue.enqueue({ workspaceId: WS_A, kind: 'smoke.job', payload: { ok: true } });
    const result = await backgroundWorker.tick();
    expect(result.completed).toBeGreaterThanOrEqual(1);
    expect(handled.length).toBeGreaterThanOrEqual(1);
    expect((await jobStore.get(handled[0]!))!.status).toBe('done');
  });

  it('Signals append and project through the production event store singleton', async () => {
    const { signalEventStore } = await import('@/lib/signals');
    const signal = createSignal({
      type: 'operation.created',
      workspaceId: WS_A,
      correlation: { correlationId: '00000000-0000-0000-0000-00000000db01', parentId: null },
      summary: 'smoke signal',
      actorId: null,
      actorName: null,
      subjectType: 'operation',
      subjectId: '00000000-0000-0000-0000-00000000da01',
    });
    await signalEventStore.appendSignal(signal);
    const found = await signalEventStore.listSignals({
      workspaceId: WS_A,
      correlationId: signal.correlationId,
    });
    expect(found.some((s) => s.id === signal.id)).toBe(true);
  });
});
