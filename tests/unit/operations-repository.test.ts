import { describe, expect, it } from 'vitest';

import { InMemoryOperationsRepository } from '@/services/operations/in-memory-operations-repository';
import type { Operation, OperationActivity } from '@/types';

function makeOp(overrides: Partial<Operation> = {}): Operation {
  return {
    id: 'op-1',
    workspaceId: 'ws-1',
    title: 'Op',
    description: null,
    status: 'draft',
    priority: 'medium',
    createdBy: 'u-1',
    updatedBy: 'u-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('InMemoryOperationsRepository', () => {
  it('creates and reads back within a workspace', async () => {
    const repo = new InMemoryOperationsRepository();
    await repo.create(makeOp());
    const found = await repo.getById('ws-1', 'op-1');
    expect(found?.title).toBe('Op');
  });

  it('isolates operations by workspace', async () => {
    const repo = new InMemoryOperationsRepository();
    await repo.create(makeOp({ id: 'a', workspaceId: 'ws-1' }));
    await repo.create(makeOp({ id: 'b', workspaceId: 'ws-2' }));

    expect(await repo.listByWorkspace('ws-1')).toHaveLength(1);
    expect(await repo.getById('ws-2', 'a')).toBeNull();
  });

  it('does not leak stored state by reference', async () => {
    const repo = new InMemoryOperationsRepository();
    await repo.create(makeOp());
    const found = await repo.getById('ws-1', 'op-1');
    found!.title = 'mutated';
    const reread = await repo.getById('ws-1', 'op-1');
    expect(reread?.title).toBe('Op');
  });

  it('replaces on update', async () => {
    const repo = new InMemoryOperationsRepository();
    await repo.create(makeOp());
    await repo.update(makeOp({ title: 'Renamed', status: 'planned' }));
    const found = await repo.getById('ws-1', 'op-1');
    expect(found).toMatchObject({ title: 'Renamed', status: 'planned' });
  });

  it('appends and filters activity by operation', async () => {
    const repo = new InMemoryOperationsRepository();
    const entry: OperationActivity = {
      id: 'a-1',
      operationId: 'op-1',
      workspaceId: 'ws-1',
      actorId: 'u-1',
      actorName: 'Ada',
      type: 'created',
      message: 'created this operation',
      fromStatus: null,
      toStatus: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    await repo.appendActivity(entry);
    await repo.appendActivity({ ...entry, id: 'a-2', operationId: 'op-2' });

    const activity = await repo.listActivity('ws-1', 'op-1');
    expect(activity).toHaveLength(1);
    expect(activity[0]?.id).toBe('a-1');
  });
});
