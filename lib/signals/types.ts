/**
 * The Signal domain — the canonical, platform-wide event model for CommandOS.
 *
 * Every subsystem (Operations, Agents, the AI runtime, provider, auth, the
 * command surface, and future Workflows/Notifications/Integrations/Monitoring)
 * emits Signals. Signals are **append-only**: an emitted {@link Signal} is an
 * immutable historical record, and its acknowledgement/resolution lifecycle is
 * expressed as appended {@link SignalEvent}s — never by mutating the original.
 *
 * These types are pure data (no `server-only`, no side effects), so they are
 * safe to import from server or client code alike.
 */

/**
 * How urgent/notable a signal is, from least to most severe. `minSeverity`
 * comparisons use {@link SEVERITY_RANK}.
 */
export type SignalSeverity = 'trace' | 'info' | 'notice' | 'warning' | 'error' | 'critical';

/** Numeric ordering for severities (low → high). */
export const SEVERITY_RANK: Record<SignalSeverity, number> = {
  trace: 0,
  info: 1,
  notice: 2,
  warning: 3,
  error: 4,
  critical: 5,
};

export const SIGNAL_SEVERITIES: readonly SignalSeverity[] = [
  'trace',
  'info',
  'notice',
  'warning',
  'error',
  'critical',
];

/** The broad concern a signal belongs to. */
export type SignalCategory =
  | 'lifecycle' // create/update/archive of a domain entity
  | 'execution' // an agent/AI run and its runtime events
  | 'security' // authentication / authorization
  | 'system' // provider / runtime / bus health
  | 'interaction'; // operator-driven surface actions (command palette, navigation)

export const SIGNAL_CATEGORIES: readonly SignalCategory[] = [
  'lifecycle',
  'execution',
  'security',
  'system',
  'interaction',
];

/** The subsystem that emitted a signal. */
export type SignalSource =
  | 'operations'
  | 'agents'
  | 'runtime'
  | 'provider'
  | 'auth'
  | 'authz'
  | 'workspace'
  | 'workflows'
  | 'commands'
  | 'signals';

export const SIGNAL_SOURCES: readonly SignalSource[] = [
  'operations',
  'agents',
  'runtime',
  'provider',
  'auth',
  'authz',
  'workspace',
  'workflows',
  'commands',
  'signals',
];

/**
 * The acknowledgement lifecycle of a signal. Most informational signals live
 * their whole life as `open`; actionable ones (a failure, a provider outage)
 * can be acknowledged and resolved. The state is a **projection** folded from a
 * signal's {@link SignalEvent}s — the emitted record is never mutated.
 */
export type SignalStatus = 'open' | 'acknowledged' | 'resolved';

/** How a signal was resolved (only meaningful once `status === 'resolved'`). */
export type SignalResolution = 'unresolved' | 'resolved' | 'dismissed' | 'expired';

/**
 * A structured, JSON-safe payload value. Deliberately constrained so a payload
 * can be serialized safely and can never smuggle a function, symbol, or class
 * instance into the append-only store.
 */
export type SignalPayloadValue =
  string | number | boolean | null | SignalPayloadValue[] | { [key: string]: SignalPayloadValue };

/** The structured detail carried with a signal (sanitized — never secrets). */
export type SignalPayload = Record<string, SignalPayloadValue>;

/** Correlation linkage: the chain a signal belongs to and its parent signal. */
export interface SignalCorrelation {
  /** Shared across every signal emitted for one logical chain (e.g. an agent run). */
  correlationId: string;
  /** The signal that directly caused this one, if any. */
  parentId: string | null;
}

/**
 * A single, canonical platform event.
 *
 * Immutable once emitted. Identity, correlation, tenancy (`workspaceId`), the
 * acting operator, source/category/severity, a human title + summary, a
 * sanitized structured `payload`, tags, and audit metadata are all fixed at
 * emit time. The `status`/`resolution`/`acknowledged*`/`resolved*` fields hold
 * the projected lifecycle state (see {@link SignalEvent}); on a freshly emitted
 * signal they are `open` / `unresolved` / `null`.
 */
export interface Signal {
  id: string;
  /** The signal type, e.g. `agent.execution.completed` (see the catalog). */
  type: string;
  /** Chain id shared by every signal in one logical flow. */
  correlationId: string;
  /** Parent signal id within the chain, if any. */
  parentId: string | null;
  /** Tenant boundary — every signal is scoped to exactly one workspace. */
  workspaceId: string;
  /** Operator/actor who caused the event; `null` for system-originated signals. */
  actorId: string | null;
  actorName: string | null;
  source: SignalSource;
  category: SignalCategory;
  severity: SignalSeverity;
  title: string;
  summary: string;
  payload: SignalPayload;
  tags: string[];
  /** Audit metadata (no secrets), e.g. `{ status, durationMs }`. */
  metadata: Record<string, string | number | boolean>;
  /** The domain entity this signal is about (for per-subject timelines). */
  subjectType: string | null;
  subjectId: string | null;
  // --- projected lifecycle (folded from SignalEvents; never mutated in place) --
  status: SignalStatus;
  resolution: SignalResolution;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
}

/** The kinds of append-only lifecycle events recorded against a signal. */
export type SignalEventType = 'emitted' | 'acknowledged' | 'resolved' | 'dismissed' | 'reopened';

/**
 * An immutable, append-only lifecycle event for a {@link Signal}. The signal's
 * current {@link SignalStatus}/{@link SignalResolution} is computed by folding
 * its events in order — historical events are never rewritten.
 */
export interface SignalEvent {
  id: string;
  signalId: string;
  workspaceId: string;
  type: SignalEventType;
  at: string;
  actorId: string | null;
  actorName: string | null;
  detail: string | null;
  /** Set for `resolved`/`dismissed` events. */
  resolution: SignalResolution | null;
}

/**
 * A declarative filter over signals. Every field is optional and ANDed together;
 * array fields match ANY of their members. Used by the bus (subscription
 * routing), the store (querying), and the UI (faceted filtering).
 */
export interface SignalFilter {
  workspaceId?: string;
  severities?: SignalSeverity[];
  /** Inclusive lower bound on severity (uses {@link SEVERITY_RANK}). */
  minSeverity?: SignalSeverity;
  categories?: SignalCategory[];
  sources?: SignalSource[];
  types?: string[];
  statuses?: SignalStatus[];
  correlationId?: string;
  parentId?: string;
  subjectType?: string;
  subjectId?: string;
  actorId?: string;
  /** Match a signal carrying ANY of these tags. */
  tags?: string[];
  /** ISO lower/upper bounds on `createdAt`. */
  since?: string;
  until?: string;
  /** Case-insensitive substring match on title/summary/type. */
  search?: string;
}

/**
 * A durable interest in a class of signals, expressed as a {@link SignalFilter}.
 * Future notification systems consume these to decide what to deliver where; the
 * `channelRefs` are opaque references into the (interface-only) notification
 * framework — no delivery happens in this sprint.
 */
export interface SignalSubscription {
  id: string;
  /** `null` subscribes across all workspaces (a platform-level subscription). */
  workspaceId: string | null;
  filter: SignalFilter;
  /** Opaque references to notification channels (see `notification.ts`). */
  channelRefs: string[];
  active: boolean;
  createdAt: string;
}
