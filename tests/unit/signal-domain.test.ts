import { describe, expect, it } from 'vitest';

import {
  acknowledgedEvent,
  createSignal,
  emittedEvent,
  projectLifecycle,
  resolvedEvent,
  sanitizePayload,
  type SignalDeps,
} from '@/lib/signals/signal';
import { rootCorrelation, childOf, groupByCorrelation } from '@/lib/signals/correlation';
import { matchesFilter, selectSignals } from '@/lib/signals/filter';
import { createSubscription, matchesSubscription } from '@/lib/signals/subscription';
import type { Signal } from '@/lib/signals/types';

function deterministicDeps(): SignalDeps {
  let ids = 0;
  let ticks = 0;
  return {
    id: () => `sig-${++ids}`,
    now: () => new Date(Date.UTC(2026, 0, 1) + ticks++ * 1000).toISOString(),
  };
}

function makeSignal(overrides: Partial<Parameters<typeof createSignal>[0]> = {}): Signal {
  return createSignal(
    {
      type: 'operation.created',
      workspaceId: 'ws-1',
      correlation: rootCorrelation('corr-1'),
      summary: 'created something',
      ...overrides,
    },
    deterministicDeps(),
  );
}

describe('createSignal + catalog', () => {
  it('fills source/category/severity/title from the catalog', () => {
    const signal = makeSignal();
    expect(signal.source).toBe('operations');
    expect(signal.category).toBe('lifecycle');
    expect(signal.severity).toBe('info');
    expect(signal.title).toBe('Operation created');
    expect(signal.status).toBe('open');
    expect(signal.resolution).toBe('unresolved');
    expect(signal.correlationId).toBe('corr-1');
  });

  it('honors per-emission overrides', () => {
    const signal = makeSignal({ severity: 'critical', title: 'Custom' });
    expect(signal.severity).toBe('critical');
    expect(signal.title).toBe('Custom');
  });

  it('defaults an uncatalogued type safely', () => {
    const signal = makeSignal({ type: 'made.up.type' });
    expect(signal.source).toBe('signals');
    expect(signal.category).toBe('system');
    expect(signal.severity).toBe('info');
  });
});

describe('payload sanitization (secret invariant)', () => {
  it('redacts secret-like keys anywhere in the payload', () => {
    const dirty = {
      apiKey: 'sk-abc123',
      token: 'bearer-xyz',
      system_prompt: 'You are a trusted system…',
      prompt: 'do the thing',
      password: 'hunter2',
      nested: { authorization: 'Bearer secret', ok: 'visible' },
      safe: 'kept',
    };
    const clean = sanitizePayload(dirty);
    expect(clean.apiKey).toBe('[redacted]');
    expect(clean.token).toBe('[redacted]');
    expect(clean.system_prompt).toBe('[redacted]');
    expect(clean.prompt).toBe('[redacted]');
    expect(clean.password).toBe('[redacted]');
    expect((clean.nested as Record<string, unknown>).authorization).toBe('[redacted]');
    expect((clean.nested as Record<string, unknown>).ok).toBe('visible');
    expect(clean.safe).toBe('kept');
  });

  it('truncates very long strings and applies through createSignal', () => {
    const signal = makeSignal({ payload: { apiKey: 'secret', note: 'x'.repeat(5000) } });
    expect(signal.payload.apiKey).toBe('[redacted]');
    expect((signal.payload.note as string).length).toBeLessThan(5000);
  });
});

describe('append-only lifecycle projection', () => {
  it('is open by default and never mutates the emitted record', () => {
    const deps = deterministicDeps();
    const signal = createSignal(
      {
        type: 'agent.execution.failed',
        workspaceId: 'ws-1',
        correlation: rootCorrelation('c'),
        summary: 'boom',
      },
      deps,
    );
    const ack = acknowledgedEvent(signal, { id: 'u-1', name: 'Ada' }, deps);
    const projected = projectLifecycle(signal, [emittedEvent(signal, deps), ack]);
    expect(projected.status).toBe('acknowledged');
    expect(projected.acknowledgedBy).toBe('u-1');
    // Original untouched.
    expect(signal.status).toBe('open');
  });

  it('folds acknowledge → resolve in order', () => {
    const deps = deterministicDeps();
    const signal = makeSignal();
    const events = [
      emittedEvent(signal, deps),
      acknowledgedEvent(signal, { id: 'u-1', name: 'Ada' }, deps),
      resolvedEvent(signal, { id: 'u-1', name: 'Ada' }, 'resolved', deps),
    ];
    const projected = projectLifecycle(signal, events);
    expect(projected.status).toBe('resolved');
    expect(projected.resolution).toBe('resolved');
    expect(projected.resolvedBy).toBe('u-1');
  });

  it('dismiss records a dismissed resolution', () => {
    const deps = deterministicDeps();
    const signal = makeSignal();
    const projected = projectLifecycle(signal, [
      resolvedEvent(signal, { id: 'u-1', name: 'Ada' }, 'dismissed', deps),
    ]);
    expect(projected.status).toBe('resolved');
    expect(projected.resolution).toBe('dismissed');
  });
});

describe('filtering', () => {
  const signals = [
    makeSignal({ type: 'operation.created', severity: 'info' }),
    makeSignal({ type: 'agent.execution.failed', severity: 'error', source: 'agents' }),
    makeSignal({ type: 'execution.timed_out', severity: 'error', source: 'runtime' }),
  ];

  it('matches by severity, source, type, and minSeverity', () => {
    expect(signals.filter((s) => matchesFilter(s, { severities: ['error'] }))).toHaveLength(2);
    expect(signals.filter((s) => matchesFilter(s, { sources: ['runtime'] }))).toHaveLength(1);
    expect(signals.filter((s) => matchesFilter(s, { minSeverity: 'warning' }))).toHaveLength(2);
    expect(signals.filter((s) => matchesFilter(s, { types: ['operation.created'] }))).toHaveLength(
      1,
    );
  });

  it('search matches title/summary/type case-insensitively', () => {
    expect(signals.filter((s) => matchesFilter(s, { search: 'TIMED' }))).toHaveLength(1);
  });

  it('selectSignals filters and sorts newest-first', () => {
    const selected = selectSignals(signals, { minSeverity: 'error' });
    expect(selected).toHaveLength(2);
    expect(selected[0]!.createdAt >= selected[1]!.createdAt).toBe(true);
  });
});

describe('subscription engine', () => {
  it('routes only matching signals and respects workspace scope', () => {
    const sub = createSubscription({ workspaceId: 'ws-1', filter: { minSeverity: 'error' } });
    const err = makeSignal({ severity: 'error' });
    const info = makeSignal({ severity: 'info' });
    const foreign = makeSignal({ severity: 'error', workspaceId: 'ws-2' });
    expect(matchesSubscription(sub, err)).toBe(true);
    expect(matchesSubscription(sub, info)).toBe(false);
    expect(matchesSubscription(sub, foreign)).toBe(false); // workspace isolation
  });

  it('a null-workspace subscription is platform-wide', () => {
    const sub = createSubscription({ workspaceId: null, filter: {} });
    expect(matchesSubscription(sub, makeSignal({ workspaceId: 'ws-9' }))).toBe(true);
  });

  it('inactive subscriptions never match', () => {
    const sub = createSubscription({ workspaceId: 'ws-1', filter: {}, active: false });
    expect(matchesSubscription(sub, makeSignal())).toBe(false);
  });
});

describe('correlation', () => {
  it('childOf inherits correlationId and links parent', () => {
    const parent = makeSignal();
    const child = childOf(parent);
    expect(child.correlationId).toBe(parent.correlationId);
    expect(child.parentId).toBe(parent.id);
  });

  it('groups signals by correlation id', () => {
    const groups = groupByCorrelation([
      makeSignal({ correlation: rootCorrelation('a') }),
      makeSignal({ correlation: rootCorrelation('a') }),
      makeSignal({ correlation: rootCorrelation('b') }),
    ]);
    expect(groups.get('a')).toHaveLength(2);
    expect(groups.get('b')).toHaveLength(1);
  });
});
