import type { z } from 'zod';

import type { Agent, AgentActivity, AgentExecution } from '@/types';
import type { WorkspaceContext } from '@/services/workspace/context';
import {
  createAgentSchema,
  executeAgentSchema,
  transitionAgentSchema,
  updateAgentSchema,
} from '@/lib/agents/schema';
import {
  INITIAL_STATUS,
  canTransition,
  isExecutable,
  isTerminal,
  statusLabel,
} from '@/lib/agents/state-machine';
import {
  canCreateAgent,
  canExecuteAgent,
  canManageAgent,
  canViewAgents,
} from '@/lib/agents/permissions';
import { buildAgentExecutionRequest } from '@/lib/agents/execution-request';
import type { ExecutionRuntime } from '@/lib/ai/runtime/runtime';
import type { SignalPublisher } from '@/lib/signals/bus';
import type { SignalSeverity } from '@/lib/signals/types';
import { rootCorrelation, continueChain } from '@/lib/signals/correlation';
import { makeEmitter, noopPublisher, type SignalEmit } from '@/services/signals/emit';
import type { AgentRepository } from './agent-repository';

/** The resolved caller context (shared with operations). */
export type AgentContext = WorkspaceContext;

export type AgentErrorCode =
  | 'validation'
  | 'forbidden'
  | 'not_found'
  | 'invalid_transition'
  | 'locked'
  | 'not_executable'
  | 'unavailable'
  | 'conflict';

/** A typed, expected domain failure (not a bug) — caught at the edge. */
export class AgentError extends Error {
  constructor(
    readonly code: AgentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

/** Injectable clock + id source so the service is deterministic under test. */
export interface ServiceDeps {
  now: () => string;
  id: () => string;
}

const defaultDeps: ServiceDeps = {
  now: () => new Date().toISOString(),
  id: () => crypto.randomUUID(),
};

/**
 * A TRUSTED, server-side correlation context an upstream orchestrator (e.g. the
 * WorkflowRuntime capability adapter) may supply so a nested agent run — and all
 * its downstream AI-runtime Signals — inherit the caller's correlation chain
 * instead of minting a new root.
 *
 * This is NEVER derived from client input: only trusted server-side callers pass
 * it, and {@link AgentService.execute} adopts it only after validating that its
 * `workspaceId` matches the caller's workspace (a foreign context is ignored, and
 * a fresh root chain is minted instead). A client can therefore never select or
 * inject a correlation id.
 */
export interface TrustedCorrelationContext {
  correlationId: string;
  /** Must equal the caller's workspace, else the context is ignored. */
  workspaceId: string;
  /** The upstream event/step that caused this run (parent within the chain). */
  causationId?: string;
  workflowRunId?: string;
  workflowStepRunId?: string;
  /** The automation/service identity initiating the run (audit). */
  initiatingActorId?: string;
}

/** Options for {@link AgentService.execute} (all server-side; none from client). */
export interface AgentExecuteOptions {
  correlation?: TrustedCorrelationContext;
}

/**
 * Agents use cases. Owns validation (Zod), authorization (RBAC + ownership),
 * lifecycle enforcement (the state machine), workspace scoping, and activity
 * recording. AI execution mechanics (provider call, retry, timeout, accounting,
 * structured-output validation, logging) are delegated to the reusable
 * {@link ExecutionRuntime} — the agent domain only builds a typed request and
 * maps the result onto its {@link AgentExecution} record. Depends only on the
 * {@link AgentRepository} and {@link ExecutionRuntime} interfaces.
 */
export class AgentService {
  /** Best-effort Signal emitter (see {@link makeEmitter}). */
  private readonly emit: SignalEmit;

  constructor(
    private readonly repo: AgentRepository,
    private readonly runtime: ExecutionRuntime,
    private readonly deps: ServiceDeps = defaultDeps,
    publisher: SignalPublisher = noopPublisher,
  ) {
    this.emit = makeEmitter(publisher, this.deps);
  }

  /** Agents in the caller's workspace, most-recently-updated first. */
  async list(ctx: AgentContext): Promise<Agent[]> {
    this.assert(canViewAgents(ctx.workspace), 'forbidden', 'You cannot view agents here.');
    const agents = await this.repo.listByWorkspace(ctx.workspace.id);
    return agents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** A single agent, scoped to the caller's workspace. */
  async get(ctx: AgentContext, id: string): Promise<Agent> {
    this.assert(canViewAgents(ctx.workspace), 'forbidden', 'You cannot view agents here.');
    const agent = await this.repo.getById(ctx.workspace.id, id);
    if (!agent) throw new AgentError('not_found', 'That agent no longer exists.');
    return agent;
  }

  /** Create an agent in `draft`, recording a `created` activity entry. */
  async create(ctx: AgentContext, input: unknown): Promise<Agent> {
    if (!canCreateAgent(ctx.workspace)) {
      await this.deny(ctx, null, 'create agent', 'You do not have permission to create agents.');
    }
    const data = this.parse(createAgentSchema, input);
    const timestamp = this.deps.now();

    const agent: Agent = {
      id: this.deps.id(),
      workspaceId: ctx.workspace.id,
      name: data.name,
      type: data.type,
      description: normalize(data.description),
      instructions: normalize(data.instructions),
      capabilities: data.capabilities,
      status: INITIAL_STATUS,
      createdBy: ctx.user.id,
      updatedBy: ctx.user.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const created = await this.repo.create(agent);
    await this.record(ctx, created, 'created', 'created this agent');
    await this.signal(ctx, 'agent.created', created, `created agent "${created.name}"`, {
      payload: { agentType: created.type, status: created.status },
    });
    return created;
  }

  /** Edit an agent's editable fields (name, description, instructions, capabilities). */
  async update(ctx: AgentContext, id: string, input: unknown): Promise<Agent> {
    const existing = await this.get(ctx, id);
    if (!canManageAgent(ctx.user, ctx.workspace, existing)) {
      await this.deny(
        ctx,
        existing.id,
        'edit agent',
        'You do not have permission to edit this agent.',
      );
    }
    if (isTerminal(existing.status)) {
      throw new AgentError('locked', 'Archived agents are read-only.');
    }

    const data = this.parse(updateAgentSchema, input);
    const description = normalize(data.description);
    const instructions = normalize(data.instructions);

    const changed: string[] = [];
    if (data.name !== existing.name) changed.push('name');
    if (description !== existing.description) changed.push('description');
    if (instructions !== existing.instructions) changed.push('instructions');
    if (!sameCapabilities(data.capabilities, existing.capabilities)) changed.push('capabilities');

    if (changed.length === 0) return existing;

    const updated: Agent = {
      ...existing,
      name: data.name,
      description,
      instructions,
      capabilities: data.capabilities,
      updatedBy: ctx.user.id,
      updatedAt: this.deps.now(),
    };

    const saved = await this.repo.update(updated);
    await this.record(ctx, saved, 'updated', `updated ${changed.join(', ')}`);
    await this.signal(ctx, 'agent.updated', saved, `updated ${changed.join(', ')}`, {
      payload: { changed },
    });
    return saved;
  }

  /** Transition an agent's status, enforcing the state machine. */
  async transition(ctx: AgentContext, id: string, input: unknown): Promise<Agent> {
    const existing = await this.get(ctx, id);
    if (!canManageAgent(ctx.user, ctx.workspace, existing)) {
      await this.deny(
        ctx,
        existing.id,
        'transition agent',
        'You do not have permission to change this agent.',
      );
    }
    const { to } = this.parse(transitionAgentSchema, input);

    if (to === existing.status) return existing;
    if (!canTransition(existing.status, to)) {
      throw new AgentError(
        'invalid_transition',
        `Cannot move from ${statusLabel(existing.status)} to ${statusLabel(to)}.`,
      );
    }

    const updated: Agent = {
      ...existing,
      status: to,
      updatedBy: ctx.user.id,
      updatedAt: this.deps.now(),
    };

    const saved = await this.repo.update(updated);
    await this.record(
      ctx,
      saved,
      'status_changed',
      `moved from ${statusLabel(existing.status)} to ${statusLabel(to)}`,
      existing.status,
      to,
    );
    const transitionType =
      to === 'active'
        ? 'agent.activated'
        : to === 'paused'
          ? 'agent.paused'
          : to === 'archived'
            ? 'agent.archived'
            : 'agent.status_changed';
    await this.signal(
      ctx,
      transitionType,
      saved,
      `moved from ${statusLabel(existing.status)} to ${statusLabel(to)}`,
      { payload: { from: existing.status, to } },
    );
    return saved;
  }

  /**
   * Run an eligible agent against operator-provided input. Enforces authz +
   * executable status + AI availability + a duplicate-submission guard, then
   * delegates the model call to the {@link ExecutionRuntime} (which owns retry,
   * timeout, accounting, structured-output validation, and logging) and maps the
   * runtime {@link Execution} onto the persisted {@link AgentExecution}.
   */
  async execute(
    ctx: AgentContext,
    id: string,
    input: unknown,
    options: AgentExecuteOptions = {},
  ): Promise<AgentExecution> {
    const agent = await this.get(ctx, id);
    if (!canManageAgent(ctx.user, ctx.workspace, agent)) {
      await this.deny(ctx, agent.id, 'run agent', 'You do not have permission to run this agent.');
    }
    if (!isExecutable(agent.status)) {
      throw new AgentError(
        'not_executable',
        `This agent is ${statusLabel(agent.status).toLowerCase()} and cannot run. Activate it first.`,
      );
    }
    // Belt-and-suspenders authz (status + manage), mirrors the UI gate.
    if (!canExecuteAgent(ctx.user, ctx.workspace, agent)) {
      await this.deny(ctx, agent.id, 'run agent', 'You do not have permission to run this agent.');
    }

    // Correlation: inherit a TRUSTED upstream chain when supplied AND its
    // workspace matches (else a foreign context is ignored and a fresh root is
    // minted). A client can never inject a correlation id — only server-side
    // callers (e.g. the WorkflowRuntime adapter) pass `options.correlation`.
    const inherited =
      options.correlation && options.correlation.workspaceId === ctx.workspace.id
        ? options.correlation
        : undefined;
    const correlationId = inherited?.correlationId ?? this.deps.id();
    const headParentId = inherited?.workflowStepRunId ?? inherited?.workflowRunId ?? null;
    const headCorrelation = inherited
      ? continueChain(correlationId, headParentId)
      : rootCorrelation(correlationId);
    const chainRefs: Record<string, string> = inherited
      ? {
          workflowRunId: inherited.workflowRunId ?? '',
          workflowStepRunId: inherited.workflowStepRunId ?? '',
        }
      : {};

    if (!this.runtime.isAvailable()) {
      await this.emit({
        type: 'provider.unavailable',
        workspaceId: ctx.workspace.id,
        correlation: headCorrelation,
        actorId: ctx.user.id,
        actorName: ctx.user.displayName,
        summary: 'AI execution unavailable — no model provider is configured.',
        subjectType: 'agent',
        subjectId: agent.id,
        payload: { agentId: agent.id, ...chainRefs },
      });
      throw new AgentError(
        'unavailable',
        'AI execution is unavailable — no model provider is configured.',
      );
    }

    // Duplicate-submission guard (best-effort in a single realm).
    if (await this.repo.hasActiveExecution(ctx.workspace.id, agent.id)) {
      throw new AgentError('conflict', 'This agent already has a run in progress.');
    }

    const { input: prompt } = this.parse(executeAgentSchema, input);

    let execution: AgentExecution = {
      id: this.deps.id(),
      agentId: agent.id,
      workspaceId: ctx.workspace.id,
      requestedBy: ctx.user.id,
      status: 'running',
      input: prompt,
      result: null,
      error: null,
      model: null,
      promptVersion: null,
      durationMs: null,
      createdAt: this.deps.now(),
      completedAt: null,
    };
    execution = await this.repo.createExecution(execution);

    const started = await this.emit({
      type: 'agent.execution.started',
      workspaceId: ctx.workspace.id,
      correlation: headCorrelation,
      actorId: ctx.user.id,
      actorName: ctx.user.displayName,
      summary: `started a run of "${agent.name}"`,
      subjectType: 'agent',
      subjectId: agent.id,
      payload: { executionId: execution.id, agentType: agent.type, ...chainRefs },
    });

    const request = buildAgentExecutionRequest(
      agent,
      prompt,
      {
        workspaceId: ctx.workspace.id,
        operatorId: ctx.user.id,
        operatorName: ctx.user.displayName,
        subjectId: agent.id,
        subjectType: 'agent',
        correlationId,
        // Downstream AI-runtime Signals become children of the agent's started
        // Signal (or, when inherited, the workflow step), keeping the chain intact.
        causationId: started?.id ?? headParentId ?? undefined,
      },
      this.deps.id(),
    );
    const run = await this.runtime.run(request);

    execution = {
      ...execution,
      status:
        run.status === 'completed'
          ? 'completed'
          : run.status === 'cancelled'
            ? 'cancelled'
            : 'failed',
      result: run.result?.output ?? null,
      error: run.error?.message ?? null,
      model: run.metadata.model,
      promptVersion: run.metadata.promptVersion,
      durationMs: run.metadata.latencyMs,
      completedAt: this.deps.now(),
    };
    execution = await this.repo.updateExecution(execution);
    await this.record(
      ctx,
      agent,
      'executed',
      execution.status === 'completed' ? 'ran this agent' : 'ran this agent (failed)',
    );

    // Close the chain with an agent-level outcome Signal, correlated to the run.
    const succeeded = execution.status === 'completed';
    await this.emit({
      type: succeeded ? 'agent.execution.completed' : 'agent.execution.failed',
      workspaceId: ctx.workspace.id,
      correlation: continueChain(correlationId, started?.id ?? null),
      actorId: ctx.user.id,
      actorName: ctx.user.displayName,
      summary: succeeded
        ? `"${agent.name}" completed a run`
        : `"${agent.name}" run ${execution.status}`,
      subjectType: 'agent',
      subjectId: agent.id,
      severity: succeeded ? undefined : 'error',
      payload: {
        executionId: execution.id,
        status: execution.status,
        durationMs: execution.durationMs ?? 0,
        model: execution.model ?? 'unknown',
      },
    });
    return execution;
  }

  /** Executions for an agent, newest first. */
  async listExecutions(ctx: AgentContext, id: string): Promise<AgentExecution[]> {
    await this.get(ctx, id);
    const executions = await this.repo.listExecutions(ctx.workspace.id, id);
    return executions.reverse();
  }

  /** The activity timeline for an agent, newest first. */
  async activity(ctx: AgentContext, id: string): Promise<AgentActivity[]> {
    await this.get(ctx, id);
    const entries = await this.repo.listActivity(ctx.workspace.id, id);
    return entries.reverse();
  }

  // --- internals -----------------------------------------------------------

  private async record(
    ctx: AgentContext,
    agent: Agent,
    type: AgentActivity['type'],
    message: string,
    fromStatus: AgentActivity['fromStatus'] = null,
    toStatus: AgentActivity['toStatus'] = null,
  ): Promise<void> {
    const entry: AgentActivity = {
      id: this.deps.id(),
      agentId: agent.id,
      workspaceId: agent.workspaceId,
      actorId: ctx.user.id,
      actorName: ctx.user.displayName,
      type,
      message,
      fromStatus,
      toStatus,
      createdAt: this.deps.now(),
    };
    await this.repo.appendActivity(entry);
  }

  private parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
    const result = schema.safeParse(input);
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? 'Invalid input.';
      throw new AgentError('validation', message);
    }
    return result.data;
  }

  private assert(ok: boolean, code: AgentErrorCode, message: string): void {
    if (!ok) throw new AgentError(code, message);
  }

  /** Emit a workspace-scoped lifecycle Signal for an agent (best-effort). */
  private async signal(
    ctx: AgentContext,
    type: string,
    agent: Agent,
    summary: string,
    extra?: {
      severity?: SignalSeverity;
      payload?: Record<string, string | number | boolean | string[]>;
    },
  ): Promise<void> {
    await this.emit({
      type,
      workspaceId: agent.workspaceId,
      correlation: rootCorrelation(this.deps.id()),
      actorId: ctx.user.id,
      actorName: ctx.user.displayName,
      summary,
      subjectType: 'agent',
      subjectId: agent.id,
      severity: extra?.severity,
      payload: extra?.payload,
    });
  }

  /** Emit a PermissionDenied Signal and throw a forbidden error (never returns). */
  private async deny(
    ctx: AgentContext,
    subjectId: string | null,
    action: string,
    message: string,
  ): Promise<never> {
    await this.emit({
      type: 'authz.permission_denied',
      workspaceId: ctx.workspace.id,
      correlation: rootCorrelation(this.deps.id()),
      actorId: ctx.user.id,
      actorName: ctx.user.displayName,
      summary: `denied: ${action}`,
      subjectType: 'agent',
      subjectId,
      payload: { action, resource: 'agent' },
    });
    throw new AgentError('forbidden', message);
  }
}

function normalize(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function sameCapabilities(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((c) => setB.has(c));
}
