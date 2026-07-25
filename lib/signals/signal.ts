import type { SignalCategory, SignalSeverity, SignalSource } from './types';
import type {
  Signal,
  SignalCorrelation,
  SignalEvent,
  SignalPayload,
  SignalPayloadValue,
  SignalResolution,
} from './types';
import { signalTypeSpec } from './catalog';

/** Injectable id + clock so signal creation is deterministic under test. */
export interface SignalDeps {
  id: () => string;
  now: () => string;
}

export const defaultSignalDeps: SignalDeps = {
  id: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

/** The input an emitter supplies; the catalog fills in the taxonomy defaults. */
export interface SignalInput {
  type: string;
  workspaceId: string;
  correlation: SignalCorrelation;
  summary: string;
  actorId?: string | null;
  actorName?: string | null;
  /** Overrides the catalog title. */
  title?: string;
  payload?: SignalPayload;
  tags?: string[];
  metadata?: Record<string, string | number | boolean>;
  subjectType?: string | null;
  subjectId?: string | null;
  /** Overrides for a catalog entry, or the value for an uncatalogued type. */
  severity?: SignalSeverity;
  category?: SignalCategory;
  source?: SignalSource;
}

// --- Payload sanitization ---------------------------------------------------
//
// Defense in depth for the security invariant "signal payloads never contain
// API keys, system prompts, provider secrets, or raw tokens". Emitters are
// already written to pass only safe fields, but every payload is additionally
// scrubbed here so a careless future emitter cannot leak a secret into the
// append-only store. We redact by key name, and bound size/depth so a payload
// can always be serialized safely (no unbounded or cyclic structures).

// Match a sensitive term as a WHOLE word after normalizing the key (camelCase
// and separators → spaces), so `apiKey`/`api_key`/`userToken`/`systemPrompt` are
// redacted but legitimate metrics like `totalTokens` or `promptVersion` are not.
const SECRET_TERM =
  /\b(api\s?key|api\s?secret|secret|token|password|passwd|authorization|auth\s?header|credential|bearer|access\s?key|private\s?key|system\s?prompt)\b/;

function isSecretKey(key: string): boolean {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .toLowerCase();
  // An exact `prompt` key holds raw prompt text (redact); `promptVersion` and
  // other prompt-* metadata are safe, so we do not redact the word broadly.
  if (normalized === 'prompt') return true;
  return SECRET_TERM.test(normalized);
}

const REDACTED = '[redacted]';
const MAX_STRING = 2_000;
const MAX_DEPTH = 6;
const MAX_ARRAY = 200;
const MAX_KEYS = 100;

function sanitizeValue(value: SignalPayloadValue, depth: number): SignalPayloadValue {
  if (value === null) return null;
  if (typeof value === 'string')
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return [];
    return value.slice(0, MAX_ARRAY).map((v) => sanitizeValue(v, depth + 1));
  }
  // object
  if (depth >= MAX_DEPTH) return {};
  const out: Record<string, SignalPayloadValue> = {};
  let count = 0;
  for (const [key, v] of Object.entries(value)) {
    if (count >= MAX_KEYS) break;
    count += 1;
    out[key] = isSecretKey(key) ? REDACTED : sanitizeValue(v, depth + 1);
  }
  return out;
}

/**
 * Scrub a payload: redact secret-like keys and bound size/depth. Exported so
 * tests can assert the invariant directly.
 */
export function sanitizePayload(payload: SignalPayload): SignalPayload {
  const out: SignalPayload = {};
  let count = 0;
  for (const [key, value] of Object.entries(payload)) {
    if (count >= MAX_KEYS) break;
    count += 1;
    out[key] = isSecretKey(key) ? REDACTED : sanitizeValue(value, 1);
  }
  return out;
}

// --- Signal creation --------------------------------------------------------

/**
 * Build an immutable {@link Signal} from an emitter's {@link SignalInput}. The
 * catalog supplies source/category/severity/title unless the input overrides
 * them; the payload is sanitized; correlation is preserved; lifecycle starts at
 * `open` / `unresolved`.
 */
export function createSignal(input: SignalInput, deps: SignalDeps = defaultSignalDeps): Signal {
  const spec = signalTypeSpec(input.type);
  const source = input.source ?? spec?.source ?? 'signals';
  const category = input.category ?? spec?.category ?? 'system';
  const severity = input.severity ?? spec?.severity ?? 'info';
  const title = input.title ?? spec?.title ?? input.type;

  return {
    id: deps.id(),
    type: input.type,
    correlationId: input.correlation.correlationId,
    parentId: input.correlation.parentId,
    workspaceId: input.workspaceId,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    source,
    category,
    severity,
    title,
    summary: input.summary,
    payload: sanitizePayload(input.payload ?? {}),
    tags: input.tags ? [...input.tags] : [],
    metadata: input.metadata ? { ...input.metadata } : {},
    subjectType: input.subjectType ?? null,
    subjectId: input.subjectId ?? null,
    status: 'open',
    resolution: 'unresolved',
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    resolvedBy: null,
    createdAt: deps.now(),
  };
}

// --- Lifecycle events (append-only) -----------------------------------------

/** The initial `emitted` event that records a signal's creation. */
export function emittedEvent(signal: Signal, deps: SignalDeps = defaultSignalDeps): SignalEvent {
  return {
    id: deps.id(),
    signalId: signal.id,
    workspaceId: signal.workspaceId,
    type: 'emitted',
    at: signal.createdAt,
    actorId: signal.actorId,
    actorName: signal.actorName,
    detail: null,
    resolution: null,
  };
}

/** An `acknowledged` lifecycle event. */
export function acknowledgedEvent(
  signal: Signal,
  actor: { id: string | null; name: string | null },
  deps: SignalDeps = defaultSignalDeps,
): SignalEvent {
  return {
    id: deps.id(),
    signalId: signal.id,
    workspaceId: signal.workspaceId,
    type: 'acknowledged',
    at: deps.now(),
    actorId: actor.id,
    actorName: actor.name,
    detail: null,
    resolution: null,
  };
}

/** A `resolved` (or `dismissed`) lifecycle event carrying its resolution. */
export function resolvedEvent(
  signal: Signal,
  actor: { id: string | null; name: string | null },
  resolution: SignalResolution,
  deps: SignalDeps = defaultSignalDeps,
): SignalEvent {
  return {
    id: deps.id(),
    signalId: signal.id,
    workspaceId: signal.workspaceId,
    type: resolution === 'dismissed' ? 'dismissed' : 'resolved',
    at: deps.now(),
    actorId: actor.id,
    actorName: actor.name,
    detail: null,
    resolution,
  };
}

/**
 * Fold a signal's append-only lifecycle events into its current state, returning
 * a NEW signal (the stored record is never mutated). Events are applied in
 * chronological order; unknown/`emitted` events are inert.
 */
export function projectLifecycle(signal: Signal, events: SignalEvent[]): Signal {
  let status = signal.status;
  let resolution = signal.resolution;
  let acknowledgedAt = signal.acknowledgedAt;
  let acknowledgedBy = signal.acknowledgedBy;
  let resolvedAt = signal.resolvedAt;
  let resolvedBy = signal.resolvedBy;

  const ordered = [...events].sort((a, b) => a.at.localeCompare(b.at));
  for (const event of ordered) {
    switch (event.type) {
      case 'acknowledged':
        if (status === 'open') {
          status = 'acknowledged';
          acknowledgedAt = event.at;
          acknowledgedBy = event.actorId;
        }
        break;
      case 'resolved':
      case 'dismissed':
        status = 'resolved';
        resolution = event.resolution ?? (event.type === 'dismissed' ? 'dismissed' : 'resolved');
        resolvedAt = event.at;
        resolvedBy = event.actorId;
        if (!acknowledgedAt) {
          acknowledgedAt = event.at;
          acknowledgedBy = event.actorId;
        }
        break;
      case 'reopened':
        status = 'open';
        resolution = 'unresolved';
        resolvedAt = null;
        resolvedBy = null;
        break;
      case 'emitted':
      default:
        break;
    }
  }

  return {
    ...signal,
    status,
    resolution,
    acknowledgedAt,
    acknowledgedBy,
    resolvedAt,
    resolvedBy,
  };
}
