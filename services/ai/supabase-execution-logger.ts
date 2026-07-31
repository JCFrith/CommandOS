import 'server-only';

import type { ExecutionLog, ExecutionLogger } from '@/lib/ai/runtime/logging';
import type { TokenUsage, CostEstimate } from '@/lib/ai/runtime/accounting';
import type { ExecutionEvent, ExecutionStatus } from '@/lib/platform/execution';
import { serviceClient } from '@/lib/supabase/service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const toLog = (r: any): ExecutionLog => ({
  executionId: r.id,
  requestId: r.request_id,
  workspaceId: r.workspace_id,
  operatorId: r.operator_id,
  subjectId: r.subject_id ?? undefined,
  subjectType: r.subject_type ?? undefined,
  provider: r.provider,
  model: r.model,
  status: r.status as ExecutionStatus,
  createdAt: r.created_at,
  completedAt: r.completed_at,
  durationMs: r.duration_ms,
  attempts: r.attempts,
  toolCalls: r.tool_calls,
  usage: r.usage as TokenUsage,
  cost: r.cost as CostEstimate,
  events: (r.events ?? []) as ExecutionEvent[],
  error: r.error,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * PRODUCTION {@link ExecutionLogger} over Postgres (service-role, workspace-scoped,
 * append-only). Secret-free by construction — the same {@link ExecutionLog} the
 * runtime already builds; this adapter only maps it to the `execution_logs` row.
 */
export class SupabaseExecutionLogger implements ExecutionLogger {
  private get db() {
    return serviceClient();
  }

  async record(log: ExecutionLog): Promise<void> {
    const { error } = await this.db.from('execution_logs').insert({
      id: log.executionId,
      workspace_id: log.workspaceId,
      request_id: log.requestId,
      correlation_id: null,
      operator_id: log.operatorId,
      subject_id: log.subjectId ?? null,
      subject_type: log.subjectType ?? null,
      provider: log.provider,
      model: log.model,
      status: log.status,
      duration_ms: log.durationMs,
      attempts: log.attempts,
      tool_calls: log.toolCalls,
      usage: log.usage,
      cost: log.cost,
      events: log.events,
      error: log.error,
      created_at: log.createdAt,
      completed_at: log.completedAt,
    });
    if (error) throw new Error(error.message);
  }

  async listByWorkspace(workspaceId: string): Promise<ExecutionLog[]> {
    const { data, error } = await this.db
      .from('execution_logs')
      .select()
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toLog);
  }
}
