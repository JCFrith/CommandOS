import type { SignalMetrics } from './metrics';
import type { SignalBusHealth } from './bus';

/**
 * Reusable health monitoring — a small, honest model of subsystem status,
 * computed from real signals/metrics (never fabricated). Surfaces provider,
 * runtime, and signal-bus health today; the same {@link SubsystemHealth} shape
 * describes any future subsystem, so the health overview extends without a
 * redesign.
 */

export type HealthStatus = 'healthy' | 'warning' | 'degraded' | 'unavailable' | 'unknown';

/** How severe each status is, for rolling subsystems up into an overall status. */
const STATUS_SEVERITY: Record<HealthStatus, number> = {
  healthy: 0,
  unknown: 1,
  warning: 2,
  degraded: 3,
  unavailable: 4,
};

export interface SubsystemHealth {
  subsystem: string;
  status: HealthStatus;
  /** Short, human-facing explanation of the current status. */
  detail: string;
  checkedAt: string;
  /** Optional supporting figures (already computed; no secrets). */
  metrics?: Record<string, number>;
}

export interface PlatformHealth {
  overall: HealthStatus;
  subsystems: SubsystemHealth[];
  checkedAt: string;
}

/** Inputs required to assess platform health — all already-observed facts. */
export interface HealthInputs {
  providerAvailable: boolean;
  runtimeAvailable: boolean;
  metrics: SignalMetrics;
  bus: SignalBusHealth;
  now: string;
}

/** Roll a set of subsystem statuses up into the worst (most severe) one. */
export function worstStatus(statuses: HealthStatus[]): HealthStatus {
  if (statuses.length === 0) return 'unknown';
  return statuses.reduce((worst, s) => (STATUS_SEVERITY[s] > STATUS_SEVERITY[worst] ? s : worst));
}

function providerHealth(inputs: HealthInputs): SubsystemHealth {
  return {
    subsystem: 'provider',
    status: inputs.providerAvailable ? 'healthy' : 'unavailable',
    detail: inputs.providerAvailable
      ? 'Model provider configured and reachable.'
      : 'No model provider is configured — AI execution is unavailable.',
    checkedAt: inputs.now,
  };
}

function runtimeHealth(inputs: HealthInputs): SubsystemHealth {
  const { execution } = inputs.metrics;
  if (!inputs.runtimeAvailable) {
    return {
      subsystem: 'runtime',
      status: 'unavailable',
      detail: 'Execution runtime has no available provider.',
      checkedAt: inputs.now,
    };
  }
  const terminal = execution.completed + execution.failed + execution.timedOut;
  if (terminal === 0 || execution.failureRate === null) {
    return {
      subsystem: 'runtime',
      status: 'unknown',
      detail: 'No executions observed yet.',
      checkedAt: inputs.now,
    };
  }
  const rate = execution.failureRate;
  const status: HealthStatus = rate <= 0.1 ? 'healthy' : rate <= 0.33 ? 'warning' : 'degraded';
  return {
    subsystem: 'runtime',
    status,
    detail:
      status === 'healthy'
        ? 'Executions completing normally.'
        : `Elevated failure rate: ${Math.round(rate * 100)}% of ${terminal} executions.`,
    checkedAt: inputs.now,
    metrics: {
      executions: terminal,
      failures: execution.failed + execution.timedOut,
      retries: execution.retries,
    },
  };
}

function busHealth(inputs: HealthInputs): SubsystemHealth {
  const { published, failedDeliveries, subscribers } = inputs.bus;
  let status: HealthStatus = 'healthy';
  let detail = 'Signal bus delivering normally.';
  if (failedDeliveries > 0) {
    const ratio = published > 0 ? failedDeliveries / published : 1;
    status = ratio > 0.1 ? 'degraded' : 'warning';
    detail = `${failedDeliveries} failed deliver${failedDeliveries === 1 ? 'y' : 'ies'} out of ${published}.`;
  }
  return {
    subsystem: 'signal-bus',
    status,
    detail,
    checkedAt: inputs.now,
    metrics: { subscribers, published, failedDeliveries },
  };
}

/** Assess platform health from observed facts. */
export function computeHealth(inputs: HealthInputs): PlatformHealth {
  const subsystems = [providerHealth(inputs), runtimeHealth(inputs), busHealth(inputs)];
  return {
    overall: worstStatus(subsystems.map((s) => s.status)),
    subsystems,
    checkedAt: inputs.now,
  };
}
