import type { z } from 'zod';

import type { AuthUser, Operation, OperationActivity, Workspace } from '@/types';
import {
  createOperationSchema,
  transitionOperationSchema,
  updateOperationSchema,
} from '@/lib/operations/schema';
import {
  INITIAL_STATUS,
  canTransition,
  isTerminal,
  statusLabel,
} from '@/lib/operations/state-machine';
import {
  canCreateOperation,
  canManageOperation,
  canViewOperations,
} from '@/lib/operations/permissions';
import type { OperationsRepository } from './operations-repository';
import { operationsRepository } from './in-memory-operations-repository';

/** The resolved caller: who is acting and in which workspace. */
export interface OperationsContext {
  user: AuthUser;
  workspace: Workspace;
}

/** Failure codes the service raises; the action layer maps these to UI states. */
export type OperationErrorCode =
  'validation' | 'forbidden' | 'not_found' | 'invalid_transition' | 'locked';

/** A typed, expected domain failure (not a bug) — always caught at the edge. */
export class OperationError extends Error {
  constructor(
    readonly code: OperationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OperationError';
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
 * Operations use cases. Owns validation (Zod), authorization (RBAC + ownership),
 * lifecycle enforcement (the state machine), workspace scoping, and activity
 * recording. Depends only on the {@link OperationsRepository} interface, so the
 * backing store swaps without touching this logic.
 */
export class OperationsService {
  constructor(
    private readonly repo: OperationsRepository = operationsRepository,
    private readonly deps: ServiceDeps = defaultDeps,
  ) {}

  /** Operations in the caller's workspace, most-recently-updated first. */
  async list(ctx: OperationsContext): Promise<Operation[]> {
    this.assert(canViewOperations(ctx.workspace), 'forbidden', 'You cannot view operations here.');
    const operations = await this.repo.listByWorkspace(ctx.workspace.id);
    return operations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** A single operation, scoped to the caller's workspace. */
  async get(ctx: OperationsContext, id: string): Promise<Operation> {
    this.assert(canViewOperations(ctx.workspace), 'forbidden', 'You cannot view operations here.');
    const operation = await this.repo.getById(ctx.workspace.id, id);
    if (!operation) throw new OperationError('not_found', 'That operation no longer exists.');
    return operation;
  }

  /** Create an operation in `draft`, recording a `created` activity entry. */
  async create(ctx: OperationsContext, input: unknown): Promise<Operation> {
    this.assert(
      canCreateOperation(ctx.workspace),
      'forbidden',
      'You do not have permission to create operations.',
    );
    const data = this.parse(createOperationSchema, input);
    const timestamp = this.deps.now();

    const operation: Operation = {
      id: this.deps.id(),
      workspaceId: ctx.workspace.id,
      title: data.title,
      description: normalizeDescription(data.description),
      status: INITIAL_STATUS,
      priority: data.priority,
      createdBy: ctx.user.id,
      updatedBy: ctx.user.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const created = await this.repo.create(operation);
    await this.record(ctx, created, 'created', 'created this operation');
    return created;
  }

  /** Edit an operation's editable fields (title, description, priority). */
  async update(ctx: OperationsContext, id: string, input: unknown): Promise<Operation> {
    const existing = await this.get(ctx, id);
    this.assert(
      canManageOperation(ctx.user, ctx.workspace, existing),
      'forbidden',
      'You do not have permission to edit this operation.',
    );
    if (isTerminal(existing.status)) {
      throw new OperationError('locked', 'Archived operations are read-only.');
    }

    const data = this.parse(updateOperationSchema, input);
    const description = normalizeDescription(data.description);

    const changed: string[] = [];
    if (data.title !== existing.title) changed.push('title');
    if (description !== existing.description) changed.push('description');
    if (data.priority !== existing.priority) changed.push('priority');

    if (changed.length === 0) return existing;

    const updated: Operation = {
      ...existing,
      title: data.title,
      description,
      priority: data.priority,
      updatedBy: ctx.user.id,
      updatedAt: this.deps.now(),
    };

    const saved = await this.repo.update(updated);
    await this.record(ctx, saved, 'updated', `updated ${changed.join(', ')}`);
    return saved;
  }

  /** Transition an operation's status, enforcing the state machine. */
  async transition(ctx: OperationsContext, id: string, input: unknown): Promise<Operation> {
    const existing = await this.get(ctx, id);
    this.assert(
      canManageOperation(ctx.user, ctx.workspace, existing),
      'forbidden',
      'You do not have permission to change this operation.',
    );
    const { to } = this.parse(transitionOperationSchema, input);

    if (to === existing.status) return existing;
    if (!canTransition(existing.status, to)) {
      throw new OperationError(
        'invalid_transition',
        `Cannot move from ${statusLabel(existing.status)} to ${statusLabel(to)}.`,
      );
    }

    const updated: Operation = {
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

  /** The activity timeline for an operation, newest first. */
  async activity(ctx: OperationsContext, id: string): Promise<OperationActivity[]> {
    await this.get(ctx, id); // authorize + existence
    const entries = await this.repo.listActivity(ctx.workspace.id, id);
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // --- internals -----------------------------------------------------------

  private async record(
    ctx: OperationsContext,
    operation: Operation,
    type: OperationActivity['type'],
    message: string,
    fromStatus: OperationActivity['fromStatus'] = null,
    toStatus: OperationActivity['toStatus'] = null,
  ): Promise<void> {
    const entry: OperationActivity = {
      id: this.deps.id(),
      operationId: operation.id,
      workspaceId: operation.workspaceId,
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
      throw new OperationError('validation', message);
    }
    return result.data;
  }

  private assert(ok: boolean, code: OperationErrorCode, message: string): void {
    if (!ok) throw new OperationError(code, message);
  }
}

function normalizeDescription(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** The shared service instance, backed by the active repository. */
export const operationsService = new OperationsService();
