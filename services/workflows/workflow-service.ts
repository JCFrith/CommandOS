import type { z } from 'zod';

import type { AuthUser, Workspace } from '@/types';
import type { WorkspaceContext } from '@/services/workspace/context';
import type { SignalBus, SignalPublisher } from '@/lib/signals/bus';
import { createSignal, type SignalDeps } from '@/lib/signals/signal';
import { rootCorrelation } from '@/lib/platform/correlation';
import type { SignalSeverity } from '@/lib/signals/types';

import type {
  Workflow,
  WorkflowApproval,
  WorkflowRun,
  WorkflowRunContext,
  WorkflowRunTrigger,
  WorkflowVersion,
} from '@/lib/workflows/types';
import {
  INITIAL_WORKFLOW_STATUS,
  canWorkflowTransition,
  isRunTerminal,
  isTriggerable,
  workflowStatusLabel,
} from '@/lib/workflows/state-machine';
import {
  createWorkflowSchema,
  decideApprovalSchema,
  startRunSchema,
  transitionWorkflowSchema,
  updateWorkflowSchema,
  validateDefinition,
} from '@/lib/workflows/schema';
import {
  canApprove,
  canCreateWorkflow,
  canManageWorkflow,
  canRunWorkflow,
  canViewWorkflows,
} from '@/lib/workflows/permissions';
import { seedVariables } from '@/lib/workflows/variables';
import { type WorkflowRuntime } from '@/lib/workflows/runtime/runtime';
import type { WorkflowRepository } from './workflow-repository';
import { TriggerEngine } from './trigger-engine';

export type WorkflowContext = WorkspaceContext;

export type WorkflowErrorCode =
  'validation' | 'forbidden' | 'not_found' | 'invalid_transition' | 'not_runnable' | 'conflict';

export class WorkflowError extends Error {
  constructor(
    readonly code: WorkflowErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}

export type WorkflowServiceDeps = SignalDeps;

/**
 * Durable approval resumption seam (Sprint 7 D-668). When present (durable mode),
 * an approval decision enqueues a `workflow.resume` job instead of executing the
 * workflow inside the deciding HTTP request. Absent in dev/in-memory mode, where
 * {@link WorkflowService.decideApproval} resumes synchronously (equivalent
 * behaviour). The implementation is server-only (service-role RPC).
 */
export interface DurableApprovalResumer {
  claimApprovalResume(
    workspaceId: string,
    approvalId: string,
    runId: string,
  ): Promise<'enqueued' | 'duplicate'>;
}

const defaultDeps: WorkflowServiceDeps = {
  now: () => new Date().toISOString(),
  id: () => crypto.randomUUID(),
};

/** Identity used for triggered (non-interactive) runs. */
function systemActor(id: string): AuthUser {
  return { id, email: null, displayName: 'Automation', avatarUrl: null };
}

/**
 * Workflow use cases: definition CRUD + versioning, lifecycle, and run
 * orchestration. Owns validation, RBAC + workspace scoping, and trigger
 * registration; delegates execution to the {@link WorkflowRuntime} and audit to
 * Signals (a run's history is reconstructed from Signals — no bespoke history
 * table). Depends only on the {@link WorkflowRepository} + runtime + bus.
 */
export class WorkflowService {
  private readonly triggers: TriggerEngine;

  constructor(
    private readonly repo: WorkflowRepository,
    private readonly runtime: WorkflowRuntime,
    bus: SignalBus,
    private readonly publisher: SignalPublisher,
    private readonly deps: WorkflowServiceDeps = defaultDeps,
    private readonly resumer?: DurableApprovalResumer,
  ) {
    this.triggers = new TriggerEngine(bus, (workflow, version, trigger) =>
      this.startFromTrigger(workflow, version, trigger),
    );
  }

  // --- reads ----------------------------------------------------------------

  async list(ctx: WorkflowContext): Promise<Workflow[]> {
    this.assertView(ctx);
    const workflows = await this.repo.listWorkflows(ctx.workspace.id);
    return workflows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(ctx: WorkflowContext, id: string): Promise<Workflow> {
    this.assertView(ctx);
    const workflow = await this.repo.getWorkflow(ctx.workspace.id, id);
    if (!workflow) throw new WorkflowError('not_found', 'That workflow no longer exists.');
    return workflow;
  }

  async listVersions(ctx: WorkflowContext, id: string): Promise<WorkflowVersion[]> {
    await this.get(ctx, id);
    return this.repo.listVersions(ctx.workspace.id, id);
  }

  async listRuns(ctx: WorkflowContext, id: string): Promise<WorkflowRun[]> {
    await this.get(ctx, id);
    return this.repo.listRuns(ctx.workspace.id, id);
  }

  async getRun(ctx: WorkflowContext, runId: string): Promise<WorkflowRun> {
    this.assertView(ctx);
    const run = await this.repo.getRun(ctx.workspace.id, runId);
    if (!run) throw new WorkflowError('not_found', 'That run no longer exists.');
    return run;
  }

  async runSteps(ctx: WorkflowContext, runId: string) {
    await this.getRun(ctx, runId);
    return this.repo.listSteps(ctx.workspace.id, runId);
  }

  async listPendingApprovals(ctx: WorkflowContext): Promise<WorkflowApproval[]> {
    this.assertView(ctx);
    return this.repo.listPendingApprovals(ctx.workspace.id);
  }

  // --- definition CRUD ------------------------------------------------------

  async create(ctx: WorkflowContext, input: unknown): Promise<Workflow> {
    if (!canCreateWorkflow(ctx.workspace)) {
      throw new WorkflowError('forbidden', 'You do not have permission to create workflows.');
    }
    const data = this.parse(createWorkflowSchema, input);
    const ts = this.deps.now();
    const workflow: Workflow = {
      id: this.deps.id(),
      workspaceId: ctx.workspace.id,
      name: data.name,
      description: data.description?.trim() || null,
      status: INITIAL_WORKFLOW_STATUS,
      currentVersionId: null,
      createdBy: ctx.user.id,
      updatedBy: ctx.user.id,
      createdAt: ts,
      updatedAt: ts,
    };
    const created = await this.repo.createWorkflow(workflow);
    await this.emit(ctx, 'workflow.created', created, `created workflow "${created.name}"`);
    return created;
  }

  async update(ctx: WorkflowContext, id: string, input: unknown): Promise<Workflow> {
    const existing = await this.get(ctx, id);
    if (!canManageWorkflow(ctx.workspace)) {
      throw new WorkflowError('forbidden', 'You do not have permission to edit this workflow.');
    }
    const data = this.parse(updateWorkflowSchema, input);
    const updated: Workflow = {
      ...existing,
      name: data.name,
      description: data.description?.trim() || null,
      updatedBy: ctx.user.id,
      updatedAt: this.deps.now(),
    };
    const saved = await this.repo.updateWorkflow(updated);
    await this.emit(ctx, 'workflow.updated', saved, 'updated workflow');
    return saved;
  }

  /** Publish a new immutable version from a validated graph definition. */
  async publish(ctx: WorkflowContext, id: string, definition: unknown): Promise<WorkflowVersion> {
    const workflow = await this.get(ctx, id);
    if (!canManageWorkflow(ctx.workspace)) {
      throw new WorkflowError('forbidden', 'You do not have permission to edit this workflow.');
    }
    const result = validateDefinition(definition);
    if (!result.ok) throw new WorkflowError('validation', result.errors[0] ?? 'Invalid workflow.');

    const existingVersions = await this.repo.listVersions(ctx.workspace.id, id);
    const nextNumber = (existingVersions[0]?.version ?? 0) + 1;
    const version: WorkflowVersion = {
      id: this.deps.id(),
      workflowId: id,
      workspaceId: ctx.workspace.id,
      version: nextNumber,
      nodes: result.def.nodes,
      edges: result.def.edges,
      triggers: result.def.triggers,
      variables: result.def.variables,
      startNodeId: result.def.startNodeId,
      createdBy: ctx.user.id,
      createdAt: this.deps.now(),
    };
    const created = await this.repo.createVersion(version);
    const updatedWorkflow = await this.repo.updateWorkflow({
      ...workflow,
      currentVersionId: created.id,
      updatedBy: ctx.user.id,
      updatedAt: this.deps.now(),
    });
    // Re-register triggers if the workflow is live.
    if (updatedWorkflow.status === 'active') this.triggers.register(updatedWorkflow, created);
    await this.emit(ctx, 'workflow.updated', updatedWorkflow, `published version ${nextNumber}`);
    return created;
  }

  async transition(ctx: WorkflowContext, id: string, input: unknown): Promise<Workflow> {
    const existing = await this.get(ctx, id);
    if (!canManageWorkflow(ctx.workspace)) {
      throw new WorkflowError('forbidden', 'You do not have permission to change this workflow.');
    }
    const { to } = this.parse(transitionWorkflowSchema, input);
    if (to === existing.status) return existing;
    if (!canWorkflowTransition(existing.status, to)) {
      throw new WorkflowError(
        'invalid_transition',
        `Cannot move from ${workflowStatusLabel(existing.status)} to ${workflowStatusLabel(to)}.`,
      );
    }
    if (to === 'active' && !existing.currentVersionId) {
      throw new WorkflowError('not_runnable', 'Publish a version before activating this workflow.');
    }

    const saved = await this.repo.updateWorkflow({
      ...existing,
      status: to,
      updatedBy: ctx.user.id,
      updatedAt: this.deps.now(),
    });

    if (to === 'active' && saved.currentVersionId) {
      const version = await this.repo.getVersion(ctx.workspace.id, saved.currentVersionId);
      if (version) this.triggers.register(saved, version);
    } else {
      this.triggers.unregister(id);
    }

    const type =
      to === 'active'
        ? 'workflow.activated'
        : to === 'paused'
          ? 'workflow.paused'
          : to === 'archived'
            ? 'workflow.archived'
            : 'workflow.updated';
    await this.emit(ctx, type, saved, `${workflowStatusLabel(to).toLowerCase()} workflow`);
    return saved;
  }

  // --- runs -----------------------------------------------------------------

  /**
   * Start a run manually (authorized operator). An optional `idempotencyKey`
   * (server-side) deduplicates repeated submissions of the same intent.
   */
  async start(
    ctx: WorkflowContext,
    id: string,
    input: unknown = {},
    idempotencyKey?: string,
  ): Promise<WorkflowRun> {
    const workflow = await this.get(ctx, id);
    if (!canRunWorkflow(ctx.workspace)) {
      throw new WorkflowError('forbidden', 'You do not have permission to run this workflow.');
    }
    if (!isTriggerable(workflow.status)) {
      throw new WorkflowError('not_runnable', 'Only active workflows can be run.');
    }
    if (!workflow.currentVersionId) {
      throw new WorkflowError('not_runnable', 'This workflow has no published version.');
    }
    const version = await this.repo.getVersion(ctx.workspace.id, workflow.currentVersionId);
    if (!version) throw new WorkflowError('not_found', 'The workflow version is missing.');

    const { input: runInput } = this.parse(startRunSchema, { input });
    const runCtx = this.runContext(ctx.workspace.id, ctx.user);
    return this.execute(
      version,
      runCtx,
      { type: 'manual', ref: ctx.user.id },
      runInput ?? {},
      idempotencyKey,
    );
  }

  /** Cancel a run in progress (or suspended). */
  async cancelRun(ctx: WorkflowContext, runId: string): Promise<WorkflowRun> {
    const run = await this.getRun(ctx, runId);
    if (!canRunWorkflow(ctx.workspace)) {
      throw new WorkflowError('forbidden', 'You do not have permission to cancel this run.');
    }
    if (isRunTerminal(run.status)) return run;
    const cancelled: WorkflowRun = {
      ...run,
      status: 'cancelled',
      frontier: [],
      error: 'Cancelled by operator.',
      completedAt: this.deps.now(),
      updatedAt: this.deps.now(),
    };
    await this.repo.saveRun(cancelled);
    await this.emitRun(cancelled, 'workflow.run.cancelled', 'run cancelled by operator', 'warning');
    return cancelled;
  }

  /** Resume a run whose timer is now due (dev: caller supplies elapsed time). */
  async resumeRun(ctx: WorkflowContext, runId: string): Promise<WorkflowRun> {
    const run = await this.getRun(ctx, runId);
    if (run.status !== 'waiting_timer') return run;
    const workflow = await this.get(ctx, run.workflowId);
    const version = await this.repo.getVersion(ctx.workspace.id, run.versionId);
    if (!version) throw new WorkflowError('not_found', 'The workflow version is missing.');
    const runCtx = this.runContext(
      ctx.workspace.id,
      workflow.createdBy === ctx.user.id ? ctx.user : systemActor(run.startedBy),
      run.correlationId,
    );
    return this.runtime.resume(version, run, runCtx);
  }

  /**
   * Execute a durably-enqueued run — the target of the `workflow.run` job handler
   * (Sprint 7 Phase 1, D-666). The run + its trigger claim were already created
   * atomically by the durable trigger evaluator; this loads the authoritative,
   * workspace-scoped run and its pinned version and drives it to a checkpoint.
   *
   * Idempotent and safe under at-least-once job delivery. Run-level concurrency is
   * inherited from the queue: the trigger claim guarantees exactly one
   * `workflow.run` job per run, and the job lease guarantees at most one worker
   * runs that job at a time; the runtime itself skips already-completed steps by
   * node id. So re-delivery converges — a terminal or suspended run is a no-op, a
   * crashed (`running`) run resumes from its persisted frontier, and a fresh
   * (`pending`) run starts. Never re-drives a suspension (that is the timer /
   * approval path's job) and never runs cross-workspace (the run is loaded scoped).
   */
  async runEnqueued(workspaceId: string, runId: string, expectedVersionId?: string): Promise<void> {
    const run = await this.repo.getRun(workspaceId, runId);
    if (!run) return; // deleted — nothing to execute; no-op so the job stops retrying
    if (isRunTerminal(run.status)) return; // already finished
    if (run.status === 'waiting_approval' || run.status === 'waiting_timer') return; // its own path resumes it
    if (expectedVersionId && expectedVersionId !== run.versionId) {
      throw new WorkflowError('conflict', 'The enqueued run version does not match the run.');
    }
    const version = await this.repo.getVersion(workspaceId, run.versionId);
    if (!version) {
      // The pinned version is gone — finalize rather than retry a permanently
      // broken run forever.
      const failed: WorkflowRun = {
        ...run,
        status: 'failed',
        frontier: [],
        error: 'The workflow version is missing.',
        completedAt: this.deps.now(),
        updatedAt: this.deps.now(),
      };
      await this.repo.saveRun(failed);
      await this.emitRun(failed, 'workflow.run.failed', 'run version missing', 'error');
      return;
    }
    if (version.workflowId !== run.workflowId) {
      throw new WorkflowError('conflict', 'The enqueued run does not match its version.');
    }
    const runCtx = this.runContext(workspaceId, systemActor(run.startedBy), run.correlationId);
    if (run.status === 'pending') {
      await this.runtime.start(version, run, runCtx);
    } else {
      await this.runtime.resume(version, run, runCtx); // `running` ⇒ crash recovery
    }
  }

  /**
   * Resume a durably-enqueued suspended run — the target of the `workflow.resume`
   * job handler (Sprint 7 Phase 1, D-668). Enqueued by the durable timer pass
   * (`cause: 'timer'`) or an approval decision / the approval-resume catch-up pass
   * (`cause: 'approval'`). Loads the authoritative, workspace-scoped run + pinned
   * version and re-advances it from its persisted frontier.
   *
   * Idempotent under at-least-once delivery: a terminal or already-advanced run is
   * a no-op, and the cause must match the run's current suspension (a `timer`
   * resume requires `waiting_timer`; an `approval` resume requires
   * `waiting_approval`) — a mismatched/stale resume is dropped. Run-level
   * concurrency is inherited from the one-resume-job-per-cause claim + the job
   * lease; the runtime skips already-completed nodes by id.
   */
  async resumeEnqueued(
    workspaceId: string,
    runId: string,
    cause: 'timer' | 'approval',
    causeId: string,
  ): Promise<void> {
    const run = await this.repo.getRun(workspaceId, runId);
    if (!run) return; // deleted — no-op
    if (isRunTerminal(run.status)) return; // already finished — nothing to resume
    // The resume cause must match the current suspension; otherwise this is a
    // stale/duplicate resume (the run already advanced) — drop it idempotently.
    if (cause === 'timer' && run.status !== 'waiting_timer') return;
    if (cause === 'approval' && run.status !== 'waiting_approval') return;
    if (cause === 'approval') {
      // Verify the cited approval exists, belongs to this run, and is decided.
      const approval = await this.repo.getApproval(workspaceId, causeId);
      if (!approval || approval.runId !== runId || approval.status === 'pending') return;
    }
    const version = await this.repo.getVersion(workspaceId, run.versionId);
    if (!version) {
      const failed: WorkflowRun = {
        ...run,
        status: 'failed',
        frontier: [],
        error: 'The workflow version is missing.',
        completedAt: this.deps.now(),
        updatedAt: this.deps.now(),
      };
      await this.repo.saveRun(failed);
      await this.emitRun(failed, 'workflow.run.failed', 'run version missing', 'error');
      return;
    }
    await this.emitRun(run, 'workflow.resume.started', `resume (${cause})`, 'trace');
    const runCtx = this.runContext(workspaceId, systemActor(run.startedBy), run.correlationId);
    try {
      const resumed = await this.runtime.resume(version, run, runCtx);
      await this.emitRun(resumed, 'workflow.resume.completed', `resumed (${cause})`, 'trace');
    } catch (err) {
      await this.emitRun(run, 'workflow.resume.failed', `resume failed (${cause})`, 'error');
      throw err; // let the worker retry via the job lease
    }
  }

  /** Decide a pending approval, then resume the run. */
  async decideApproval(
    ctx: WorkflowContext,
    approvalId: string,
    input: unknown,
  ): Promise<WorkflowApproval> {
    this.assertView(ctx);
    const approval = await this.repo.getApproval(ctx.workspace.id, approvalId);
    if (!approval) throw new WorkflowError('not_found', 'That approval no longer exists.');
    if (!canApprove(ctx.workspace, approval.approvers)) {
      throw new WorkflowError('forbidden', 'You do not have permission to decide this approval.');
    }
    if (approval.status !== 'pending') {
      throw new WorkflowError('conflict', 'This approval has already been decided.');
    }
    const { decision, comment } = this.parse(decideApprovalSchema, input);
    const decided = await this.repo.saveApproval({
      ...approval,
      status: decision,
      decidedBy: ctx.user.id,
      decidedAt: this.deps.now(),
      comment: comment?.trim() || null,
    });

    const run = await this.repo.getRun(ctx.workspace.id, approval.runId);
    if (run) {
      await this.emitRun(run, 'workflow.approval.decided', `approval ${decision}`, 'notice');
      const version = await this.repo.getVersion(ctx.workspace.id, run.versionId);
      if (version && !isRunTerminal(run.status)) {
        if (this.resumer) {
          // Durable mode: DO NOT execute the workflow inside this HTTP request.
          // The decision is persisted (above, transactional + decided-once); a
          // `workflow.resume` job is enqueued (fast path, idempotent per approval).
          // If this enqueue is lost to a crash, the approval-resume catch-up pass
          // recovers it — the decision alone is enough to guarantee resumption.
          await this.resumer.claimApprovalResume(ctx.workspace.id, approval.id, run.id);
        } else {
          const runCtx = this.runContext(ctx.workspace.id, ctx.user, run.correlationId);
          await this.runtime.resume(version, run, runCtx);
        }
      }
    }
    return decided;
  }

  /** Fire schedule triggers that are due (dev tick; production timer is TD). */
  async runDueSchedules(nowMs: number): Promise<number> {
    return this.triggers.runDue(nowMs);
  }

  /** Re-register triggers for every active workflow (called at wiring/boot). */
  async bootTriggers(): Promise<void> {
    for (const workflow of await this.repo.listActive()) {
      if (!workflow.currentVersionId) continue;
      const version = await this.repo.getVersion(workflow.workspaceId, workflow.currentVersionId);
      if (version) this.triggers.register(workflow, version);
    }
  }

  // --- internals ------------------------------------------------------------

  private async startFromTrigger(
    workflow: Workflow,
    version: WorkflowVersion,
    trigger: WorkflowRunTrigger,
  ): Promise<void> {
    if (!isTriggerable(workflow.status)) return;
    const runCtx = this.runContext(workflow.workspaceId, systemActor(workflow.createdBy));
    await this.execute(version, runCtx, trigger, {});
  }

  /**
   * A stable, server-derived key for one trigger OCCURRENCE (or `null` when a
   * manual run supplies no idempotency key — each is then distinct). Derived only
   * from trusted server-side data: workspace, version, trigger type, and the
   * occurrence id (source signal id / schedule tick / manual idempotency key).
   */
  private triggerKey(
    workspaceId: string,
    versionId: string,
    trigger: WorkflowRunTrigger,
    idempotencyKey?: string,
  ): string | null {
    if (trigger.type === 'signal' && trigger.ref) {
      return `${workspaceId}:${versionId}:signal:${trigger.ref}`;
    }
    if (trigger.type === 'schedule' && trigger.ref) {
      return `${workspaceId}:${versionId}:schedule:${trigger.ref}`;
    }
    if (trigger.type === 'manual' && idempotencyKey) {
      return `${workspaceId}:${versionId}:manual:${idempotencyKey}`;
    }
    return null;
  }

  private async execute(
    version: WorkflowVersion,
    runCtx: WorkflowRunContext,
    trigger: WorkflowRunTrigger,
    input: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<WorkflowRun> {
    const runId = this.deps.id();
    const key = this.triggerKey(version.workspaceId, version.id, trigger, idempotencyKey);

    // Deduplicate at-least-once trigger delivery: two runs are never created for
    // the same occurrence. The claim is atomic (maps to a DB unique constraint).
    if (key) {
      const claim = await this.repo.claimTrigger({
        workspaceId: version.workspaceId,
        triggerKey: key,
        runId,
        createdAt: this.deps.now(),
      });
      if (!claim.claimed) {
        const existing = claim.existingRunId
          ? await this.repo.getRun(version.workspaceId, claim.existingRunId)
          : null;
        if (existing) return existing;
        throw new WorkflowError('conflict', 'This trigger occurrence has already been processed.');
      }
    }

    const run: WorkflowRun = {
      id: runId,
      workflowId: version.workflowId,
      versionId: version.id,
      workspaceId: version.workspaceId,
      correlationId: runCtx.correlationId ?? this.deps.id(),
      status: 'pending',
      trigger,
      triggerKey: key,
      variables: seedVariables(version.variables, input),
      frontier: [],
      joinArrivals: {},
      error: null,
      startedBy: runCtx.operatorId,
      createdAt: this.deps.now(),
      updatedAt: this.deps.now(),
      completedAt: null,
    };
    await this.repo.createRun(run);
    return this.runtime.start(version, run, runCtx);
  }

  private runContext(
    workspaceId: string,
    user: AuthUser,
    correlationId?: string,
  ): WorkflowRunContext {
    return {
      workspaceId,
      operatorId: user.id,
      operatorName: user.displayName,
      subjectType: 'workflow',
      correlationId: correlationId ?? this.deps.id(),
    };
  }

  private parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
    const result = schema.safeParse(input);
    if (!result.success) {
      throw new WorkflowError('validation', result.error.issues[0]?.message ?? 'Invalid input.');
    }
    return result.data;
  }

  private assertView(ctx: WorkflowContext): void {
    if (!canViewWorkflows(ctx.workspace)) {
      throw new WorkflowError('forbidden', 'You cannot view workflows here.');
    }
  }

  private async emit(
    ctx: WorkflowContext,
    type: string,
    workflow: Workflow,
    summary: string,
  ): Promise<void> {
    await this.publishDefinitionSignal(
      type,
      workflow.workspaceId,
      workflow.id,
      summary,
      ctx.user,
      this.deps.id(),
    );
  }

  private async emitRun(
    run: WorkflowRun,
    type: string,
    summary: string,
    severity?: SignalSeverity,
  ): Promise<void> {
    try {
      await this.publisher.publish(
        createSignal(
          {
            type,
            workspaceId: run.workspaceId,
            correlation: rootCorrelation(run.correlationId),
            actorId: run.startedBy,
            actorName: null,
            summary,
            subjectType: 'workflow_run',
            subjectId: run.id,
            severity,
            source: 'workflows',
            payload: { runId: run.id },
          },
          this.deps,
        ),
      );
    } catch {
      /* best effort */
    }
  }

  private async publishDefinitionSignal(
    type: string,
    workspaceId: string,
    subjectId: string,
    summary: string,
    user: { id: string; displayName: string },
    correlationId: string,
  ): Promise<void> {
    try {
      await this.publisher.publish(
        createSignal(
          {
            type,
            workspaceId,
            correlation: rootCorrelation(correlationId),
            actorId: user.id,
            actorName: user.displayName,
            summary,
            subjectType: 'workflow',
            subjectId,
            source: 'workflows',
            payload: {},
          },
          this.deps,
        ),
      );
    } catch {
      /* best effort */
    }
  }
}

/** Convenience re-export for wiring. */
export type { Workspace };
