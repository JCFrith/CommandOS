#!/usr/bin/env node
// Reproducible performance-fixture generator. Populates the validation database
// with a configurable, deterministic dataset (server-side generate_series, so it
// is fast and repeatable). All volumes and cardinalities are env-configurable:
//
//   SIGNAL_COUNT (default 10000; set 100000 for the large tier)
//   WORKFLOW_RUN_COUNT (1000), STEP_RUN_COUNT (10000), JOB_COUNT (10000)
//   WORKSPACE_COUNT (8), CORRELATION_COUNT (500)
//
// Requires SUPABASE_TEST_DB_URL. Deterministic: uses md5(seed || n)::uuid, no RNG.
import { execFileSync } from 'node:child_process';

const DB_URL = process.env.SUPABASE_TEST_DB_URL;
if (!DB_URL) {
  console.error('FAIL: SUPABASE_TEST_DB_URL is required for fixture generation (fail-closed).');
  process.exit(1);
}

const N = {
  signals: Number(process.env.SIGNAL_COUNT ?? 10_000),
  runs: Number(process.env.WORKFLOW_RUN_COUNT ?? 1_000),
  steps: Number(process.env.STEP_RUN_COUNT ?? 10_000),
  jobs: Number(process.env.JOB_COUNT ?? 10_000),
  workspaces: Number(process.env.WORKSPACE_COUNT ?? 8),
  correlations: Number(process.env.CORRELATION_COUNT ?? 500),
};

// A stable uuid derived from a namespace + integer — no randomness, fully
// reproducible. md5() returns exactly 32 hex chars, which cast directly to uuid.
const uuid = (ns, expr) => `(md5('${ns}:' || (${expr})::text)::uuid)`;

const sql = `
begin;
-- Workspaces (FK target for runs/steps).
insert into workspaces (id, name, slug, kind)
select ${uuid('ws', 'g')}, 'Fixture ' || g, 'fx-' || g, 'team'
from generate_series(1, ${N.workspaces}) g
on conflict do nothing;

-- One workflow + immutable version per workspace (FK targets for runs).
insert into workflows (id, workspace_id, name, status, created_by, updated_by)
select ${uuid('wf', 'g')}, ${uuid('ws', 'g')}, 'WF ' || g, 'active', ${uuid('u', 'g')}, ${uuid('u', 'g')}
from generate_series(1, ${N.workspaces}) g
on conflict do nothing;

insert into workflow_versions (id, workflow_id, workspace_id, version, nodes, edges, triggers, variables, start_node_id, created_by)
select ${uuid('ver', 'g')}, ${uuid('wf', 'g')}, ${uuid('ws', 'g')}, 1,
       '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'start', ${uuid('u', 'g')}
from generate_series(1, ${N.workspaces}) g
on conflict do nothing;

-- Signals — spread across workspaces and correlations, monotonically aged.
insert into signals (id, workspace_id, type, correlation_id, source, category, severity, title, summary, subject_type, subject_id, created_at)
select ${uuid('sig', 'g')},
       ${uuid('ws', `1 + (g % ${N.workspaces})`)},
       (array['operation.created','agent.execution.completed','workflow.run.completed','job.completed'])[1 + (g % 4)],
       ${uuid('corr', `1 + (g % ${N.correlations})`)},
       (array['operations','agents','workflows','platform'])[1 + (g % 4)],
       'lifecycle', (array['info','warn','error'])[1 + (g % 3)],
       'Signal ' || g, 'summary ' || g,
       'operation', ${uuid('subj', `1 + (g % ${N.correlations})`)},
       now() - (g || ' seconds')::interval
from generate_series(1, ${N.signals}) g;

-- Workflow runs (FK to workspaces/workflows/versions via the per-workspace index).
insert into workflow_runs (id, workspace_id, workflow_id, version_id, correlation_id, status, trigger, started_by, created_at)
select ${uuid('run', 'g')},
       ${uuid('ws', `1 + (g % ${N.workspaces})`)},
       ${uuid('wf', `1 + (g % ${N.workspaces})`)},
       ${uuid('ver', `1 + (g % ${N.workspaces})`)},
       ${uuid('corr', `1 + (g % ${N.correlations})`)},
       (array['running','completed','waiting_approval','waiting_timer'])[1 + (g % 4)],
       '{}'::jsonb, ${uuid('u', `1 + (g % ${N.workspaces})`)},
       now() - (g || ' seconds')::interval
from generate_series(1, ${N.runs}) g;

-- Step runs (append-only checkpoints) attached to the generated runs.
insert into workflow_step_runs (id, workspace_id, run_id, node_id, node_type, status, attempts, started_at)
select ${uuid('step', 'g')},
       ${uuid('ws', `1 + (g % ${N.workspaces})`)},
       ${uuid('run', `1 + (g % ${N.runs})`)},
       'node-' || (g % 20), 'task', 'completed', 1,
       now() - (g || ' seconds')::interval
from generate_series(1, ${N.steps}) g;

-- Jobs — a realistic mix of queued/running/done so the claim index is exercised.
insert into jobs (id, workspace_id, kind, payload, status, scheduled_for, attempts, created_at)
select ${uuid('job', 'g')},
       ${uuid('ws', `1 + (g % ${N.workspaces})`)},
       'ai.execution', '{}'::jsonb,
       (array['queued','running','done','failed'])[1 + (g % 4)],
       now() - (g || ' seconds')::interval, g % 3,
       now() - (g || ' seconds')::interval
from generate_series(1, ${N.jobs}) g;

analyze;
commit;
`;

console.log(
  `Generating fixtures: ${N.signals} signals, ${N.runs} runs, ${N.steps} steps, ${N.jobs} jobs across ${N.workspaces} workspaces / ${N.correlations} correlations…`,
);
try {
  execFileSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  console.log('OK: fixtures generated.');
} catch (err) {
  console.error(`FAIL: fixture generation failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
