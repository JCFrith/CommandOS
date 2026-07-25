import { isOpenAIConfigured } from '@/lib/env';
import { signalBus, signalEventStore } from '@/lib/signals';
import { SignalsService } from './signals-service';

/**
 * The shared signals service, wired to the append-only event store and live
 * availability/bus-health probes. Availability is read from configuration
 * (`isOpenAIConfigured`) — the runtime is available exactly when a provider is
 * configured — never fabricated. Pages, Server Actions, and route handlers
 * import this; tests construct {@link SignalsService} directly with a store and
 * deterministic deps.
 */
export const signalsService = new SignalsService(signalEventStore, {
  id: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
  availability: () => {
    const configured = isOpenAIConfigured();
    return { providerAvailable: configured, runtimeAvailable: configured };
  },
  busHealth: () => signalBus.health(),
});

export { SignalError } from './signals-service';
export type { SignalsContext, SignalErrorCode, SignalQuery } from './signals-service';
