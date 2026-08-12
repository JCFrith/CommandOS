import { describe, expect, it } from 'vitest';

import { DurableTriggerEvaluator } from '@/services/workflows/durable-trigger-evaluator';
import {
  SupabaseDurableTriggerPort,
  WORKFLOW_RUN_JOB_KIND,
} from '@/services/workflows/supabase-durable-trigger-port';
import { SupabaseWorkflowRepository } from '@/services/workflows/supabase-workflow-repository';
import { SupabaseLeasedJobStore } from '@/services/jobs/supabase-job-store';
import { LeasedBackgroundWorker } from '@/services/jobs/worker';
import { workflowRunHandler } from '@/services/jobs/workflow-durable';
import { resetDb, testDb, USER_A_OWNER, WS_A } from './helpers';
import { PRODUCTION_VALIDATION } from './setup';

// Deterministic uuid/id + clock so run ids and cursor positions are predictable.
function portDeps() {
  let seq = 0;
  return {
    id: () => `33333333-3333-3333-3333-${String(++seq).padStart(12, '0')}`,
    now: () => new Date(Date.parse('2027-03-01T00:00:00.000Z') + seq * 1000).toISOString(),
  };
}

async function seedSignalTriggeredWorkflow() {
  const repo = new SupabaseWorkflowRepository();
  const now = '2027-02-01T00:00:00.000Z';
  const wf = {
    id: '00000000-0000-0000-0000-0000000000d0',
    workspaceId: WS_A,
    name: 'durable-trigger',
    description: null,
    status: 'draft' as const,
    currentVersionId: null,
    createdBy: USER_A_OWNER,
    updatedBy: USER_A_OWNER,
    createdAt: now,
    updatedAt: now,
  };
  await repo.createWorkflow(wf);
  const ver = {
    id: '00000000-0000-0000-0000-0000000000d1',
    workflowId: wf.id,
    workspaceId: WS_A,
    version: 1,
    nodes: [
      { id: 's', type: 'start', name: 'S', config: { type: 'start' } },
      { id: 'e', type: 'end', name: 'E', config: { type: 'end' } },
    ],
    edges: [{ from: 's', to: 'e' }],
    triggers: [{ type: 'signal', signalType: 'operation.created' }],
    variables: [],
    startNodeId: 's',
    createdBy: USER_A_OWNER,
    createdAt: now,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await repo.createVersion(ver as any);
  await repo.updateWorkflow({
    ...wf,
    status: 'active',
    currentVersionId: ver.id,
    updatedAt: now,
  });
  return { workflowId: wf.id, versionId: ver.id };
}

async function insertSignal(createdAt: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await testDb()
    .from('signals')
    .insert({
      workspace_id: WS_A,
      type: 'operation.created',
      correlation_id: '44444444-4444-4444-4444-444444444444',
      source: 'operations',
      category: 'lifecycle',
      severity: 'info',
      title: 't',
      summary: 's',
      created_at: createdAt,
      ...overrides,
    })
    .select('id')
    .single();
  if (error) throw new Error(`insert signal failed: ${error.message}`);
  return data.id as string;
}

(PRODUCTION_VALIDATION ? describe : describe.skip)('durable signal triggers × Supabase', () => {
  it('initializes future-only, then claims+enqueues a run for a new matching signal', async () => {
    await resetDb();
    const { workflowId, versionId } = await seedSignalTriggeredWorkflow();
    const port = new SupabaseDurableTriggerPort(portDeps());
    const evaluator = new DurableTriggerEvaluator(port);

    // A pre-existing signal must NOT be replayed: the first pass initializes the
    // cursor to the current frontier (future-only).
    await insertSignal('2027-02-15T00:00:00.000Z');
    const first = await evaluator.evaluateSignals();
    expect(first.initializedWorkspaces).toBe(1);
    expect(first.enqueued).toBe(0);

    // A new signal after initialization is matched, claimed, and enqueued once.
    await insertSignal('2027-02-16T00:00:00.000Z');
    const second = await evaluator.evaluateSignals();
    expect(second.enqueued).toBe(1);

    // One pending run + one queued workflow.run job for this workflow.
    const runs = await testDb()
      .from('workflow_runs')
      .select('id, status, version_id')
      .eq('workflow_id', workflowId);
    expect(runs.data).toHaveLength(1);
    expect(runs.data![0]).toMatchObject({ status: 'pending', version_id: versionId });

    const jobs = await testDb()
      .from('jobs')
      .select('id, kind, status')
      .eq('kind', WORKFLOW_RUN_JOB_KIND);
    expect(jobs.data).toHaveLength(1);
    expect(jobs.data![0]!.status).toBe('queued');

    // Idempotent: another pass with no new signal enqueues nothing more.
    const third = await evaluator.evaluateSignals();
    expect(third.enqueued).toBe(0);

    // The worker drains the workflow.run job → the run reaches completion.
    const store = new SupabaseLeasedJobStore();
    const worker = new LeasedBackgroundWorker(store, {
      workerId: 'durable-itest',
      leaseMs: 30_000,
      batchSize: 10,
      id: () => '55555555-5555-5555-5555-555555555555',
      now: () => new Date().toISOString(),
    });
    worker.register(workflowRunHandler);
    const tick = await worker.tick();
    expect(tick).toMatchObject({ claimed: 1, completed: 1, failed: 0 });

    const done = await testDb()
      .from('workflow_runs')
      .select('status')
      .eq('workflow_id', workflowId)
      .single();
    expect(done.data!.status).toBe('completed');
  });

  it('claiming the same occurrence twice dedups via trigger_claims (one run, one job)', async () => {
    await resetDb();
    const { workflowId, versionId } = await seedSignalTriggeredWorkflow();
    const repo = new SupabaseWorkflowRepository();
    const version = (await repo.getVersion(WS_A, versionId))!;
    const port = new SupabaseDurableTriggerPort(portDeps());

    // The cursor is a mere progress marker; dedup is authoritative in the claim.
    // Claiming the same (workspace, version, signal) occurrence twice — as an
    // at-least-once re-scan would — must create exactly one run and one job.
    const signalId = '66666666-6666-6666-6666-666666666666';
    const first = await port.claimAndEnqueueRun({
      version,
      signalId,
      correlationId: '44444444-4444-4444-4444-444444444444',
      causationId: signalId,
    });
    const second = await port.claimAndEnqueueRun({
      version,
      signalId,
      correlationId: '44444444-4444-4444-4444-444444444444',
      causationId: signalId,
    });
    expect(first).toBe('enqueued');
    expect(second).toBe('duplicate');

    const runs = await testDb().from('workflow_runs').select('id').eq('workflow_id', workflowId);
    expect(runs.data).toHaveLength(1);
    const jobs = await testDb().from('jobs').select('id').eq('kind', WORKFLOW_RUN_JOB_KIND);
    expect(jobs.data).toHaveLength(1);
  });
});
