import { describe, expect, it } from 'vitest';

import { InMemoryAgentRepository } from '@/services/agents/in-memory-agent-repository';
import { AgentService, type AgentContext, type ServiceDeps } from '@/services/agents/agent-service';
import { FakeAIProvider, type FakeMode } from '@/lib/ai/fake-provider';
import type { AuthUser, Workspace, WorkspaceRole } from '@/types';

const user: AuthUser = { id: 'u-1', email: null, displayName: 'Ada', avatarUrl: null };
const other: AuthUser = { id: 'u-2', email: null, displayName: 'Bo', avatarUrl: null };

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

/** A service wired with an in-memory repo + a fake AI provider in the given mode. */
function makeService(aiMode: FakeMode = 'success', aiAvailable = true) {
  return new AgentService(
    new InMemoryAgentRepository(),
    new FakeAIProvider(aiMode, aiAvailable),
    deterministicDeps(),
  );
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
    const activity = await svc.activity(ctx, agent.id);
    expect(activity[0]).toMatchObject({ type: 'created' });
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
    const activated = await svc.transition(ctx, agent.id, { to: 'active' });
    expect(activated.status).toBe('active');
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

describe('AgentService.execute', () => {
  it('runs an active agent and records a completed execution + activity', async () => {
    const svc = makeService('success');
    const ctx = ctxFor(user);
    const agent = await activeAgent(svc, ctx);

    const exec = await svc.execute(ctx, agent.id, { input: 'Prepare a briefing' });
    expect(exec.status).toBe('completed');
    expect(exec.result?.confidence).toBe('medium');
    expect(exec.model).toBe('fake-model');

    const executions = await svc.listExecutions(ctx, agent.id);
    expect(executions).toHaveLength(1);
    const activity = await svc.activity(ctx, agent.id);
    expect(activity[0]).toMatchObject({ type: 'executed' });
  });

  it('surfaces an honest unavailable error when AI is not configured (no fake success)', async () => {
    const svc = makeService('success', /* aiAvailable */ false);
    const ctx = ctxFor(user);
    const agent = await activeAgent(svc, ctx);
    await expect(svc.execute(ctx, agent.id, { input: 'go' })).rejects.toMatchObject({
      code: 'unavailable',
    });
    // Nothing fabricated.
    expect(await svc.listExecutions(ctx, agent.id)).toHaveLength(0);
  });

  it('records a FAILED execution (not a throw) on provider timeout/failure/invalid output', async () => {
    for (const mode of ['timeout', 'failed', 'invalid_output'] as const) {
      const svc = makeService(mode);
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
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      svc.execute(ctxFor(user, 'owner', 'ws-2'), agent.id, { input: 'go' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects a duplicate submission while a run is in progress', async () => {
    const repo = new InMemoryAgentRepository();
    const svc = new AgentService(repo, new FakeAIProvider('success'), deterministicDeps());
    const ctx = ctxFor(user);
    const agent = await activeAgent(svc, ctx);
    // Seed an in-flight execution.
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
    const fixed: ServiceDeps = {
      id: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
      now: () => '2026-01-01T00:00:00.000Z',
    };
    const svc = new AgentService(
      new InMemoryAgentRepository(),
      new FakeAIProvider('success'),
      fixed,
    );
    const ctx = ctxFor(user);
    const agent = await svc.create(ctx, { name: 'A', type: 'operations' });
    await svc.transition(ctx, agent.id, { to: 'active' });
    await svc.execute(ctx, agent.id, { input: 'go' });

    const activity = await svc.activity(ctx, agent.id);
    expect(activity.map((a) => a.type)).toEqual(['executed', 'status_changed', 'created']);
  });
});
