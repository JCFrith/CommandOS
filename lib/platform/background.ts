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
