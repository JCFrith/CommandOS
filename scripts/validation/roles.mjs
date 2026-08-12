#!/usr/bin/env node
/**
 * Client-role diagnostic (`npm run db:verify:roles`).
 *
 * Proves — by ROUND-TRIP, never by decoding a key — that each Supabase HTTP
 * client the integration suites construct resolves to the intended Postgres role:
 *
 *   SUPABASE_TEST_SERVICE_ROLE_KEY -> service_role   (bypasses RLS)
 *   SUPABASE_TEST_ANON_KEY         -> anon
 *   a signed-in user JWT           -> authenticated
 *
 * Why this exists: the SQL privilege model can be provably correct (grants,
 * RLS, 355 assertions all green) while the HTTP clients still act as the WRONG
 * role — because a key was pasted into the wrong TEST_* slot, the service and
 * anon keys were swapped, or a new-format sb_publishable_/sb_secret_ key was
 * used where a legacy key was expected. String heuristics (e.g. /anon/) cannot
 * catch that; only asking the database "who am I?" can. This runs BEFORE the
 * destructive validation chain so a misconfiguration fails fast with one clear
 * message instead of ~35 misleading "permission denied" test failures.
 *
 * It prints ONLY role names and pass/fail. It never prints keys, JWTs,
 * Authorization headers, or any environment value.
 */
import { createClient } from '@supabase/supabase-js';

const fail = (msg) => {
  console.error(`\n✗ role diagnostic FAILED: ${msg}`);
  process.exit(1);
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

const url = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;

if (!url) fail('SUPABASE_TEST_URL is required.');
if (!serviceKey) fail('SUPABASE_TEST_SERVICE_ROLE_KEY is required.');
if (!anonKey)
  fail('SUPABASE_TEST_ANON_KEY is required to prove the anon role (RLS suites need it too).');

/** Ask the DB, as this client, what role it actually resolves to. */
async function effectiveRole(client, label) {
  const { data, error } = await client.rpc('app_effective_role');
  if (error) {
    // A missing function means the validation helpers were not applied yet.
    if (/app_effective_role|does not exist|not find/i.test(error.message)) {
      fail(
        `app_effective_role() is not present on the target DB — apply supabase/validation/reset.sql first ` +
          `(the validate:production chain does this automatically). Underlying: ${error.message}`,
      );
    }
    // Any other error IS a signal: e.g. an anon client denied EXECUTE still tells
    // us it is not service_role. Surface it rather than masking it.
    return { role: null, error: error.message, label };
  }
  return { role: data?.db_role ?? null, jwtRole: data?.jwt_role ?? null, label };
}

const raw = (v) => createClient(url, v, { auth: { persistSession: false, autoRefreshToken: false } });

// --- service_role -----------------------------------------------------------
const service = await effectiveRole(raw(serviceKey), 'service');
// --- anon -------------------------------------------------------------------
const anon = await effectiveRole(raw(anonKey), 'anon');

console.log('Effective roles (authoritative = current_user):');
console.log(`  SUPABASE_TEST_SERVICE_ROLE_KEY -> ${service.role ?? `<error: ${service.error}>`}`);
console.log(`  SUPABASE_TEST_ANON_KEY         -> ${anon.role ?? `<error: ${anon.error}>`}`);

const serviceOk = service.role === 'service_role';
const anonOk = anon.role === 'anon';

if (!serviceOk || !anonOk) {
  // Pinpoint the credential-mapping root cause without ever revealing a key.
  const swapped = service.role === 'anon' && anon.role === 'service_role';
  let cause;
  if (swapped) {
    cause =
      'the service-role and anon keys are SWAPPED: SUPABASE_TEST_SERVICE_ROLE_KEY carries the anon key ' +
      'and SUPABASE_TEST_ANON_KEY carries the service key. Exchange the two values.';
  } else if (!serviceOk && service.role) {
    cause =
      `SUPABASE_TEST_SERVICE_ROLE_KEY resolves to '${service.role}', not 'service_role' — a non-service ` +
      '(anon/publishable) key is in the service slot. Use the project\'s service_role (or sb_secret_) key.';
  } else if (!anonOk && anon.role) {
    cause =
      `SUPABASE_TEST_ANON_KEY resolves to '${anon.role}', not 'anon' — the wrong key is in the anon slot. ` +
      'Use the project\'s anon (or sb_publishable_) key.';
  } else {
    cause =
      'a client could not resolve its role (see the error above) — the key is invalid for this project ' +
      'or lacks EXECUTE on the diagnostic.';
  }
  fail(
    `client role(s) wrong — service='${service.role}' (want service_role), anon='${anon.role}' (want anon).\n` +
      `  Root cause: ${cause}\n` +
      '  No SQL/RLS/privilege change is warranted — this is a credential-wiring problem.',
  );
}
ok('service-role client resolves to service_role');
ok('anon client resolves to anon');

// --- authenticated (best effort) --------------------------------------------
// Proven with a real, throwaway GoTrue user so it is correct regardless of the
// project's JWT signing scheme (hosted projects may sign asymmetrically, which
// rejects hand-minted HS256 tokens). If GoTrue signups are disabled this is a
// SKIP (not the reported failure surface), never a false PASS.
const admin = raw(serviceKey);
const email = 'role-diagnostic@validation.local';
const password = 'role-diagnostic-passw0rd!';
try {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list?.users?.find((u) => u.email === email);
  if (existing) await admin.auth.admin.deleteUser(existing.id);
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created?.user) throw new Error(createErr?.message ?? 'no user returned');

  const userClient = raw(anonKey);
  const { error: signInErr } = await userClient.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(signInErr.message);

  const authed = await effectiveRole(userClient, 'authenticated');
  console.log(`  signed-in user JWT             -> ${authed.role ?? `<error: ${authed.error}>`}`);
  await admin.auth.admin.deleteUser(created.user.id);

  if (authed.role !== 'authenticated') {
    fail(
      `a signed-in user JWT resolves to '${authed.role}', not 'authenticated' — the anon key used to ` +
        'establish the session is not really the anon key. Check SUPABASE_TEST_ANON_KEY.',
    );
  }
  ok('signed-in user client resolves to authenticated');
} catch (e) {
  console.log(
    `  authenticated-role check SKIPPED (could not establish a GoTrue session: ${e.message}).\n` +
      '    Not the reported failure surface (service vs anon); service_role + anon are proven above.',
  );
}

console.log('\n✓ client role diagnostic PASSED — service_role, anon (and authenticated) correctly wired.');
