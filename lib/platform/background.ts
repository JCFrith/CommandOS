/**
 * Background-execution readiness — **INTERFACES ONLY** (no implementation).
 *
 * Previously these contracts were parameterized over the AI runtime's
 * `ExecutionRequest`/`Execution`, which coupled the queue/worker/scheduler to AI
 * and made them unusable by other runtimes. They are now **payload-generic**: a
 * {@link Job} wraps an arbitrary, workspace-scoped payload with a `kind` tag, so
 * the AI runtime enqueues an execution request, a future `WorkflowRuntime`
 * enqueues a workflow run, and a `NotificationRuntime` enqueues a dispatch —
 * all through the same contracts, with no changes. A durable implementation
 * (e.g. Vercel Queues / a Supabase job table) drops in behind these interfaces.
 */

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** A persisted background job wrapping an arbitrary payload. */
export interface Job<T = unknown> {
  id: string;
  workspaceId: string;
  /** Discriminates the payload kind, e.g. `ai.execution` or `workflow.run`. */
  kind: string;
  payload: T;
  status: JobStatus;
  /** ISO time the job should run at (scheduled/delayed), else `null`. */
  scheduledFor: string | null;
  attempts: number;
  /** Max attempts before a failure is terminal (default policy set on enqueue). */
  maxAttempts: number;
  /** Lease held by a worker while running — enables crash/stale recovery. */
  leaseUntil: string | null;
  leaseWorker: string | null;
  /** Safe, user-facing failure message — never internals. */
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields required to enqueue a new job (the store assigns id/status/timestamps). */
export interface NewJob<T = unknown> {
  workspaceId: string;
  kind: string;
  payload: T;
  scheduledFor?: string | null;
  maxAttempts?: number;
}

/** FIFO (or priority) queue of pending jobs. */
export interface ExecutionQueue {
  enqueue<T>(job: NewJob<T>): Promise<Job<T>>;
  /** Claim the next ready job, or `null` if none is due. */
  dequeue(): Promise<Job | null>;
  size(): Promise<number>;
}

/** Durable store of jobs and their outcomes. */
export interface JobStore {
  save<T>(job: Job<T>): Promise<void>;
  get<T>(id: string): Promise<Job<T> | null>;
  listByWorkspace(workspaceId: string): Promise<Job[]>;
}

/**
 * A snapshot of queue/lease health for observability (never secrets).
 */
export interface QueueStats {
  queued: number;
  running: number;
  failed: number;
  /** Oldest queued job's age in ms, or null if the queue is empty. */
  oldestQueuedMs: number | null;
  /** Number of currently-expired leases (recoverable work). */
  expiredLeases: number;
}

/**
 * The leasing extension a DURABLE job store implements on top of {@link JobStore}
 * (the base contract is unchanged — this is additive). Leasing is what makes
 * background execution crash-safe and idempotent: a worker atomically claims due
 * work with a time-boxed lease, renews it while running, and on crash the lease
 * expires and the work is reclaimed. Modelled to map directly onto Postgres
 * `... FOR UPDATE SKIP LOCKED` + a `lease_until`/`lease_worker` column.
 */
export interface LeasedJobStore extends JobStore {
  /**
   * Atomically claim up to `limit` runnable jobs for `workerId`: `queued` jobs
   * whose `scheduledFor` is due, plus `running` jobs whose lease has expired
   * (crash recovery). Sets each to `running` with a fresh lease. Returns them.
   */
  claimDue(workerId: string, leaseMs: number, nowIso: string, limit: number): Promise<Job[]>;
  /** Renew a held lease while a long job runs; `false` if the lease was lost. */
  renewLease(jobId: string, workerId: string, leaseMs: number, nowIso: string): Promise<boolean>;
  /** Mark a claimed job done (terminal). */
  complete(jobId: string, workerId: string, nowIso: string): Promise<void>;
  /** Fail a claimed job — re-queue for retry if attempts remain, else terminal. */
  fail(jobId: string, workerId: string, error: string, nowIso: string): Promise<void>;
  /** Reclaim expired leases back to `queued` (idempotent). Returns count. */
  reclaimExpired(nowIso: string): Promise<number>;
  stats(nowIso: string): Promise<QueueStats>;
}

/**
 * Drains a queue, running each job through a handler. The handler is what binds
 * a job `kind` to a concrete runtime (AI, workflow, …), keeping the worker
 * itself domain-agnostic.
 */
export interface JobHandler {
  readonly kind: string;
  handle(job: Job): Promise<void>;
}

/** Runs queued jobs via registered {@link JobHandler}s. */
export interface BackgroundWorker {
  register(handler: JobHandler): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly running: boolean;
}

/** Schedules jobs to run at a future time or on a recurrence. */
export interface Scheduler {
  schedule<T>(job: NewJob<T>, at: string): Promise<Job<T>>;
  scheduleRecurring<T>(job: NewJob<T>, cron: string): Promise<Job<T>>;
  cancel(jobId: string): Promise<void>;
}
