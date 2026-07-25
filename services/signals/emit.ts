import type { Signal } from '@/lib/signals/types';
import type { SignalPublisher } from '@/lib/signals/bus';
import { createSignal, type SignalDeps, type SignalInput } from '@/lib/signals/signal';

/**
 * Emission helpers shared by every feature service.
 *
 * A feature service depends only on a {@link SignalPublisher} (injected — a
 * no-op by default so tests and behavior stay unchanged unless a real bus is
 * wired). {@link makeEmitter} turns that publisher plus the service's own
 * deterministic id/clock into a single `emit(input)` function.
 *
 * Emission is **best-effort and non-throwing**: a signal is observability, never
 * part of a use case's contract, so a bus failure can never break — or alter the
 * result of — an operation, an agent run, or a transition. `emit` returns the
 * created {@link Signal} (or `null` on failure) so callers can derive a
 * correlated child from it.
 */

/** A publisher that discards signals — the default for services with none wired. */
export const noopPublisher: SignalPublisher = {
  async publish() {
    /* no-op */
  },
};

export type SignalEmit = (input: SignalInput) => Promise<Signal | null>;

/** Build a best-effort emitter bound to a publisher + deterministic deps. */
export function makeEmitter(publisher: SignalPublisher, deps: SignalDeps): SignalEmit {
  return async (input) => {
    try {
      const signal = createSignal(input, deps);
      await publisher.publish(signal);
      return signal;
    } catch {
      // Observability must never break the caller.
      return null;
    }
  };
}
