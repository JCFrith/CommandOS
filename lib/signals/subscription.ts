import type { Signal, SignalFilter, SignalSubscription } from './types';
import { matchesFilter } from './filter';

/** Injectable id + clock so subscription creation is deterministic under test. */
export interface SubscriptionDeps {
  id: () => string;
  now: () => string;
}

const defaultDeps: SubscriptionDeps = {
  id: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

/** Input to declare a subscription; `active` defaults to true. */
export interface SubscriptionInput {
  workspaceId: string | null;
  filter: SignalFilter;
  channelRefs?: string[];
  active?: boolean;
}

/** Build a {@link SignalSubscription} from an input. */
export function createSubscription(
  input: SubscriptionInput,
  deps: SubscriptionDeps = defaultDeps,
): SignalSubscription {
  return {
    id: deps.id(),
    workspaceId: input.workspaceId,
    filter: input.filter,
    channelRefs: input.channelRefs ? [...input.channelRefs] : [],
    active: input.active ?? true,
    createdAt: deps.now(),
  };
}

/**
 * Whether a subscription should receive a signal. A subscription is honored only
 * when it is active, its (optional) workspace scope matches the signal's
 * workspace — a workspace-scoped subscription can NEVER match another
 * workspace's signals (the isolation guarantee) — and the signal satisfies its
 * filter. A `null` workspace scope is a deliberate platform-level subscription.
 */
export function matchesSubscription(subscription: SignalSubscription, signal: Signal): boolean {
  if (!subscription.active) return false;
  if (subscription.workspaceId !== null && subscription.workspaceId !== signal.workspaceId) {
    return false;
  }
  return matchesFilter(signal, subscription.filter);
}

/** The subset of subscriptions that should receive a signal. */
export function routeToSubscriptions(
  subscriptions: SignalSubscription[],
  signal: Signal,
): SignalSubscription[] {
  return subscriptions.filter((s) => matchesSubscription(s, signal));
}
