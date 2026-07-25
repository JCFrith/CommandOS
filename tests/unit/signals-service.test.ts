import { beforeEach, describe, expect, it } from 'vitest';

import { InMemorySignalEventStore } from '@/lib/signals/store';
import { createSignal, emittedEvent, type SignalDeps } from '@/lib/signals/signal';
import { rootCorrelation } from '@/lib/signals/correlation';
import {
  SignalError,
  SignalsService,
  type SignalsContext,
  type SignalsServiceDeps,
} from '@/services/signals/signals-service';
import type { AuthUser, Workspace, WorkspaceRole } from '@/types';

const user: AuthUser = { id: 'u-1', email: null, displayName: 'Ada', avatarUrl: null };

function ctxFor(role: WorkspaceRole = 'owner', workspaceId = 'ws-1'): SignalsContext {
  const workspace: Workspace = { id: workspaceId, name: 'W', slug: 'w', role, kind: 'personal' };
  return { user, workspace };
}

function serviceDeps(): SignalsServiceDeps {
  let ids = 0;
  let ticks = 0;
  return {
    id: () => `svc-${++ids}`,
    now: () => new Date(Date.UTC(2026, 5, 1) + ticks++ * 1000).toISOString(),
    availability: () => ({ providerAvailable: true, runtimeAvailable: true }),
    busHealth: () => ({ subscribers: 1, published: 0, delivered: 0, failedDeliveries: 0 }),
  };
}

let store: InMemorySignalEventStore;
let service: SignalsService;
const seedDeps: SignalDeps = (() => {
  let ids = 0;
  let ticks = 0;
  return {
    id: () => `seed-${++ids}`,
    now: () => new Date(Date.UTC(2026, 0, 1) + ticks++ * 1000).toISOString(),
  };
})();

async function seed(
  type: string,
  workspaceId: string,
  overrides: Partial<Parameters<typeof createSignal>[0]> = {},
) {
  const signal = createSignal(
    {
      type,
      workspaceId,
      correlation: rootCorrelation('c'),
      summary: type,
      actorId: 'u-1',
      actorName: 'Ada',
      ...overrides,
    },
    seedDeps,
  );
  await store.appendSignal(signal);
  await store.appendEvent(emittedEvent(signal, seedDeps));
  return signal;
}

beforeEach(() => {
  store = new InMemorySignalEventStore();
  service = new SignalsService(store, serviceDeps());
});

describe('SignalsService — workspace isolation', () => {
  it('lists only the caller’s workspace signals, even with a foreign filter', async () => {
    await seed('operation.created', 'ws-1');
    await seed('operation.created', 'ws-2');
    const list = await service.list(ctxFor('owner', 'ws-1'), {});
    expect(list).toHaveLength(1);
    expect(list[0]!.workspaceId).toBe('ws-1');
  });

  it('cannot get a signal from another workspace', async () => {
    const foreign = await seed('operation.created', 'ws-2');
    await expect(service.get(ctxFor('owner', 'ws-1'), foreign.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('SignalsService — lifecycle (append-only)', () => {
  it('acknowledge then resolve appends events and projects status', async () => {
    const s = await seed('agent.execution.failed', 'ws-1', { severity: 'error' });
    const ctx = ctxFor();

    const acked = await service.acknowledge(ctx, s.id);
    expect(acked.status).toBe('acknowledged');
    expect(acked.acknowledgedBy).toBe('u-1');

    const resolved = await service.resolve(ctx, s.id, 'resolved');
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolution).toBe('resolved');

    const events = await service.events(ctx, s.id);
    expect(events.map((e) => e.type)).toContain('acknowledged');
    expect(events.map((e) => e.type)).toContain('resolved');
  });

  it('rejects an "unresolved" resolution', async () => {
    const s = await seed('agent.execution.failed', 'ws-1');
    await expect(service.resolve(ctxFor(), s.id, 'unresolved')).rejects.toBeInstanceOf(SignalError);
  });
});

describe('SignalsService — observability', () => {
  it('computes metrics and health scoped to the workspace', async () => {
    await seed('execution.completed', 'ws-1', {
      payload: { durationMs: 100, totalTokens: 20, costUsd: 0.001 },
    });
    await seed('execution.failed', 'ws-1', { payload: { durationMs: 200 } });
    await seed('execution.completed', 'ws-2', { payload: { durationMs: 100 } });

    const metrics = await service.metrics(ctxFor('owner', 'ws-1'));
    expect(metrics.execution.total).toBe(2); // ws-2 excluded
    expect(metrics.execution.completed).toBe(1);

    const health = await service.health(ctxFor('owner', 'ws-1'));
    expect(health.subsystems.map((s) => s.subsystem)).toEqual([
      'provider',
      'runtime',
      'signal-bus',
    ]);
  });

  it('builds a correlation-scoped timeline', async () => {
    await seed('agent.execution.started', 'ws-1', { correlation: rootCorrelation('run-x') });
    await seed('agent.execution.completed', 'ws-1', { correlation: rootCorrelation('run-x') });
    await seed('operation.created', 'ws-1', { correlation: rootCorrelation('other') });

    const chains = await service.correlations(ctxFor(), 'run-x');
    expect(chains).toHaveLength(1);
    expect(chains[0]!.entries).toHaveLength(2);
  });
});
