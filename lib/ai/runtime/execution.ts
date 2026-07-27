import type { z } from 'zod';

import type { Conversation } from '@/lib/ai/conversation/conversation';
import type { StructuredOutputSpec } from '@/lib/ai/provider/provider';
import type { CancellationToken } from '@/lib/platform/cancellation';
import type { RetryPolicy } from '@/lib/platform/retry';
import type { TokenUsage, CostEstimate } from './accounting';

/**
 * The AI execution domain model — the AI-specific layer over the generic
 * platform execution primitives (`lib/platform/execution.ts`). The status
 * machine, `ExecutionKind`, `ExecutionContext`, and `ExecutionEvent` are owned
 * by the platform and re-exported here so existing imports of this module keep
 * working; this file adds only what is AI-specific: a typed `ExecutionRequest`
 * (conversation + structured output), the validated `ExecutionResult`, the
 * token/cost-bearing `ExecutionMetadata`, the AI `ExecutionError` codes, and the
 * full `Execution` record.
 */

// Generic execution primitives are owned by the platform runtime.
export {
  TERMINAL_STATUSES,
  canTransition,
  isTerminalStatus,
  type ExecutionKind,
  type ExecutionStatus,
  type ExecutionContext,
  type ExecutionEvent,
  type ExecutionEventType,
} from '@/lib/platform/execution';
import type {
  ExecutionContext,
  ExecutionEvent,
  ExecutionStatus,
  ExecutionKind,
} from '@/lib/platform/execution';

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
