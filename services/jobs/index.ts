import { isSupabasePersistenceEnabled } from '@/lib/env';
import { signalPublisher } from '@/lib/signals';
import type { LeasedJobStore } from '@/lib/platform/background';
import { InMemoryLeasedJobStore } from './in-memory-job-store';
import { LeasedBackgroundWorker, type WorkerPass } from './worker';
// Type-only (erased) so the server-only adapters stay out of the dev bundle.
import type * as SupabaseJobStoreModule from './supabase-job-store';
import type * as WorkflowDurableModule from './workflow-durable';

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
    const mod = require('@/services/jobs/supabase-job-store') as typeof SupabaseJobStoreModule;
    return new mod.SupabaseLeasedJobStore();
  }
  return new InMemoryLeasedJobStore({
    id: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  });
}

export const jobStore: LeasedJobStore = globalForJobs.__jobStore ?? buildStore();
globalForJobs.__jobStore = jobStore;

/**
 * How workflow triggers are evaluated in this runtime:
 * - `durable`: the worker scans persisted Signals each tick and enqueues
 *   `workflow.run` jobs (crash-safe, multi-instance — Sprint 7 D-666).
 * - `in-memory`: the in-process {@link TriggerEngine} fires runs synchronously
 *   from the {@link SignalBus} (dev / unconfigured; unchanged behaviour).
 *
 * Exported so a diagnostics endpoint / the worker heartbeat can surface the
 * active path without leaking configuration.
 */
export const workflowTriggerPath: 'durable' | 'in-memory' = isSupabasePersistenceEnabled()
  ? 'durable'
  : 'in-memory';

/**
 * The durable trigger evaluation pass + `workflow.run` handler, lazily required
 * only when persistence is enabled (keeps `server-only` out of the dev bundle).
 * In the in-memory path this is empty and no handler is registered — triggered
 * runs execute in-process through the {@link TriggerEngine} as before.
 */
const durablePasses: WorkerPass[] = [];
if (workflowTriggerPath === 'durable') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@/services/jobs/workflow-durable') as typeof WorkflowDurableModule;
  durablePasses.push(mod.buildDurableTriggerPass());
}

/** The shared stateless worker (driven by the cron endpoint). */
export const backgroundWorker = new LeasedBackgroundWorker(jobStore, {
  id: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
  workerId: `worker-${process.env.VERCEL_REGION ?? 'local'}`,
  leaseMs: 60_000,
  batchSize: 20,
  publisher: signalPublisher,
  passes: durablePasses,
});

if (workflowTriggerPath === 'durable') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@/services/jobs/workflow-durable') as typeof WorkflowDurableModule;
  backgroundWorker.register(mod.workflowRunHandler);
}
