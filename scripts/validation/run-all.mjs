#!/usr/bin/env node
// Fail-closed production-validation orchestrator (`npm run validate:production`).
//
// Assumes the CANONICAL migration has already been applied to the target
// validation database (by `supabase migration up` locally, or by the workflow for
// a hosted project). It then runs the full validation pipeline in order and, at
// the end, computes the release gate via report.mjs.
//
// FAIL-CLOSED: production validation requires a real database. If the required
// credentials are absent, this refuses to run — it NEVER silently passes by
// skipping the database-backed suites.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const ART = join(ROOT, 'artifacts', 'production-validation');
const TEST_RESULTS = join(ART, 'test-results');
mkdirSync(TEST_RESULTS, { recursive: true });

// Production validation is always on for this entrypoint — fail closed downstream.
process.env.PRODUCTION_VALIDATION = '1';

const REQUIRED = ['SUPABASE_TEST_URL', 'SUPABASE_TEST_SERVICE_ROLE_KEY', 'SUPABASE_TEST_DB_URL'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    `FAIL (fail-closed): production validation requires a real database. Missing: ${missing.join(', ')}.\n` +
      'Refusing to run — validation must never pass by skipping the database-backed suites.',
  );
  process.exit(1);
}

function step(label, bin, args, opts = {}) {
  console.log(`\n=== ${label} ===`);
  const res = spawnSync(bin, args, { stdio: 'inherit', env: process.env, ...opts });
  if (res.status !== 0) {
    console.error(`\nFAIL: step "${label}" exited with ${res.status ?? res.signal}.`);
    // Still produce a report so artifacts are uploaded on failure.
    spawnSync('node', ['scripts/validation/report.mjs'], { stdio: 'inherit', env: process.env });
    process.exit(1);
  }
}

// 1. Fail-closed environment + schema probe.
step('validate-env', 'node', ['scripts/validation/validate-env.mjs']);

// 2. Migration-chain reversibility (A–D): the latest migration rolls back to the
//    released base schema and the full chain replays deterministically. Leaves the
//    DB fully migrated at the latest (Sprint 7) schema.
step('migrate:verify', 'node', ['scripts/validation/migrate.mjs', 'verify']);

// 3. Re-apply the validation-only helpers (the rollback/replay cycle truncated
//    the DB; re-create them fresh and re-seed on next resetDb()).
step('apply validation helpers', 'psql', [
  process.env.SUPABASE_TEST_DB_URL,
  '-v', 'ON_ERROR_STOP=1',
  '-f', 'supabase/validation/reset.sql',
]);

// 4. SQL privilege assertions: prove the replayed grant state matches the expected
//    matrix for every privileged RPC + infra table (fail-closed on any violation).
step('privilege assertions', 'node', ['scripts/validation/privileges.mjs']);

// 5. Database-backed integration suites (single vitest run, JSON + console).
//    These MUST NOT be skipped in production-validation mode; report.mjs fails the
//    gate if any required test is skipped.
step('integration suites', 'npx', [
  'vitest', 'run', '-c', 'vitest.integration.config.ts',
  '--reporter=default', '--reporter=json',
  `--outputFile=${join(TEST_RESULTS, 'integration.json')}`,
]);

// 6. Performance fixtures + EXPLAIN plans (after the functional suites, which reset
//    the DB; fixtures are bulk perf data left in place for plan capture).
step('generate fixtures', 'node', ['scripts/validation/gen-fixtures.mjs']);
step('explain plans', 'node', ['scripts/validation/explain-plans.mjs']);

// 7. Aggregate + compute the release gate (exits non-zero on FAIL).
console.log('\n=== report + release gate ===');
const report = spawnSync('node', ['scripts/validation/report.mjs'], { stdio: 'inherit', env: process.env });
process.exit(report.status ?? 1);
