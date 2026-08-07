#!/usr/bin/env node
// SQL privilege assertions for production validation. Verifies the FINAL, replayed
// privilege state of every privileged RPC and every infrastructure table against
// an explicit expected matrix — catching exactly the Defect-2 class of failure
// (a broad/default GRANT re-opening a server-only object to a browser role, or a
// missing GRANT leaving service_role unable to reach an object).
//
// It asks Postgres directly with has_function_privilege / has_table_privilege, so
// it accounts for PUBLIC-inherited grants (the usual leak): if `anon` lacks a
// privilege, PUBLIC cannot be granting it either. Fail-closed: any missing object,
// unknown role, or matrix violation exits non-zero and writes a JSON artifact.
//
//   node scripts/validation/privileges.mjs   # asserts the live SUPABASE_TEST_DB_URL
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ART = join(resolve(process.cwd()), 'artifacts', 'production-validation', 'privileges');
mkdirSync(ART, { recursive: true });

const DB_URL = process.env.SUPABASE_TEST_DB_URL;
if (!DB_URL) {
  console.error('FAIL: SUPABASE_TEST_DB_URL is required for privilege validation (fail-closed).');
  process.exit(1);
}

const ROLES = ['anon', 'authenticated', 'service_role'];

// Server-only SECURITY DEFINER RPCs: ONLY service_role may EXECUTE. `anon` and
// `authenticated` (and therefore PUBLIC) must not. Signatures must match the
// CREATE signatures exactly so has_function_privilege resolves the right overload.
const SERVER_ONLY_FUNCTIONS = [
  'app_provision_personal_workspace(uuid, text)',
  'claim_jobs(text, int, timestamptz, int)',
  'app_claim_trigger_run(uuid, text, uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, text, timestamptz)',
  'app_advance_trigger_cursor(uuid, timestamptz, uuid, timestamptz)',
  'app_reset_trigger_cursor(uuid)',
  'app_scan_signals_after(uuid, timestamptz, uuid, int)',
  'app_claim_schedule_run(uuid, uuid, text, uuid, uuid, uuid, jsonb, jsonb, uuid, text, timestamptz)',
  'app_claim_due_timers(timestamptz, int, text)',
  'app_claim_approval_resume(uuid, uuid, uuid, text, timestamptz)',
  'app_claim_due_approval_resumes(timestamptz, int, text)',
  'app_durable_health(timestamptz)',
];

// app_is_member is invoked INSIDE RLS policies as the querying role, so
// authenticated (and anon, for the anon-sees-nothing path) legitimately need
// EXECUTE. Asserted as an explicit positive control so a future "lock everything"
// change that breaks RLS is caught here rather than as opaque empty query results.
const POLICY_HELPER = 'app_is_member(uuid)';

// Infrastructure tables: browser roles get NO write (and no read); service_role
// gets full DML. RLS is a second layer — this checks the GRANT layer beneath it.
const INFRA_TABLES = ['jobs', 'trigger_claims', 'schedule_occurrences', 'signal_subscriptions', 'trigger_scan_cursor'];
// Tenant tables authenticated may SELECT (RLS-filtered) but never directly write.
const TENANT_NO_WRITE = ['operations', 'workflows', 'workflow_runs'];

function psqlRows(sql) {
  const out = execFileSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-F', '|', '-c', sql], {
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split('|'));
}

const violations = [];
const checks = [];
function record(name, role, priv, actual, expected) {
  const ok = actual === expected;
  checks.push({ name, role, priv, expected, actual, ok });
  if (!ok) {
    violations.push(
      `${name} — role ${role} ${priv}: expected ${expected ? 'ALLOWED' : 'DENIED'}, got ${actual ? 'ALLOWED' : 'DENIED'}`,
    );
  }
}

try {
  // ---- Function EXECUTE matrix ------------------------------------------------
  const fnSql =
    `select r.role, f.sig, has_function_privilege(r.role, f.sig, 'EXECUTE') from ` +
    `(values ${ROLES.map((r) => `('${r}')`).join(',')}) r(role), ` +
    `(values ${[...SERVER_ONLY_FUNCTIONS, POLICY_HELPER].map((s) => `('${s.replace(/'/g, "''")}')`).join(',')}) f(sig);`;
  for (const [role, sig, has] of psqlRows(fnSql)) {
    const allowed = has === 't';
    if (sig === POLICY_HELPER) {
      // authenticated + anon must retain EXECUTE (RLS policy needs it); service_role too.
      record(`fn:${sig}`, role, 'EXECUTE', allowed, true);
    } else {
      record(`fn:${sig}`, role, 'EXECUTE', allowed, role === 'service_role');
    }
  }

  // ---- Table privilege matrix -------------------------------------------------
  const tableSql =
    `select r.role, t.tbl, p.priv, has_table_privilege(r.role, t.tbl, p.priv) from ` +
    `(values ${ROLES.map((r) => `('${r}')`).join(',')}) r(role), ` +
    `(values ${[...INFRA_TABLES, ...TENANT_NO_WRITE].map((t) => `('${t}')`).join(',')}) t(tbl), ` +
    `(values ('INSERT'),('UPDATE'),('DELETE')) p(priv);`;
  for (const [role, tbl, priv, has] of psqlRows(tableSql)) {
    const allowed = has === 't';
    // service_role writes everywhere; anon/authenticated write nowhere (infra or tenant).
    record(`table:${tbl}`, role, priv, allowed, role === 'service_role');
  }

  // ---- Infra tables: browser roles cannot even SELECT -------------------------
  const infraSelectSql =
    `select r.role, t.tbl, has_table_privilege(r.role, t.tbl, 'SELECT') from ` +
    `(values ('anon'),('authenticated')) r(role), ` +
    `(values ${INFRA_TABLES.map((t) => `('${t}')`).join(',')}) t(tbl);`;
  for (const [role, tbl, has] of psqlRows(infraSelectSql)) {
    record(`table:${tbl}`, role, 'SELECT', has === 't', false);
  }
} catch (err) {
  console.error(`FAIL: privilege probe errored (missing object or unknown role?): ${err instanceof Error ? err.message : String(err)}`);
  writeFileSync(join(ART, 'privileges.json'), JSON.stringify({ ok: false, error: String(err), checks }, null, 2));
  process.exit(1);
}

const ok = violations.length === 0;
writeFileSync(join(ART, 'privileges.json'), JSON.stringify({ ok, violations, checks }, null, 2));

if (!ok) {
  console.error(`\n✗ privilege validation FAILED — ${violations.length} violation(s):`);
  for (const v of violations) console.error(`  - ${v}`);
  console.error('\nThe replayed grant state is wrong. Do NOT weaken RLS/grants to pass — fix the migration privilege block.');
  process.exit(1);
}
console.log(`✓ privilege validation PASSED — ${checks.length} grant assertions across ${ROLES.length} roles.`);
