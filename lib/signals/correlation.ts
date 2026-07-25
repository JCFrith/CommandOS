import type { Signal, SignalCorrelation } from './types';

/**
 * Correlation tracking — the thread that ties one logical chain of work together
 * across subsystems.
 *
 * A correlation id is minted once at the head of a chain (e.g. when an operator
 * runs an agent) and then carried, unchanged, through every downstream step:
 *
 * ```
 * Agent run → Execution runtime → Provider call → Retry → Completion
 *      └──────────────── one correlationId ────────────────┘
 * ```
 *
 * Every signal emitted anywhere in that chain preserves the id automatically
 * (the emitters thread {@link SignalCorrelation} into `createSignal`), so the
 * timeline and correlation views can reconstruct the whole flow — and a future
 * notification can reference it — without any per-feature plumbing.
 */

/** A correlation with no parent — the head of a new chain. */
export function rootCorrelation(correlationId: string): SignalCorrelation {
  return { correlationId, parentId: null };
}

/**
 * Derive the correlation for a child signal caused by `parent`: it inherits the
 * parent's `correlationId` and records the parent's id as its `parentId`. This
 * is how causal depth is preserved within a single chain.
 */
export function childOf(parent: Signal): SignalCorrelation {
  return { correlationId: parent.correlationId, parentId: parent.id };
}

/**
 * Continue an existing chain at the same causal level (same `correlationId`,
 * optionally under a known parent). Used when several sibling signals belong to
 * one chain (e.g. the runtime's execution events under an agent run).
 */
export function continueChain(
  correlationId: string,
  parentId: string | null = null,
): SignalCorrelation {
  return { correlationId, parentId };
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
