import { beforeEach, describe, expect, it } from 'vitest';

import { InProcessSignalBus } from '@/lib/signals/bus';
import { InMemorySignalEventStore } from '@/lib/signals/store';
import { emittedEvent } from '@/lib/signals/signal';
import type { Signal } from '@/lib/signals/types';

import { InMemoryAgentRepository } from '@/services/agents/in-memory-agent-repository';
import { AgentService, type AgentContext, type ServiceDeps } from '@/services/agents/agent-service';
import { InMemoryOperationsRepository } from '@/services/operations/in-memory-operations-repository';
import { OperationsService } from '@/services/operations/operations-service';
import { ExecutionRuntime } from '@/lib/ai/runtime/runtime';
import { FakeModelProvider } from '@/lib/ai/provider/fake';
import type { ExecutionLogger } from '@/lib/ai/runtime/logging';
import type { AuthUser, Workspace, WorkspaceRole } from '@/types';

const AGENT_OK = JSON.stringify({
  summary: 'ok',
  keyPoints: ['a'],
  risks: [],
  recommendations: ['b'],
  confidence: 'medium',
});

const owner: AuthUser = { id: 'u-1', email: null, displayName: 'Ada', avatarUrl: null };
const other: AuthUser = { id: 'u-2', email: null, displayName: 'Bo', avatarUrl: null };
const noopLogger: ExecutionLogger = { record: async () => {}, listByWorkspace: async () => [] };

function ctxFor(u: AuthUser, role: WorkspaceRole = 'owner', workspaceId = 'ws-1'): AgentContext {
  const workspace: Workspace = { id: workspaceId, name: 'W', slug: 'w', role, kind: 'personal' };
  return { user: u, workspace };
}

function deps(prefix: string): ServiceDeps {
  let ids = 0;
  let ticks = 0;
  return {
    id: () => `${prefix}-${++ids}`,
    now: () => new Date(Date.UTC(2026, 0, 1) + ticks++ * 1000).toISOString(),
  };
}

let bus: InProcessSignalBus;
let store: InMemorySignalEventStore;

/** Wire a bus → append-only store exactly like the production platform index. */
function wirePersistence() {
  bus = new InProcessSignalBus();
  store = new InMemorySignalEventStore();
  bus.subscribe({}, async (signal) => {
    await store.appendSignal(signal);
    await store.appendEvent(emittedEvent(signal));
  });
}

function makeAgentService(available = true) {
  const provider = new FakeModelProvider(available ? { content: AGENT_OK } : { available: false });
  const runtime = new ExecutionRuntime(
    provider,
    { sleep: async () => {}, logger: noopLogger, id: () => `rt-${Math.random()}` },
    bus,
  );
  return new AgentService(new InMemoryAgentRepository(), runtime, deps('ag'), bus);
}

async function types(workspaceId = 'ws-1'): Promise<string[]> {
  const signals = await store.listSignals({ workspaceId });
  return signals.map((s) => s.type);
}

beforeEach(() => {
  wirePersistence();
});

describe('Feature integration — Operations emits Signals', () => {
  it('emits lifecycle signals on create, update, and transition', async () => {
    const ops = new OperationsService(new InMemoryOperationsRepository(), deps('op'), bus);
    const ctx = ctxFor(owner);
    const op = await ops.create(ctx, { title: 'Ship review', priority: 'high' });
    await ops.transition(ctx, op.id, { to: 'planned' });

    const t = await types();
    expect(t).toContain('operation.created');
    expect(t).toContain('operation.status_changed');

    const created = (
      await store.listSignals({ types: ['operation.created'], workspaceId: 'ws-1' })
    )[0]!;
    expect(created.subjectType).toBe('operation');
    expect(created.subjectId).toBe(op.id);
    expect(created.actorName).toBe('Ada');
  });

  it('emits operation.archived when archived', async () => {
    const ops = new OperationsService(new InMemoryOperationsRepository(), deps('op'), bus);
    const ctx = ctxFor(owner);
    const op = await ops.create(ctx, { title: 'X', priority: 'low' });
    await ops.transition(ctx, op.id, { to: 'planned' });
    await ops.transition(ctx, op.id, { to: 'in_progress' });
    await ops.transition(ctx, op.id, { to: 'completed' });
    await ops.transition(ctx, op.id, { to: 'archived' });
    expect(await types()).toContain('operation.archived');
  });
});

describe('Execution + provider integration — the full run chain shares one correlation', () => {
  it('emits agent + runtime signals correlated end to end', async () => {
    const svc = makeAgentService(true);
    const ctx = ctxFor(owner);
    const agent = await svc.create(ctx, { name: 'Briefer', type: 'executive' });
    await svc.transition(ctx, agent.id, { to: 'active' });
    const run = await svc.execute(ctx, agent.id, { input: 'Summarize the Q3 operations report.' });
    expect(run.status).toBe('completed');

    const t = await types();
    // The chain: agent.execution.started → execution.started → execution.completed → agent.execution.completed
    expect(t).toContain('agent.execution.started');
    expect(t).toContain('execution.started');
    expect(t).toContain('execution.completed');
    expect(t).toContain('agent.execution.completed');

    // Correlation propagation: every execution-chain signal shares one id.
    const signals = await store.listSignals({ workspaceId: 'ws-1' });
    const chain = signals.filter((s: Signal) =>
      [
        'agent.execution.started',
        'execution.started',
        'execution.completed',
        'agent.execution.completed',
      ].includes(s.type),
    );
    const correlationIds = new Set(chain.map((s) => s.correlationId));
    expect(correlationIds.size).toBe(1);

    // The terminal runtime signal carries observability stats (no secrets).
    const completed = signals.find((s) => s.type === 'execution.completed')!;
    expect(completed.payload.outcome).toBe('completed');
    expect(typeof completed.payload.durationMs).toBe('number');
    expect(JSON.stringify(completed.payload)).not.toMatch(/api[_-]?key|secret|prompt/i);
  });

  it('emits provider.unavailable and does not fabricate a run when no provider is configured', async () => {
    const svc = makeAgentService(false);
    const ctx = ctxFor(owner);
    const agent = await svc.create(ctx, { name: 'Briefer', type: 'executive' });
    await svc.transition(ctx, agent.id, { to: 'active' });
    await expect(
      svc.execute(ctx, agent.id, { input: 'Summarize the report.' }),
    ).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(await types()).toContain('provider.unavailable');
  });
});

describe('Security integration — PermissionDenied is emitted', () => {
  it('emits authz.permission_denied when a non-owner member tries to manage', async () => {
    const svc = makeAgentService(true);
    const agent = await svc.create(ctxFor(owner), { name: 'Briefer', type: 'executive' });
    // Bo is a member but not the creator → cannot transition.
    await expect(
      svc.transition(ctxFor(other, 'member'), agent.id, { to: 'active' }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    const denied = (
      await store.listSignals({ types: ['authz.permission_denied'], workspaceId: 'ws-1' })
    )[0];
    expect(denied).toBeDefined();
    expect(denied!.category).toBe('security');
    expect(denied!.source).toBe('authz');
  });
});
