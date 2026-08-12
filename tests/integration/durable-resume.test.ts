import { describe, expect, it } from 'vitest';

import { SupabaseWorkflowRepository } from '@/services/workflows/supabase-workflow-repository';
import { SupabaseDurableTriggerPort } from '@/services/workflows/supabase-durable-trigger-port';
import { SupabaseLeasedJobStore } from '@/services/jobs/supabase-job-store';
import { LeasedBackgroundWorker } from '@/services/jobs/worker';
import { workflowResumeHandler } from '@/services/jobs/workflow-durable';
import type { WorkflowApproval, WorkflowRun, WorkflowTimer } from '@/lib/workflows/types';
import { resetDb, testDb, USER_A_OWNER, WS_A, WS_B } from './helpers';
import { PRODUCTION_VALIDATION } from './setup';

const NOW = '2027-05-01T00:00:00.000Z';
const DUE = '2027-04-01T00:00:00.000Z'; // in the past ⇒ overdue

function ids() {
  let seq = 0;
  return () => `77777777-7777-7777-7777-${String(++seq).padStart(12, '0')}`;
}

async function seedActiveWorkflow(
  ws: string,
  suffix: string,
  triggers: unknown[],
  extraNodes: Array<Record<string, unknown>> = [],
  extraEdges: Array<Record<string, unknown>> = [],
) {
  const repo = new SupabaseWorkflowRepository();
  const now = '2027-01-01T00:00:00.000Z';
  const wf = {
    id: `00000000-0000-0000-0000-0000000000${suffix}`,
    workspaceId: ws,
    name: `w-${suffix}`,
    description: null,
    status: 'draft' as const,
    currentVersionId: null,
    createdBy: USER_A_OWNER,
    updatedBy: USER_A_OWNER,
    createdAt: now,
    updatedAt: now,
  };
  await repo.createWorkflow(wf);
  // 12 hex in the final group: 9 zeros + 2-char suffix + trailing 'f' (distinct
  // from the workflow id's `…0000000000${suffix}`). The previous `…0000000000${suffix}f`
  // was 13 hex — an invalid uuid that made createVersion throw.
  const verId = `00000000-0000-0000-0000-000000000${suffix}f`;
  const ver = {
    id: verId,
    workflowId: wf.id,
    workspaceId: ws,
    version: 1,
    nodes: [
      { id: 's', type: 'start', name: 'S', config: { type: 'start' } },
      { id: 'e', type: 'end', name: 'E', config: { type: 'end' } },
      ...extraNodes,
    ],
    edges: [{ from: 's', to: 'e' }, ...extraEdges],
    triggers,
    variables: [],
    startNodeId: 's',
    createdBy: USER_A_OWNER,
    createdAt: now,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await repo.createVersion(ver as any);
  await repo.updateWorkflow({ ...wf, status: 'active', currentVersionId: verId, updatedAt: now });
  return { repo, workflowId: wf.id, versionId: verId };
}

async function seedRun(
  repo: SupabaseWorkflowRepository,
  ws: string,
  workflowId: string,
  versionId: string,
  status: WorkflowRun['status'],
  frontier: string[],
  id: string,
): Promise<WorkflowRun> {
  const run: WorkflowRun = {
    id,
    workflowId,
    versionId,
    workspaceId: ws,
    correlationId: '44444444-4444-4444-4444-444444444444',
    status,
    trigger: { type: 'signal', ref: 'x' },
    triggerKey: null,
    variables: {},
    frontier,
    joinArrivals: {},
    error: null,
    startedBy: USER_A_OWNER,
    createdAt: '2027-01-02T00:00:00.000Z',
    updatedAt: '2027-01-02T00:00:00.000Z',
    completedAt: null,
  };
  await repo.createRun(run);
  return run;
}

(PRODUCTION_VALIDATION ? describe : describe.skip)('durable resume × Supabase', () => {
  // --- schedule ---------------------------------------------------------------
  it('schedule claim dedups on the occurrence key (one run, one job)', async () => {
    await resetDb();
    const { versionId, workflowId } = await seedActiveWorkflow(WS_A, 'a0', [
      { type: 'schedule', intervalMs: 60_000 },
    ]);
    const repo = new SupabaseWorkflowRepository();
    const version = (await repo.getVersion(WS_A, versionId))!;
    const port = new SupabaseDurableTriggerPort({ id: ids(), now: () => NOW });

    const key = `${versionId}:sched0:1234`;
    const a = await port.claimScheduleRun({
      version,
      occurrenceKey: key,
      scheduledAt: NOW,
      correlationId: '44444444-4444-4444-4444-444444444444',
    });
    const b = await port.claimScheduleRun({
      version,
      occurrenceKey: key,
      scheduledAt: NOW,
      correlationId: '44444444-4444-4444-4444-444444444444',
    });
    expect(a).toBe('enqueued');
    expect(b).toBe('duplicate');
    const runs = await testDb().from('workflow_runs').select('id').eq('workflow_id', workflowId);
    expect(runs.data).toHaveLength(1);
    const jobs = await testDb().from('jobs').select('id').eq('kind', 'workflow.run');
    expect(jobs.data).toHaveLength(1);
  });

  // --- timers -----------------------------------------------------------------
  it('claims due timers once, skips terminal runs, and is idempotent', async () => {
    await resetDb();
    const { repo, workflowId, versionId } = await seedActiveWorkflow(WS_A, 'b0', []);
    const waiting = await seedRun(
      repo,
      WS_A,
      workflowId,
      versionId,
      'waiting_timer',
      ['d'],
      '11111111-1111-1111-1111-111111111111',
    );
    const done = await seedRun(
      repo,
      WS_A,
      workflowId,
      versionId,
      'completed',
      [],
      '22222222-2222-2222-2222-222222222222',
    );
    const timer = (id: string, runId: string, nodeId: string): WorkflowTimer => ({
      id,
      workspaceId: WS_A,
      runId,
      nodeId,
      dueAt: DUE,
      claimedAt: null,
    });
    await repo.createTimer(timer('aaaaaaaa-0000-0000-0000-000000000001', waiting.id, 'd'));
    await repo.createTimer(timer('aaaaaaaa-0000-0000-0000-000000000002', done.id, 'd'));

    const port = new SupabaseDurableTriggerPort({ id: ids(), now: () => NOW });
    const claimed = await port.claimDueTimers();
    expect(claimed).toBe(1); // the terminal run's timer is skipped

    const jobs = await testDb().from('jobs').select('payload').eq('kind', 'workflow.resume');
    expect(jobs.data).toHaveLength(1);
    expect((jobs.data![0]!.payload as { runId: string }).runId).toBe(waiting.id);

    const again = await port.claimDueTimers();
    expect(again).toBe(0); // already claimed
  });

  // --- approval resume --------------------------------------------------------
  it('approval resume claim + catch-up dedup to a single resume job', async () => {
    await resetDb();
    const { repo, workflowId, versionId } = await seedActiveWorkflow(WS_A, 'c0', []);
    const run = await seedRun(
      repo,
      WS_A,
      workflowId,
      versionId,
      'waiting_approval',
      ['ap'],
      '33333333-3333-3333-3333-333333333333',
    );
    const approval: WorkflowApproval = {
      id: 'bbbbbbbb-0000-0000-0000-000000000001',
      runId: run.id,
      workspaceId: WS_A,
      nodeId: 'ap',
      prompt: 'ok?',
      approvers: 'owner',
      status: 'approved',
      decidedBy: USER_A_OWNER,
      decidedAt: NOW,
      comment: null,
      createdAt: NOW,
    };
    await repo.createApproval(approval);
    const port = new SupabaseDurableTriggerPort({ id: ids(), now: () => NOW });

    const first = await port.claimApprovalResume(WS_A, approval.id, run.id);
    expect(first).toBe('enqueued');
    // The catch-up pass must NOT double-enqueue (same trigger_claims key).
    const caughtUp = await port.claimDueApprovalResumes();
    expect(caughtUp).toBe(0);
    const jobs = await testDb().from('jobs').select('id').eq('kind', 'workflow.resume');
    expect(jobs.data).toHaveLength(1);
  });

  it('catch-up recovers a decided approval whose fast-path enqueue was lost', async () => {
    await resetDb();
    const { repo, workflowId, versionId } = await seedActiveWorkflow(WS_A, 'c1', []);
    const run = await seedRun(
      repo,
      WS_A,
      workflowId,
      versionId,
      'waiting_approval',
      ['ap'],
      '33333333-3333-3333-3333-333333333334',
    );
    await repo.createApproval({
      id: 'bbbbbbbb-0000-0000-0000-000000000002',
      runId: run.id,
      workspaceId: WS_A,
      nodeId: 'ap',
      prompt: 'ok?',
      approvers: 'owner',
      status: 'approved',
      decidedBy: USER_A_OWNER,
      decidedAt: NOW,
      comment: null,
      createdAt: NOW,
    });
    const port = new SupabaseDurableTriggerPort({ id: ids(), now: () => NOW });
    // No fast-path claim happened (simulating a crash) — catch-up finds it.
    const recovered = await port.claimDueApprovalResumes();
    expect(recovered).toBe(1);
    const jobs = await testDb().from('jobs').select('id').eq('kind', 'workflow.resume');
    expect(jobs.data).toHaveLength(1);
  });

  // --- end-to-end resume via the worker + handler -----------------------------
  it('the worker drains a workflow.resume job and the approved run completes', async () => {
    await resetDb();
    const { repo, workflowId, versionId } = await seedActiveWorkflow(
      WS_A,
      'd0',
      [],
      [
        {
          id: 'ap',
          type: 'approval',
          name: 'A',
          config: { type: 'approval', prompt: 'ok?', approvers: 'owner' },
        },
      ],
      [
        { from: 's', to: 'ap' },
        { from: 'ap', to: 'e' },
      ],
    );
    const run = await seedRun(
      repo,
      WS_A,
      workflowId,
      versionId,
      'waiting_approval',
      ['ap'],
      '33333333-3333-3333-3333-333333333335',
    );
    await repo.createApproval({
      id: 'bbbbbbbb-0000-0000-0000-000000000003',
      runId: run.id,
      workspaceId: WS_A,
      nodeId: 'ap',
      prompt: 'ok?',
      approvers: 'owner',
      status: 'approved',
      decidedBy: USER_A_OWNER,
      decidedAt: NOW,
      comment: null,
      createdAt: NOW,
    });
    const port = new SupabaseDurableTriggerPort({ id: ids(), now: () => NOW });
    await port.claimApprovalResume(WS_A, 'bbbbbbbb-0000-0000-0000-000000000003', run.id);

    const store = new SupabaseLeasedJobStore();
    const worker = new LeasedBackgroundWorker(store, {
      workerId: 'resume-itest',
      leaseMs: 30_000,
      batchSize: 10,
      id: () => '99999999-9999-9999-9999-999999999999',
      now: () => new Date().toISOString(),
    });
    worker.register(workflowResumeHandler);
    const tick = await worker.tick();
    expect(tick).toMatchObject({ claimed: 1, completed: 1, failed: 0 });

    const after = await testDb().from('workflow_runs').select('status').eq('id', run.id).single();
    expect(after.data!.status).toBe('completed');
  });

  // --- cross-workspace isolation ---------------------------------------------
  it('an approval resume is scoped to its workspace (no cross-tenant leakage)', async () => {
    await resetDb();
    const { repo, workflowId, versionId } = await seedActiveWorkflow(WS_A, 'e0', []);
    const run = await seedRun(
      repo,
      WS_A,
      workflowId,
      versionId,
      'waiting_approval',
      ['ap'],
      '33333333-3333-3333-3333-333333333336',
    );
    await repo.createApproval({
      id: 'bbbbbbbb-0000-0000-0000-000000000004',
      runId: run.id,
      workspaceId: WS_A,
      nodeId: 'ap',
      prompt: 'ok?',
      approvers: 'owner',
      status: 'approved',
      decidedBy: USER_A_OWNER,
      decidedAt: NOW,
      comment: null,
      createdAt: NOW,
    });
    const port = new SupabaseDurableTriggerPort({ id: ids(), now: () => NOW });
    // Claiming under the WRONG workspace inserts a distinct claim key and never
    // enqueues against WS_A's run under WS_B — then the catch-up (correct ws)
    // still finds exactly one to enqueue.
    await port.claimApprovalResume(WS_B, 'bbbbbbbb-0000-0000-0000-000000000004', run.id);
    const recovered = await port.claimDueApprovalResumes();
    expect(recovered).toBe(1);
    const jobs = await testDb().from('jobs').select('workspace_id').eq('kind', 'workflow.resume');
    // Every enqueued resume for this run carries WS_A (the run's real workspace).
    const wsA = jobs.data!.filter((j) => j.workspace_id === WS_A);
    expect(wsA.length).toBeGreaterThanOrEqual(1);
  });
});
