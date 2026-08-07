#!/usr/bin/env node
// Validation report aggregator. Collects every machine-readable result produced by
// the validation run and emits both a machine-readable (summary.json) and a
// human-readable (summary.md) report under artifacts/production-validation/, then
// computes the FINAL release-gate status.
//
// The gate PASSES only when: zero required tests failed, zero required tests were
// skipped, migrations applied, rollback+replay succeeded, and query plans were
// captured. Anything short of that is a FAIL and this script exits non-zero.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ART = join(resolve(process.cwd()), 'artifacts', 'production-validation');
const TEST_RESULTS = join(ART, 'test-results');
const PLANS = join(ART, 'query-plans');
const MIGRATION_LOGS = join(ART, 'migration-logs');
const PRIVILEGES = join(ART, 'privileges');
mkdirSync(ART, { recursive: true });

const safe = (fn, fallback) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};
const cmd = (bin, args) => safe(() => execFileSync(bin, args, { encoding: 'utf8' }).trim(), 'unknown');

// ---- Environment provenance (no secrets) --------------------------------------
const env = {
  commit: cmd('git', ['rev-parse', 'HEAD']),
  branch: cmd('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
  generatedAt: new Date().toISOString(),
  node: process.version,
  supabaseCli: cmd('supabase', ['--version']),
  psql: cmd('psql', ['--version']),
  supabaseUrlHost: safe(() => new URL(process.env.SUPABASE_TEST_URL ?? '').host, 'unset'),
  productionValidation: process.env.PRODUCTION_VALIDATION === '1',
};

// ---- Integration test results (vitest JSON reporter) --------------------------
let tests = { present: false, total: 0, passed: 0, failed: 0, skipped: 0, files: [] };
const integrationJson = join(TEST_RESULTS, 'integration.json');
if (existsSync(integrationJson)) {
  const j = JSON.parse(readFileSync(integrationJson, 'utf8'));
  tests = {
    present: true,
    total: j.numTotalTests ?? 0,
    passed: j.numPassedTests ?? 0,
    failed: j.numFailedTests ?? 0,
    skipped: (j.numPendingTests ?? 0) + (j.numTodoTests ?? 0),
    files: (j.testResults ?? []).map((f) => ({
      name: f.name?.split('/').slice(-1)[0] ?? f.name,
      status: f.status,
      failed: (f.assertionResults ?? []).filter((a) => a.status === 'failed').length,
      skipped: (f.assertionResults ?? []).filter((a) => a.status === 'pending' || a.status === 'skipped').length,
    })),
  };
}

// ---- Migration validation -----------------------------------------------------
const migration = {
  canonicalCaptured: existsSync(join(MIGRATION_LOGS, 'schema.canonical.sql')),
  replayCaptured: existsSync(join(MIGRATION_LOGS, 'schema.replayed.sql')),
  schemaDiff: existsSync(join(MIGRATION_LOGS, 'schema.diff.txt')),
};
migration.ok = migration.canonicalCaptured && migration.replayCaptured && !migration.schemaDiff;

// ---- Privilege assertions -----------------------------------------------------
const privResult = safe(
  () => JSON.parse(readFileSync(join(PRIVILEGES, 'privileges.json'), 'utf8')),
  null,
);
const privileges = {
  present: privResult !== null,
  ok: privResult?.ok === true,
  violations: privResult?.violations ?? [],
  checks: privResult?.checks?.length ?? 0,
};

// ---- Query plans --------------------------------------------------------------
const planFiles = safe(() => readdirSync(PLANS).filter((f) => f.endsWith('.txt')), []);
const planSummary = safe(
  () => JSON.parse(readFileSync(join(PLANS, 'plans.summary.json'), 'utf8')).queries ?? [],
  [],
);
const plans = {
  captured: planFiles.length,
  seqScans: planSummary.filter((q) => q.seqScan).map((q) => q.name),
  failures: planSummary.filter((q) => q.ok === false).map((q) => q.name),
};

// ---- Release gate -------------------------------------------------------------
const gate = {
  testsRun: tests.present,
  zeroFailures: tests.present && tests.failed === 0,
  zeroRequiredSkips: tests.present && tests.skipped === 0,
  migrationsReversible: migration.ok,
  privilegesEnforced: privileges.present && privileges.ok,
  queryPlansCaptured: plans.captured > 0 && plans.failures.length === 0,
};
gate.pass =
  env.productionValidation &&
  gate.testsRun &&
  gate.zeroFailures &&
  gate.zeroRequiredSkips &&
  gate.migrationsReversible &&
  gate.privilegesEnforced &&
  gate.queryPlansCaptured;

const summary = { releaseGate: gate.pass ? 'PASS' : 'FAIL', env, gate, tests, migration, privileges, plans };
writeFileSync(join(ART, 'summary.json'), JSON.stringify(summary, null, 2));

// ---- Human-readable -----------------------------------------------------------
const check = (b) => (b ? '✅' : '❌');
const md = `# Production Validation Report

**Release gate: ${summary.releaseGate}**

- Commit: \`${env.commit}\` (branch \`${env.branch}\`)
- Generated: ${env.generatedAt}
- Node: ${env.node} · Supabase CLI: ${env.supabaseCli} · ${env.psql}
- Target host: \`${env.supabaseUrlHost}\` · PRODUCTION_VALIDATION=${env.productionValidation ? '1' : '0'}

## Gate criteria
| Criterion | Status |
| --- | --- |
| Ran in production-validation mode | ${check(env.productionValidation)} |
| Integration suites executed | ${check(gate.testsRun)} |
| Zero required test failures | ${check(gate.zeroFailures)} |
| Zero required test skips | ${check(gate.zeroRequiredSkips)} |
| Migration rollback + replay reproduces canonical schema | ${check(gate.migrationsReversible)} |
| Privilege matrix enforced (every privileged RPC + infra table) | ${check(gate.privilegesEnforced)} |
| Query plans captured (no EXPLAIN failures) | ${check(gate.queryPlansCaptured)} |

## Integration tests
- Total: ${tests.total} · Passed: ${tests.passed} · Failed: ${tests.failed} · Skipped: ${tests.skipped}

${tests.files.map((f) => `  - ${check(f.status !== 'failed' && f.skipped === 0)} ${f.name} (${f.status}${f.skipped ? `, ${f.skipped} skipped` : ''})`).join('\n') || '  - (no per-file results)'}

## Migration validation
- Canonical schema captured: ${check(migration.canonicalCaptured)}
- Replay captured: ${check(migration.replayCaptured)}
- Schema drift after replay: ${migration.schemaDiff ? '❌ drift detected (see schema.diff.txt)' : '✅ none'}

## Privilege assertions
- Assertions run: ${privileges.checks} · Result: ${privileges.present ? (privileges.ok ? '✅ all enforced' : '❌ violations') : '❌ not run'}
${privileges.violations.length ? privileges.violations.map((v) => `  - ❌ ${v}`).join('\n') : '  - No violations'}

## Performance (query plans)
- Plans captured: ${plans.captured}
- Plans containing a Seq Scan (review): ${plans.seqScans.join(', ') || 'none'}
- EXPLAIN failures: ${plans.failures.join(', ') || 'none'}

---
_This report is generated by \`scripts/validation/report.mjs\`. Performance numbers are the measured plans; no performance claims are hardcoded._
`;
writeFileSync(join(ART, 'summary.md'), md);

console.log(`\nRelease gate: ${summary.releaseGate}`);
console.log(`Report written to ${join(ART, 'summary.md')} and summary.json`);
if (!gate.pass) process.exit(1);
