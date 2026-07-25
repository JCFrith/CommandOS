import type { Signal, SignalFilter, SignalSeverity } from './types';

/**
 * Notification framework — **interfaces only** (readiness contracts).
 *
 * This sprint ships NO notification delivery and NO production channel
 * implementations. These contracts define how a future notification system will
 * consume Signals (via the subscription engine) and fan them out to channels, so
 * that adding Email/Slack/SMS/Teams/Webhook/Push later drops in behind these
 * interfaces without changing the Signal platform. Nothing here sends anything.
 */

/** The channel families a future implementation may support. */
export type NotificationChannelType = 'email' | 'slack' | 'sms' | 'teams' | 'webhook' | 'push';

/** A message derived from a signal, ready to be delivered to a channel. */
export interface NotificationMessage {
  title: string;
  body: string;
  severity: SignalSeverity;
  /** The signal that triggered this notification. */
  signalId: string;
  correlationId: string;
  workspaceId: string;
  /** Deep link into the console (e.g. the signal detail), if applicable. */
  url?: string;
}

/** A configured delivery channel. Concrete channels are future work. */
export interface NotificationChannel {
  readonly id: string;
  readonly type: NotificationChannelType;
  /** Whether the channel has the configuration it needs to deliver. */
  isConfigured(): boolean;
}

/** Fans a message out to one or more channels. Future implementation only. */
export interface NotificationDispatcher {
  dispatch(message: NotificationMessage, channels: NotificationChannel[]): Promise<void>;
}

/**
 * A durable interest that binds a {@link SignalFilter} to delivery channels.
 * Consumed by the (future) notification system; the Signal platform already
 * produces everything it needs (filtered, correlated signals).
 */
export interface NotificationSubscription {
  id: string;
  /** `null` = platform-level (all workspaces). */
  workspaceId: string | null;
  filter: SignalFilter;
  channelIds: string[];
  active: boolean;
}

/**
 * A higher-level rule: which signals notify which channel types, with optional
 * throttling. A future rule engine evaluates these against the signal stream.
 */
export interface NotificationRule {
  id: string;
  name: string;
  workspaceId: string | null;
  match: SignalFilter;
  channels: NotificationChannelType[];
  /** Minimum interval between deliveries for this rule, if throttled. */
  throttleMs?: number;
  enabled: boolean;
}

/**
 * Project a signal into a notification message. Pure and safe (title/summary
 * only — never payload secrets), provided now so a future dispatcher has a
 * canonical, sanitized mapping to start from. It does not send anything.
 */
export function toNotificationMessage(signal: Signal, url?: string): NotificationMessage {
  return {
    title: signal.title,
    body: signal.summary,
    severity: signal.severity,
    signalId: signal.id,
    correlationId: signal.correlationId,
    workspaceId: signal.workspaceId,
    url,
  };
}
