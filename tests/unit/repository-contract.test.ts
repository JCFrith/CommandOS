import { describe, expect, it } from 'vitest';

import { InMemoryOperationsRepository } from '@/services/operations/in-memory-operations-repository';
import { InMemoryAgentRepository } from '@/services/agents/in-memory-agent-repository';
import type { Operation, OperationActivity, Agent, AgentActivity } from '@/types';

/**
 * Repository CONTRACT tests — the invariants every implementation (in-memory and
 * the `Supabase*` adapters) must satisfy identically: workspace isolation,
 * CRUD roundtrip, and **append-only chronological activity ordering** (the
 * backend-agnostic `ORDER BY created_at, id` contract). Run here against the
 * in-memory implementations; the Supabase implementations run the same
 * invariants against Postgres when `SUPABASE_TEST_URL` is set (see
 * docs/database.md) — gated, not executed in a DB-less environment (TD-34).
 */

function op(id: string, ws: string): Operation {
  return {
    id,
    workspaceId: ws,
    title: `op ${id}`,
    description: null,
    status: 'draft',
    priority: 'medium',
    createdBy: 'u-1',
    updatedBy: 'u-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
function opAct(id: string, opId: string, ws: string, at: string): OperationActivity {
  return {
    id,
    operationId: opId,
    workspaceId: ws,
    actorId: 'u-1',
    actorName: 'Ada',
    type: 'created',
    message: 'x',
    fromStatus: null,
    toStatus: null,
    createdAt: at,
  };
}
function agent(id: string, ws: string): Agent {
  return {
    id,
    workspaceId: ws,
    name: `a ${id}`,
    type: 'executive',
    description: null,
    instructions: null,
    capabilities: ['summarize'],
    status: 'draft',
    createdBy: 'u-1',
    updatedBy: 'u-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
function agentAct(id: string, agentId: string, ws: string, at: string): AgentActivity {
  return {
    id,
    agentId,
    workspaceId: ws,
    actorId: 'u-1',
    actorName: 'Ada',
    type: 'created',
    message: 'x',
    fromStatus: null,
    toStatus: null,
    createdAt: at,
  };
}

describe('OperationsRepository contract — InMemory', () => {
  it('CRUD roundtrip is workspace-scoped', async () => {
    const repo = new InMemoryOperationsRepository();
    await repo.create(op('o1', 'ws-1'));
    await repo.create(op('o2', 'ws-2'));
    expect(await repo.getById('ws-1', 'o1')).not.toBeNull();
    expect(await repo.getById('ws-2', 'o1')).toBeNull(); // isolation
    expect((await repo.listByWorkspace('ws-1')).map((o) => o.id)).toEqual(['o1']);
    await repo.update({ ...op('o1', 'ws-1'), title: 'renamed' });
    expect((await repo.getById('ws-1', 'o1'))!.title).toBe('renamed');
  });

  it('activity is append-only and chronological (same-ms ties keep insert order)', async () => {
    const repo = new InMemoryOperationsRepository();
    const same = '2026-01-01T00:00:00.000Z';
    await repo.appendActivity(opAct('a1', 'o1', 'ws-1', same));
    await repo.appendActivity(opAct('a2', 'o1', 'ws-1', same));
    await repo.appendActivity(opAct('a3', 'o1', 'ws-2', same)); // other workspace
    const list = await repo.listActivity('ws-1', 'o1');
    expect(list.map((a) => a.id)).toEqual(['a1', 'a2']); // isolated + chronological
  });
});

describe('AgentRepository contract — InMemory', () => {
  it('executions + active-run guard are workspace-scoped', async () => {
    const repo = new InMemoryAgentRepository();
    await repo.create(agent('ag1', 'ws-1'));
    expect(await repo.hasActiveExecution('ws-1', 'ag1')).toBe(false);
    await repo.createExecution({
      id: 'e1',
      agentId: 'ag1',
      workspaceId: 'ws-1',
      requestedBy: 'u-1',
      status: 'running',
      input: 'x',
      result: null,
      error: null,
      model: null,
      promptVersion: null,
      durationMs: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      completedAt: null,
    });
    expect(await repo.hasActiveExecution('ws-1', 'ag1')).toBe(true);
    expect(await repo.hasActiveExecution('ws-2', 'ag1')).toBe(false); // isolation
  });

  it('activity is chronological and workspace-isolated', async () => {
    const repo = new InMemoryAgentRepository();
    const same = '2026-01-01T00:00:00.000Z';
    await repo.appendActivity(agentAct('a1', 'ag1', 'ws-1', same));
    await repo.appendActivity(agentAct('a2', 'ag1', 'ws-1', same));
    expect((await repo.listActivity('ws-1', 'ag1')).map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(await repo.listActivity('ws-2', 'ag1')).toHaveLength(0);
  });
});
