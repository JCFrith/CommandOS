import type { OperationStatus } from '@/types';

/**
 * The Operation lifecycle state machine.
 *
 * States and legal transitions are transcribed verbatim from the "Task" entity
 * in `33_STATE_MACHINE_SPECIFICATION.md` — the canonical lifecycle for a unit of
 * work. Nothing here is invented: the only legal moves are the ones the spec
 * lists. Invalid transitions are rejected (spec: "Invalid transitions are
 * rejected").
 *
 *   draft ─▶ planned ─▶ in_progress ─▶ completed ─▶ archived
 *                          ▲   │
 *                          └───┴─▶ blocked ─▶ in_progress
 */
export const OPERATION_STATUSES: readonly OperationStatus[] = [
  'draft',
  'planned',
  'in_progress',
  'blocked',
  'completed',
  'archived',
] as const;

/** Human-readable labels for each status. Pure (no presentation deps) so the
 * service can build audit messages without importing UI code. */
export const STATUS_LABELS: Record<OperationStatus, string> = {
  draft: 'Draft',
  planned: 'Planned',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  completed: 'Completed',
  archived: 'Archived',
};

/** The display label for a status. */
export function statusLabel(status: OperationStatus): string {
  return STATUS_LABELS[status];
}

/** Adjacency list of legal transitions, keyed by the current status. */
const TRANSITIONS: Record<OperationStatus, readonly OperationStatus[]> = {
  draft: ['planned'],
  planned: ['in_progress'],
  in_progress: ['blocked', 'completed'],
  blocked: ['in_progress'],
  completed: ['archived'],
  archived: [],
};

/** The statuses an Operation may legally move to from `from`. */
export function allowedTransitions(from: OperationStatus): readonly OperationStatus[] {
  return TRANSITIONS[from];
}

/** Whether moving `from` → `to` is a legal transition. */
export function canTransition(from: OperationStatus, to: OperationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** A terminal status has no outgoing transitions (`archived`). */
export function isTerminal(status: OperationStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** The initial status for a newly created Operation. */
export const INITIAL_STATUS: OperationStatus = 'draft';
