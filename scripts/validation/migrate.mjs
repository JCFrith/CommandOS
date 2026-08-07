#!/usr/bin/env node
// Migration-chain validation. The schema is now owned by an ORDERED CHAIN of
// immutable migrations (released production foundation → Sprint 7 durable
// triggers → …), NOT a single migration. This harness proves the chain is
// deterministic and that the LATEST (under-development) migration is cleanly
// reversible back to the previously-released schema — it never assumes one
// migration owns all current schema, and it never mutates any migration.
//
//   node scripts/validation/migrate.mjs verify    # full canonical procedure (A–D)
//   node scripts/validation/migrate.mjs sprint7    # latest-migration reversibility (B,C,D)
//   node scripts/validation/migrate.mjs replay      # empty-DB full-chain replay (A)
//
// Canonical procedure (single shared SUPABASE_TEST_DB_URL; starts fully migrated):
//   1. Capture the fully-migrated (latest) schema  = S_LATEST  (schema.canonical.sql).
//   2. Roll back ONLY the latest migration.
//   3. (C) Assert the result equals the previously-released schema (S_BASE).
//   4. Re-apply ONLY the latest migration.
//   5. (B) Assert v(base)+latest reaches S_LATEST.
//   6. (D) Re-apply the latest migration again; assert schema unchanged (idempotent).
//   7. (A) Tear the DB down to empty, replay the FULL chain, assert it reaches
//          S_LATEST (schema.replayed.sql).
// The DB is left fully migrated at the latest schema for the downstream suites.
//
// Validation-only helpers (supabase/validation/reset.sql) are `plpgsql` and are
// NOT migration objects, so they persist untouched through every rollback and
// therefore appear identically in every schema snapshot — they never perturb a
// comparison. Privileges are validated separately (privileges.mjs); this harness
// dumps with --no-privileges so it compares STRUCTURE only.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
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

// Tables owned by the released base chain (everything before the latest migration)
// and by the latest (Sprint 7) migration. Kept explicit so the count assertions
// stay meaningful even as the chain grows.
const BASE_TABLES = [
  'workspaces', 'workspace_members', 'operations', 'operation_activity', 'agents',
  'agent_activity', 'agent_executions', 'execution_logs', 'signals', 'signal_events',
  'signal_subscriptions', 'workflows', 'workflow_versions', 'workflow_runs',
  'workflow_step_runs', 'workflow_approvals', 'workflow_timers', 'trigger_claims',
  'schedule_occurrences', 'jobs',
];
const LATEST_TABLES = ['trigger_scan_cursor']; // net-new tables in the latest migration
const ALL_TABLES = [...BASE_TABLES, ...LATEST_TABLES];

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
  // Strip volatile lines so the diff reflects only real schema differences:
  //  - `--` comment lines and blanks (cosmetic)
  //  - `\restrict`/`\unrestrict` psql meta-commands, which recent pg_dump emits
  //    with a RANDOM per-invocation token (Postgres Sept-2025 security release);
  //    identical schemas would otherwise always differ on that token.
  const normalized = out
    .split('\n')
    .filter(
      (l) =>
        !l.startsWith('--') &&
        !l.startsWith('\\restrict') &&
        !l.startsWith('\\unrestrict') &&
        l.trim() !== '',
    )
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
/** The 14-digit timestamp prefix shared by a migration and its rollback file. */
function stamp(file) {
  const m = file.match(/^(\d{14})/);
  if (!m) throw new Error(`migration/rollback file has no timestamp prefix: ${file}`);
  return m[1];
}
/** The rollback file whose timestamp matches a migration file (fail if missing). */
function rollbackFor(migrationFile) {
  const want = stamp(migrationFile);
  const match = rollbackFiles().find((f) => stamp(f) === want);
  if (!match) {
    console.error(`FAIL: migration ${migrationFile} has no matching rollback (timestamp ${want}).`);
    process.exit(1);
  }
  return match;
}
function tableCount(tables) {
  const list = tables.map((t) => `'${t}'`).join(',');
  return Number(
    psql(`select count(*) from information_schema.tables where table_schema='public' and table_name in (${list});`),
  );
}
function columnExists(table, column) {
  return (
    Number(
      psql(
        `select count(*) from information_schema.columns where table_schema='public' and table_name='${table}' and column_name='${column}';`,
      ),
    ) > 0
  );
}

function applyMigration(file) {
  console.log(`  apply migration ${file}`);
  psqlFile(join(MIGRATIONS, file));
}
function applyRollback(file) {
  console.log(`  apply rollback ${file}`);
  psqlFile(join(ROLLBACK, file));
}
function applyFullChain() {
  for (const f of migrationFiles()) applyMigration(f);
}
/** Tear the DB down to empty by applying every rollback in reverse chain order. */
function tearDownToEmpty() {
  for (const f of rollbackFiles().slice().reverse()) applyRollback(f);
  const left = tableCount(ALL_TABLES);
  if (left !== 0) {
    console.error(`FAIL: teardown left ${left} app tables behind (expected 0). Rollbacks incomplete.`);
    process.exit(1);
  }
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
function assertSchema(expected, actual, code, message) {
  if (expected !== actual) {
    writeFileSync(join(LOG_DIR, 'schema.diff.txt'), `[${code}] ${message}\n\n${diff(expected, actual)}`);
    console.error(`FAIL (${code}): ${message} — see migration-logs/schema.diff.txt.`);
    process.exit(1);
  }
  console.log(`  OK (${code}): ${message}`);
}

/** Precondition shared by every command: DB is fully migrated at the latest schema. */
function requireFullyMigrated() {
  const n = tableCount(ALL_TABLES);
  if (n !== ALL_TABLES.length) {
    console.error(
      `FAIL: expected ${ALL_TABLES.length} app tables (full chain applied), found ${n}. Apply all migrations first.`,
    );
    process.exit(1);
  }
}

/**
 * Latest-migration reversibility (B, C, D). Captures the canonical latest schema,
 * rolls back only the latest migration, proves the result equals a freshly-built
 * base (released) schema, then proves re-applying the latest migration is
 * deterministic and idempotent. Leaves the DB fully migrated.
 */
function verifySprint7(captureCanonical) {
  const chain = migrationFiles();
  if (chain.length < 2) {
    console.error(`FAIL: expected a base + latest migration chain, found ${chain.length} migration(s).`);
    process.exit(1);
  }
  const latest = chain[chain.length - 1];
  const base = chain.slice(0, -1);
  requireFullyMigrated();

  // 1. Canonical latest schema.
  const sLatest = dumpSchema(captureCanonical ? 'canonical' : 'latest');

  // 2. Roll back ONLY the latest migration.
  applyRollback(rollbackFor(latest));
  if (tableCount(LATEST_TABLES) !== 0) {
    console.error('FAIL: latest-migration rollback did not remove its net-new tables.');
    process.exit(1);
  }
  if (tableCount(BASE_TABLES) !== BASE_TABLES.length) {
    console.error('FAIL: latest-migration rollback removed released base tables (it must not).');
    process.exit(1);
  }
  if (columnExists('workflow_timers', 'node_id')) {
    console.error('FAIL: latest-migration rollback did not revert the workflow_timers.node_id ALTER.');
    process.exit(1);
  }
  const sBaseAfterRollback = dumpSchema('base-after-latest-rollback');

  // 3. Build a clean reference base schema: empty DB → base migrations only.
  tearDownToEmpty();
  for (const f of base) applyMigration(f);
  const sBaseCanonical = dumpSchema('base-canonical');

  // (C) Rolling back the latest migration must reproduce the released base schema.
  assertSchema(
    sBaseCanonical,
    sBaseAfterRollback,
    'C',
    'rolling back only the latest migration reproduces the released base schema exactly',
  );

  // (B) base + latest migration only must reach the canonical latest schema.
  applyMigration(latest);
  const sFromBase = dumpSchema('latest-from-base');
  assertSchema(
    sLatest,
    sFromBase,
    'B',
    'applying only the latest migration onto the released base reaches the latest schema',
  );

  // (D) Re-applying the latest migration is idempotent (schema unchanged).
  applyMigration(latest);
  const sReapplied = dumpSchema('latest-reapplied');
  assertSchema(
    sLatest,
    sReapplied,
    'D',
    're-applying the latest migration leaves the schema identical (idempotent)',
  );

  return sLatest;
}

/**
 * (A) Empty-DB full-chain replay. Tears the DB down to empty and replays the
 * WHOLE ordered chain, asserting it reproduces the canonical latest schema.
 */
function verifyEmptyReplay(sLatest) {
  tearDownToEmpty();
  applyFullChain();
  const replayed = dumpSchema('replayed');
  assertSchema(
    sLatest,
    replayed,
    'A',
    'empty-DB replay of the full migration chain reaches the latest schema',
  );
}

function cmdVerify() {
  // Fresh diff artifact each run (report.mjs treats its presence as drift).
  rmSync(join(LOG_DIR, 'schema.diff.txt'), { force: true });
  const sLatest = verifySprint7(true); // writes schema.canonical.sql
  verifyEmptyReplay(sLatest); //          writes schema.replayed.sql
  console.log('\nOK: migration chain is deterministic, and the latest migration is cleanly reversible (A–D).');
}

const cmd = process.argv[2];
try {
  if (cmd === 'verify') cmdVerify();
  else if (cmd === 'sprint7') {
    rmSync(join(LOG_DIR, 'schema.diff.txt'), { force: true });
    verifySprint7(true);
    console.log('\nOK: latest-migration reversibility verified (B, C, D).');
  } else if (cmd === 'replay') {
    rmSync(join(LOG_DIR, 'schema.diff.txt'), { force: true });
    requireFullyMigrated();
    const sLatest = dumpSchema('canonical');
    verifyEmptyReplay(sLatest);
    console.log('\nOK: empty-DB full-chain replay verified (A).');
  } else {
    console.error('usage: migrate.mjs <verify|sprint7|replay>');
    process.exit(1);
  }
} catch (err) {
  console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
