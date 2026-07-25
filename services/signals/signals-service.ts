import type { WorkspaceContext } from '@/services/workspace/context';
import type { Signal, SignalEvent, SignalFilter, SignalResolution } from '@/lib/signals/types';
import type { SignalEventStore } from '@/lib/signals/store';
import type { SignalBusHealth } from '@/lib/signals/bus';
import { acknowledgedEvent, resolvedEvent, type SignalDeps } from '@/lib/signals/signal';
import { canManageSignals, canViewSignals } from '@/lib/signals/permissions';
import {
  buildCorrelationChains,
  buildTimeline,
  type CorrelationChain,
  type TimelineEntry,
} from '@/lib/signals/timeline';
import { computeMetrics, type SignalMetrics } from '@/lib/signals/metrics';
import { computeHealth, type PlatformHealth } from '@/lib/signals/health';

/** The resolved caller context (shared with operations/agents). */
export type SignalsContext = WorkspaceContext;

export type SignalErrorCode = 'forbidden' | 'not_found' | 'validation';

/** A typed, expected domain failure — caught at the edge. */
export class SignalError extends Error {
  constructor(
    readonly code: SignalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SignalError';
  }
}

/** Availability facts the health model needs (wired to env in `index.ts`). */
export interface AvailabilitySnapshot {
  providerAvailable: boolean;
  runtimeAvailable: boolean;
}

export interface SignalsServiceDeps extends SignalDeps {
  availability: () => AvailabilitySnapshot;
  busHealth: () => SignalBusHealth;
}

/** A filter callers may pass — its `workspaceId` is always overridden by scope. */
export type SignalQuery = Omit<SignalFilter, 'workspaceId'>;

/**
 * Signals read/observability use cases.
 *
 * Every query is forcibly scoped to the caller's workspace (`ctx.workspace.id`)
 * before touching the store — a caller can NEVER read, correlate, or resolve a
 * signal outside their workspace, even by supplying a foreign filter. Reads gate
 * on {@link canViewSignals}; acknowledge/resolve gate on {@link canManageSignals}
 * and append lifecycle events (the emitted record is never mutated). Depends
 * only on the {@link SignalEventStore} interface, so the durable store swaps in
 * without changing this logic.
 */
export class SignalsService {
  constructor(
    private readonly store: SignalEventStore,
    private readonly deps: SignalsServiceDeps,
  ) {}

  /** Signals in the caller's workspace matching an optional filter, newest first. */
  async list(ctx: SignalsContext, query: SignalQuery = {}): Promise<Signal[]> {
    this.assertView(ctx);
    return this.store.listSignals(this.scope(ctx, query));
  }

  /** A single signal (lifecycle projected), scoped to the caller's workspace. */
  async get(ctx: SignalsContext, id: string): Promise<Signal> {
    this.assertView(ctx);
    const signal = await this.store.getSignal(ctx.workspace.id, id);
    if (!signal) throw new SignalError('not_found', 'That signal no longer exists.');
    return signal;
  }

  /** The append-only lifecycle events for a signal. */
  async events(ctx: SignalsContext, id: string): Promise<SignalEvent[]> {
    await this.get(ctx, id); // authorize + existence
    return this.store.listEvents(ctx.workspace.id, id);
  }

  /**
   * A timeline for a domain subject (e.g. an operation or agent) OR the whole
   * workspace, generated from Signals. Pass `{ subjectType, subjectId }` for a
   * subject timeline; omit them for a workspace-wide recent-activity timeline.
   */
  async timeline(
    ctx: SignalsContext,
    query: SignalQuery & { limit?: number } = {},
  ): Promise<TimelineEntry[]> {
    const signals = await this.list(ctx, query);
    return buildTimeline(signals, { order: 'desc', limit: query.limit });
  }

  /** Correlation chains in the workspace (optionally a single chain). */
  async correlations(ctx: SignalsContext, correlationId?: string): Promise<CorrelationChain[]> {
    const signals = await this.list(ctx, correlationId ? { correlationId } : {});
    return buildCorrelationChains(signals);
  }

  /** Observability metrics computed from the workspace's signals. */
  async metrics(ctx: SignalsContext, query: SignalQuery = {}): Promise<SignalMetrics> {
    const signals = await this.list(ctx, query);
    return computeMetrics(signals);
  }

  /** Platform health for the workspace (provider / runtime / signal-bus). */
  async health(ctx: SignalsContext): Promise<PlatformHealth> {
    const metrics = await this.metrics(ctx);
    const availability = this.deps.availability();
    return computeHealth({
      providerAvailable: availability.providerAvailable,
      runtimeAvailable: availability.runtimeAvailable,
      metrics,
      bus: this.deps.busHealth(),
      now: this.deps.now(),
    });
  }

  /** Acknowledge a signal — appends an `acknowledged` event (append-only). */
  async acknowledge(ctx: SignalsContext, id: string): Promise<Signal> {
    this.assertManage(ctx);
    const signal = await this.get(ctx, id);
    if (signal.status === 'open') {
      await this.store.appendEvent(
        acknowledgedEvent(signal, { id: ctx.user.id, name: ctx.user.displayName }, this.deps),
      );
    }
    return this.get(ctx, id);
  }

  /** Resolve (or dismiss) a signal — appends a `resolved` event (append-only). */
  async resolve(
    ctx: SignalsContext,
    id: string,
    resolution: SignalResolution = 'resolved',
  ): Promise<Signal> {
    this.assertManage(ctx);
    if (resolution === 'unresolved') {
      throw new SignalError('validation', 'A resolution must be resolved, dismissed, or expired.');
    }
    const signal = await this.get(ctx, id);
    if (signal.status !== 'resolved') {
      await this.store.appendEvent(
        resolvedEvent(
          signal,
          { id: ctx.user.id, name: ctx.user.displayName },
          resolution,
          this.deps,
        ),
      );
    }
    return this.get(ctx, id);
  }

  // --- internals -----------------------------------------------------------

  /** Force the workspace scope onto any caller-supplied filter. */
  private scope(ctx: SignalsContext, query: SignalQuery): SignalFilter {
    return { ...query, workspaceId: ctx.workspace.id };
  }

  private assertView(ctx: SignalsContext): void {
    if (!canViewSignals(ctx.workspace)) {
      throw new SignalError('forbidden', 'You cannot view signals here.');
    }
  }

  private assertManage(ctx: SignalsContext): void {
    if (!canManageSignals(ctx.workspace)) {
      throw new SignalError('forbidden', 'You cannot manage signals here.');
    }
  }
}
