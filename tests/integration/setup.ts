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
  // Install the `require()` interception FIRST, over an initially-empty map, then
  // populate the map incrementally. ORDER IS LOad-BEARING: some server-only
  // singletons run `require('@/lib/env')` / `require('@/services/.../supabase-*')`
  // at MODULE-EVAL time (e.g. `buildWorkflowRepository` in
  // in-memory-workflow-repository, which the durable trigger port imports). If the
  // map were fully built before the hook were installed — as it was — that
  // eval-time require would throw and the singleton would silently pin itself to
  // the empty InMemoryWorkflowRepository, so discovery reads an empty store
  // (durable-triggers `initializedWorkspaces=0`) and assertSupabaseBindings fails
  // (production-smoke `beforeAll`). Registering `@/lib/env` and the Supabase
  // workflow repository BEFORE importing the durable port makes that singleton's
  // eval bind Supabase correctly.
  const preloaded = new Map<string, unknown>();
  const loader = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = loader._load;
  loader._load = function (request: string, parent: unknown, isMain: boolean): unknown {
    if (preloaded.has(request)) return preloaded.get(request);
    return originalLoad.call(this, request, parent, isMain);
  };
  // env first (eval-time requires resolve it), then the Supabase workflow repo
  // BEFORE the durable trigger port (whose import evaluates the workflow-repo
  // singleton), then the remaining server-only adapters.
  preloaded.set('@/lib/env', await import('@/lib/env'));
  preloaded.set(
    '@/services/operations/supabase-operations-repository',
    await import('@/services/operations/supabase-operations-repository'),
  );
  preloaded.set(
    '@/services/agents/supabase-agent-repository',
    await import('@/services/agents/supabase-agent-repository'),
  );
  preloaded.set(
    '@/services/workflows/supabase-workflow-repository',
    await import('@/services/workflows/supabase-workflow-repository'),
  );
  // The workflow service singleton lazily binds its durable approval resumer via
  // `require('@/services/workflows/supabase-durable-trigger-port')` (server-only,
  // kept out of the client bundle). vite-node's native `require()` cannot resolve
  // the `@` alias or `.ts`, so this specifier MUST be intercepted like the other
  // server-only adapters — omitting it made services/workflows/index.ts throw
  // "Cannot find module" in the durable-resume / durable-triggers suites. Importing
  // it evaluates the workflow-repo singleton, so `@/lib/env` and the Supabase
  // workflow repository above MUST already be registered.
  preloaded.set(
    '@/services/workflows/supabase-durable-trigger-port',
    await import('@/services/workflows/supabase-durable-trigger-port'),
  );
  preloaded.set(
    '@/services/ai/supabase-execution-logger',
    await import('@/services/ai/supabase-execution-logger'),
  );
  preloaded.set(
    '@/services/signals/supabase-signal-event-store',
    await import('@/services/signals/supabase-signal-event-store'),
  );
  preloaded.set(
    '@/services/jobs/supabase-job-store',
    await import('@/services/jobs/supabase-job-store'),
  );
  preloaded.set(
    '@/services/workspaces/supabase-workspace-repository',
    await import('@/services/workspaces/supabase-workspace-repository'),
  );
  // The jobs singleton (services/jobs/index.ts) lazily requires the Sprint 7
  // durable job handlers via `require('@/services/jobs/workflow-durable')` to
  // register them on the worker. Same vite-node alias problem — intercept it too.
  // Registered LAST: it transitively imports @/services/workflows (the workflow
  // singleton + durable port), so those specifiers must already be in the map.
  preloaded.set(
    '@/services/jobs/workflow-durable',
    await import('@/services/jobs/workflow-durable'),
  );
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
