/**
 * Generic execution primitives — the provider- and domain-agnostic core of any
 * platform runtime.
 *
 * These describe *how a unit of work is driven and observed* without saying
 * anything about *what it does*: an execution kind, a lifecycle status machine,
 * the who/where context (with a correlation id), and immutable lifecycle events.
 * The AI runtime layers `ExecutionRequest`/`Execution`/metadata on top (see
 * `lib/ai/runtime/execution.ts`); a future `WorkflowRuntime` reuses the same
 * status machine, context, and events without modification.
 */

/** How an execution is driven. Only `synchronous` is exercised today. */
export type ExecutionKind = 'synchronous' | 'asynchronous' | 'scheduled' | 'autonomous';

/** The lifecycle status of an execution. */
export type ExecutionStatus =
  'queued' | 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out';

/** Statuses from which no further transition is possible. */
export const TERMINAL_STATUSES: readonly ExecutionStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'timed_out',
];

const TRANSITIONS: Record<ExecutionStatus, readonly ExecutionStatus[]> = {
  queued: ['pending', 'cancelled'],
  pending: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled', 'timed_out'],
  completed: [],
  failed: [],
  cancelled: [],
  timed_out: [],
};

export function canTransition(from: ExecutionStatus, to: ExecutionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminalStatus(status: ExecutionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Who and where a unit of work runs — ids only, never secrets. Carries the
 * correlation id for the chain it belongs to, so every runtime tags its work
 * onto one causal thread.
 */
export interface ExecutionContext {
  workspaceId: string;
  operatorId: string;
  operatorName: string;
  /** Optional link to a domain record (e.g. an agent, a workflow). */
  subjectId?: string;
  subjectType?: string;
  /** The correlation id for the chain this work belongs to. */
  correlationId?: string;
}

export type ExecutionEventType =
  | 'created'
  | 'queued'
  | 'started'
  | 'retrying'
  | 'tool_invoked'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

/** An immutable timeline entry recording a state change or notable moment. */
export interface ExecutionEvent {
  at: string;
  type: ExecutionEventType;
  status: ExecutionStatus;
  detail?: string;
}
