import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Production-validation vitest config. Runs the gated integration suites under
 * `tests/integration/` against a REAL Supabase/Postgres (never in-memory). The
 * setup file (`tests/integration/setup.ts`) FAILS CLOSED when
 * `PRODUCTION_VALIDATION=1` but the database env is absent, so a missing DB is a
 * hard failure — the gated tests are never silently skipped in validation mode.
 * `server-only` is aliased to a no-op so the server-only adapters load in Node.
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
    include: ['tests/integration/**/*.test.ts'],
    // Run-wide credential/role preflight: in validation mode it proves each
    // Supabase client resolves to its intended Postgres role and aborts the whole
    // run with one clear error if not (instead of ~35 misleading permission
    // failures). No-op outside PRODUCTION_VALIDATION.
    globalSetup: ['tests/integration/global-setup.ts'],
    setupFiles: ['tests/integration/setup.ts'],
    hookTimeout: 120_000,
    testTimeout: 120_000,
    // Integration suites touch shared DB state — run files serially.
    fileParallelism: false,
  },
});
