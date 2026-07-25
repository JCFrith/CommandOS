import { describe, expect, it } from 'vitest';

import { InMemoryAgentRepository } from '@/services/agents/in-memory-agent-repository';
import { AgentService, type AgentContext, type ServiceDeps } from '@/services/agents/agent-service';
import { ExecutionRuntime } from '@/lib/ai/runtime/runtime';
import { FakeModelProvider } from '@/lib/ai/provider/fake';
import { ProviderError } from '@/lib/ai/provider/provider';
import type { ExecutionLogger } from '@/lib/ai/runtime/logging';
import type { AuthUser, Workspace, WorkspaceRole } from '@/types';

const user: AuthUser = { id: 'u-1', email: null, displayName: 'Ada', avatarUrl: null };
const other: AuthUser = { id: 'u-2', email: null, displayName: 'Bo', avatarUrl: null };

/** A valid agent structured result, as a provider would return it. */
const AGENT_OK = JSON.stringify({
  summary: 'ok',
  keyPoints: ['a'],
  risks: [],
  recommendations: ['b'],
  confidence: 'medium',
});

type Scenario = 'success' | 'invalid_output' | 'timeout' | 'failed' | 'unavailable';

function providerFor(scenario: Scenario): FakeModelProvider {
  switch (scenario) {
    case 'success':
      return new FakeModelProvider({ content: AGENT_OK });
    case 'invalid_output':
      return new FakeModelProvider({ content: '{"nope":true}' });
    case 'timeout':
      return new FakeModelProvider({
        failWith: new ProviderError('timeout', 'CMD-AI-003', 'slow', true),
      });
    case 'failed':
      return new FakeModelProvider({
        failWith: new ProviderError('failed', 'CMD-AI-002', 'boom', true),
      });
    case 'unavailable':
      return new FakeModelProvider({ available: false });
  }
}

const noopLogger: ExecutionLogger = { record: async () => {}, listByWorkspace: async () => [] };

function ctxFor(u: AuthUser, role: WorkspaceRole = 'owner', workspaceId = 'ws-1'): AgentContext {
  const workspace: Workspace = { id: workspaceId, name: 'W', slug: 'w', role, kind: 'personal' };
  return { user: u, workspace };
}

function deterministicDeps(): ServiceDeps {
  let ids = 0;
  let ticks = 0;
  return {
    id: () => `id-${++ids}`,
    now: () => new Date(Date.UTC(2026, 0, 1) + ticks++ * 1000).toISOString(),
  };
}

/** A service wired with an in-memory repo + a runtime over a fake provider. */
function makeService(scenario: Scenario = 'success', repo = new InMemoryAgentRepository()) {
  const runtime = new ExecutionRuntime(providerFor(scenario), {
    sleep: async () => {},
    logger: noopLogger,
  });
  return new AgentService(repo, runtime, deterministicDeps());
}

async function activeAgent(svc: AgentService, ctx = ctxFor(user)) {
  const agent = await svc.create(ctx, { name: 'Briefer', type: 'executive' });
  await svc.transition(ctx, agent.id, { to: 'active' });
  return agent;
}

describe('AgentService — definition lifecycle', () => {
  it('creates a draft agent scoped to the workspace with a created event', async () => {
    const svc = makeService();
    const ctx = ctxFor(user);
    const agent = await svc.create(ctx, {
      name: 'Briefer',
      type: 'executive',
      capabilities: ['summarize'],
    });
    expect(agent).toMatchObject({ status: 'draft', workspaceId: 'ws-1', createdBy: 'u-1' });
    expect((await svc.activity(ctx, agent.id))[0]).toMatchObject({ type: 'created' });
  });

  it('rejects invalid input', async () => {
    const svc = makeService();
    await expect(svc.create(ctxFor(user), { name: '', type: 'executive' })).rejects.toMatchObject({
      code: 'validation',
    });
  });

  it('enforces the transition state machine', async () => {
    const svc = makeService();
    const ctx = ctxFor(user);
    const agent = await svc.create(ctx, { name: 'A', type: 'operations' });
    await expect(svc.transition(ctx, agent.id, { to: 'paused' })).rejects.toMatchObject({
      code: 'invalid_transition',
    });
    expect((await svc.transition(ctx, agent.id, { to: 'active' })).status).toBe('active');
  });

  it('locks archived agents against edits', async () => {
    const svc = makeService();
    const ctx = ctxFor(user);
    const agent = await svc.create(ctx, { name: 'A', type: 'operations' });
    await svc.transition(ctx, agent.id, { to: 'archived' });
    await expect(svc.update(ctx, agent.id, { name: 'B', capabilities: [] })).rejects.toMatchObject({
      code: 'locked',
    });
  });

  it('scopes reads and writes to the workspace', async () => {
    const svc = makeService();
    const agent = await svc.create(ctxFor(user, 'owner', 'ws-1'), {
      name: 'A',
      type: 'operations',
    });
    const foreign = ctxFor(user, 'owner', 'ws-2');
    expect(await svc.list(foreign)).toHaveLength(0);
    await expect(svc.get(foreign, agent.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(svc.transition(foreign, agent.id, { to: 'active' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('forbids a non-creator member from managing', async () => {
    const svc = makeService();
    const agent = await svc.create(ctxFor(user), { name: 'A', type: 'operations' });
    await expect(
      svc.update(ctxFor(other, 'member'), agent.id, { name: 'X', capabilities: [] }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('AgentService.execute (via the runtime)', () => {
  it('runs an active agent and records a completed execution + activity', async () => {
    const svc = makeService('success');
    const ctx = ctxFor(user);
    const agent = await activeAgent(svc, ctx);

    const exec = await svc.execute(ctx, agent.id, { input: 'Prepare a briefing' });
    expect(exec.status).toBe('completed');
    expect(exec.result?.confidence).toBe('medium');
    expect(exec.model).toBe('fake-model');
    expect(exec.promptVersion).toBeTruthy();

    expect(await svc.listExecutions(ctx, agent.id)).toHaveLength(1);
    expect((await svc.activity(ctx, agent.id))[0]).toMatchObject({ type: 'executed' });
  });

  it('surfaces an honest unavailable error when AI is not configured (no fabrication)', async () => {
    const svc = makeService('unavailable');
    const ctx = ctxFor(user);
    const agent = await activeAgent(svc, ctx);
    await expect(svc.execute(ctx, agent.id, { input: 'go' })).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(await svc.listExecutions(ctx, agent.id)).toHaveLength(0);
  });

  it('records a FAILED execution (not a throw) on timeout / failure / invalid output', async () => {
    for (const scenario of ['timeout', 'failed', 'invalid_output'] as const) {
      const svc = makeService(scenario);
      const ctx = ctxFor(user);
      const agent = await activeAgent(svc, ctx);
      const exec = await svc.execute(ctx, agent.id, { input: 'go' });
      expect(exec.status).toBe('failed');
      expect(exec.error).toBeTruthy();
      expect(exec.result).toBeNull();
    }
  });

  it('rejects execution of a non-active agent', async () => {
    const svc = makeService();
    const ctx = ctxFor(user);
    const agent = await svc.create(ctx, { name: 'A', type: 'operations' }); // draft
    await expect(svc.execute(ctx, agent.id, { input: 'go' })).rejects.toMatchObject({
      code: 'not_executable',
    });
    await svc.transition(ctx, agent.id, { to: 'active' });
    await svc.transition(ctx, agent.id, { to: 'disabled' });
    await expect(svc.execute(ctx, agent.id, { input: 'go' })).rejects.toMatchObject({
      code: 'not_executable',
    });
  });

  it('rejects execution by an unauthorized member and across workspaces', async () => {
    const svc = makeService();
    const ctx = ctxFor(user);
    const agent = await activeAgent(svc, ctx);
    await expect(
      svc.execute(ctxFor(other, 'member'), agent.id, { input: 'go' }),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      svc.execute(ctxFor(user, 'owner', 'ws-2'), agent.id, { input: 'go' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects a duplicate submission while a run is in progress', async () => {
    const repo = new InMemoryAgentRepository();
    const svc = makeService('success', repo);
    const ctx = ctxFor(user);
    const agent = await activeAgent(svc, ctx);
    await repo.createExecution({
      id: 'inflight',
      agentId: agent.id,
      workspaceId: 'ws-1',
      requestedBy: 'u-1',
      status: 'running',
      input: 'first',
      result: null,
      error: null,
      model: null,
      promptVersion: null,
      durationMs: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      completedAt: null,
    });
    await expect(svc.execute(ctx, agent.id, { input: 'second' })).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('validates execution input', async () => {
    const svc = makeService();
    const ctx = ctxFor(user);
    const agent = await activeAgent(svc, ctx);
    await expect(svc.execute(ctx, agent.id, { input: '' })).rejects.toMatchObject({
      code: 'validation',
    });
  });
});

describe('AgentService activity ordering', () => {
  it('is newest-first even when entries share a timestamp', async () => {
    const svc = makeService('success');
    const ctx = ctxFor(user);
    const agent = await svc.create(ctx, { name: 'A', type: 'operations' });
    await svc.transition(ctx, agent.id, { to: 'active' });
    await svc.execute(ctx, agent.id, { input: 'go' });
    // created (t0), status_changed (t1), executed (t2) — deterministic deps.
    expect((await svc.activity(ctx, agent.id)).map((a) => a.type)).toEqual([
      'executed',
      'status_changed',
      'created',
    ]);
  });
});
