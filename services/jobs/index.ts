import { isSupabasePersistenceEnabled } from '@/lib/env';
import { signalPublisher } from '@/lib/signals';
import type { LeasedJobStore } from '@/lib/platform/background';
import { InMemoryLeasedJobStore } from './in-memory-job-store';
import { LeasedBackgroundWorker } from './worker';
// Type-only (erased) so the server-only adapter stays out of the dev bundle.
import type * as SupabaseJobStoreModule from './supabase-job-store';

/**
 * The wired durable-execution singletons.
 *
 * Binding is gated by {@link isSupabasePersistenceEnabled}: the production
 * Postgres-backed store is used ONLY when Supabase persistence is explicitly
 * enabled; otherwise the development in-memory leased store is used (identical
 * interface, per-realm — TD-09). This keeps `next dev`, tests, and unconfigured
 * environments behaving exactly as before. The store is pinned to `globalThis`
 * within a realm like the other dev stores.
 */
const globalForJobs = globalThis as typeof globalThis & {
  __jobStore?: LeasedJobStore;
};

function buildStore(): LeasedJobStore {
  if (isSupabasePersistenceEnabled()) {
    // Lazily require the server-only Supabase adapter only when enabled, so the
    // in-memory/dev path never pulls `server-only` into non-server bundles.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./supabase-job-store') as typeof SupabaseJobStoreModule;
    return new mod.SupabaseLeasedJobStore();
  }
  return new InMemoryLeasedJobStore({
    id: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  });
}

export const jobStore: LeasedJobStore = globalForJobs.__jobStore ?? buildStore();
globalForJobs.__jobStore = jobStore;

/** The shared stateless worker (driven by the cron endpoint). */
export const backgroundWorker = new LeasedBackgroundWorker(jobStore, {
  id: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
  workerId: `worker-${process.env.VERCEL_REGION ?? 'local'}`,
  leaseMs: 60_000,
  batchSize: 20,
  publisher: signalPublisher,
});
