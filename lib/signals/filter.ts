import type { Signal, SignalFilter } from './types';
import { SEVERITY_RANK } from './types';

/**
 * Pure predicate: does a signal satisfy a {@link SignalFilter}? Every present
 * field must match (AND); array fields match ANY of their members (OR within the
 * field). Shared by the bus (subscription routing), the store (querying), and
 * the UI (faceted filtering), so filtering semantics are defined exactly once.
 */
export function matchesFilter(signal: Signal, filter: SignalFilter): boolean {
  if (filter.workspaceId !== undefined && signal.workspaceId !== filter.workspaceId) return false;
  if (filter.correlationId !== undefined && signal.correlationId !== filter.correlationId)
    return false;
  if (filter.parentId !== undefined && signal.parentId !== filter.parentId) return false;
  if (filter.subjectType !== undefined && signal.subjectType !== filter.subjectType) return false;
  if (filter.subjectId !== undefined && signal.subjectId !== filter.subjectId) return false;
  if (filter.actorId !== undefined && signal.actorId !== filter.actorId) return false;

  if (
    filter.severities &&
    filter.severities.length > 0 &&
    !filter.severities.includes(signal.severity)
  ) {
    return false;
  }
  if (filter.minSeverity && SEVERITY_RANK[signal.severity] < SEVERITY_RANK[filter.minSeverity]) {
    return false;
  }
  if (
    filter.categories &&
    filter.categories.length > 0 &&
    !filter.categories.includes(signal.category)
  ) {
    return false;
  }
  if (filter.sources && filter.sources.length > 0 && !filter.sources.includes(signal.source)) {
    return false;
  }
  if (filter.types && filter.types.length > 0 && !filter.types.includes(signal.type)) {
    return false;
  }
  if (filter.statuses && filter.statuses.length > 0 && !filter.statuses.includes(signal.status)) {
    return false;
  }
  if (filter.tags && filter.tags.length > 0 && !filter.tags.some((t) => signal.tags.includes(t))) {
    return false;
  }
  if (filter.since !== undefined && signal.createdAt < filter.since) return false;
  if (filter.until !== undefined && signal.createdAt > filter.until) return false;

  if (filter.search) {
    const needle = filter.search.toLowerCase();
    const haystack = `${signal.title} ${signal.summary} ${signal.type}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  return true;
}

/** Filter and sort signals (newest first) in one pass — the common query shape. */
export function selectSignals(signals: Signal[], filter: SignalFilter = {}): Signal[] {
  return signals
    .filter((s) => matchesFilter(s, filter))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
