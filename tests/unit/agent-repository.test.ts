import { describe, expect, it } from 'vitest';

import { InMemoryAgentRepository } from '@/services/agents/in-memory-agent-repository';
import type { Agent, AgentExecution } from '@/types';

function makeAgent(over: Partial<Agent> = {}): Agent {
  return {
    id: 'a-1',
    workspaceId: 'ws-1',
    name: 'Agent',
    type: 'operations',
    description: null,
    instructions: null,
    capabilities: [],
    status: 'draft',
    createdBy: 'u-1',
    updatedBy: 'u-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function makeExec(over: Partial<AgentExecution> = {}): AgentExecution {
  return {
    id: 'e-1',
    agentId: 'a-1',
    workspaceId: 'ws-1',
    requestedBy: 'u-1',
    status: 'running',
    input: 'go',
    result: null,
    error: null,
    model: null,
    promptVersion: null,
    durationMs: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    ...over,
  };
}

describe('InMemoryAgentRepository', () => {
  it('creates and reads back within a workspace, isolating others', async () => {
    const repo = new InMemoryAgentRepository();
    await repo.create(makeAgent({ id: 'a', workspaceId: 'ws-1' }));
    await repo.create(makeAgent({ id: 'b', workspaceId: 'ws-2' }));

    expect(await repo.listByWorkspace('ws-1')).toHaveLength(1);
    expect(await repo.getById('ws-1', 'a')).not.toBeNull();
    expect(await repo.getById('ws-2', 'a')).toBeNull();
  });

  it('does not leak stored state by reference', async () => {
    const repo = new InMemoryAgentRepository();
    await repo.create(makeAgent());
    const found = await repo.getById('ws-1', 'a-1');
    found!.name = 'mutated';
    expect((await repo.getById('ws-1', 'a-1'))?.name).toBe('Agent');
  });

  it('tracks executions and reports an active one for the dupe guard', async () => {
    const repo = new InMemoryAgentRepository();
    await repo.createExecution(makeExec({ id: 'e-1', status: 'running' }));
    expect(await repo.hasActiveExecution('ws-1', 'a-1')).toBe(true);

    const completed = makeExec({ id: 'e-1', status: 'completed' });
    await repo.updateExecution(completed);
    expect(await repo.hasActiveExecution('ws-1', 'a-1')).toBe(false);
    expect(await repo.getExecution('ws-1', 'e-1')).toMatchObject({ status: 'completed' });
    expect(await repo.getExecution('ws-2', 'e-1')).toBeNull();
  });

  it('lists executions scoped to workspace + agent', async () => {
    const repo = new InMemoryAgentRepository();
    await repo.createExecution(makeExec({ id: 'e-1', agentId: 'a-1' }));
    await repo.createExecution(makeExec({ id: 'e-2', agentId: 'a-2' }));
    expect(await repo.listExecutions('ws-1', 'a-1')).toHaveLength(1);
  });
});
