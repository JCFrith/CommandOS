import type {
  Signal,
  SignalCategory,
  SignalPayload,
  SignalPayloadValue,
  SignalSeverity,
  SignalSource,
} from './types';
import { SIGNAL_CATEGORIES, SIGNAL_SEVERITIES, SIGNAL_SOURCES } from './types';

/**
 * Reusable observability metrics — computed FROM signals wherever possible, so
 * there is a single source of truth (the event stream) rather than a parallel
 * metrics pipeline that can drift.
 *
 * Execution metrics are derived from the runtime's terminal execution signals
 * (`execution.completed|failed|timed_out|cancelled`) and retry signals
 * (`execution.retried`), reading the structured stats each carries in its
 * payload (see the emitters). Values marked `estimated` upstream stay estimates
 * — the metrics never present an approximation as a measured figure.
 */

/** The runtime execution signal types that carry a terminal outcome. */
const OUTCOME_TYPE: Record<string, 'completed' | 'failed' | 'timedOut' | 'cancelled'> = {
  'execution.completed': 'completed',
  'execution.failed': 'failed',
  'execution.timed_out': 'timedOut',
  'execution.cancelled': 'cancelled',
};

const RETRY_TYPE = 'execution.retried';

export interface ExecutionMetrics {
  total: number;
  completed: number;
  failed: number;
  timedOut: number;
  cancelled: number;
  /** Number of retry attempts observed across executions. */
  retries: number;
  /** completed / (completed + failed + timedOut), in [0,1]; null with no data. */
  successRate: number | null;
  /** (failed + timedOut) / total-terminal, in [0,1]; null with no data. */
  failureRate: number | null;
  /** Mean execution duration (ms) across terminal executions; null if none. */
  avgDurationMs: number | null;
  /** Mean measured provider-call latency (ms); null if none reported. */
  avgProviderLatencyMs: number | null;
  totalTokens: number;
  estimatedCostUsd: number;
  /** True if any contributing token/cost figure was an upstream estimate. */
  costEstimated: boolean;
}

export interface SignalMetrics {
  total: number;
  bySeverity: Record<SignalSeverity, number>;
  byCategory: Record<SignalCategory, number>;
  bySource: Record<SignalSource, number>;
  execution: ExecutionMetrics;
  /** Signals per minute across the observed window; null if <2 signals. */
  throughputPerMinute: number | null;
  windowStart: string | null;
  windowEnd: string | null;
}

function num(payload: SignalPayload, key: string): number | null {
  const value: SignalPayloadValue | undefined = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bool(payload: SignalPayload, key: string): boolean {
  return payload[key] === true;
}

function zeroBy<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
}

/** Compute the full metrics snapshot from a set of signals. */
export function computeMetrics(signals: Signal[]): SignalMetrics {
  const bySeverity = zeroBy(SIGNAL_SEVERITIES);
  const byCategory = zeroBy(SIGNAL_CATEGORIES);
  const bySource = zeroBy(SIGNAL_SOURCES);

  let completed = 0;
  let failed = 0;
  let timedOut = 0;
  let cancelled = 0;
  let retries = 0;
  let durationSum = 0;
  let durationCount = 0;
  let providerLatencySum = 0;
  let providerLatencyCount = 0;
  let totalTokens = 0;
  let estimatedCostUsd = 0;
  let costEstimated = false;

  let windowStart: string | null = null;
  let windowEnd: string | null = null;

  for (const signal of signals) {
    bySeverity[signal.severity] += 1;
    byCategory[signal.category] += 1;
    bySource[signal.source] += 1;

    if (windowStart === null || signal.createdAt < windowStart) windowStart = signal.createdAt;
    if (windowEnd === null || signal.createdAt > windowEnd) windowEnd = signal.createdAt;

    if (signal.type === RETRY_TYPE) retries += 1;

    const outcome = OUTCOME_TYPE[signal.type];
    if (outcome) {
      if (outcome === 'completed') completed += 1;
      else if (outcome === 'failed') failed += 1;
      else if (outcome === 'timedOut') timedOut += 1;
      else cancelled += 1;

      const duration = num(signal.payload, 'durationMs');
      if (duration !== null) {
        durationSum += duration;
        durationCount += 1;
      }
      const providerLatency = num(signal.payload, 'providerLatencyMs');
      if (providerLatency !== null) {
        providerLatencySum += providerLatency;
        providerLatencyCount += 1;
      }
      const tokens = num(signal.payload, 'totalTokens');
      if (tokens !== null) totalTokens += tokens;
      const cost = num(signal.payload, 'costUsd');
      if (cost !== null) estimatedCostUsd += cost;
      if (bool(signal.payload, 'estimated')) costEstimated = true;
    }
  }

  const terminal = completed + failed + timedOut;
  const successRate = terminal > 0 ? completed / terminal : null;
  const failureRate = terminal > 0 ? (failed + timedOut) / terminal : null;

  const execution: ExecutionMetrics = {
    total: completed + failed + timedOut + cancelled,
    completed,
    failed,
    timedOut,
    cancelled,
    retries,
    successRate,
    failureRate,
    avgDurationMs: durationCount > 0 ? Math.round(durationSum / durationCount) : null,
    avgProviderLatencyMs:
      providerLatencyCount > 0 ? Math.round(providerLatencySum / providerLatencyCount) : null,
    totalTokens,
    estimatedCostUsd: Math.round(estimatedCostUsd * 1e6) / 1e6,
    costEstimated,
  };

  let throughputPerMinute: number | null = null;
  if (windowStart && windowEnd && signals.length >= 2) {
    const spanMs = new Date(windowEnd).getTime() - new Date(windowStart).getTime();
    const minutes = spanMs / 60_000;
    throughputPerMinute = minutes > 0 ? Math.round((signals.length / minutes) * 100) / 100 : null;
  }

  return {
    total: signals.length,
    bySeverity,
    byCategory,
    bySource,
    execution,
    throughputPerMinute,
    windowStart,
    windowEnd,
  };
}
