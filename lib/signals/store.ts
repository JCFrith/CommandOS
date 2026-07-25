import type { Signal, SignalEvent, SignalFilter } from './types';
import { projectLifecycle } from './signal';
import { matchesFilter } from './filter';

/**
 * The append-only Signal event store.
 *
 * Two append-only logs: emitted {@link Signal} records and their lifecycle
 * {@link SignalEvent}s. Historical entries are NEVER overwritten — the only
 * writes are appends. A signal's current status/resolution is a **projection**
 * folded over its lifecycle events at read time ({@link projectLifecycle}), so
 * acknowledging or resolving a signal appends an event rather than mutating the
 * original record.
 *
 * The interface is the stable contract for a future durable (Supabase-backed)
 * implementation — the service and UI depend only on it, so the backing store
 * swaps without touching call sites (ADR 0002).
 */
export interface SignalEventStore {
  /** Append an emitted signal. Returns the stored record. */
  appendSignal(signal: Signal): Promise<Signal>;
  /** Append a lifecycle event (acknowledge/resolve/…). */
  appendEvent(event: SignalEvent): Promise<SignalEvent>;
  /** A single signal (lifecycle projected), scoped to a workspace. */
  getSignal(workspaceId: string, id: string): Promise<Signal | null>;
  /** Signals matching a filter (lifecycle projected), newest first. */
  listSignals(filter: SignalFilter): Promise<Signal[]>;
  /** The append-only lifecycle events for a signal, chronological. */
  listEvents(workspaceId: string, signalId: string): Promise<SignalEvent[]>;
}

/**
 * DEVELOPMENT-ONLY in-memory {@link SignalEventStore}.
 *
 * Holds signals + lifecycle events in a worker process's memory (append-only,
 * bounded to a recent window per store to avoid unbounded growth in a long dev
 * session). Records are cloned in and out so callers can never mutate stored
 * state by reference. Same single-worker limitation as the other in-memory
 * stores (TD-09): not shared across a multi-worker `next start`. The durable
 * adapter (TECH_DEBT) implements the interface above unchanged.
 */
export class InMemorySignalEventStore implements SignalEventStore {
  private readonly signals: Signal[] = [];
  private readonly events: SignalEvent[] = [];
  /** Index of events by signal id, for O(1) projection lookups. */
  private readonly eventsBySignal = new Map<string, SignalEvent[]>();
  private readonly max: number;

  constructor(max = 5_000) {
    this.max = max;
  }

  private static clone<T>(value: T): T {
    return structuredClone(value);
  }

  async appendSignal(signal: Signal): Promise<Signal> {
    this.signals.push(InMemorySignalEventStore.clone(signal));
    if (this.signals.length > this.max) this.signals.splice(0, this.signals.length - this.max);
    return InMemorySignalEventStore.clone(signal);
  }

  async appendEvent(event: SignalEvent): Promise<SignalEvent> {
    const stored = InMemorySignalEventStore.clone(event);
    this.events.push(stored);
    const bucket = this.eventsBySignal.get(event.signalId);
    if (bucket) bucket.push(stored);
    else this.eventsBySignal.set(event.signalId, [stored]);
    return InMemorySignalEventStore.clone(event);
  }

  private project(signal: Signal): Signal {
    const events = this.eventsBySignal.get(signal.id);
    const projected = events && events.length > 0 ? projectLifecycle(signal, events) : signal;
    return InMemorySignalEventStore.clone(projected);
  }

  async getSignal(workspaceId: string, id: string): Promise<Signal | null> {
    const signal = this.signals.find((s) => s.id === id && s.workspaceId === workspaceId);
    return signal ? this.project(signal) : null;
  }

  async listSignals(filter: SignalFilter): Promise<Signal[]> {
    return this.signals
      .map((s) => this.project(s))
      .filter((s) => matchesFilter(s, filter))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listEvents(workspaceId: string, signalId: string): Promise<SignalEvent[]> {
    return (this.eventsBySignal.get(signalId) ?? [])
      .filter((e) => e.workspaceId === workspaceId)
      .map((e) => InMemorySignalEventStore.clone(e))
      .sort((a, b) => a.at.localeCompare(b.at));
  }
}
