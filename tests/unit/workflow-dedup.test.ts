import { beforeEach, describe, expect, it } from 'vitest';

import { InProcessSignalBus } from '@/lib/signals/bus';
import { createSignal } from '@/lib/signals/signal';
import { rootCorrelation } from '@/lib/platform/correlation';
import { InMemoryWorkflowRepository } from '@/services/workflows/in-memory-workflow-repository';
import { WorkflowRuntime } from '@/lib/workflows/runtime/runtime';
import type { WorkflowCapabilities } from '@/lib/workflows/runtime/ports';
import { WorkflowService, type WorkflowContext } from '@/services/workflows/workflow-service';
import type { WorkflowDefinitionInput } from '@/lib/workflows/schema';
import type { WorkflowRun, WorkflowVersion } from '@/lib/workflows/types';
import type { AuthUser, Workspace } from '@/types';

const user: AuthUser = { id: 'u-1', email: null, displayName: 'Ada', avatarUrl: null };
const ctx: WorkflowContext = {
  user,
  workspace: { id: 'ws-1', name: 'W', slug: 'w', role: 'owner', kind: 'personal' } as Workspace,
};
const okCaps: WorkflowCapabilities = {
  runAgent: async () => ({ ok: true, summary: 'ok', output: {} }),
  createOperation: async () => ({ id: 'op-1' }),
  transitionOperation: async () => {},
};
function det(p: string) {
  let ids = 0,
    ticks = 0;
  return {
    id: () => `${p}-${++ids}`,
    now: () => new Date(Date.UTC(2026, 6, 1) + ticks++ * 1000).toISOString(),
  };
}

const LINEAR: WorkflowDefinitionInput = {
  variables: [],
  triggers: [{ type: 'signal', signalType: 'operation.created' }],
  startNodeId: 's',
  nodes: [
    { id: 's', type: 'start', name: 'S', config: { type: 'start' } },
    {
      id: 'v',
      type: 'set_variable',
      name: 'V',
      config: { type: 'set_variable', key: 'x', valueTemplate: '1' },
    },
    { id: 'e', type: 'end', name: 'E', config: { type: 'end' } },
  ],
  edges: [
    { from: 's', to: 'v' },
    { from: 'v', to: 'e' },
  ],
};
const APPROVAL: WorkflowDefinitionInput = {
  ...LINEAR,
  triggers: [{ type: 'manual' }],
  nodes: [
    { id: 's', type: 'start', name: 'S', config: { type: 'start' } },
    {
      id: 'ap',
      type: 'approval',
      name: 'Ap',
      config: { type: 'approval', approvers: 'owner', prompt: 'ok?' },
    },
    { id: 'e', type: 'end', name: 'E', config: { type: 'end' } },
  ],
  edges: [
    { from: 's', to: 'ap' },
    { from: 'ap', to: 'e' },
  ],
};

let repo: InMemoryWorkflowRepository;
let bus: InProcessSignalBus;
let service: WorkflowService;

beforeEach(() => {
  repo = new InMemoryWorkflowRepository();
  bus = new InProcessSignalBus();
  const runtime = new WorkflowRuntime({
    ...det('rt'),
    publisher: bus,
    capabilities: okCaps,
    store: repo,
  });
  service = new WorkflowService(repo, runtime, bus, bus, det('sv'));
});

async function activate(def: WorkflowDefinitionInput) {
  const wf = await service.create(ctx, { name: 'W' });
  await service.publish(ctx, wf.id, def);
  await service.transition(ctx, wf.id, { to: 'active' });
  return wf;
}

describe('trigger deduplication', () => {
  it('duplicate signal delivery creates exactly one run', async () => {
    const wf = await activate(LINEAR);
    const signal = createSignal(
      {
        type: 'operation.created',
        workspaceId: 'ws-1',
        correlation: rootCorrelation('c'),
        summary: 'op',
        source: 'operations',
      },
      { id: () => 'signal-fixed', now: () => '2026-07-01T00:00:00.000Z' },
    );
    // Same occurrence delivered twice (at-least-once).
    await bus.publish(signal);
    await bus.publish(signal);
    await new Promise((r) => setTimeout(r, 0));
    expect((await service.listRuns(ctx, wf.id)).length).toBe(1);
  });

  it('repeated manual submission with the same idempotency key creates one run', async () => {
    const wf = await activate({ ...LINEAR, triggers: [{ type: 'manual' }] });
    const a = await service.start(ctx, wf.id, {}, 'key-1');
    const b = await service.start(ctx, wf.id, {}, 'key-1');
    expect(a.id).toBe(b.id); // same run returned
    expect((await service.listRuns(ctx, wf.id)).length).toBe(1);
  });

  it('claimTrigger is atomic — a repeated occurrence is not re-claimed (schedule/generic)', async () => {
    const first = await repo.claimTrigger({
      workspaceId: 'ws-1',
      triggerKey: 'ws-1:v:schedule:1000',
      runId: 'r1',
      createdAt: 't',
    });
    const second = await repo.claimTrigger({
      workspaceId: 'ws-1',
      triggerKey: 'ws-1:v:schedule:1000',
      runId: 'r2',
      createdAt: 't',
    });
    expect(first).toEqual({ claimed: true, existingRunId: null });
    expect(second).toEqual({ claimed: false, existingRunId: 'r1' });
  });

  it('a duplicate approval decision is rejected', async () => {
    const wf = await activate(APPROVAL);
    await service.start(ctx, wf.id, {}, 'k');
    const pending = await service.listPendingApprovals(ctx);
    await service.decideApproval(ctx, pending[0]!.id, { decision: 'approved' });
    await expect(
      service.decideApproval(ctx, pending[0]!.id, { decision: 'approved' }),
    ).rejects.toMatchObject({
      code: 'conflict',
    });
  });
});

describe('resume idempotency — completed nodes never re-execute', () => {
  it('re-running a completed run does not execute nodes twice', async () => {
    // Drive a linear run to completion directly through the runtime.
    const runtime = new WorkflowRuntime({
      ...det('rt2'),
      publisher: bus,
      capabilities: okCaps,
      store: repo,
    });
    const version: WorkflowVersion = {
      id: 'v-1',
      workflowId: 'wf-1',
      workspaceId: 'ws-1',
      version: 1,
      nodes: LINEAR.nodes,
      edges: LINEAR.edges,
      triggers: [],
      variables: [],
      startNodeId: 's',
      createdBy: 'u-1',
      createdAt: 't',
    };
    const run: WorkflowRun = {
      id: 'run-1',
      workflowId: 'wf-1',
      versionId: 'v-1',
      workspaceId: 'ws-1',
      correlationId: 'c',
      status: 'pending',
      trigger: { type: 'manual', ref: 'u-1' },
      triggerKey: null,
      variables: {},
      frontier: [],
      joinArrivals: {},
      error: null,
      startedBy: 'u-1',
      createdAt: 't',
      updatedAt: 't',
      completedAt: null,
    };
    const runCtx = {
      workspaceId: 'ws-1',
      operatorId: 'u-1',
      operatorName: 'Ada',
      correlationId: 'c',
    };

    const done = await runtime.start(version, run, runCtx);
    expect(done.status).toBe('completed');
    const before = (await repo.listSteps('ws-1', 'run-1')).filter(
      (s) => s.status === 'completed',
    ).length;

    // A duplicate resume must be a no-op — completed run, no new node executions.
    await runtime.resume(version, done, runCtx);
    const after = (await repo.listSteps('ws-1', 'run-1')).filter(
      (s) => s.status === 'completed',
    ).length;
    expect(after).toBe(before);
  });
});
