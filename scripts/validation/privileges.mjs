#!/usr/bin/env node
// SQL privilege + RLS assertions for production validation. Verifies the FINAL,
// replayed security state at BOTH layers — explicit grants AND row-level security —
// against an explicit expected model. This catches the Defect-2 class (a broad or
// default GRANT re-opening a server-only object to a browser role, or a missing
// GRANT leaving service_role unable to reach an object) AND enforces defense in
// depth: browser roles are denied at the grant layer even before RLS is considered.
//
// It asks Postgres directly (has_function_privilege / has_table_privilege /
// pg_class.relrowsecurity / pg_policies / pg_trigger), so it accounts for
// PUBLIC-inherited grants and reflects the live catalog. Fail-closed: any missing
// object, unknown role, or violation exits non-zero and writes a JSON artifact.
//
// Layers asserted (all required — grant assertions are NOT replaced by RLS ones):
//   1. Function EXECUTE matrix   — server-only RPCs are service_role-only.
//   2. Table GRANT matrix         — browser roles denied writes (+ infra reads).
//   3. RLS structure              — RLS on every app table; infra has no policies;
//                                   tenant has only workspace-scoped SELECT policies;
//                                   append-only tables keep their forbid triggers.
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

// Server-only SECURITY DEFINER RPCs: ONLY service_role may EXECUTE. Signatures must
// match the CREATE signatures exactly so has_function_privilege resolves the overload.
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

// app_is_member runs INSIDE RLS policies as the querying role, so anon +
// authenticated legitimately need EXECUTE. Asserted as a positive control.
const POLICY_HELPER = 'app_is_member(uuid)';

// Infrastructure tables: service-role-only. RLS enabled, NO policies; browser roles
// have NO grant at all (nor read).
const INFRA_TABLES = [
  'jobs',
  'trigger_claims',
  'schedule_occurrences',
  'signal_subscriptions',
  'trigger_scan_cursor',
];
// Tenant tables: RLS enabled with a workspace-scoped SELECT policy; authenticated
// may SELECT (RLS-filtered) but never write; anon gets nothing.
const TENANT_TABLES = [
  'workspaces',
  'workspace_members',
  'operations',
  'operation_activity',
  'agents',
  'agent_activity',
  'agent_executions',
  'execution_logs',
  'workflows',
  'workflow_versions',
  'workflow_runs',
  'workflow_step_runs',
  'workflow_approvals',
  'workflow_timers',
  'signals',
  'signal_events',
];
const ALL_APP_TABLES = [...INFRA_TABLES, ...TENANT_TABLES];
// Append-only tables carry a forbid-mutation trigger (UPDATE/DELETE rejected, even
// for service_role); workflow_versions is immutable (forbid-update).
const APPEND_ONLY_TABLES = [
  'signals',
  'signal_events',
  'workflow_step_runs',
  'execution_logs',
  'trigger_claims',
  'schedule_occurrences',
  'operation_activity',
  'agent_activity',
  'workflow_versions',
];

function psqlRows(sql) {
  const out = execFileSync(
    'psql',
    [DB_URL, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-F', '|', '-c', sql],
    { encoding: 'utf8' },
  );
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
      `${name} — ${role} ${priv}: expected ${expected ? 'ALLOWED/PRESENT' : 'DENIED/ABSENT'}, got ${actual ? 'ALLOWED/PRESENT' : 'DENIED/ABSENT'}`,
    );
  }
}
const sqlList = (xs) => xs.map((x) => `('${x}')`).join(',');

try {
  // ---- 1. Function EXECUTE matrix --------------------------------------------
  const fnSql =
    `select r.role, f.sig, has_function_privilege(r.role, f.sig, 'EXECUTE') from ` +
    `(values ${sqlList(ROLES)}) r(role), ` +
    `(values ${[...SERVER_ONLY_FUNCTIONS, POLICY_HELPER].map((s) => `('${s.replace(/'/g, "''")}')`).join(',')}) f(sig);`;
  for (const [role, sig, has] of psqlRows(fnSql)) {
    const allowed = has === 't';
    if (sig === POLICY_HELPER) record(`fn:${sig}`, role, 'EXECUTE', allowed, true);
    else record(`fn:${sig}`, role, 'EXECUTE', allowed, role === 'service_role');
  }

  // ---- 2. Table GRANT matrix -------------------------------------------------
  // Writes (INSERT/UPDATE/DELETE): only service_role, on every app table.
  const writeSql =
    `select r.role, t.tbl, p.priv, has_table_privilege(r.role, t.tbl, p.priv) from ` +
    `(values ${sqlList(ROLES)}) r(role), ` +
    `(values ${sqlList(ALL_APP_TABLES)}) t(tbl), ` +
    `(values ('INSERT'),('UPDATE'),('DELETE')) p(priv);`;
  for (const [role, tbl, priv, has] of psqlRows(writeSql)) {
    record(`table:${tbl}`, role, priv, has === 't', role === 'service_role');
  }
  // SELECT: infra → only service_role; tenant → service_role + authenticated (RLS-filtered), never anon.
  const selSql =
    `select r.role, t.tbl, has_table_privilege(r.role, t.tbl, 'SELECT') from ` +
    `(values ${sqlList(ROLES)}) r(role), ` +
    `(values ${sqlList(ALL_APP_TABLES)}) t(tbl);`;
  for (const [role, tbl, has] of psqlRows(selSql)) {
    const isInfra = INFRA_TABLES.includes(tbl);
    const expected = role === 'service_role' || (!isInfra && role === 'authenticated');
    record(`table:${tbl}`, role, 'SELECT', has === 't', expected);
  }

  // ---- 3. RLS structure ------------------------------------------------------
  const rlsSql =
    `select c.relname, c.relrowsecurity::int, ` +
    `(select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname), ` +
    `(select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname and p.cmd <> 'SELECT') ` +
    `from pg_class c join pg_namespace n on n.oid=c.relnamespace ` +
    `where n.nspname='public' and c.relkind='r' and c.relname in (${ALL_APP_TABLES.map((t) => `'${t}'`).join(',')});`;
  const seenTables = new Set();
  for (const [relname, rls, npol, nwrite] of psqlRows(rlsSql)) {
    seenTables.add(relname);
    record(`rls:${relname}`, 'table', 'ROW_SECURITY', rls === '1', true);
    if (INFRA_TABLES.includes(relname)) {
      // Infra: no policies at all (RLS with no policy denies every row to non-bypass roles).
      record(`policies:${relname}`, 'table', 'NO_POLICIES', npol === '0', true);
    } else {
      // Tenant: at least one policy, and every policy is SELECT-only (no write policies).
      record(`policies:${relname}`, 'table', 'HAS_POLICY', Number(npol) >= 1, true);
      record(`policies:${relname}`, 'table', 'NO_WRITE_POLICY', nwrite === '0', true);
    }
  }
  for (const t of ALL_APP_TABLES) {
    if (!seenTables.has(t)) record(`rls:${t}`, 'table', 'TABLE_EXISTS', false, true);
  }

  // Append-only / immutable behaviour: the forbid trigger must be present.
  const trigSql =
    `select c.relname, count(*) from pg_trigger t ` +
    `join pg_class c on c.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid ` +
    `where not t.tgisinternal and p.proname in ('app_forbid_mutation','app_forbid_update') ` +
    `and c.relname in (${APPEND_ONLY_TABLES.map((t) => `'${t}'`).join(',')}) group by c.relname;`;
  const withTrigger = new Map(psqlRows(trigSql).map(([r, c]) => [r, Number(c)]));
  for (const t of APPEND_ONLY_TABLES) {
    record(`append-only:${t}`, 'table', 'FORBID_TRIGGER', (withTrigger.get(t) ?? 0) >= 1, true);
  }
} catch (err) {
  console.error(
    `FAIL: privilege/RLS probe errored (missing object or unknown role?): ${err instanceof Error ? err.message : String(err)}`,
  );
  writeFileSync(
    join(ART, 'privileges.json'),
    JSON.stringify({ ok: false, error: String(err), checks }, null, 2),
  );
  process.exit(1);
}

const ok = violations.length === 0;
writeFileSync(join(ART, 'privileges.json'), JSON.stringify({ ok, violations, checks }, null, 2));

if (!ok) {
  console.error(`\n✗ privilege/RLS validation FAILED — ${violations.length} violation(s):`);
  for (const v of violations) console.error(`  - ${v}`);
  console.error(
    '\nThe replayed security state is wrong. Do NOT weaken RLS/grants to pass — fix the migration.',
  );
  process.exit(1);
}
console.log(
  `✓ privilege/RLS validation PASSED — ${checks.length} assertions (grants + function matrix + RLS structure) across ${ROLES.length} roles.`,
);
