import type { Execution, ExecutionEvent, ExecutionStatus } from './execution';
import type { TokenUsage, CostEstimate } from './accounting';
import type * as EnvMod from '@/lib/env';
import type * as SupaLoggerMod from '@/services/ai/supabase-execution-logger';

/**
 * Execution logging — a durable, auditable record of every run.
 *
 * The log NEVER contains secrets, API keys, or provider credentials. It captures
 * timing, status changes, provider/model, workspace/operator ids, usage/cost,
 * tool usage counts, and a safe error message only.
 */
export interface ExecutionLog {
  executionId: string;
  requestId: string;
  workspaceId: string;
  operatorId: string;
  subjectId?: string;
  subjectType?: string;
  provider: string;
  model: string;
  status: ExecutionStatus;
  createdAt: string;
  completedAt: string | null;
  durationMs: number;
  attempts: number;
  toolCalls: number;
  usage: TokenUsage;
  cost: CostEstimate;
  /** Status-change timeline (no payloads). */
  events: ExecutionEvent[];
  /** Safe, user-facing error message — never internals. */
  error: string | null;
}

/** Project an {@link Execution} onto a secret-free {@link ExecutionLog}. */
export function toExecutionLog<T>(execution: Execution<T>): ExecutionLog {
  return {
    executionId: execution.id,
    requestId: execution.requestId,
    workspaceId: execution.context.workspaceId,
    operatorId: execution.context.operatorId,
    subjectId: execution.context.subjectId,
    subjectType: execution.context.subjectType,
    provider: execution.metadata.provider,
    model: execution.metadata.model,
    status: execution.status,
    createdAt: execution.createdAt,
    completedAt: execution.completedAt,
    durationMs: execution.metadata.latencyMs,
    attempts: execution.metadata.attempts,
    toolCalls: execution.metadata.toolCalls,
    usage: execution.metadata.usage,
    cost: execution.metadata.cost,
    events: execution.events,
    error: execution.error?.message ?? null,
  };
}

/** Sink for execution logs. Implementations persist or forward them. */
export interface ExecutionLogger {
  record(log: ExecutionLog): Promise<void>;
  /** Logs for a workspace, newest first (for observability surfaces). */
  listByWorkspace(workspaceId: string): Promise<ExecutionLog[]>;
}

/**
 * DEVELOPMENT-ONLY in-memory {@link ExecutionLogger}. Pinned to `globalThis`
 * within a realm (see the repository stores) so all module graphs share it;
 * replaced by a Supabase-backed logger later (TECH_DEBT). Bounded to the most
 * recent entries per workspace to avoid unbounded growth in a long dev session.
 */
export class InMemoryExecutionLogger implements ExecutionLogger {
  private readonly logs: ExecutionLog[] = [];
  private readonly max = 500;

  async record(log: ExecutionLog): Promise<void> {
    this.logs.push(structuredClone(log));
    if (this.logs.length > this.max) this.logs.splice(0, this.logs.length - this.max);
  }

  async listByWorkspace(workspaceId: string): Promise<ExecutionLog[]> {
    return this.logs
      .filter((l) => l.workspaceId === workspaceId)
      .map((l) => structuredClone(l))
      .reverse();
  }
}

const globalForLogger = globalThis as typeof globalThis & {
  __executionLogger?: ExecutionLogger;
};

/** The active execution logger (dev in-memory; swap for Supabase later). */
/* eslint-disable @typescript-eslint/no-require-imports */
function buildExecutionLogger(): ExecutionLogger {
  try {
    const env = require('@/lib/env') as typeof EnvMod;
    if (env.isSupabasePersistenceEnabled()) {
      const mod = require('@/services/ai/supabase-execution-logger') as typeof SupaLoggerMod;
      return new mod.SupabaseExecutionLogger();
    }
  } catch {
    /* fall through */
  }
  return new InMemoryExecutionLogger();
}
/* eslint-enable @typescript-eslint/no-require-imports */

export const executionLogger: ExecutionLogger =
  globalForLogger.__executionLogger ?? buildExecutionLogger();

globalForLogger.__executionLogger = executionLogger;
