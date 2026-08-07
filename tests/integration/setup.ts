/**
 * Integration setup — FAIL CLOSED.
 *
 * When `PRODUCTION_VALIDATION=1`, a missing database is a hard error (not a skip):
 * the gated suites must never silently pass without a real Postgres. It also wires
 * the app's runtime env to the VALIDATION project + enables the durable path, so
 * every repository binding resolves to its Supabase adapter (asserted per-suite).
 */
import Module from 'node:module';

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

  // The production singletons bind their server-only adapters via a lazy
  // `require('@/...')` (keeps `server-only` out of the client bundle). Under
  // vitest, vite-node leaves `require()` Node-native, which resolves neither the
  // `@` alias nor `.ts` — so every gated require fails (5 builders swallow it and
  // fall back to in-memory; the job store throws). In real Next.js the require
  // resolves. To exercise the true production bindings here, preload each gated
  // module via ESM import (which vite-node DOES resolve) and intercept the
  // matching `require()` specifiers to return the real module. Validation-mode
  // only; other requires are untouched.
  const preloaded = new Map<string, unknown>([
    ['@/lib/env', await import('@/lib/env')],
    [
      '@/services/operations/supabase-operations-repository',
      await import('@/services/operations/supabase-operations-repository'),
    ],
    [
      '@/services/agents/supabase-agent-repository',
      await import('@/services/agents/supabase-agent-repository'),
    ],
    [
      '@/services/workflows/supabase-workflow-repository',
      await import('@/services/workflows/supabase-workflow-repository'),
    ],
    [
      // The workflow service singleton lazily binds its durable approval resumer
      // via `require('@/services/workflows/supabase-durable-trigger-port')`
      // (server-only, kept out of the client bundle). vite-node's native
      // `require()` cannot resolve the `@` alias or `.ts`, so this specifier MUST
      // be intercepted here like the other server-only adapters — omitting it is
      // what made services/workflows/index.ts throw "Cannot find module" in the
      // durable-resume / durable-triggers integration suites.
      '@/services/workflows/supabase-durable-trigger-port',
      await import('@/services/workflows/supabase-durable-trigger-port'),
    ],
    [
      '@/services/ai/supabase-execution-logger',
      await import('@/services/ai/supabase-execution-logger'),
    ],
    [
      '@/services/signals/supabase-signal-event-store',
      await import('@/services/signals/supabase-signal-event-store'),
    ],
    ['@/services/jobs/supabase-job-store', await import('@/services/jobs/supabase-job-store')],
    [
      '@/services/workspaces/supabase-workspace-repository',
      await import('@/services/workspaces/supabase-workspace-repository'),
    ],
  ]);
  const loader = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = loader._load;
  loader._load = function (request: string, parent: unknown, isMain: boolean): unknown {
    if (preloaded.has(request)) return preloaded.get(request);
    return originalLoad.call(this, request, parent, isMain);
  };
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
