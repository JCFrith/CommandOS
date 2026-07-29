#!/usr/bin/env node
// Performance validation. Runs EXPLAIN (ANALYZE, BUFFERS) for every hot query the
// runtime depends on against a fixture-loaded validation database and stores each
// plan as an artifact. It makes NO performance claims and changes NO indexes — it
// records the measured plans so a human can judge whether the current indexes hold
// up. If a scan looks wrong, that is a signal to investigate, not to hardcode.
//
// Requires SUPABASE_TEST_DB_URL and a fixture-loaded DB (run gen-fixtures.mjs first).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DB_URL = process.env.SUPABASE_TEST_DB_URL;
if (!DB_URL) {
  console.error('FAIL: SUPABASE_TEST_DB_URL is required for performance validation (fail-closed).');
  process.exit(1);
}
const OUT = join(resolve(process.cwd()), 'artifacts', 'production-validation', 'query-plans');
mkdirSync(OUT, { recursive: true });

// A concrete workspace present in the fixtures (same derivation as gen-fixtures).
const WS = `('x' || substr(md5('ws:1'), 1, 32))::uuid`;
const CORR = `('x' || substr(md5('corr:1'), 1, 32))::uuid`;
const now = `now()`;

/** The runtime's hot paths, each mapped to the exact shape the adapters issue. */
const QUERIES = [
  ['queue-claim-scan',
    `select id from jobs where status in ('queued','running')
       and coalesce(scheduled_for, created_at) <= ${now}
     order by coalesce(scheduled_for, created_at) asc
     for update skip locked limit 10`],
  ['due-job-scan',
    `select id from jobs where status = 'queued' and coalesce(scheduled_for, created_at) <= ${now}
     order by coalesce(scheduled_for, created_at) asc limit 25`],
  ['expired-lease-recovery',
    `select id from jobs where status = 'running' and lease_until < ${now} limit 100`],
  ['due-timer-scan',
    `select id from workflow_timers where due_at <= ${now} and claimed_at is null limit 100`],
  ['schedule-lookup',
    `select 1 from schedule_occurrences where workspace_id = ${WS}
       and workflow_id = ('x' || substr(md5('wf:1'), 1, 32))::uuid and occurrence_key = 'k1'`],
  ['signal-timeline',
    `select * from signals where workspace_id = ${WS} order by created_at desc limit 50`],
  ['signal-by-correlation',
    `select * from signals where workspace_id = ${WS} and correlation_id = ${CORR} order by created_at desc`],
  ['signal-by-subject',
    `select * from signals where workspace_id = ${WS} and subject_type = 'operation'
       and subject_id = ('x' || substr(md5('subj:1'), 1, 32))::uuid order by created_at desc`],
  ['workflow-history',
    `select * from workflow_runs where workspace_id = ${WS} order by created_at desc limit 50`],
  ['suspended-workflows',
    `select id from workflow_runs where status in ('waiting_timer','waiting_approval') limit 100`],
  ['approval-lookup',
    `select * from workflow_approvals where workspace_id = ${WS} and status = 'pending' limit 50`],
  ['trigger-claim-lookup',
    `select run_id from trigger_claims where workspace_id = ${WS} and trigger_key = 'k1'`],
  ['operations-list',
    `select * from operations where workspace_id = ${WS} order by updated_at desc limit 50`],
  ['agents-list',
    `select * from agents where workspace_id = ${WS} order by updated_at desc limit 50`],
];

function explain(sql) {
  return execFileSync(
    'psql',
    [DB_URL, '-v', 'ON_ERROR_STOP=1', '-X', '-A', '-t', '-c', `explain (analyze, buffers, format text) ${sql}`],
    { encoding: 'utf8' },
  );
}

const summary = [];
let failed = false;
for (const [name, sql] of QUERIES) {
  try {
    const plan = explain(sql);
    writeFileSync(join(OUT, `${name}.txt`), `-- query: ${name}\n${sql}\n\n${plan}\n`);
    // Record whether the plan used a Seq Scan on a large table (a review signal, not a hard failure).
    const seqScan = /Seq Scan/.test(plan);
    summary.push({ name, seqScan, ok: true });
    console.log(`  ${name}: plan captured${seqScan ? ' (contains Seq Scan — review)' : ''}`);
  } catch (err) {
    failed = true;
    summary.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) });
    console.error(`  ${name}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
  }
}
writeFileSync(join(OUT, 'plans.summary.json'), JSON.stringify({ generatedFor: 'fixture-loaded validation db', queries: summary }, null, 2));
console.log(`Query plans written to ${OUT}`);
if (failed) process.exit(1);
