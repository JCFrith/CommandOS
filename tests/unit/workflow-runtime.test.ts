import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryWorkflowRepository } from '@/services/workflows/in-memory-workflow-repository';
import { WorkflowRuntime } from '@/lib/workflows/runtime/runtime';
import type { WorkflowCapabilities } from '@/lib/workflows/runtime/ports';
import type {
  WorkflowNode,
  WorkflowEdge,
  WorkflowRun,
  WorkflowRunContext,
  WorkflowVersion,
} from '@/lib/workflows/types';

// --- deterministic harness --------------------------------------------------

function deps(repo: InMemoryWorkflowRepository, caps: WorkflowCapabilities) {
  let ids = 0;
  let ticks = 0;
  return {
    now: () => new Date(Date.UTC(2026, 6, 1) + ticks++ * 1000).toISOString(),
    id: () => `id-${++ids}`,
    publisher: { publish: async () => {} },
    capabilities: caps,
    store: repo,
  };
}

const okCaps: WorkflowCapabilities = {
  runAgent: async (_ctx, { agentId }) => ({ ok: true, summary: `ran ${agentId}`, output: {} }),
  createOperation: async (_ctx, { title }) => ({ id: `op-${title}` }),
  transitionOperation: async () => {},
};

const ctx: WorkflowRunContext = {
  workspaceId: 'ws-1',
  operatorId: 'u-1',
  operatorName: 'Ada',
  correlationId: 'corr-1',
};

function version(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  startNodeId: string,
): WorkflowVersion {
  return {
    id: 'v-1',
    workflowId: 'wf-1',
    workspaceId: 'ws-1',
    version: 1,
    nodes,
    edges,
    triggers: [],
    variables: [],
    startNodeId,
    createdBy: 'u-1',
    createdAt: '2026-07-01T00:00:00.000Z',
  };
}

function newRun(vars: Record<string, string | number | boolean | null> = {}): WorkflowRun {
  return {
    id: 'run-1',
    workflowId: 'wf-1',
    versionId: 'v-1',
    workspaceId: 'ws-1',
    correlationId: 'corr-1',
    status: 'pending',
    trigger: { type: 'manual', ref: 'u-1' },
    variables: vars,
    frontier: [],
    joinArrivals: {},
    error: null,
    startedBy: 'u-1',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    completedAt: null,
  };
}

const node = (
  id: string,
  config: WorkflowNode['config'],
  extra: Partial<WorkflowNode> = {},
): WorkflowNode => ({
  id,
  type: config.type,
  name: id,
  config,
  ...extra,
});

let repo: InMemoryWorkflowRepository;
function runtimeWith(caps = okCaps) {
  return new WorkflowRuntime(deps(repo, caps));
}

beforeEach(() => {
  repo = new InMemoryWorkflowRepository();
});

describe('WorkflowRuntime — linear + variables', () => {
  it('runs a linear graph to completion and interpolates variables', async () => {
    const v = version(
      [
        node('s', { type: 'start' }),
        node('setv', { type: 'set_variable', key: 'greeting', valueTemplate: 'hi {{name}}' }),
        node('e', { type: 'end' }),
      ],
      [
        { from: 's', to: 'setv' },
        { from: 'setv', to: 'e' },
      ],
      's',
    );
    const run = await runtimeWith().start(v, newRun({ name: 'Ada' }), ctx);
    expect(run.status).toBe('completed');
    expect(run.variables.greeting).toBe('hi Ada');
    const steps = await repo.listSteps('ws-1', 'run-1');
    expect(steps.map((s) => s.nodeId)).toContain('setv');
  });
});

describe('WorkflowRuntime — conditions + branching', () => {
  it('follows the true edge when the condition holds', async () => {
    const v = version(
      [
        node('s', { type: 'start' }),
        node('c', {
          type: 'condition',
          expression: { kind: 'compare', left: { var: 'n' }, op: 'gte', right: { literal: 10 } },
        }),
        node('hi', { type: 'set_variable', key: 'path', valueTemplate: 'high' }),
        node('lo', { type: 'set_variable', key: 'path', valueTemplate: 'low' }),
        node('e', { type: 'end' }),
      ],
      [
        { from: 's', to: 'c' },
        { from: 'c', to: 'hi', label: 'true' },
        { from: 'c', to: 'lo', label: 'false' },
        { from: 'hi', to: 'e' },
        { from: 'lo', to: 'e' },
      ],
      's',
    );
    const high = await runtimeWith().start(v, newRun({ n: 42 }), ctx);
    expect(high.variables.path).toBe('high');

    repo = new InMemoryWorkflowRepository();
    const low = await runtimeWith().start(v, newRun({ n: 3 }), ctx);
    expect(low.variables.path).toBe('low');
  });
});

describe('WorkflowRuntime — parallel + join', () => {
  it('fans out and joins on all branches', async () => {
    const v = version(
      [
        node('s', { type: 'start' }),
        node('p', { type: 'parallel' }),
        node('a', { type: 'set_variable', key: 'a', valueTemplate: '1' }),
        node('b', { type: 'set_variable', key: 'b', valueTemplate: '2' }),
        node('j', { type: 'join', mode: 'all' }),
        node('e', { type: 'end' }),
      ],
      [
        { from: 's', to: 'p' },
        { from: 'p', to: 'a' },
        { from: 'p', to: 'b' },
        { from: 'a', to: 'j' },
        { from: 'b', to: 'j' },
        { from: 'j', to: 'e' },
      ],
      's',
    );
    const run = await runtimeWith().start(v, newRun(), ctx);
    expect(run.status).toBe('completed');
    expect(run.variables.a).toBe('1');
    expect(run.variables.b).toBe('2');
  });
});

describe('WorkflowRuntime — approval suspension + resume', () => {
  it('suspends at an approval, then completes after the approval is granted', async () => {
    const v = version(
      [
        node('s', { type: 'start' }),
        node('ap', { type: 'approval', approvers: 'owner', prompt: 'OK?' }),
        node('e', { type: 'end' }),
      ],
      [
        { from: 's', to: 'ap' },
        { from: 'ap', to: 'e' },
      ],
      's',
    );
    const rt = runtimeWith();
    const suspended = await rt.start(v, newRun(), ctx);
    expect(suspended.status).toBe('waiting_approval');

    // An approval was created; grant it, then resume.
    const approval = await repo.getApprovalForNode('ws-1', 'run-1', 'ap');
    expect(approval).not.toBeNull();
    await repo.saveApproval({ ...approval!, status: 'approved', decidedBy: 'u-1', decidedAt: 'x' });

    const resumed = await rt.resume(v, (await repo.getRun('ws-1', 'run-1'))!, ctx);
    expect(resumed.status).toBe('completed');
  });

  it('fails the run when the approval is rejected', async () => {
    const v = version(
      [
        node('s', { type: 'start' }),
        node('ap', { type: 'approval', approvers: 'owner', prompt: 'OK?' }),
        node('e', { type: 'end' }),
      ],
      [
        { from: 's', to: 'ap' },
        { from: 'ap', to: 'e' },
      ],
      's',
    );
    const rt = runtimeWith();
    await rt.start(v, newRun(), ctx);
    const approval = await repo.getApprovalForNode('ws-1', 'run-1', 'ap');
    await repo.saveApproval({ ...approval!, status: 'rejected', decidedBy: 'u-1', decidedAt: 'x' });
    const resumed = await rt.resume(v, (await repo.getRun('ws-1', 'run-1'))!, ctx);
    expect(resumed.status).toBe('failed');
  });
});

describe('WorkflowRuntime — delay suspends on a timer', () => {
  it('suspends with waiting_timer for a positive delay', async () => {
    const v = version(
      [
        node('s', { type: 'start' }),
        node('d', { type: 'delay', ms: 60_000 }),
        node('e', { type: 'end' }),
      ],
      [
        { from: 's', to: 'd' },
        { from: 'd', to: 'e' },
      ],
      's',
    );
    const run = await runtimeWith().start(v, newRun(), ctx);
    expect(run.status).toBe('waiting_timer');
  });
});

describe('WorkflowRuntime — agent orchestration + retries + failure', () => {
  it('runs an agent step and stores its summary in a variable', async () => {
    const v = version(
      [
        node('s', { type: 'start' }),
        node('run', {
          type: 'agent_run',
          agentId: 'a-1',
          inputTemplate: 'do {{task}}',
          outputVar: 'result',
        }),
        node('e', { type: 'end' }),
      ],
      [
        { from: 's', to: 'run' },
        { from: 'run', to: 'e' },
      ],
      's',
    );
    const run = await runtimeWith().start(v, newRun({ task: 'x' }), ctx);
    expect(run.status).toBe('completed');
    expect(run.variables.result).toBe('ran a-1');
  });

  it('retries a flaky agent step and then succeeds', async () => {
    let calls = 0;
    const flaky: WorkflowCapabilities = {
      ...okCaps,
      runAgent: async () => {
        calls += 1;
        if (calls < 2) throw new Error('flaky');
        return { ok: true, summary: 'ok', output: {} };
      },
    };
    const v = version(
      [
        node('s', { type: 'start' }),
        node(
          'run',
          { type: 'agent_run', agentId: 'a-1', inputTemplate: 'x' },
          { retry: { kind: 'fixed', maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 } },
        ),
        node('e', { type: 'end' }),
      ],
      [
        { from: 's', to: 'run' },
        { from: 'run', to: 'e' },
      ],
      's',
    );
    const run = await runtimeWith(flaky).start(v, newRun(), ctx);
    expect(run.status).toBe('completed');
    expect(calls).toBe(2);
  });

  it('fails the run when an agent step reports failure', async () => {
    const failing: WorkflowCapabilities = {
      ...okCaps,
      runAgent: async () => ({ ok: false, summary: '', output: {}, error: 'nope' }),
    };
    const v = version(
      [
        node('s', { type: 'start' }),
        node('run', { type: 'agent_run', agentId: 'a-1', inputTemplate: 'x' }),
        node('e', { type: 'end' }),
      ],
      [
        { from: 's', to: 'run' },
        { from: 'run', to: 'e' },
      ],
      's',
    );
    const run = await runtimeWith(failing).start(v, newRun(), ctx);
    expect(run.status).toBe('failed');
  });
});
