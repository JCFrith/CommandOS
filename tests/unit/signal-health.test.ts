import { describe, expect, it } from 'vitest';

import { computeHealth, worstStatus, type HealthInputs } from '@/lib/signals/health';
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

function exec(type: string, payload: Record<string, string | number | boolean> = {}): Signal {
  return createSignal(
    { type, workspaceId: 'ws-1', correlation: rootCorrelation('c'), summary: type, payload },
    d,
  );
}

const NOW = '2026-01-01T00:00:00.000Z';
const HEALTHY_BUS = { subscribers: 1, published: 10, delivered: 10, failedDeliveries: 0 };

function inputs(partial: Partial<HealthInputs> & { signals?: Signal[] }): HealthInputs {
  const metrics = computeMetrics(partial.signals ?? []);
  return {
    providerAvailable: partial.providerAvailable ?? true,
    runtimeAvailable: partial.runtimeAvailable ?? true,
    metrics,
    bus: partial.bus ?? HEALTHY_BUS,
    now: NOW,
  };
}

describe('computeHealth', () => {
  it('reports provider unavailable when not configured', () => {
    const health = computeHealth(inputs({ providerAvailable: false, runtimeAvailable: false }));
    const provider = health.subsystems.find((s) => s.subsystem === 'provider')!;
    expect(provider.status).toBe('unavailable');
    expect(health.overall).toBe('unavailable');
  });

  it('runtime is unknown with no executions and healthy when succeeding', () => {
    const unknown = computeHealth(inputs({}));
    expect(unknown.subsystems.find((s) => s.subsystem === 'runtime')!.status).toBe('unknown');

    const good = computeHealth(
      inputs({
        signals: [
          exec('execution.completed', { durationMs: 100 }),
          exec('execution.completed', { durationMs: 100 }),
        ],
      }),
    );
    expect(good.subsystems.find((s) => s.subsystem === 'runtime')!.status).toBe('healthy');
  });

  it('runtime degrades under a high failure rate', () => {
    const signals = [
      exec('execution.failed'),
      exec('execution.failed'),
      exec('execution.completed', { durationMs: 100 }),
    ];
    const health = computeHealth(inputs({ signals }));
    expect(health.subsystems.find((s) => s.subsystem === 'runtime')!.status).toBe('degraded');
  });

  it('bus warns on failed deliveries', () => {
    const health = computeHealth(
      inputs({ bus: { subscribers: 2, published: 100, delivered: 99, failedDeliveries: 1 } }),
    );
    expect(health.subsystems.find((s) => s.subsystem === 'signal-bus')!.status).toBe('warning');
  });

  it('worstStatus rolls up the most severe', () => {
    expect(worstStatus(['healthy', 'warning', 'degraded'])).toBe('degraded');
    expect(worstStatus(['healthy', 'unavailable'])).toBe('unavailable');
    expect(worstStatus([])).toBe('unknown');
  });
});
