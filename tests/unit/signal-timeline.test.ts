import { describe, expect, it } from 'vitest';

import {
  buildCorrelationChains,
  buildSubjectTimeline,
  buildTimeline,
} from '@/lib/signals/timeline';
import { createSignal, type SignalDeps } from '@/lib/signals/signal';
import { rootCorrelation, continueChain } from '@/lib/signals/correlation';
import type { Signal } from '@/lib/signals/types';

function deps(): SignalDeps {
  let ids = 0;
  let ticks = 0;
  return {
    id: () => `sig-${++ids}`,
    now: () => new Date(Date.UTC(2026, 0, 1) + ticks++ * 1000).toISOString(),
  };
}
const d = deps();

function sig(type: string, overrides: Partial<Parameters<typeof createSignal>[0]> = {}): Signal {
  return createSignal(
    { type, workspaceId: 'ws-1', correlation: rootCorrelation('c'), summary: type, ...overrides },
    d,
  );
}

describe('buildTimeline', () => {
  it('orders newest-first by default and oldest-first on request', () => {
    const a = sig('one');
    const b = sig('two');
    const desc = buildTimeline([a, b]);
    expect(desc.map((e) => e.type)).toEqual(['two', 'one']);
    const asc = buildTimeline([a, b], { order: 'asc' });
    expect(asc.map((e) => e.type)).toEqual(['one', 'two']);
  });

  it('respects a limit', () => {
    const entries = buildTimeline([sig('a'), sig('b'), sig('c')], { limit: 2 });
    expect(entries).toHaveLength(2);
  });
});

describe('buildSubjectTimeline', () => {
  it('includes only the subject’s signals', () => {
    const signals = [
      sig('agent.created', { subjectType: 'agent', subjectId: 'A' }),
      sig('agent.updated', { subjectType: 'agent', subjectId: 'A' }),
      sig('agent.created', { subjectType: 'agent', subjectId: 'B' }),
    ];
    const timeline = buildSubjectTimeline(signals, 'agent', 'A');
    expect(timeline).toHaveLength(2);
    expect(timeline.every((e) => e.subjectId === 'A')).toBe(true);
  });
});

describe('buildCorrelationChains', () => {
  it('assembles one chain per correlation id in causal order', () => {
    const started = sig('agent.execution.started', { correlation: rootCorrelation('run-1') });
    const runtime = sig('execution.started', {
      correlation: continueChain('run-1', started.id),
    });
    const done = sig('agent.execution.completed', {
      correlation: continueChain('run-1', started.id),
    });
    const other = sig('operation.created', { correlation: rootCorrelation('run-2') });

    const chains = buildCorrelationChains([done, runtime, started, other]);
    const chain = chains.find((c) => c.correlationId === 'run-1')!;
    expect(chain.entries).toHaveLength(3);
    // Oldest-first (causal): started → runtime → completed.
    expect(chain.entries.map((e) => e.type)).toEqual([
      'agent.execution.started',
      'execution.started',
      'agent.execution.completed',
    ]);
    expect(chains).toHaveLength(2);
  });
});
