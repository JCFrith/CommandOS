#!/usr/bin/env node
// Migration validation. Drives the CANONICAL migration through a rollback/replay
// cycle against a real Postgres (SUPABASE_TEST_DB_URL) and proves it is
// reversible and deterministic. Never mutates the canonical migration.
//
//   node scripts/validation/migrate.mjs rollback   # apply rollback, assert 6.5 objects gone
//   node scripts/validation/migrate.mjs replay      # reapply migration, assert schema == canonical
//
// Logs and schema snapshots are written under artifacts/production-validation/migration-logs/.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const ROLLBACK = join(ROOT, 'supabase', 'rollback');
const LOG_DIR = join(ROOT, 'artifacts', 'production-validation', 'migration-logs');
mkdirSync(LOG_DIR, { recursive: true });

const DB_URL = process.env.SUPABASE_TEST_DB_URL;
if (!DB_URL) {
  console.error('FAIL: SUPABASE_TEST_DB_URL is required for migration validation (fail-closed).');
  process.exit(1);
}

const APP_TABLES = [
  'workspaces', 'workspace_members', 'operations', 'operation_activity', 'agents',
  'agent_activity', 'agent_executions', 'execution_logs', 'signals', 'signal_events',
  'signal_subscriptions', 'workflows', 'workflow_versions', 'workflow_runs',
  'workflow_step_runs', 'workflow_approvals', 'workflow_timers', 'trigger_claims',
  'schedule_occurrences', 'jobs',
];

function psql(sql) {
  return execFileSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql], {
    encoding: 'utf8',
  }).trim();
}
function psqlFile(file) {
  return execFileSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-f', file], { encoding: 'utf8' });
}
function dumpSchema(label) {
  const out = execFileSync('pg_dump', ['--schema-only', '--no-owner', '--no-privileges', DB_URL], {
    encoding: 'utf8',
  });
  // Strip volatile comment lines so the diff is deterministic across runs/hosts.
  const normalized = out
    .split('\n')
    .filter((l) => !l.startsWith('--') && l.trim() !== '')
    .join('\n');
  writeFileSync(join(LOG_DIR, `schema.${label}.sql`), normalized);
  return normalized;
}
function migrationFiles() {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
}
function rollbackFiles() {
  return readdirSync(ROLLBACK).filter((f) => f.endsWith('.sql')).sort();
}
function tableCount() {
  const list = APP_TABLES.map((t) => `'${t}'`).join(',');
  return Number(
    psql(`select count(*) from information_schema.tables where table_schema='public' and table_name in (${list});`),
  );
}

function applyMigrations() {
  for (const f of migrationFiles()) {
    console.log(`  apply migration ${f}`);
    psqlFile(join(MIGRATIONS, f));
  }
}
function applyRollback() {
  for (const f of rollbackFiles()) {
    console.log(`  apply rollback ${f}`);
    psqlFile(join(ROLLBACK, f));
  }
}

function cmdRollback() {
  // Precondition: migrations applied → all app tables present.
  const before = tableCount();
  if (before !== APP_TABLES.length) {
    console.error(`FAIL: expected ${APP_TABLES.length} app tables before rollback, found ${before}. Apply migrations first.`);
    process.exit(1);
  }
  const canonical = dumpSchema('canonical');
  writeFileSync(join(LOG_DIR, 'canonical.snapshot.marker'), 'ok');
  applyRollback();
  const after = tableCount();
  if (after !== 0) {
    console.error(`FAIL: rollback left ${after} app tables behind (expected 0). Rollback must remove all Sprint 6.5 objects.`);
    process.exit(1);
  }
  console.log(`OK: rollback removed all ${before} Sprint 6.5 tables. Canonical schema snapshot captured (${canonical.length} bytes).`);
}

function cmdReplay() {
  // Reapply the canonical migration onto the rolled-back (empty) DB and prove the
  // schema is byte-identical to the canonical snapshot captured before rollback.
  if (!existsSync(join(LOG_DIR, 'schema.canonical.sql'))) {
    console.error('FAIL: no canonical snapshot found. Run `migrate.mjs rollback` first.');
    process.exit(1);
  }
  applyMigrations();
  const replayed = dumpSchema('replayed');
  const canonical = readFileSync(join(LOG_DIR, 'schema.canonical.sql'), 'utf8');
  if (replayed !== canonical) {
    writeFileSync(join(LOG_DIR, 'schema.diff.txt'), diff(canonical, replayed));
    console.error('FAIL: replayed schema differs from canonical. See migration-logs/schema.diff.txt.');
    process.exit(1);
  }
  console.log('OK: replay reproduced the canonical schema exactly (migration is deterministic and reversible).');
}

function diff(a, b) {
  const al = a.split('\n');
  const bl = b.split('\n');
  const out = [];
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i]) out.push(`- ${al[i] ?? ''}\n+ ${bl[i] ?? ''}`);
  }
  return out.join('\n');
}

const cmd = process.argv[2];
try {
  if (cmd === 'rollback') cmdRollback();
  else if (cmd === 'replay') cmdReplay();
  else {
    console.error('usage: migrate.mjs <rollback|replay>');
    process.exit(1);
  }
} catch (err) {
  console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
