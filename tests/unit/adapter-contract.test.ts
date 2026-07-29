import { describe, it } from 'vitest';

import { InMemoryLeasedJobStore } from '@/services/jobs/in-memory-job-store';
import { describeJobStoreContract } from './support/job-store-contract';

/**
 * Adapter contract tests — the SAME contract runs against every implementation.
 *
 * The in-memory store runs here (deterministically). The production Supabase
 * store must pass the identical contract against a real Postgres; that run is
 * gated on `SUPABASE_TEST_URL` (a local `supabase start` or a test project) and
 * is skipped in environments without a database — see docs/database.md. The
 * server-only Supabase adapter is imported lazily only inside the gated block so
 * it never loads in the dev/test bundle.
 */

let counter = 0;
describeJobStoreContract(
  'InMemory',
  () =>
    new InMemoryLeasedJobStore({
      id: () => `job-${++counter}`,
      now: () => new Date().toISOString(),
    }),
);

const SUPABASE_TEST_URL = process.env.SUPABASE_TEST_URL;
describe.skipIf(!SUPABASE_TEST_URL)('LeasedJobStore contract — Supabase (live DB)', () => {
  it('runs the shared contract against Postgres when SUPABASE_TEST_URL is set', async () => {
    const { SupabaseLeasedJobStore } = await import('@/services/jobs/supabase-job-store');
    describeJobStoreContract('Supabase', () => new SupabaseLeasedJobStore());
  });
});
