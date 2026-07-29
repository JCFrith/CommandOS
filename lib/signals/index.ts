import { InProcessSignalBus, type SignalBus, type SignalPublisher } from './bus';
import { InMemorySignalEventStore, type SignalEventStore } from './store';
import { emittedEvent } from './signal';
// Type-only imports (erased): keep the server-only Supabase store out of the dev
// bundle while typing the lazy `require` below.
import type * as EnvModule from '@/lib/env';
import type * as SupabaseSignalStoreModule from '@/services/signals/supabase-signal-event-store';

/**
 * The wired Signal platform singletons.
 *
 * Topology (see `docs/signal-bus.md`):
 *
 * ```
 * Feature service ──publish──▶ SignalBus ──fan-out──▶ subscribers
 *                                  │
 *                                  └─(built-in)─▶ SignalEventStore (append-only)
 * ```
 *
 * Feature services depend only on {@link SignalPublisher} (`signalPublisher`,
 * which is the bus). The bus fans every signal out to its subscribers; a
 * built-in **persistence subscriber**, registered here exactly once, appends
 * each signal — and its `emitted` lifecycle event — to the append-only
 * {@link SignalEventStore}. The {@link SignalsService} reads that store for the
 * console surfaces. Future consumers (notifications, monitoring) subscribe to
 * the same bus without any change upstream.
 *
 * Everything is pinned to `globalThis` within a realm — like the other dev
 * stores — so Next's separate module graphs (Server Actions, Route Handlers,
 * RSC) share ONE bus + store and the persistence subscriber is wired only once.
 * Development-only (in-memory, per-worker, TD-09); the durable adapter swaps the
 * store binding without touching callers.
 */
const globalForSignals = globalThis as typeof globalThis & {
  __signalEventStore?: SignalEventStore;
  __signalBus?: SignalBus;
  __signalPersistenceWired?: boolean;
};

function buildSignalStore(): SignalEventStore {
  // Production Postgres store only when persistence is explicitly enabled; the
  // server-only adapter is lazy-required so the dev/client path never pulls it in.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const env = require('@/lib/env') as typeof EnvModule;
    if (env.isSupabasePersistenceEnabled()) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod =
        require('@/services/signals/supabase-signal-event-store') as typeof SupabaseSignalStoreModule;
      return new mod.SupabaseSignalEventStore();
    }
  } catch {
    /* fall through to the dev store */
  }
  return new InMemorySignalEventStore();
}

export const signalEventStore: SignalEventStore =
  globalForSignals.__signalEventStore ?? buildSignalStore();
globalForSignals.__signalEventStore = signalEventStore;

export const signalBus: SignalBus = globalForSignals.__signalBus ?? new InProcessSignalBus();
globalForSignals.__signalBus = signalBus;

if (!globalForSignals.__signalPersistenceWired) {
  globalForSignals.__signalPersistenceWired = true;
  // Persist every published signal to the append-only store. Isolated by the
  // bus's fan-out (a store failure never breaks emission or other consumers).
  signalBus.subscribe({}, async (signal) => {
    await signalEventStore.appendSignal(signal);
    await signalEventStore.appendEvent(emittedEvent(signal));
  });
}

/** The narrow publish capability feature services depend on (the bus). */
export const signalPublisher: SignalPublisher = signalBus;

export type { SignalBus, SignalPublisher } from './bus';
export type { SignalEventStore } from './store';
