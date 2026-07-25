import { describe, expect, it } from 'vitest';

import { InProcessSignalBus } from '@/lib/signals/bus';
import { createSignal, type SignalDeps } from '@/lib/signals/signal';
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

function sig(type: string, overrides: Partial<Parameters<typeof createSignal>[0]> = {}): Signal {
  return createSignal(
    { type, workspaceId: 'ws-1', correlation: rootCorrelation('c'), summary: type, ...overrides },
    deps(),
  );
}

describe('InProcessSignalBus', () => {
  it('fans a published signal out to every matching subscriber', async () => {
    let n = 0;
    const bus = new InProcessSignalBus({ id: () => `sub-${++n}` });
    const a: Signal[] = [];
    const b: Signal[] = [];
    bus.subscribe({}, (s) => void a.push(s));
    bus.subscribe({ minSeverity: 'error' }, (s) => void b.push(s));

    await bus.publish(sig('operation.created')); // info
    await bus.publish(sig('agent.execution.failed', { severity: 'error' }));

    expect(a).toHaveLength(2); // catch-all
    expect(b).toHaveLength(1); // only the error
  });

  it('unsubscribe detaches a handler', async () => {
    const bus = new InProcessSignalBus();
    const seen: Signal[] = [];
    const handle = bus.subscribe({}, (s) => void seen.push(s));
    await bus.publish(sig('a'));
    handle.unsubscribe();
    await bus.publish(sig('b'));
    expect(seen).toHaveLength(1);
  });

  it('filters by workspace so a subscriber never sees another workspace', async () => {
    const bus = new InProcessSignalBus();
    const seen: Signal[] = [];
    bus.subscribe({ workspaceId: 'ws-1' }, (s) => void seen.push(s));
    await bus.publish(sig('a', { workspaceId: 'ws-1' }));
    await bus.publish(sig('b', { workspaceId: 'ws-2' }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.workspaceId).toBe('ws-1');
  });

  it('isolates handler failures and counts them in health', async () => {
    const bus = new InProcessSignalBus();
    const good: Signal[] = [];
    bus.subscribe({}, () => {
      throw new Error('bad consumer');
    });
    bus.subscribe({}, (s) => void good.push(s));

    // Must not throw even though one consumer throws.
    await expect(bus.publish(sig('a'))).resolves.toBeUndefined();
    expect(good).toHaveLength(1); // peer still delivered

    const health = bus.health();
    expect(health.subscribers).toBe(2);
    expect(health.published).toBe(1);
    expect(health.delivered).toBe(1);
    expect(health.failedDeliveries).toBe(1);
  });

  it('awaits async handlers before publish resolves', async () => {
    const bus = new InProcessSignalBus();
    let done = false;
    bus.subscribe({}, async () => {
      await Promise.resolve();
      done = true;
    });
    await bus.publish(sig('a'));
    expect(done).toBe(true);
  });
});
