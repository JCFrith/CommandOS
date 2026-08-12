/**
 * Run-wide fail-fast guard for the production-validation integration suites.
 *
 * Runs ONCE, before any test file, only in validation mode. It proves — by
 * round-trip to the database, never by decoding a key — that the Supabase HTTP
 * clients resolve to the intended Postgres roles:
 *
 *   SUPABASE_TEST_SERVICE_ROLE_KEY -> service_role
 *   SUPABASE_TEST_ANON_KEY         -> anon
 *   the REAL app service adapter   -> service_role   (@/lib/supabase/service)
 *
 * If any client acts as the wrong role, this throws a single clear configuration
 * error and vitest aborts BEFORE running a suite — instead of emitting ~35
 * misleading "permission denied for table …" failures that look like an SQL/RLS
 * bug when the real problem is credential wiring. It prints only role names.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { applyValidationEnv } from './env-map';

async function roleOf(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client.rpc('app_effective_role');
  if (error) {
    if (/app_effective_role|does not exist|not find/i.test(error.message)) {
      throw new Error(
        'app_effective_role() is missing on the target DB — apply supabase/validation/reset.sql before ' +
          `the integration suites (validate:production does this automatically). Underlying: ${error.message}`,
      );
    }
    return null; // e.g. an anon client denied EXECUTE — still proves it is not service_role.
  }
  return (data?.db_role as string | undefined) ?? null;
}

export default async function setup(): Promise<void> {
  if (process.env.PRODUCTION_VALIDATION !== '1') return;

  const { url, serviceKey, anonKey } = applyValidationEnv();
  const raw = (key: string) =>
    createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // The clients the suites actually use (helpers.testDb / helpers.anonDb) …
  const serviceRole = await roleOf(raw(serviceKey));
  const anonRole = await roleOf(raw(anonKey));
  // … and the REAL production adapter (reads the mapped app vars via @/lib/env),
  // which is what the repository singletons run every query through.
  const { serviceClient } = await import('@/lib/supabase/service');
  const appServiceRole = await roleOf(serviceClient());

  const problems: string[] = [];
  if (serviceRole !== 'service_role')
    problems.push(
      `SUPABASE_TEST_SERVICE_ROLE_KEY resolves to '${serviceRole}' (want 'service_role')`,
    );
  if (anonRole !== 'anon')
    problems.push(`SUPABASE_TEST_ANON_KEY resolves to '${anonRole}' (want 'anon')`);
  if (appServiceRole !== 'service_role')
    problems.push(
      `the app service adapter (@/lib/supabase/service) resolves to '${appServiceRole}' (want 'service_role')`,
    );

  if (problems.length) {
    const swapped = serviceRole === 'anon' && anonRole === 'service_role';
    const hint = swapped
      ? 'ROOT CAUSE: the service-role and anon keys are SWAPPED between SUPABASE_TEST_SERVICE_ROLE_KEY and SUPABASE_TEST_ANON_KEY — exchange the two values.'
      : 'ROOT CAUSE: a Supabase key is in the wrong SUPABASE_TEST_* slot (or is a wrong-format/other-project key). This is credential wiring — no SQL/RLS/privilege change is warranted.';
    throw new Error(
      `Client-role preflight FAILED — aborting before the DB suites to avoid misleading permission errors.\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        `\n  ${hint}`,
    );
  }

  console.log(
    '✓ client-role preflight: service_role, anon, and app service adapter all resolve to the intended roles.',
  );
}
