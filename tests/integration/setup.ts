/**
 * Integration setup — FAIL CLOSED.
 *
 * When `PRODUCTION_VALIDATION=1`, a missing database is a hard error (not a skip):
 * the gated suites must never silently pass without a real Postgres. It also wires
 * the app's runtime env to the VALIDATION project + enables the durable path, so
 * every repository binding resolves to its Supabase adapter (asserted per-suite).
 */
const validating = process.env.PRODUCTION_VALIDATION === '1';

if (validating) {
  const url = process.env.SUPABASE_TEST_URL;
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'PRODUCTION_VALIDATION=1 but SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_ROLE_KEY are missing — failing closed (gated DB tests must not be skipped).',
    );
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY ?? 'anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
  process.env.USE_SUPABASE_PERSISTENCE = '1';
}

/** Whether we are in live production-validation mode (real DB present). */
export const PRODUCTION_VALIDATION = validating;

/**
 * Skip guard for the gated suites. In validation mode a missing DB has already
 * thrown above, so this only skips during ordinary `npm test` (in-memory) runs —
 * where these files are NOT included by the default config anyway. Used so a
 * developer can run an integration file directly without a DB and get a clean
 * skip, while validation mode never skips.
 */
export const requiresDatabase = !validating;
