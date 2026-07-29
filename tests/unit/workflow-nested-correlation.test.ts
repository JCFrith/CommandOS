import { beforeEach, describe, expect, it } from 'vitest';

import { InProcessSignalBus } from '@/lib/signals/bus';
import type { Signal } from '@/lib/signals/types';
import { InMemoryAgentRepository } from '@/services/agents/in-memory-agent-repository';
import { AgentService, type AgentContext } from '@/services/agents/agent-service';
import { ExecutionRuntime } from '@/lib/ai/runtime/runtime';
import { FakeModelProvider } from '@/lib/ai/provider/fake';
import type { ExecutionLogger } from '@/lib/ai/runtime/logging';

import { InMemoryWorkflowRepository } from '@/services/workflows/in-memory-workflow-repository';
import { WorkflowRuntime } from '@/lib/workflows/runtime/runtime';
import type { WorkflowCapabilities } from '@/lib/workflows/runtime/ports';
import { WorkflowService } from '@/services/workflows/workflow-service';
import type { WorkflowDefinitionInput } from '@/lib/workflows/schema';
import type { AuthUser, Workspace } from '@/types';

const AGENT_OK = JSON.stringify({
  summary: 'ok',
  keyPoints: ['a'],
  risks: [],
  recommendations: ['b'],
  confidence: 'high',
});
const noopLogger: ExecutionLogger = { record: async () => {}, listByWorkspace: async () => [] };
const user: AuthUser = { id: 'u-1', email: null, displayName: 'Ada', avatarUrl: null };
const agentCtx = (ws = 'ws-1'): AgentContext => ({
  user,
  workspace: { id: ws, name: 'W', slug: 'w', role: 'owner', kind: 'personal' } as Workspace,
});
function det(p: string) {
  let ids = 0,
    ticks = 0;
  return {
    id: () => `${p}-${++ids}`,
    now: () => new Date(Date.UTC(2026, 6, 1) + ticks++ * 1000).toISOString(),
  };
}

let bus: InProcessSignalBus;
let signals: Signal[];
let agents: AgentService;

async function activeAgent() {
  const a = await agents.create(agentCtx(), { name: 'Briefer', type: 'executive' });
  await agents.transition(agentCtx(), a.id, { to: 'active' });
  return a;
}
/** Correlation ids across an agent run's own + downstream AI-runtime signals. */
function chainIds(): Set<string> {
  return new Set(
    signals
      .filter((s) =>
        [
          'agent.execution.started',
          'agent.execution.completed',
          'execution.started',
          'execution.completed',
        ].includes(s.type),
      )
      .map((s) => s.correlationId),
  );
}

beforeEach(() => {
  bus = new InProcessSignalBus();
  signals = [];
  bus.subscribe({}, (s) => void signals.push(s));
  const runtime = new ExecutionRuntime(
    new FakeModelProvider({ content: AGENT_OK }),
    { sleep: async () => {}, logger: noopLogger, id: () => `rt-${Math.random()}` },
    bus,
  );
  agents = new AgentService(new InMemoryAgentRepository(), runtime, det('ag'), bus);
});

describe('nested correlation — standalone', () => {
  it('a standalone agent run gets a fresh root correlation id shared by its AI signals', async () => {
    const a = await activeAgent();
    await agents.execute(agentCtx(), a.id, { input: 'Summarize the report.' });
    const ids = chainIds();
    expect(ids.size).toBe(1); // agent + execution signals share one id
  });

  it('client-controlled request data cannot inject a correlation id', async () => {
    const a = await activeAgent();
    // A malicious extra field on the (client) input must be ignored — the schema
    // only accepts `input`, and correlation is a separate server-side option.
    await agents.execute(agentCtx(), a.id, {
      input: 'x',
      correlationId: 'attacker',
      correlation: { correlationId: 'attacker' },
    } as unknown);
    const ids = [...chainIds()];
    expect(ids).not.toContain('attacker');
    expect(ids.length).toBe(1);
  });
});

describe('nested correlation — inherited (trusted)', () => {
  it('inherits an upstream correlation id when the workspace matches', async () => {
    const a = await activeAgent();
    await agents.execute(
      agentCtx(),
      a.id,
      { input: 'x' },
      {
        correlation: {
          correlationId: 'wf-corr',
          workspaceId: 'ws-1',
          workflowRunId: 'run-1',
          workflowStepRunId: 'step-1',
          causationId: 'step-1',
        },
      },
    );
    const ids = chainIds();
    expect(ids).toEqual(new Set(['wf-corr'])); // agent + AI runtime signals all share it
  });

  it('IGNORES a foreign-workspace correlation context and mints a fresh root', async () => {
    const a = await activeAgent();
    await agents.execute(
      agentCtx('ws-1'),
      a.id,
      { input: 'x' },
      {
        correlation: {
          correlationId: 'wf-corr',
          workspaceId: 'ws-OTHER',
          workflowRunId: 'run-1',
          workflowStepRunId: 'step-1',
        },
      },
    );
    const ids = chainIds();
    expect(ids.has('wf-corr')).toBe(false); // foreign context not adopted
    expect(ids.size).toBe(1);
  });
});

// A workflow with a single agent_run node, wired to the real AgentService.
const AGENT_WF: WorkflowDefinitionInput = {
  variables: [],
  triggers: [{ type: 'manual' }],
  startNodeId: 's',
  nodes: [
    { id: 's', type: 'start', name: 'S', config: { type: 'start' } },
    {
      id: 'run',
      type: 'agent_run',
      name: 'Run',
      config: { type: 'agent_run', agentId: 'AGENT', inputTemplate: 'go' },
    },
    { id: 'e', type: 'end', name: 'E', config: { type: 'end' } },
  ],
  edges: [
    { from: 's', to: 'run' },
    { from: 'run', to: 'e' },
  ],
};

describe('nested correlation — end to end through the WorkflowRuntime', () => {
  it('a workflow-triggered agent run + its AI signals inherit the WorkflowRun correlation id', async () => {
    const agent = await activeAgent();

    // A capability adapter that forwards the trusted correlation into the agent.
    const caps: WorkflowCapabilities = {
      runAgent: async (_ctx, { input, correlation }) => {
        const exec = await agents.execute(
          agentCtx(),
          agent.id,
          { input },
          {
            correlation: {
              correlationId: correlation.correlationId,
              workspaceId: correlation.workspaceId,
              workflowRunId: correlation.workflowRunId,
              workflowStepRunId: correlation.workflowStepRunId,
              causationId: correlation.workflowStepRunId,
            },
          },
        );
        return exec.status === 'completed' && exec.result
          ? { ok: true, summary: exec.result.summary, output: {} }
          : { ok: false, summary: '', output: {}, error: exec.error ?? 'failed' };
      },
      createOperation: async () => ({ id: 'op' }),
      transitionOperation: async () => {},
    };

    const repo = new InMemoryWorkflowRepository();
    const wfRuntime = new WorkflowRuntime({
      ...det('wf'),
      publisher: bus,
      capabilities: caps,
      store: repo,
    });
    const service = new WorkflowService(repo, wfRuntime, bus, bus, det('sv'));
    const ctx = { user, workspace: agentCtx().workspace };

    const wf = await service.create(ctx, { name: 'Brief' });
    await service.publish(ctx, wf.id, {
      ...AGENT_WF,
      nodes: AGENT_WF.nodes.map((n) =>
        n.id === 'run' ? { ...n, config: { ...n.config, agentId: agent.id } } : n,
      ),
    });
    await service.transition(ctx, wf.id, { to: 'active' });
    const run = await service.start(ctx, wf.id, {});

    expect(run.status).toBe('completed');
    // The agent + AI-runtime signals share the WORKFLOW RUN correlation id.
    const nested = signals.filter((s) =>
      [
        'agent.execution.started',
        'agent.execution.completed',
        'execution.started',
        'execution.completed',
      ].includes(s.type),
    );
    expect(nested.length).toBeGreaterThan(0);
    expect(new Set(nested.map((s) => s.correlationId))).toEqual(new Set([run.correlationId]));
  });
});
