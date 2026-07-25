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
 * Agents use cases. Owns validation (Zod), authorization (RBAC + ownership),
 * lifecycle enforcement (the state machine), workspace scoping, and activity
 * recording. AI execution mechanics (provider call, retry, timeout, accounting,
 * structured-output validation, logging) are delegated to the reusable
 * {@link ExecutionRuntime} — the agent domain only builds a typed request and
 * maps the result onto its {@link AgentExecution} record. Depends only on the
 * {@link AgentRepository} and {@link ExecutionRuntime} interfaces.
 */
export class AgentService {
  constructor(
    private readonly repo: AgentRepository,
    private readonly runtime: ExecutionRuntime,
    private readonly deps: ServiceDeps = defaultDeps,
  ) {}

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
    this.assert(
      canCreateAgent(ctx.workspace),
      'forbidden',
      'You do not have permission to create agents.',
    );
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
    return created;
  }

  /** Edit an agent's editable fields (name, description, instructions, capabilities). */
  async update(ctx: AgentContext, id: string, input: unknown): Promise<Agent> {
    const existing = await this.get(ctx, id);
    this.assert(
      canManageAgent(ctx.user, ctx.workspace, existing),
      'forbidden',
      'You do not have permission to edit this agent.',
    );
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
    return saved;
  }

  /** Transition an agent's status, enforcing the state machine. */
  async transition(ctx: AgentContext, id: string, input: unknown): Promise<Agent> {
    const existing = await this.get(ctx, id);
    this.assert(
      canManageAgent(ctx.user, ctx.workspace, existing),
      'forbidden',
      'You do not have permission to change this agent.',
    );
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
    return saved;
  }

  /**
   * Run an eligible agent against operator-provided input. Enforces authz +
   * executable status + AI availability + a duplicate-submission guard, then
   * delegates the model call to the {@link ExecutionRuntime} (which owns retry,
   * timeout, accounting, structured-output validation, and logging) and maps the
   * runtime {@link Execution} onto the persisted {@link AgentExecution}.
   */
  async execute(ctx: AgentContext, id: string, input: unknown): Promise<AgentExecution> {
    const agent = await this.get(ctx, id);
    this.assert(
      canManageAgent(ctx.user, ctx.workspace, agent),
      'forbidden',
      'You do not have permission to run this agent.',
    );
    if (!isExecutable(agent.status)) {
      throw new AgentError(
        'not_executable',
        `This agent is ${statusLabel(agent.status).toLowerCase()} and cannot run. Activate it first.`,
      );
    }
    // Belt-and-suspenders authz (status + manage), mirrors the UI gate.
    this.assert(
      canExecuteAgent(ctx.user, ctx.workspace, agent),
      'forbidden',
      'You do not have permission to run this agent.',
    );

    if (!this.runtime.isAvailable()) {
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

    const request = buildAgentExecutionRequest(
      agent,
      prompt,
      {
        workspaceId: ctx.workspace.id,
        operatorId: ctx.user.id,
        operatorName: ctx.user.displayName,
        subjectId: agent.id,
        subjectType: 'agent',
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
