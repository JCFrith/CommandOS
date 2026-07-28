import type { Signal, SignalCorrelation } from './types';
import { childRef } from '@/lib/platform/correlation';

/**
 * Signal-specific correlation helpers, built on the platform correlation
 * primitives (`@/lib/platform/correlation`).
 *
 * The generic chain constructors — `rootCorrelation` / `continueChain` — are
 * owned by the platform and re-exported here so existing signal emitters keep
 * importing them from `@/lib/signals/correlation` unchanged. This module adds
 * only what is Signal-shaped: deriving a child from a {@link Signal} and
 * grouping signals into chains.
 *
 * A correlation id is minted once at the head of a chain (e.g. an agent run) and
 * carried unchanged through every downstream step:
 *
 * ```
 * Agent run → Execution runtime → Provider call → Retry → Completion → Signal timeline
 *      └──────────────────────── one correlationId ────────────────────────┘
 * ```
 */

export { rootCorrelation, continueChain, type CorrelationRef } from '@/lib/platform/correlation';

/**
 * Derive the correlation for a child signal caused by `parent`: it inherits the
 * parent's `correlationId` and records the parent's id as its `parentId`.
 */
export function childOf(parent: Signal): SignalCorrelation {
  return childRef(parent);
}

/** Group signals by their correlation id (chain → signals, insertion order). */
export function groupByCorrelation(signals: Signal[]): Map<string, Signal[]> {
  const groups = new Map<string, Signal[]>();
  for (const signal of signals) {
    const existing = groups.get(signal.correlationId);
    if (existing) existing.push(signal);
    else groups.set(signal.correlationId, [signal]);
  }
  return groups;
}
