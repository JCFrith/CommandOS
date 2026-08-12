/**
 * Single source of truth for mapping the VALIDATION credentials
 * (`SUPABASE_TEST_*`) onto the exact runtime variables the real app adapters
 * consume (`@/lib/env`). Both the per-worker setup file and the run-wide global
 * setup call this so the mapping can never drift between the two and so the
 * production adapters are exercised with the intended real credentials.
 *
 * The mapping the app depends on (see `@/lib/env`):
 *   service client (lib/supabase/service.ts):
 *     NEXT_PUBLIC_SUPABASE_URL      <- SUPABASE_TEST_URL
 *     SUPABASE_SERVICE_ROLE_KEY     <- SUPABASE_TEST_SERVICE_ROLE_KEY
 *   public/anon client (lib/supabase/client|server.ts):
 *     NEXT_PUBLIC_SUPABASE_URL      <- SUPABASE_TEST_URL
 *     NEXT_PUBLIC_SUPABASE_ANON_KEY <- SUPABASE_TEST_ANON_KEY
 */
export function applyValidationEnv(): { url: string; serviceKey: string; anonKey: string } {
  const url = process.env.SUPABASE_TEST_URL;
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'PRODUCTION_VALIDATION=1 but SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_ROLE_KEY are missing — ' +
        'failing closed (gated DB tests must not be skipped).',
    );
  }
  const anonKey = process.env.SUPABASE_TEST_ANON_KEY ?? 'anon-key';
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
  process.env.USE_SUPABASE_PERSISTENCE = '1';
  return { url, serviceKey, anonKey };
}
