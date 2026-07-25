/**
 * Cancellation primitives for the execution runtime.
 *
 * Synchronous execution today cancels only at await boundaries (before/after the
 * provider call). The interface is built around the standard `AbortSignal` so a
 * future streaming or background executor can support genuine mid-flight
 * cancellation without any caller change.
 */

/** A read-only cancellation view handed to providers, tools, and retry loops. */
export interface CancellationToken {
  readonly isCancelled: boolean;
  /** The underlying signal, forwarded to `fetch`/provider SDKs. */
  readonly signal: AbortSignal;
  /** Register a callback fired once when cancellation is requested. */
  onCancelled(callback: () => void): void;
}

/** A token plus the `cancel()` capability, held by the orchestrator. */
export interface CancellationSource {
  readonly token: CancellationToken;
  cancel(reason?: string): void;
}

/** Create a fresh cancellation source backed by an `AbortController`. */
export function createCancellation(): CancellationSource {
  const controller = new AbortController();
  const token: CancellationToken = {
    get isCancelled() {
      return controller.signal.aborted;
    },
    signal: controller.signal,
    onCancelled(callback) {
      if (controller.signal.aborted) callback();
      else controller.signal.addEventListener('abort', () => callback(), { once: true });
    },
  };
  return {
    token,
    cancel(reason) {
      if (!controller.signal.aborted) controller.abort(reason ?? 'cancelled');
    },
  };
}
