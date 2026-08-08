import 'server-only';

import { serviceClient } from '@/lib/supabase/service';
import type { Workflow, WorkflowVersion } from '@/lib/workflows/types';
import { seedVariables } from '@/lib/workflows/variables';
import { workflowRepository } from '@/services/workflows/in-memory-workflow-repository';
import type {
  ClaimAndEnqueueInput,
  ClaimOutcome,
  DurableTriggerPort,
  ScannedSignal,
  SignalCursor,
} from './durable-trigger-evaluator';
import type { DurableSchedulePort, ScheduleClaimInput } from './durable-schedule-evaluator';

/** The job kind the durable worker handler drains to execute a triggered run. */
export const WORKFLOW_RUN_JOB_KIND = 'workflow.run';

/** The job kind drained to resume a suspended run (due timer / decided approval). */
export const WORKFLOW_RESUME_JOB_KIND = 'workflow.resume';

export interface DurablePortDeps {
  id(): string;
  now(): string;
}
const defaultDeps: DurablePortDeps = {
  id: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

/**
 * Production {@link DurableTriggerPort}: wires the evaluator to the durable
 * workflow repository, the persisted signal scan, the `trigger_scan_cursor`, and
 * the atomic `app_claim_trigger_run` RPC. Server-only — every query is
 * workspace-scoped and the claim/run/enqueue is a single transaction (no stranding).
 */
export class SupabaseDurableTriggerPort implements DurableTriggerPort, DurableSchedulePort {
  constructor(private readonly deps: DurablePortDeps = defaultDeps) {}

  private get db() {
    return serviceClient();
  }

  now(): string {
    return this.deps.now();
  }

  newCorrelationId(): string {
    return this.deps.id();
  }

  listActiveWorkflows(): Promise<Workflow[]> {
    return workflowRepository.listActive();
  }

  getVersion(workspaceId: string, versionId: string): Promise<WorkflowVersion | null> {
    return workflowRepository.getVersion(workspaceId, versionId);
  }

  async latestSignalPosition(workspaceId: string): Promise<SignalCursor | null> {
    const { data, error } = await this.db
      .from('signals')
      .select('created_at, id')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`latestSignalPosition failed: ${error.message}`);
    return data ? { createdAt: data.created_at as string, id: data.id as string } : null;
  }

  async scanSignalsAfter(
    workspaceId: string,
    cursor: SignalCursor | null,
    limit: number,
  ): Promise<ScannedSignal[]> {
    const { data, error } = await this.db.rpc('app_scan_signals_after', {
      p_workspace: workspaceId,
      p_created_at: cursor?.createdAt ?? null,
      p_signal_id: cursor?.id ?? null,
      p_limit: limit,
    });
    if (error) throw new Error(`scanSignalsAfter failed: ${error.message}`);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      workspaceId: r.workspace_id as string,
      type: r.type as string,
      correlationId: r.correlation_id as string,
      source: r.source as string,
      createdAt: r.created_at as string,
    }));
  }

  async readCursor(workspaceId: string): Promise<SignalCursor | null> {
    const { data, error } = await this.db
      .from('trigger_scan_cursor')
      .select('last_signal_created_at, last_signal_id')
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (error) throw new Error(`readCursor failed: ${error.message}`);
    if (!data || !data.last_signal_id) return null; // absent/reset ⇒ re-initialize
    return {
      createdAt: data.last_signal_created_at as string,
      id: data.last_signal_id as string,
    };
  }

  async advanceCursor(workspaceId: string, to: SignalCursor): Promise<void> {
    const { error } = await this.db.rpc('app_advance_trigger_cursor', {
      p_workspace: workspaceId,
      p_created_at: to.createdAt,
      p_signal_id: to.id,
      p_now: this.deps.now(),
    });
    if (error) throw new Error(`advanceCursor failed: ${error.message}`);
  }

  async claimAndEnqueueRun(input: ClaimAndEnqueueInput): Promise<ClaimOutcome> {
    const { version, signalId, correlationId } = input;
    // Same server-derived occurrence key the synchronous path uses (trusted data only).
    const triggerKey = `${version.workspaceId}:${version.id}:signal:${signalId}`;
    const { data, error } = await this.db.rpc('app_claim_trigger_run', {
      p_workspace: version.workspaceId,
      p_trigger_key: triggerKey,
      p_run_id: this.deps.id(),
      p_workflow_id: version.workflowId,
      p_version_id: version.id,
      p_correlation_id: correlationId,
      p_trigger: { type: 'signal', ref: signalId },
      p_variables: seedVariables(version.variables, {}),
      p_started_by: version.createdBy,
      p_job_kind: WORKFLOW_RUN_JOB_KIND,
      p_now: this.deps.now(),
    });
    if (error) throw new Error(`claimAndEnqueueRun failed: ${error.message}`);
    return (data as { claimed?: boolean } | null)?.claimed === true ? 'enqueued' : 'duplicate';
  }

  // --- schedule / timer / approval resume (Sprint 7 D-667/D-668) ------------

  async claimScheduleRun(input: ScheduleClaimInput): Promise<ClaimOutcome> {
    const { version, occurrenceKey, scheduledAt, correlationId } = input;
    const { data, error } = await this.db.rpc('app_claim_schedule_run', {
      p_workspace: version.workspaceId,
      p_workflow_id: version.workflowId,
      p_occurrence_key: occurrenceKey,
      p_run_id: this.deps.id(),
      p_version_id: version.id,
      p_correlation_id: correlationId,
      // Retain the scheduled occurrence time as causation (distinct from `now`).
      p_trigger: { type: 'schedule', ref: occurrenceKey, scheduledAt },
      p_variables: seedVariables(version.variables, {}),
      p_started_by: version.createdBy,
      p_job_kind: WORKFLOW_RUN_JOB_KIND,
      p_now: this.deps.now(),
    });
    if (error) throw new Error(`claimScheduleRun failed: ${error.message}`);
    return (data as { claimed?: boolean } | null)?.claimed === true ? 'enqueued' : 'duplicate';
  }

  /** Claim due timers + enqueue `workflow.resume` jobs (bounded). Returns count. */
  async claimDueTimers(limit = 100): Promise<number> {
    const { data, error } = await this.db.rpc('app_claim_due_timers', {
      p_now: this.deps.now(),
      p_limit: limit,
      p_job_kind: WORKFLOW_RESUME_JOB_KIND,
    });
    if (error) throw new Error(`claimDueTimers failed: ${error.message}`);
    return typeof data === 'number' ? data : 0;
  }

  /** Fast-path approval resume claim (from a decision). Idempotent per approval. */
  async claimApprovalResume(
    workspaceId: string,
    approvalId: string,
    runId: string,
  ): Promise<ClaimOutcome> {
    const { data, error } = await this.db.rpc('app_claim_approval_resume', {
      p_workspace: workspaceId,
      p_approval_id: approvalId,
      p_run_id: runId,
      p_job_kind: WORKFLOW_RESUME_JOB_KIND,
      p_now: this.deps.now(),
    });
    if (error) throw new Error(`claimApprovalResume failed: ${error.message}`);
    return (data as { claimed?: boolean } | null)?.claimed === true ? 'enqueued' : 'duplicate';
  }

  /** Catch-up: claim decided-but-unresumed approvals + enqueue. Returns count. */
  async claimDueApprovalResumes(limit = 100): Promise<number> {
    const { data, error } = await this.db.rpc('app_claim_due_approval_resumes', {
      p_now: this.deps.now(),
      p_limit: limit,
      p_job_kind: WORKFLOW_RESUME_JOB_KIND,
    });
    if (error) throw new Error(`claimDueApprovalResumes failed: ${error.message}`);
    return typeof data === 'number' ? data : 0;
  }

  /** Aggregate durable-runtime health snapshot (never secrets/per-row). */
  async durableHealth(): Promise<Record<string, unknown>> {
    const { data, error } = await this.db.rpc('app_durable_health', { p_now: this.deps.now() });
    if (error) throw new Error(`durableHealth failed: ${error.message}`);
    return (data as Record<string, unknown> | null) ?? {};
  }
}
