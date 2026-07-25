import { beforeEach, describe, expect, it } from 'vitest';

import { InMemorySignalEventStore } from '@/lib/signals/store';
import {
  acknowledgedEvent,
  createSignal,
  emittedEvent,
  resolvedEvent,
  type SignalDeps,
} from '@/lib/signals/signal';
import { rootCorrelation } from '@/lib/signals/correlation';
import type { Signal } from '@/lib/signals/types';

function deps(): SignalDeps {
  let ids = 0;
  let ticks = 0;
  return {
    id: () => `sig-${++ids}`,
    now: () => new Date(Date.UTC(2026, 0, 1) + ticks++ * 1000).toISOString(),
  };
}

let store: InMemorySignalEventStore;
const d = deps();

function sig(
  workspaceId: string,
  type = 'operation.created',
  overrides: Partial<Parameters<typeof createSignal>[0]> = {},
): Signal {
  return createSignal(
    { type, workspaceId, correlation: rootCorrelation('c'), summary: type, ...overrides },
    d,
  );
}

beforeEach(() => {
  store = new InMemorySignalEventStore();
});

describe('InMemorySignalEventStore (append-only repository)', () => {
  it('appends and reads back signals scoped to a workspace', async () => {
    const a = await store.appendSignal(sig('ws-1'));
    await store.appendSignal(sig('ws-2'));
    const list = await store.listSignals({ workspaceId: 'ws-1' });
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(a.id);
  });

  it('getSignal never crosses a workspace boundary', async () => {
    const a = await store.appendSignal(sig('ws-1'));
    expect(await store.getSignal('ws-2', a.id)).toBeNull(); // isolation
    expect(await store.getSignal('ws-1', a.id)).not.toBeNull();
  });

  it('does not mutate historical records — lifecycle is projected from events', async () => {
    const s = await store.appendSignal(sig('ws-1', 'agent.execution.failed'));
    await store.appendEvent(emittedEvent(s, d));
    await store.appendEvent(acknowledgedEvent(s, { id: 'u-1', name: 'Ada' }, d));
    await store.appendEvent(resolvedEvent(s, { id: 'u-1', name: 'Ada' }, 'resolved', d));

    const projected = await store.getSignal('ws-1', s.id);
    expect(projected!.status).toBe('resolved');
    // The originally appended signal object is unchanged.
    expect(s.status).toBe('open');

    const events = await store.listEvents('ws-1', s.id);
    expect(events.map((e) => e.type)).toEqual(['emitted', 'acknowledged', 'resolved']);
  });

  it('lists events scoped to the workspace, chronologically', async () => {
    const s = await store.appendSignal(sig('ws-1'));
    await store.appendEvent(acknowledgedEvent(s, { id: 'u-1', name: 'Ada' }, d));
    const events = await store.listEvents('ws-2', s.id);
    expect(events).toHaveLength(0); // wrong workspace
  });
});
