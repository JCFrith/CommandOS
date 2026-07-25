import type { z } from 'zod';

import type { Conversation } from '@/lib/ai/conversation/conversation';
import type { StructuredOutputSpec } from '@/lib/ai/provider/provider';
import type { CancellationToken } from './cancellation';
import type { RetryPolicy } from './retry';
import type { TokenUsage, CostEstimate } from './accounting';

/**
 * The execution domain model — a provider- and feature-agnostic description of
 * one AI run. The current runtime exercises only synchronous execution, but the
 * shape (kind, status set, events) supports async / scheduled / autonomous
 * execution without a redesign.
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

/** Who and where an execution runs — ids only, never secrets. */
export interface ExecutionContext {
  workspaceId: string;
  operatorId: string;
  operatorName: string;
  /** Optional correlation id linking this run to a domain record (e.g. agent). */
  subjectId?: string;
  subjectType?: string;
  /**
   * The Signal correlation id for the chain this execution belongs to. When set
   * (e.g. by the agent service, which mints it at the head of the run), the
   * runtime tags every execution Signal it emits with this id, so the whole
   * chain — agent run → runtime → provider → completion — shares one correlation.
   */
  correlationId?: string;
}

/** A typed request to run one execution producing a `T`-shaped structured output. */
export interface ExecutionRequest<T> {
  id: string;
  kind: ExecutionKind;
  context: ExecutionContext;
  conversation: Conversation;
  /** Zod schema the structured output is validated against (runtime-side). */
  outputSchema: z.ZodType<T>;
  /** JSON-schema spec handed to the provider's structured-output mode. */
  outputSpec: StructuredOutputSpec;
  retryPolicy: RetryPolicy;
  timeoutMs: number;
  /** Free-form audit tags (no secrets), e.g. `{ promptVersion }`. */
  metadata: Record<string, string | number | boolean>;
  /** Cancellation token; the runtime creates one if omitted. */
  token?: CancellationToken;
}

/** The validated result of a completed execution. */
export interface ExecutionResult<T> {
  output: T;
  /** The raw provider content (retained for audit/debug). */
  raw: string;
}

/** Audit-appropriate metadata about how an execution ran (no secrets). */
export interface ExecutionMetadata {
  provider: string;
  model: string;
  usage: TokenUsage;
  cost: CostEstimate;
  latencyMs: number;
  attempts: number;
  promptVersion: string | null;
  toolCalls: number;
}

export type ExecutionErrorCode =
  'unavailable' | 'timeout' | 'provider_failed' | 'invalid_output' | 'cancelled' | 'tool_failed';

/** A safe, user-facing execution failure. Never carries secrets or internals. */
export interface ExecutionError {
  code: ExecutionErrorCode;
  /** Error-catalog code (`39_ERROR_CATALOG.md`, domain `AI`). */
  catalogCode: string;
  message: string;
  retryable: boolean;
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

/** The full record of one execution. */
export interface Execution<T> {
  id: string;
  requestId: string;
  kind: ExecutionKind;
  context: ExecutionContext;
  status: ExecutionStatus;
  result: ExecutionResult<T> | null;
  error: ExecutionError | null;
  metadata: ExecutionMetadata;
  events: ExecutionEvent[];
  createdAt: string;
  completedAt: string | null;
}
