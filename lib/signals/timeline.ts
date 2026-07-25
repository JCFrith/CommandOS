import type { Signal, SignalCategory, SignalSeverity, SignalSource } from './types';
import { groupByCorrelation } from './correlation';

/**
 * The reusable timeline engine.
 *
 * Timelines are generated FROM signals rather than from per-feature history
 * tables, so any domain — Operations, Agents, Executions, a Signal's own
 * correlation chain, or a future subsystem — gets a consistent, chronological
 * view for free. Feed it the relevant signals (filter first by subject or
 * correlation) and it returns ordered, presentation-ready entries.
 */

/** A single, presentation-ready timeline entry derived from a {@link Signal}. */
export interface TimelineEntry {
  /** The source signal id. */
  id: string;
  at: string;
  type: string;
  source: SignalSource;
  category: SignalCategory;
  severity: SignalSeverity;
  title: string;
  summary: string;
  actorName: string | null;
  correlationId: string;
  parentId: string | null;
  subjectType: string | null;
  subjectId: string | null;
}

export interface TimelineOptions {
  /** `desc` (newest first, default) or `asc` (oldest first). */
  order?: 'asc' | 'desc';
  /** Cap the number of entries returned (after ordering). */
  limit?: number;
}

function toEntry(signal: Signal): TimelineEntry {
  return {
    id: signal.id,
    at: signal.createdAt,
    type: signal.type,
    source: signal.source,
    category: signal.category,
    severity: signal.severity,
    title: signal.title,
    summary: signal.summary,
    actorName: signal.actorName,
    correlationId: signal.correlationId,
    parentId: signal.parentId,
    subjectType: signal.subjectType,
    subjectId: signal.subjectId,
  };
}

/** Build an ordered timeline from a set of signals. */
export function buildTimeline(signals: Signal[], options: TimelineOptions = {}): TimelineEntry[] {
  const order = options.order ?? 'desc';
  const entries = signals
    .map(toEntry)
    .sort((a, b) => (order === 'asc' ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at)));
  return options.limit !== undefined ? entries.slice(0, options.limit) : entries;
}

/**
 * A timeline for a specific domain subject (e.g. an operation or agent),
 * assembled from that subject's signals. The caller supplies the subject's
 * signals (already workspace-scoped and subject-filtered by the service).
 */
export function buildSubjectTimeline(
  signals: Signal[],
  subjectType: string,
  subjectId: string,
  options: TimelineOptions = {},
): TimelineEntry[] {
  return buildTimeline(
    signals.filter((s) => s.subjectType === subjectType && s.subjectId === subjectId),
    options,
  );
}

/** A single correlation chain, ordered oldest → newest (causal order). */
export interface CorrelationChain {
  correlationId: string;
  entries: TimelineEntry[];
  start: string;
  end: string;
  /** The most severe severity seen in the chain. */
  severities: SignalSeverity[];
}

/**
 * Assemble correlation chains from a set of signals — one chain per
 * `correlationId`, entries in causal (oldest-first) order. Used by the
 * correlation view to render an execution flow end to end.
 */
export function buildCorrelationChains(signals: Signal[]): CorrelationChain[] {
  const groups = groupByCorrelation(signals);
  const chains: CorrelationChain[] = [];
  for (const [correlationId, chainSignals] of groups) {
    const entries = buildTimeline(chainSignals, { order: 'asc' });
    if (entries.length === 0) continue;
    chains.push({
      correlationId,
      entries,
      start: entries[0]!.at,
      end: entries[entries.length - 1]!.at,
      severities: [...new Set(entries.map((e) => e.severity))],
    });
  }
  // Most recently active chain first.
  return chains.sort((a, b) => b.end.localeCompare(a.end));
}
