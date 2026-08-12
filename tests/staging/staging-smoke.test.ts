/**
 * LIVE Vercel staging smoke — drives the DEPLOYED worker route.
 *
 * Unlike the in-process integration suites (which call `worker.tick()` directly),
 * this exercises the real deployment end to end:
 *
 *   seed staging DB (service client) → POST https://…/api/worker (Bearer CRON_SECRET)
 *     → deployed BackgroundWorker.tick() → durable passes + handlers → staging DB
 *     → assert via the service client
 *
 * It therefore validates what the DB-only validation cannot: the route wiring, the
 * CRON_SECRET auth guard, the health/metrics endpoint, and idempotency across real
 * HTTP requests and redeploys.
 *
 * Fixtures are dated in the REAL past (the deployment uses the real wall clock,
 * whereas the integration suites inject a fixed 2027 clock).
 *
 * Gated: runs ONLY when PRODUCTION_VALIDATION=1 AND STAGING_URL AND CRON_SECRET are
 * present, so it never runs as part of `validate:production` (different directory +
 * config) and never counts as a skip against the release gate. Run it with:
 *
 *   PRODUCTION_VALIDATION=1 STAGING_URL=https://commandos-staging.vercel.app \
 *   CRON_SECRET=… SUPABASE_TEST_URL=… SUPABASE_TEST_SERVICE_ROLE_KEY=… \
 *   SUPABASE_TEST_ANON_KEY=… npm run test:staging:smoke
 */
import { describe, expect, it } from 'vitest';

import { SupabaseWorkflowRepository } from '@/services/workflows/supabase-workflow-repository';
import type { WorkflowApproval, WorkflowRun, WorkflowTimer } from '@/lib/workflows/types';

import { resetDb, testDb, USER_A_OWNER, WS_A, WS_B } from '../integration/helpers';

const STAGING_URL = process.env.STAGING_URL?.replace(/\/$/, '');
const CRON_SECRET = process.env.CRON_SECRET;
const RUN =
  process.env.PRODUCTION_VALIDATION === '1' && Boolean(STAGING_URL) && Boolean(CRON_SECRET);

const CORRELATION = '44444444-4444-4444-4444-444444444444';
const pastIso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

/** POST the deployed worker route with the cron bearer; returns status + parsed body. */
async function tick(): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${STAGING_URL}/api/worker`, {
    method: 'POST',
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

async function health(): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${STAGING_URL}/api/worker/health`, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

/**
 * Await a PostgREST list query and fail with the REAL database error instead of a
 * null-deref. A malformed query (e.g. a nonexistent column) or a denied SELECT
 * surfaces `error` with `data === null`; asserting `data!.length` would throw an
 * opaque `TypeError` and hide the actual cause. This makes the smoke fail loudly
 * with the message Postgres/PostgREST returned — never a non-null assertion.
 */
async function rows<T = Record<string, unknown>>(
  label: string,
  query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  if (data === null) throw new Error(`${label}: query returned null data with no error`);
  return data;
}

/** As `rows`, for `.single()` queries that resolve to exactly one row. */
async function one<T = Record<string, unknown>>(
  label: string,
  query: PromiseLike<{ data: T | null; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  if (data === null) throw new Error(`${label}: query returned null data with no error`);
  return data;
}

async function countRuns(workflowId: string): Promise<number> {
  const data = await rows(
    'countRuns',
    testDb().from('workflow_runs').select('id').eq('workflow_id', workflowId),
  );
  return data.length;
}

async function insertSignal(
  ws: string,
  createdAt: string,
  correlationId: string = CORRELATION,
): Promise<string> {
  const data = await one<{ id: string }>(
    'insert signal',
    testDb()
      .from('signals')
      .insert({
        workspace_id: ws,
        type: 'operation.created',
        correlation_id: correlationId,
        source: 'operations',
        category: 'lifecycle',
        severity: 'info',
        title: 't',
        summary: 's',
        created_at: createdAt,
      })
      .select('id')
      .single(),
  );
  return data.id;
}

/** An active workflow whose single version has the given triggers + node graph. */
async function seedWorkflow(
  ws: string,
  suffix: string,
  triggers: unknown[],
  extraNodes: Array<Record<string, unknown>> = [],
  extraEdges: Array<Record<string, unknown>> = [],
): Promise<{ repo: SupabaseWorkflowRepository; workflowId: string; versionId: string }> {
  const repo = new SupabaseWorkflowRepository();
  const created = pastIso(7 * 24 * 60 * 60 * 1000); // 7 days ago (past anchor for schedules)
  const workflowId = `00000000-0000-0000-0000-0000000000${suffix}`;
  const versionId = `00000000-0000-0000-0000-000000000${suffix}f`;
  const wf = {
    id: workflowId,
    workspaceId: ws,
    name: `smoke-${suffix}`,
    description: null,
    status: 'draft' as const,
    currentVersionId: null,
    createdBy: USER_A_OWNER,
    updatedBy: USER_A_OWNER,
    createdAt: created,
    updatedAt: created,
  };
  await repo.createWorkflow(wf);
  const ver = {
    id: versionId,
    workflowId,
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
    createdAt: created,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await repo.createVersion(ver as any);
  await repo.updateWorkflow({
    ...wf,
    status: 'active',
    currentVersionId: versionId,
    updatedAt: created,
  });
  return { repo, workflowId, versionId };
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
  const now = pastIso(60 * 60 * 1000);
  const run: WorkflowRun = {
    id,
    workflowId,
    versionId,
    workspaceId: ws,
    correlationId: CORRELATION,
    status,
    trigger: { type: 'signal', ref: 'x' },
    triggerKey: null,
    variables: {},
    frontier,
    joinArrivals: {},
    error: null,
    startedBy: USER_A_OWNER,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  await repo.createRun(run);
  return run;
}

(RUN ? describe : describe.skip)('Vercel staging smoke × deployed worker', () => {
  it('worker authorization + health/metrics endpoints', async () => {
    // Negative: no bearer / wrong bearer → 401 (the app guard, not a Vercel wall).
    expect((await fetch(`${STAGING_URL}/api/worker`, { method: 'POST' })).status).toBe(401);
    expect(
      (
        await fetch(`${STAGING_URL}/api/worker`, {
          method: 'POST',
          headers: { authorization: 'Bearer wrong' },
        })
      ).status,
    ).toBe(401);

    // Positive: the deployment really runs the DURABLE path, all passes, no failures.
    const t = await tick();
    expect(t.status).toBe(200);
    expect(t.body.ok).toBe(true);
    expect(t.body.triggerPath).toBe('durable');
    expect(typeof t.body.passesRun).toBe('number');
    expect(t.body.passesFailed).toBe(0);

    // Health/metrics: bearer-guarded, exposes the durable aggregates + pass liveness.
    expect((await fetch(`${STAGING_URL}/api/worker/health`)).status).toBe(401);
    const h = await health();
    expect(h.status).toBe(200);
    expect(h.body.triggerPath).toBe('durable');
    for (const k of [
      'overdueTimers',
      'oldestOverdueTimerMs',
      'pendingApprovalResumes',
      'resumeQueueDepth',
      'oldestResumeJobMs',
    ]) {
      expect(k in h.body, `health missing metric: ${k}`).toBe(true);
    }
    expect(h.body.workerPasses).toBeTruthy();
  });

  it('durable signal trigger + duplicate suppression (incl. concurrent workers)', async () => {
    await resetDb();
    const { workflowId } = await seedWorkflow(WS_A, 'd0', [
      { type: 'signal', signalType: 'operation.created' },
    ]);

    // A pre-existing signal only establishes the cursor frontier (future-only init).
    await insertSignal(WS_A, pastIso(120_000));
    const t1 = await tick();
    expect(t1.body.triggerPath).toBe('durable');
    expect(await countRuns(workflowId)).toBe(0);

    // A new signal after the cursor → claimed + enqueued + drained → exactly one run.
    await insertSignal(WS_A, pastIso(5_000));
    await tick(); // signal pass claims+enqueues
    await tick(); // execute pass drains the workflow.run job
    expect(await countRuns(workflowId)).toBe(1);

    // Duplicate suppression: repeated ticks with no new signal never add a run.
    await tick();
    await tick();
    expect(await countRuns(workflowId)).toBe(1);

    // Concurrent-worker dedup: one fresh signal + two simultaneous ticks → +1 run only.
    await insertSignal(WS_A, pastIso(1_000), '55555555-5555-5555-5555-555555555555');
    await Promise.all([tick(), tick()]);
    await tick();
    expect(await countRuns(workflowId)).toBe(2);
  });

  it('durable scheduled trigger + occurrence dedup', async () => {
    await resetDb();
    // 24h interval + a 7-day-past anchor ⇒ a stable most-recent occurrence during the
    // smoke (re-ticks fall in the same window → dedup, not a second run).
    const { workflowId } = await seedWorkflow(WS_A, 'a0', [
      { type: 'schedule', intervalMs: 24 * 60 * 60 * 1000 },
    ]);

    await tick(); // schedule pass claims the most-recent missed occurrence
    await tick(); // drain
    expect(await countRuns(workflowId)).toBe(1);
    // `schedule_occurrences` is service-role-only (RLS on, no browser policy) and its
    // PK is (workspace_id, workflow_id, occurrence_key) — there is NO `id` column, so
    // the prior `.select('id')` was a malformed query that PostgREST rejected. Select a
    // real column, scoped to this workflow, so `rows()` surfaces any DB error instead of
    // a null-deref: exactly one dedup occurrence backs the single run above.
    const occ = await rows(
      'schedule_occurrences select',
      testDb().from('schedule_occurrences').select('occurrence_key').eq('workflow_id', workflowId),
    );
    expect(occ.length).toBe(1);

    // Same-window re-ticks (and a duplicate "cron") never create a second run.
    await tick();
    await tick();
    expect(await countRuns(workflowId)).toBe(1);
  });

  it('durable timer resume (due timer → claim → resume → advance)', async () => {
    await resetDb();
    const { repo, workflowId, versionId } = await seedWorkflow(
      WS_A,
      'b0',
      [],
      [{ id: 'd', type: 'delay', name: 'D', config: { type: 'delay', ms: 0 } }],
      [
        { from: 's', to: 'd' },
        { from: 'd', to: 'e' },
      ],
    );
    const run = await seedRun(
      repo,
      WS_A,
      workflowId,
      versionId,
      'waiting_timer',
      ['d'],
      '11111111-1111-1111-1111-111111111111',
    );
    const timer: WorkflowTimer = {
      id: 'aaaaaaaa-0000-0000-0000-000000000001',
      workspaceId: WS_A,
      runId: run.id,
      nodeId: 'd',
      dueAt: pastIso(60 * 60 * 1000), // 1h overdue
      claimedAt: null,
    };
    await repo.createTimer(timer);

    await tick(); // timer pass claims + enqueues workflow.resume
    await tick(); // execute pass drains the resume → run advances

    const claimedTimer = await one<{ claimed_at: string | null }>(
      'claimed timer',
      testDb().from('workflow_timers').select('claimed_at').eq('run_id', run.id).single(),
    );
    expect(claimedTimer.claimed_at).not.toBeNull();

    const resumeJobs = await rows<{ id: string; payload: { runId: string } }>(
      'resume jobs',
      testDb().from('jobs').select('id, payload').eq('kind', 'workflow.resume'),
    );
    expect(resumeJobs.length).toBeGreaterThanOrEqual(1);
    expect(resumeJobs[0]?.payload.runId).toBe(run.id);

    const after = await one<{ status: string }>(
      'run status',
      testDb().from('workflow_runs').select('status').eq('id', run.id).single(),
    );
    expect(after.status).toBe('completed');

    // Idempotent: no further resume jobs on a subsequent tick.
    const before = resumeJobs.length;
    await tick();
    const nowJobs = await rows(
      'resume jobs after tick',
      testDb().from('jobs').select('id').eq('kind', 'workflow.resume'),
    );
    expect(nowJobs.length).toBe(before);
  });

  it('durable approval resume (decided approval → catch-up → resume → complete)', async () => {
    await resetDb();
    const { repo, workflowId, versionId } = await seedWorkflow(
      WS_A,
      'c0',
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
      decidedAt: pastIso(60_000),
      comment: null,
      createdAt: pastIso(60_000),
    };
    await repo.createApproval(approval);

    // No fast-path claim (simulating the request-path skip in durable mode): the
    // worker's approval-resume catch-up pass must find + enqueue exactly one resume.
    await tick();
    await tick();

    const resumeJobs = await rows(
      'approval resume jobs',
      testDb().from('jobs').select('id').eq('kind', 'workflow.resume'),
    );
    expect(resumeJobs.length).toBe(1);
    const after = await one<{ status: string }>(
      'run status',
      testDb().from('workflow_runs').select('status').eq('id', run.id).single(),
    );
    expect(after.status).toBe('completed');
  });

  it('signal claiming is workspace-scoped (no cross-tenant run)', async () => {
    await resetDb();
    const a = await seedWorkflow(WS_A, 'e0', [{ type: 'signal', signalType: 'operation.created' }]);
    const b = await seedWorkflow(WS_B, 'e1', [{ type: 'signal', signalType: 'operation.created' }]);

    // Establish both cursors, then a fresh signal in each workspace.
    await insertSignal(WS_A, pastIso(120_000));
    await insertSignal(WS_B, pastIso(120_000));
    await tick();
    await insertSignal(WS_A, pastIso(5_000));
    await insertSignal(WS_B, pastIso(5_000));
    await tick();
    await tick();

    const aRuns = await rows<{ workspace_id: string }>(
      'a runs',
      testDb().from('workflow_runs').select('workspace_id').eq('workflow_id', a.workflowId),
    );
    const bRuns = await rows<{ workspace_id: string }>(
      'b runs',
      testDb().from('workflow_runs').select('workspace_id').eq('workflow_id', b.workflowId),
    );
    expect(aRuns.length).toBe(1);
    expect(bRuns.length).toBe(1);
    expect(aRuns.every((r) => r.workspace_id === WS_A)).toBe(true);
    expect(bRuns.every((r) => r.workspace_id === WS_B)).toBe(true);
  });

  it('idempotent across many stateless ticks (cold-start / redeploy safe, persistent state)', async () => {
    await resetDb();
    const { workflowId } = await seedWorkflow(WS_A, 'f0', [
      { type: 'signal', signalType: 'operation.created' },
    ]);
    await insertSignal(WS_A, pastIso(120_000));
    await tick();
    await insertSignal(WS_A, pastIso(5_000));

    // Many separate HTTP ticks — as a redeployed / cold-started stateless worker
    // would issue — must converge to exactly one run + one job (state persists in
    // Postgres across requests; dedup survives process churn).
    for (let i = 0; i < 5; i++) await tick();
    expect(await countRuns(workflowId)).toBe(1);
    const jobs = await rows(
      'run jobs',
      testDb().from('jobs').select('id').eq('kind', 'workflow.run'),
    );
    expect(jobs.length).toBe(1);
  });
});
