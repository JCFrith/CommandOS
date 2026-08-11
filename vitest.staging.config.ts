import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * LIVE Vercel staging-smoke config. Runs ONLY `tests/staging/**` — the smoke that
 * drives the DEPLOYED worker route against the staging database. Deliberately
 * SEPARATE from `vitest.integration.config.ts` so the smoke is never part of
 * `validate:production` (and so a skipped smoke never counts against the release
 * gate's "zero required skips").
 *
 * It reuses the integration setup: `setup.ts` maps SUPABASE_TEST_* → app vars
 * (so the repositories bind to Supabase) and `global-setup.ts` proves the client
 * roles before anything runs. `server-only` is shimmed so the adapters load in Node.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      'server-only': fileURLToPath(
        new URL('./tests/integration/server-only-shim.js', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/staging/**/*.test.ts'],
    globalSetup: ['tests/integration/global-setup.ts'],
    setupFiles: ['tests/integration/setup.ts'],
    hookTimeout: 120_000,
    testTimeout: 120_000,
    // Sequential: the smoke seeds + resets shared staging DB state and drives a
    // single live worker; parallel files would race on the database.
    fileParallelism: false,
  },
});
