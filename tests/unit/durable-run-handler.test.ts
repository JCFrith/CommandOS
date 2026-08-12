import { beforeEach, describe, expect, it } from 'vitest';

import type { Job } from '@/lib/platform/background';
import { InProcessSignalBus } from '@/lib/signals/bus';
import { InMemoryLeasedJobStore } from '@/services/jobs/in-memory-job-store';
import { LeasedBackgroundWorker, type WorkerPass } from '@/services/jobs/worker';
import { InMemoryWorkflowRepository } from '@/services/workflows/in-memory-workflow-repository';
import { WorkflowRuntime } from '@/lib/workflows/runtime/runtime';
import type { WorkflowCapabilities } from '@/lib/workflows/runtime/ports';
import { WorkflowService, type WorkflowContext } from '@/services/workflows/workflow-service';
import type { WorkflowDefinitionInput } from '@/lib/workflows/schema';
import { seedVariables } from '@/lib/workflows/variables';
import type { WorkflowRun, WorkflowVersion } from '@/lib/workflows/types';
import type { AuthUser, Workspace } from '@/types';

// --- worker pre-claim pass mechanism ----------------------------------------

function jobDeps() {
  let seq = 0;
  let clock = Date.parse('2027-01-01T00:00:00.000Z');
  return {
    id: () => `00000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`,
    now: () => new Date((clock += 1000)).toISOString(),
  };
}

function worker(store: InMemoryLeasedJobStore, passes: WorkerPass[]) {
  return new LeasedBackgroundWorker(store, {
    ...jobDeps(),
    workerId: 'w-test',
    leaseMs: 30_000,
    batchSize: 10,
    passes,
  });
}

describe('LeasedBackgroundWorker — pre-claim passes', () => {
  it('runs passes after reclaim and before claim, so a pass-enqueued job drains the same tick', async () => {
    const store = new InMemoryLeasedJobStore(jobDeps());
    const handled: string[] = [];
    const pass: WorkerPass = {
      name: 'enqueuer',
      run: async () => void (await store.enqueue({ workspaceId: 'ws', kind: 'k', payload: {} })),
    };
    const w = worker(store, [pass]);
    w.register({ kind: 'k', handle: async (j: Job) => void handled.push(j.id) });

    const result = await w.tick();
    expect(result.passesRun).toBe(1);
    expect(result.passesFailed).toBe(0);
    expect(result).toMatchObject({ claimed: 1, completed: 1 }); // enqueued by the pass, drained same tick
    expect(handled).toHaveLength(1);
  });

  it('isolates a failing pass — queued jobs still drain and the failure is counted', async () => {
    const store = new InMemoryLeasedJobStore(jobDeps());
    await store.enqueue({ workspaceId: 'ws', kind: 'k', payload: {} });
    const handled: string[] = [];
    const boom: WorkerPass = {
      name: 'boom',
      run: async () => {
        throw new Error('pass exploded');
      },
    };
    const w = worker(store, [boom]);
    w.register({ kind: 'k', handle: async (j: Job) => void handled.push(j.id) });

    const result = await w.tick();
    expect(result.passesRun).toBe(1);
    expect(result.passesFailed).toBe(1);
    expect(result).toMatchObject({ claimed: 1, completed: 1, failed: 0 }); // unaffected by the pass
    expect(handled).toHaveLength(1);
  });
});

// --- WorkflowService.runEnqueued (the workflow.run handler's core) -----------

const user: AuthUser = { id: 'u-1', email: null, displayName: 'Ada', avatarUrl: null };
const workspace: Workspace = { id: 'ws-1', name: 'W', slug: 'w', role: 'owner', kind: 'personal' };
const ctx: WorkflowContext = { user, workspace };
const okCaps: WorkflowCapabilities = {
  runAgent: async () => ({ ok: true, summary: 'ok', output: {} }),
  createOperation: async () => ({ id: 'op-1' }),
  transitionOperation: async () => {},
};
const LINEAR: WorkflowDefinitionInput = {
  variables: [{ key: 'name', type: 'string', required: false, default: 'x' }],
  triggers: [{ type: 'signal', signalType: 'operation.created' }],
  startNodeId: 's',
  nodes: [
    { id: 's', type: 'start', name: 'S', config: { type: 'start' } },
    {
      id: 'v',
      type: 'set_variable',
      name: 'V',
      config: { type: 'set_variable', key: 'greeting', valueTemplate: 'hi {{name}}' },
    },
    { id: 'e', type: 'end', name: 'E', config: { type: 'end' } },
  ],
  edges: [
    { from: 's', to: 'v' },
    { from: 'v', to: 'e' },
  ],
};

function deterministic() {
  let ids = 0;
  let ticks = 0;
  return {
    id: () => `id-${++ids}`,
    now: () => new Date(Date.UTC(2026, 6, 1) + ticks++ * 1000).toISOString(),
  };
}

describe('WorkflowService.runEnqueued — durable workflow.run execution', () => {
  let repo: InMemoryWorkflowRepository;
  let service: WorkflowService;

  async function pendingRun(): Promise<{ run: WorkflowRun; version: WorkflowVersion }> {
    const wf = await service.create(ctx, { name: 'Review' });
    await service.publish(ctx, wf.id, LINEAR);
    await service.transition(ctx, wf.id, { to: 'active' });
    const current = await service.get(ctx, wf.id);
    const version = (await repo.getVersion(workspace.id, current.currentVersionId!))!;
    const run: WorkflowRun = {
      id: 'run-1',
      workflowId: wf.id,
      versionId: version.id,
      workspaceId: workspace.id,
      correlationId: 'corr-1',
      status: 'pending',
      trigger: { type: 'signal', ref: 'sig-1' },
      triggerKey: `${workspace.id}:${version.id}:signal:sig-1`,
      variables: seedVariables(version.variables, {}),
      frontier: [],
      joinArrivals: {},
      error: null,
      startedBy: user.id,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      completedAt: null,
    };
    await repo.createRun(run);
    return { run, version };
  }

  beforeEach(() => {
    repo = new InMemoryWorkflowRepository();
    const bus = new InProcessSignalBus();
    const runtime = new WorkflowRuntime({
      ...deterministic(),
      publisher: bus,
      capabilities: okCaps,
      store: repo,
    });
    service = new WorkflowService(repo, runtime, bus, bus, deterministic());
  });

  it('starts a pending run and drives it to completion, preserving correlation', async () => {
    const { run, version } = await pendingRun();
    await service.runEnqueued(workspace.id, run.id, version.id);
    const after = (await repo.getRun(workspace.id, run.id))!;
    expect(after.status).toBe('completed');
    expect(after.correlationId).toBe('corr-1');
    expect(after.variables.greeting).toBe('hi x');
  });

  it('is a no-op for a terminal run (idempotent re-delivery)', async () => {
    const { run, version } = await pendingRun();
    await service.runEnqueued(workspace.id, run.id, version.id); // completes
    const first = (await repo.getRun(workspace.id, run.id))!;
    await service.runEnqueued(workspace.id, run.id, version.id); // re-delivered
    const second = (await repo.getRun(workspace.id, run.id))!;
    expect(second.status).toBe('completed');
    expect(second.updatedAt).toBe(first.updatedAt); // untouched
  });

  it('is a no-op for a missing run (deleted) rather than looping', async () => {
    await expect(service.runEnqueued(workspace.id, 'ghost')).resolves.toBeUndefined();
  });

  it('rejects a version mismatch (stale/tampered enqueue)', async () => {
    const { run } = await pendingRun();
    await expect(service.runEnqueued(workspace.id, run.id, 'other-version')).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('does not re-drive a suspended run (waiting_* resumes via its own path)', async () => {
    const { run, version } = await pendingRun();
    await repo.saveRun({ ...run, status: 'waiting_approval' });
    await service.runEnqueued(workspace.id, run.id, version.id);
    const after = (await repo.getRun(workspace.id, run.id))!;
    expect(after.status).toBe('waiting_approval'); // untouched
  });
});
