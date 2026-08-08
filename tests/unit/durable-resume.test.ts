import { beforeEach, describe, expect, it } from 'vitest';

import { InProcessSignalBus } from '@/lib/signals/bus';
import { InMemoryWorkflowRepository } from '@/services/workflows/in-memory-workflow-repository';
import type { WorkflowRuntime } from '@/lib/workflows/runtime/runtime';
import {
  type DurableApprovalResumer,
  WorkflowService,
  type WorkflowContext,
} from '@/services/workflows/workflow-service';
import type { WorkflowDefinitionInput } from '@/lib/workflows/schema';
import type { WorkflowApproval, WorkflowRun, WorkflowRunStatus } from '@/lib/workflows/types';
import type { AuthUser, Workspace } from '@/types';

const user: AuthUser = { id: 'u-1', email: null, displayName: 'Ada', avatarUrl: null };
const workspace: Workspace = { id: 'ws-1', name: 'W', slug: 'w', role: 'owner', kind: 'personal' };
const ctx: WorkflowContext = { user, workspace };

const LINEAR: WorkflowDefinitionInput = {
  variables: [],
  triggers: [{ type: 'manual' }],
  startNodeId: 's',
  nodes: [
    { id: 's', type: 'start', name: 'S', config: { type: 'start' } },
    { id: 'e', type: 'end', name: 'E', config: { type: 'end' } },
  ],
  edges: [{ from: 's', to: 'e' }],
};

/** Records start/resume without executing — isolates the service's dispatch logic. */
class SpyRuntime {
  startCalls: WorkflowRun[] = [];
  resumeCalls: WorkflowRun[] = [];
  async start(_v: unknown, run: WorkflowRun): Promise<WorkflowRun> {
    this.startCalls.push(run);
    return { ...run, status: 'completed' };
  }
  async resume(_v: unknown, run: WorkflowRun): Promise<WorkflowRun> {
    this.resumeCalls.push(run);
    return { ...run, status: 'completed' };
  }
}

function deterministic() {
  let ids = 0;
  let ticks = 0;
  return {
    id: () => `id-${++ids}`,
    now: () => new Date(Date.UTC(2026, 6, 1) + ticks++ * 1000).toISOString(),
  };
}

describe('WorkflowService durable resume', () => {
  let repo: InMemoryWorkflowRepository;
  let runtime: SpyRuntime;
  let bus: InProcessSignalBus;

  function serviceWith(resumer?: DurableApprovalResumer) {
    return new WorkflowService(
      repo,
      runtime as unknown as WorkflowRuntime,
      bus,
      bus,
      deterministic(),
      resumer,
    );
  }

  async function versionId(): Promise<string> {
    const svc = serviceWith();
    const wf = await svc.create(ctx, { name: 'W' });
    await svc.publish(ctx, wf.id, LINEAR);
    await svc.transition(ctx, wf.id, { to: 'active' });
    const current = await svc.get(ctx, wf.id);
    return current.currentVersionId!;
  }

  async function makeRun(status: WorkflowRunStatus, verId: string): Promise<WorkflowRun> {
    const run: WorkflowRun = {
      id: `run-${status}`,
      workflowId: 'wf-1',
      versionId: verId,
      workspaceId: workspace.id,
      correlationId: 'corr-1',
      status,
      trigger: { type: 'signal', ref: 'sig-1' },
      triggerKey: null,
      variables: {},
      frontier: ['s'],
      joinArrivals: {},
      error: null,
      startedBy: user.id,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      completedAt: null,
    };
    await repo.createRun(run);
    return run;
  }

  beforeEach(() => {
    repo = new InMemoryWorkflowRepository();
    runtime = new SpyRuntime();
    bus = new InProcessSignalBus();
  });

  describe('resumeEnqueued', () => {
    it('resumes a waiting_timer run on a timer cause', async () => {
      const v = await versionId();
      const run = await makeRun('waiting_timer', v);
      await serviceWith().resumeEnqueued(workspace.id, run.id, 'timer', 'timer-1');
      expect(runtime.resumeCalls).toHaveLength(1);
    });

    it('drops a timer resume when the run is not waiting_timer (stale/duplicate)', async () => {
      const v = await versionId();
      const run = await makeRun('running', v);
      await serviceWith().resumeEnqueued(workspace.id, run.id, 'timer', 'timer-1');
      expect(runtime.resumeCalls).toHaveLength(0);
    });

    it('resumes a waiting_approval run when the cited approval is decided', async () => {
      const v = await versionId();
      const run = await makeRun('waiting_approval', v);
      const approval: WorkflowApproval = {
        id: 'ap-1',
        runId: run.id,
        workspaceId: workspace.id,
        nodeId: 'ap',
        prompt: 'ok?',
        approvers: 'owner',
        status: 'approved',
        decidedBy: user.id,
        decidedAt: '2026-07-01T00:00:00.000Z',
        comment: null,
        createdAt: '2026-07-01T00:00:00.000Z',
      };
      await repo.createApproval(approval);
      await serviceWith().resumeEnqueued(workspace.id, run.id, 'approval', 'ap-1');
      expect(runtime.resumeCalls).toHaveLength(1);
    });

    it('drops an approval resume when the approval is still pending', async () => {
      const v = await versionId();
      const run = await makeRun('waiting_approval', v);
      await repo.createApproval({
        id: 'ap-2',
        runId: run.id,
        workspaceId: workspace.id,
        nodeId: 'ap',
        prompt: 'ok?',
        approvers: 'owner',
        status: 'pending',
        decidedBy: null,
        decidedAt: null,
        comment: null,
        createdAt: '2026-07-01T00:00:00.000Z',
      });
      await serviceWith().resumeEnqueued(workspace.id, run.id, 'approval', 'ap-2');
      expect(runtime.resumeCalls).toHaveLength(0);
    });

    it('is a no-op for a terminal run', async () => {
      const v = await versionId();
      const run = await makeRun('completed', v);
      await serviceWith().resumeEnqueued(workspace.id, run.id, 'timer', 'timer-1');
      expect(runtime.resumeCalls).toHaveLength(0);
    });

    it('is a no-op for a missing run', async () => {
      await expect(
        serviceWith().resumeEnqueued(workspace.id, 'ghost', 'timer', 't'),
      ).resolves.toBeUndefined();
      expect(runtime.resumeCalls).toHaveLength(0);
    });

    it('finalizes a run whose pinned version has vanished, without resuming', async () => {
      const run = await makeRun('waiting_timer', 'ghost-version');
      await serviceWith().resumeEnqueued(workspace.id, run.id, 'timer', 'timer-1');
      expect(runtime.resumeCalls).toHaveLength(0);
      expect((await repo.getRun(workspace.id, run.id))!.status).toBe('failed');
    });
  });

  describe('decideApproval mode selection', () => {
    async function suspendedApproval() {
      const v = await versionId();
      const run = await makeRun('waiting_approval', v);
      const approval: WorkflowApproval = {
        id: 'ap-d',
        runId: run.id,
        workspaceId: workspace.id,
        nodeId: 'ap',
        prompt: 'ok?',
        approvers: 'owner',
        status: 'pending',
        decidedBy: null,
        decidedAt: null,
        comment: null,
        createdAt: '2026-07-01T00:00:00.000Z',
      };
      await repo.createApproval(approval);
      return { approval };
    }

    it('durable mode enqueues a resume and does NOT execute inline', async () => {
      const { approval } = await suspendedApproval();
      const calls: string[] = [];
      const resumer: DurableApprovalResumer = {
        async claimApprovalResume(ws, apId, runId) {
          calls.push(`${ws}:${apId}:${runId}`);
          return 'enqueued';
        },
      };
      const decided = await serviceWith(resumer).decideApproval(ctx, approval.id, {
        decision: 'approved',
      });
      expect(decided.status).toBe('approved');
      expect(calls).toEqual([`${workspace.id}:${approval.id}:${approval.runId}`]);
      expect(runtime.resumeCalls).toHaveLength(0); // no workflow execution in the request
    });

    it('in-memory mode (no resumer) resumes synchronously', async () => {
      const { approval } = await suspendedApproval();
      const decided = await serviceWith().decideApproval(ctx, approval.id, {
        decision: 'approved',
      });
      expect(decided.status).toBe('approved');
      expect(runtime.resumeCalls).toHaveLength(1);
    });
  });
});
