import 'server-only';

import type {
  ExecutionQueue,
  Job,
  JobStatus,
  LeasedJobStore,
  NewJob,
  QueueStats,
  Scheduler,
} from '@/lib/platform/background';
import { serviceClient } from '@/lib/supabase/service';

/** A `jobs` row (snake_case) as returned by Postgres. */
interface JobRow {
  id: string;
  workspace_id: string;
  kind: string;
  payload: unknown;
  status: JobStatus;
  scheduled_for: string | null;
  attempts: number;
  max_attempts: number;
  lease_until: string | null;
  lease_worker: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function toJob<T>(row: JobRow): Job<T> {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    payload: row.payload as T,
    status: row.status,
    scheduledFor: row.scheduled_for,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    leaseUntil: row.lease_until,
    leaseWorker: row.lease_worker,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * PRODUCTION durable job store — Postgres-backed {@link LeasedJobStore} +
 * {@link ExecutionQueue} + {@link Scheduler} over the service-role client. The
 * atomic batch claim uses the `claim_jobs` RPC (`… FOR UPDATE SKIP LOCKED`), so
 * concurrent stateless workers never claim the same job. Same public interface
 * as the in-memory store — a pure binding swap, no service/UI change.
 */
export class SupabaseLeasedJobStore implements LeasedJobStore, ExecutionQueue, Scheduler {
  private get db() {
    return serviceClient();
  }

  async enqueue<T>(input: NewJob<T>): Promise<Job<T>> {
    const { data, error } = await this.db
      .from('jobs')
      .insert({
        workspace_id: input.workspaceId,
        kind: input.kind,
        payload: input.payload,
        scheduled_for: input.scheduledFor ?? null,
        max_attempts: input.maxAttempts ?? 3,
      })
      .select()
      .single();
    if (error) throw new Error(`enqueue failed: ${error.message}`);
    return toJob<T>(data as JobRow);
  }

  async dequeue(): Promise<Job | null> {
    const claimed = await this.claimDue('inline', 30_000, new Date().toISOString(), 1);
    return claimed[0] ?? null;
  }

  async size(): Promise<number> {
    const { count, error } = await this.db
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'queued');
    if (error) throw new Error(`size failed: ${error.message}`);
    return count ?? 0;
  }

  async save<T>(job: Job<T>): Promise<void> {
    const { error } = await this.db
      .from('jobs')
      .update({
        status: job.status,
        scheduled_for: job.scheduledFor,
        attempts: job.attempts,
        lease_until: job.leaseUntil,
        lease_worker: job.leaseWorker,
        error: job.error,
      })
      .eq('id', job.id);
    if (error) throw new Error(`save failed: ${error.message}`);
  }

  async get<T>(id: string): Promise<Job<T> | null> {
    const { data, error } = await this.db.from('jobs').select().eq('id', id).maybeSingle();
    if (error) throw new Error(`get failed: ${error.message}`);
    return data ? toJob<T>(data as JobRow) : null;
  }

  async listByWorkspace(workspaceId: string): Promise<Job[]> {
    const { data, error } = await this.db.from('jobs').select().eq('workspace_id', workspaceId);
    if (error) throw new Error(`list failed: ${error.message}`);
    return (data as JobRow[]).map((r) => toJob(r));
  }

  async claimDue(workerId: string, leaseMs: number, nowIso: string, limit: number): Promise<Job[]> {
    const { data, error } = await this.db.rpc('claim_jobs', {
      p_worker: workerId,
      p_lease_ms: leaseMs,
      p_now: nowIso,
      p_limit: limit,
    });
    if (error) throw new Error(`claimDue failed: ${error.message}`);
    return (data as JobRow[]).map((r) => toJob(r));
  }

  async renewLease(
    jobId: string,
    workerId: string,
    leaseMs: number,
    nowIso: string,
  ): Promise<boolean> {
    const leaseUntil = new Date(new Date(nowIso).getTime() + leaseMs).toISOString();
    const { data, error } = await this.db
      .from('jobs')
      .update({ lease_until: leaseUntil })
      .eq('id', jobId)
      .eq('lease_worker', workerId)
      .eq('status', 'running')
      .gte('lease_until', nowIso)
      .select('id');
    if (error) throw new Error(`renewLease failed: ${error.message}`);
    return (data as unknown[]).length > 0;
  }

  async complete(jobId: string, workerId: string, _nowIso: string): Promise<void> {
    const { error } = await this.db
      .from('jobs')
      .update({ status: 'done', lease_until: null, lease_worker: null })
      .eq('id', jobId)
      .eq('lease_worker', workerId);
    if (error) throw new Error(`complete failed: ${error.message}`);
  }

  async fail(jobId: string, workerId: string, message: string, nowIso: string): Promise<void> {
    const job = await this.get(jobId);
    if (!job || job.leaseWorker !== workerId) return;
    const retry = job.attempts < job.maxAttempts;
    const { error } = await this.db
      .from('jobs')
      .update({
        status: retry ? 'queued' : 'failed',
        error: message,
        lease_until: null,
        lease_worker: null,
        scheduled_for: retry
          ? new Date(new Date(nowIso).getTime() + 1_000 * job.attempts).toISOString()
          : job.scheduledFor,
      })
      .eq('id', jobId)
      .eq('lease_worker', workerId);
    if (error) throw new Error(`fail failed: ${error.message}`);
  }

  async reclaimExpired(nowIso: string): Promise<number> {
    const { data, error } = await this.db
      .from('jobs')
      .update({ status: 'queued', lease_until: null, lease_worker: null })
      .eq('status', 'running')
      .lt('lease_until', nowIso)
      .select('id');
    if (error) throw new Error(`reclaimExpired failed: ${error.message}`);
    return (data as unknown[]).length;
  }

  async stats(nowIso: string): Promise<QueueStats> {
    const counts = async (status: JobStatus) => {
      const { count } = await this.db
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);
      return count ?? 0;
    };
    const { data: oldest } = await this.db
      .from('jobs')
      .select('created_at')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    const { count: expired } = await this.db
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'running')
      .lt('lease_until', nowIso);
    return {
      queued: await counts('queued'),
      running: await counts('running'),
      failed: await counts('failed'),
      oldestQueuedMs: oldest
        ? new Date(nowIso).getTime() - new Date(oldest.created_at).getTime()
        : null,
      expiredLeases: expired ?? 0,
    };
  }

  async schedule<T>(input: NewJob<T>, at: string): Promise<Job<T>> {
    return this.enqueue({ ...input, scheduledFor: at });
  }
  async scheduleRecurring<T>(input: NewJob<T>, _cron: string): Promise<Job<T>> {
    return this.enqueue(input);
  }
  async cancel(jobId: string): Promise<void> {
    const { error } = await this.db
      .from('jobs')
      .update({ status: 'cancelled', lease_until: null, lease_worker: null })
      .eq('id', jobId)
      .neq('status', 'done');
    if (error) throw new Error(`cancel failed: ${error.message}`);
  }
}
