import type { Signal, SignalFilter } from './types';
import { matchesFilter } from './filter';

/**
 * The Signal bus — the reusable publish/subscribe hub that distributes signals
 * from emitters to any number of consumers.
 *
 * Design constraints (so a future distributed bus drops in without a redesign):
 * - **Emitters depend only on {@link SignalPublisher}** (a single `publish`
 *   method), never on the bus implementation or on any subscriber. Nothing
 *   upstream depends on downstream consumers.
 * - **Fan-out is isolated**: one subscriber throwing never affects another or
 *   the publisher; failures are counted for health, not propagated.
 * - **Correlation is preserved**: the bus passes each signal through untouched,
 *   so `correlationId`/`parentId` survive every hop.
 * - The current implementation is in-process; a distributed transport (queue,
 *   log, websocket) implements the same {@link SignalBus} interface.
 */

/** The narrow interface an emitter depends on — publish only. */
export interface SignalPublisher {
  publish(signal: Signal): Promise<void>;
}

export type SignalHandler = (signal: Signal) => void | Promise<void>;

/** Handle returned by {@link SignalBus.subscribe}; call to detach. */
export interface SignalSubscriptionHandle {
  readonly id: string;
  unsubscribe(): void;
}

/** Observability snapshot of the bus itself. */
export interface SignalBusHealth {
  subscribers: number;
  published: number;
  delivered: number;
  failedDeliveries: number;
}

export interface SignalBus extends SignalPublisher {
  publish(signal: Signal): Promise<void>;
  subscribe(filter: SignalFilter, handler: SignalHandler): SignalSubscriptionHandle;
  /** Detach every subscriber (used to reset the bus in tests). */
  clear(): void;
  health(): SignalBusHealth;
}

interface Registration {
  id: string;
  filter: SignalFilter;
  handler: SignalHandler;
}

/** Injectable id source so subscription ids are deterministic under test. */
export interface BusDeps {
  id: () => string;
}

const defaultDeps: BusDeps = { id: () => crypto.randomUUID() };

/**
 * In-process {@link SignalBus}. Fan-out is synchronous-dispatch, await-all:
 * `publish` resolves once every matching handler has settled (each isolated in a
 * try/catch, async handlers awaited). Handler exceptions are swallowed and
 * counted so a misbehaving consumer can never break emission or another consumer.
 */
export class InProcessSignalBus implements SignalBus {
  private readonly registrations = new Map<string, Registration>();
  private readonly deps: BusDeps;
  private published = 0;
  private delivered = 0;
  private failedDeliveries = 0;

  constructor(deps: Partial<BusDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps };
  }

  async publish(signal: Signal): Promise<void> {
    this.published += 1;
    const targets = [...this.registrations.values()].filter((r) => matchesFilter(signal, r.filter));
    await Promise.all(
      targets.map(async (reg) => {
        try {
          await reg.handler(signal);
          this.delivered += 1;
        } catch {
          // Isolate consumer failures — never let one break emission or a peer.
          this.failedDeliveries += 1;
        }
      }),
    );
  }

  subscribe(filter: SignalFilter, handler: SignalHandler): SignalSubscriptionHandle {
    const id = this.deps.id();
    this.registrations.set(id, { id, filter, handler });
    return {
      id,
      unsubscribe: () => {
        this.registrations.delete(id);
      },
    };
  }

  clear(): void {
    this.registrations.clear();
  }

  health(): SignalBusHealth {
    return {
      subscribers: this.registrations.size,
      published: this.published,
      delivered: this.delivered,
      failedDeliveries: this.failedDeliveries,
    };
  }
}
