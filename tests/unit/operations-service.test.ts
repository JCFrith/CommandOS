import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryOperationsRepository } from '@/services/operations/in-memory-operations-repository';
import {
  OperationError,
  OperationsService,
  type OperationsContext,
  type ServiceDeps,
} from '@/services/operations/operations-service';
import type { AuthUser, Workspace, WorkspaceRole } from '@/types';

const user: AuthUser = { id: 'u-1', email: null, displayName: 'Ada', avatarUrl: null };
const other: AuthUser = { id: 'u-2', email: null, displayName: 'Bo', avatarUrl: null };

function ctxFor(
  u: AuthUser,
  role: WorkspaceRole = 'owner',
  workspaceId = 'ws-1',
): OperationsContext {
  const workspace: Workspace = { id: workspaceId, name: 'W', slug: 'w', role, kind: 'personal' };
  return { user: u, workspace };
}

/** Deterministic id + monotonic clock so ordering is stable under test. */
function deterministicDeps(): ServiceDeps {
  let ids = 0;
  let ticks = 0;
  return {
    id: () => `id-${++ids}`,
    now: () => new Date(Date.UTC(2026, 0, 1) + ticks++ * 1000).toISOString(),
  };
}

let service: OperationsService;

beforeEach(() => {
  service = new OperationsService(new InMemoryOperationsRepository(), deterministicDeps());
});

describe('OperationsService.create', () => {
  it('creates a draft scoped to the workspace and records a created event', async () => {
    const ctx = ctxFor(user);
    const op = await service.create(ctx, { title: 'Ship review', priority: 'high' });

    expect(op).toMatchObject({
      title: 'Ship review',
      status: 'draft',
      priority: 'high',
      workspaceId: 'ws-1',
      createdBy: 'u-1',
    });

    const activity = await service.activity(ctx, op.id);
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ type: 'created', actorName: 'Ada' });
  });

  it('normalizes a blank description to null', async () => {
    const op = await service.create(ctxFor(user), { title: 'X', description: '  ' });
    expect(op.description).toBeNull();
  });

  it('rejects invalid input with a validation error', async () => {
    await expect(service.create(ctxFor(user), { title: '' })).rejects.toMatchObject({
      code: 'validation',
    });
  });
});

describe('OperationsService.list / get', () => {
  it('returns operations most-recently-updated first', async () => {
    const ctx = ctxFor(user);
    const first = await service.create(ctx, { title: 'First' });
    const second = await service.create(ctx, { title: 'Second' });

    const list = await service.list(ctx);
    expect(list.map((o) => o.id)).toEqual([second.id, first.id]);
  });

  it('scopes reads to the caller workspace', async () => {
    const op = await service.create(ctxFor(user, 'owner', 'ws-1'), { title: 'Secret' });
    const otherCtx = ctxFor(user, 'owner', 'ws-2');

    expect(await service.list(otherCtx)).toHaveLength(0);
    await expect(service.get(otherCtx, op.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('throws not_found for a missing operation', async () => {
    await expect(service.get(ctxFor(user), 'nope')).rejects.toBeInstanceOf(OperationError);
  });

  it('blocks cross-workspace writes (update / transition) as not_found', async () => {
    const op = await service.create(ctxFor(user, 'owner', 'ws-1'), { title: 'A-only' });
    // Even an owner of a *different* workspace cannot reach it.
    const foreign = ctxFor(user, 'owner', 'ws-2');

    await expect(
      service.update(foreign, op.id, { title: 'Hijack', priority: 'low' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(service.transition(foreign, op.id, { to: 'planned' })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(service.activity(foreign, op.id)).rejects.toMatchObject({ code: 'not_found' });

    // The record is untouched in its own workspace.
    const still = await service.get(ctxFor(user, 'owner', 'ws-1'), op.id);
    expect(still.title).toBe('A-only');
    expect(still.status).toBe('draft');
  });
});

describe('OperationsService.update', () => {
  it('edits fields and records the changed fields', async () => {
    const ctx = ctxFor(user);
    const op = await service.create(ctx, { title: 'Old', priority: 'low' });
    const updated = await service.update(ctx, op.id, { title: 'New', priority: 'high' });

    expect(updated).toMatchObject({ title: 'New', priority: 'high' });
    const activity = await service.activity(ctx, op.id);
    expect(activity[0]).toMatchObject({ type: 'updated' });
    expect(activity[0]?.message).toContain('title');
    expect(activity[0]?.message).toContain('priority');
  });

  it('is a no-op (no new activity) when nothing changed', async () => {
    const ctx = ctxFor(user);
    const op = await service.create(ctx, { title: 'Same', priority: 'medium' });
    await service.update(ctx, op.id, { title: 'Same', priority: 'medium' });
    const activity = await service.activity(ctx, op.id);
    expect(activity).toHaveLength(1); // only the created event
  });

  it('forbids a non-creator member from editing', async () => {
    const owned = await service.create(ctxFor(user), { title: 'Mine' });
    const intruder = ctxFor(other, 'member');
    await expect(
      service.update(intruder, owned.id, { title: 'Hijack', priority: 'low' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('locks archived operations against edits', async () => {
    const ctx = ctxFor(user);
    const op = await service.create(ctx, { title: 'Retire me' });
    await service.transition(ctx, op.id, { to: 'planned' });
    await service.transition(ctx, op.id, { to: 'in_progress' });
    await service.transition(ctx, op.id, { to: 'completed' });
    await service.transition(ctx, op.id, { to: 'archived' });

    await expect(
      service.update(ctx, op.id, { title: 'Nope', priority: 'low' }),
    ).rejects.toMatchObject({ code: 'locked' });
  });
});

describe('OperationsService.transition', () => {
  it('applies a legal transition and records from/to', async () => {
    const ctx = ctxFor(user);
    const op = await service.create(ctx, { title: 'Move me' });
    const moved = await service.transition(ctx, op.id, { to: 'planned' });

    expect(moved.status).toBe('planned');
    const activity = await service.activity(ctx, op.id);
    expect(activity[0]).toMatchObject({
      type: 'status_changed',
      fromStatus: 'draft',
      toStatus: 'planned',
    });
  });

  it('rejects an illegal transition', async () => {
    const ctx = ctxFor(user);
    const op = await service.create(ctx, { title: 'Jumpy' });
    await expect(service.transition(ctx, op.id, { to: 'completed' })).rejects.toMatchObject({
      code: 'invalid_transition',
    });
  });

  it('is a no-op when transitioning to the current status', async () => {
    const ctx = ctxFor(user);
    const op = await service.create(ctx, { title: 'Stay' });
    const same = await service.transition(ctx, op.id, { to: 'draft' });
    expect(same.status).toBe('draft');
    expect(await service.activity(ctx, op.id)).toHaveLength(1);
  });
});

describe('OperationsService.activity ordering', () => {
  it('is newest-first even when entries share a timestamp', async () => {
    // Fixed clock → every activity gets the identical createdAt, so a naive
    // timestamp sort would tie. Ordering must fall back to append order.
    const fixed: ServiceDeps = {
      id: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
      now: () => '2026-01-01T00:00:00.000Z',
    };
    const svc = new OperationsService(new InMemoryOperationsRepository(), fixed);
    const ctx = ctxFor(user);

    const op = await svc.create(ctx, { title: 'Rapid' });
    await svc.update(ctx, op.id, { title: 'Rapid v2', priority: 'high' });
    await svc.transition(ctx, op.id, { to: 'planned' });

    const activity = await svc.activity(ctx, op.id);
    expect(activity.map((a) => a.type)).toEqual(['status_changed', 'updated', 'created']);
  });
});
