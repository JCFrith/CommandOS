import 'server-only';

import type { Signal, SignalEvent, SignalFilter } from '@/lib/signals/types';
import type { SignalEventStore } from '@/lib/signals/store';
import { projectLifecycle } from '@/lib/signals/signal';
import { serviceClient } from '@/lib/supabase/service';
import { SEVERITY_RANK } from '@/lib/signals/types';

/** A `signals` row (snake_case). */
interface SignalRow {
  id: string;
  workspace_id: string;
  type: string;
  correlation_id: string;
  parent_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  source: string;
  category: string;
  severity: string;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  tags: string[];
  metadata: Record<string, unknown>;
  subject_type: string | null;
  subject_id: string | null;
  created_at: string;
}
interface EventRow {
  id: string;
  workspace_id: string;
  signal_id: string;
  type: string;
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  detail: string | null;
  resolution: string | null;
}

function toSignal(row: SignalRow): Signal {
  return {
    id: row.id,
    type: row.type,
    correlationId: row.correlation_id,
    parentId: row.parent_id,
    workspaceId: row.workspace_id,
    actorId: row.actor_id,
    actorName: row.actor_name,
    source: row.source as Signal['source'],
    category: row.category as Signal['category'],
    severity: row.severity as Signal['severity'],
    title: row.title,
    summary: row.summary,
    payload: row.payload as Signal['payload'],
    tags: row.tags,
    metadata: row.metadata as Signal['metadata'],
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    status: 'open',
    resolution: 'unresolved',
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    resolvedBy: null,
    createdAt: row.created_at,
  };
}
function toEvent(row: EventRow): SignalEvent {
  return {
    id: row.id,
    signalId: row.signal_id,
    workspaceId: row.workspace_id,
    type: row.type as SignalEvent['type'],
    at: row.at,
    actorId: row.actor_id,
    actorName: row.actor_name,
    detail: row.detail,
    resolution: row.resolution as SignalEvent['resolution'],
  };
}

/**
 * PRODUCTION {@link SignalEventStore} over Postgres (service-role). The `signals`
 * and `signal_events` tables are **append-only** (DB triggers reject UPDATE /
 * DELETE), so this adapter only inserts + reads; a signal's lifecycle is folded
 * from its events at read time ({@link projectLifecycle}) — identical semantics
 * to the in-memory store. Every read is scoped to `workspace_id`.
 */
export class SupabaseSignalEventStore implements SignalEventStore {
  private get db() {
    return serviceClient();
  }

  async appendSignal(signal: Signal): Promise<Signal> {
    const { error } = await this.db.from('signals').insert({
      id: signal.id,
      workspace_id: signal.workspaceId,
      type: signal.type,
      correlation_id: signal.correlationId,
      parent_id: signal.parentId,
      actor_id: signal.actorId,
      actor_name: signal.actorName,
      source: signal.source,
      category: signal.category,
      severity: signal.severity,
      title: signal.title,
      summary: signal.summary,
      payload: signal.payload,
      tags: signal.tags,
      metadata: signal.metadata,
      subject_type: signal.subjectType,
      subject_id: signal.subjectId,
      created_at: signal.createdAt,
    });
    if (error) throw new Error(`appendSignal failed: ${error.message}`);
    return signal;
  }

  async appendEvent(event: SignalEvent): Promise<SignalEvent> {
    const { error } = await this.db.from('signal_events').insert({
      id: event.id,
      workspace_id: event.workspaceId,
      signal_id: event.signalId,
      type: event.type,
      at: event.at,
      actor_id: event.actorId,
      actor_name: event.actorName,
      detail: event.detail,
      resolution: event.resolution,
    });
    if (error) throw new Error(`appendEvent failed: ${error.message}`);
    return event;
  }

  private async project(signals: Signal[]): Promise<Signal[]> {
    if (signals.length === 0) return [];
    const ids = signals.map((s) => s.id);
    const { data } = await this.db.from('signal_events').select().in('signal_id', ids);
    const byId = new Map<string, SignalEvent[]>();
    for (const row of (data as EventRow[] | null) ?? []) {
      const e = toEvent(row);
      (byId.get(e.signalId) ?? byId.set(e.signalId, []).get(e.signalId)!).push(e);
    }
    return signals.map((s) => {
      const events = byId.get(s.id);
      return events && events.length ? projectLifecycle(s, events) : s;
    });
  }

  async getSignal(workspaceId: string, id: string): Promise<Signal | null> {
    const { data, error } = await this.db
      .from('signals')
      .select()
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getSignal failed: ${error.message}`);
    if (!data) return null;
    return (await this.project([toSignal(data as SignalRow)]))[0]!;
  }

  async listSignals(filter: SignalFilter): Promise<Signal[]> {
    let q = this.db.from('signals').select().order('created_at', { ascending: false });
    if (filter.workspaceId !== undefined) q = q.eq('workspace_id', filter.workspaceId);
    if (filter.correlationId !== undefined) q = q.eq('correlation_id', filter.correlationId);
    if (filter.subjectType !== undefined) q = q.eq('subject_type', filter.subjectType);
    if (filter.subjectId !== undefined) q = q.eq('subject_id', filter.subjectId);
    if (filter.actorId !== undefined) q = q.eq('actor_id', filter.actorId);
    if (filter.sources?.length) q = q.in('source', filter.sources);
    if (filter.categories?.length) q = q.in('category', filter.categories);
    if (filter.types?.length) q = q.in('type', filter.types);
    if (filter.since !== undefined) q = q.gte('created_at', filter.since);
    if (filter.until !== undefined) q = q.lte('created_at', filter.until);
    const { data, error } = await q;
    if (error) throw new Error(`listSignals failed: ${error.message}`);

    let signals = await this.project((data as SignalRow[]).map(toSignal));
    // Facets a SQL query can't express cheaply are applied in-memory (mirrors the
    // in-memory store's `matchesFilter`): severity floor, statuses, tags, search.
    if (filter.minSeverity) {
      signals = signals.filter(
        (s) => SEVERITY_RANK[s.severity] >= SEVERITY_RANK[filter.minSeverity!],
      );
    }
    if (filter.severities?.length)
      signals = signals.filter((s) => filter.severities!.includes(s.severity));
    if (filter.statuses?.length)
      signals = signals.filter((s) => filter.statuses!.includes(s.status));
    if (filter.tags?.length)
      signals = signals.filter((s) => filter.tags!.some((t) => s.tags.includes(t)));
    if (filter.search) {
      const n = filter.search.toLowerCase();
      signals = signals.filter((s) =>
        `${s.title} ${s.summary} ${s.type}`.toLowerCase().includes(n),
      );
    }
    return signals;
  }

  async listEvents(workspaceId: string, signalId: string): Promise<SignalEvent[]> {
    const { data, error } = await this.db
      .from('signal_events')
      .select()
      .eq('workspace_id', workspaceId)
      .eq('signal_id', signalId)
      .order('at', { ascending: true });
    if (error) throw new Error(`listEvents failed: ${error.message}`);
    return (data as EventRow[]).map(toEvent);
  }
}
