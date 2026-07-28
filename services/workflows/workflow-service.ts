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

  /** Start a run manually (authorized operator). */
  async start(ctx: WorkflowContext, id: string, input: unknown = {}): Promise<WorkflowRun> {
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
    return this.execute(version, runCtx, { type: 'manual', ref: ctx.user.id }, runInput ?? {});
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
        const runCtx = this.runContext(ctx.workspace.id, ctx.user, run.correlationId);
        await this.runtime.resume(version, run, runCtx);
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

  private async execute(
    version: WorkflowVersion,
    runCtx: WorkflowRunContext,
    trigger: WorkflowRunTrigger,
    input: Record<string, unknown>,
  ): Promise<WorkflowRun> {
    const run: WorkflowRun = {
      id: this.deps.id(),
      workflowId: version.workflowId,
      versionId: version.id,
      workspaceId: version.workspaceId,
      correlationId: runCtx.correlationId ?? this.deps.id(),
      status: 'pending',
      trigger,
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
