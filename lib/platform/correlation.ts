/**
 * Correlation primitives — the causal thread that ties one chain of work
 * together across subsystems.
 *
 * These are **domain-agnostic**: a correlation id is minted once at the head of
 * a chain and carried, unchanged, through every downstream step (an AI
 * execution, a future workflow run, a notification dispatch). Signal-specific
 * helpers build on these (see `lib/signals/correlation.ts`); the AI runtime and
 * future runtimes consume them directly.
 */

/** A correlation reference: the chain a unit of work belongs to, and its parent. */
export interface CorrelationRef {
  correlationId: string;
  parentId: string | null;
}

/** The head of a new chain — no parent. */
export function rootCorrelation(correlationId: string): CorrelationRef {
  return { correlationId, parentId: null };
}

/**
 * Continue an existing chain (same `correlationId`), optionally under a known
 * parent. Used when several siblings belong to one chain (e.g. a runtime's
 * events under a run it was handed a correlation id for).
 */
export function continueChain(
  correlationId: string,
  parentId: string | null = null,
): CorrelationRef {
  return { correlationId, parentId };
}

/**
 * Derive the correlation for a child caused by `parent`: it inherits the
 * parent's `correlationId` and records the parent's id as its `parentId`. The
 * parent is any record carrying `{ id, correlationId }`.
 */
export function childRef(parent: { id: string; correlationId: string }): CorrelationRef {
  return { correlationId: parent.correlationId, parentId: parent.id };
}
