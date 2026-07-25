import { describe, expect, it } from 'vitest';

import { computeMetrics } from '@/lib/signals/metrics';
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
const d = deps();

function exec(type: string, payload: Record<string, string | number | boolean>): Signal {
  return createSignal(
    { type, workspaceId: 'ws-1', correlation: rootCorrelation('c'), summary: type, payload },
    d,
  );
}

describe('computeMetrics', () => {
  it('derives execution counts, rates, duration, tokens, and cost from signals', () => {
    const signals = [
      exec('execution.completed', {
        durationMs: 100,
        providerLatencyMs: 80,
        totalTokens: 50,
        costUsd: 0.001,
      }),
      exec('execution.completed', {
        durationMs: 200,
        providerLatencyMs: 120,
        totalTokens: 70,
        costUsd: 0.002,
      }),
      exec('execution.failed', { durationMs: 300, totalTokens: 10, costUsd: 0.0005 }),
      exec('execution.timed_out', { durationMs: 30000 }),
      exec('execution.retried', { attempt: 2, delayMs: 200 }),
    ];
    const m = computeMetrics(signals);

    expect(m.execution.completed).toBe(2);
    expect(m.execution.failed).toBe(1);
    expect(m.execution.timedOut).toBe(1);
    expect(m.execution.retries).toBe(1);
    // success = 2 / (2 completed + 1 failed + 1 timedOut) = 0.5
    expect(m.execution.successRate).toBeCloseTo(0.5, 5);
    expect(m.execution.failureRate).toBeCloseTo(0.5, 5);
    expect(m.execution.avgDurationMs).toBe(Math.round((100 + 200 + 300 + 30000) / 4));
    expect(m.execution.avgProviderLatencyMs).toBe(100); // (80+120)/2
    expect(m.execution.totalTokens).toBe(130);
    expect(m.execution.estimatedCostUsd).toBeCloseTo(0.0035, 6);
  });

  it('counts by severity/category/source and reports null rates with no executions', () => {
    const signals = [
      createSignal(
        {
          type: 'operation.created',
          workspaceId: 'ws-1',
          correlation: rootCorrelation('c'),
          summary: 'x',
        },
        d,
      ),
      createSignal(
        {
          type: 'agent.execution.failed',
          workspaceId: 'ws-1',
          correlation: rootCorrelation('c'),
          summary: 'y',
          severity: 'error',
        },
        d,
      ),
    ];
    const m = computeMetrics(signals);
    expect(m.total).toBe(2);
    expect(m.bySeverity.error).toBe(1);
    expect(m.byCategory.lifecycle).toBe(1);
    expect(m.bySource.operations).toBe(1);
    expect(m.execution.successRate).toBeNull();
    expect(m.execution.failureRate).toBeNull();
  });
});
