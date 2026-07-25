import type { Execution, ExecutionRequest } from './execution';

/**
 * Background-execution readiness — INTERFACES ONLY.
 *
 * No queue, worker, or scheduler is implemented in this sprint. These contracts
 * exist so a future durable implementation (e.g. Vercel Queues / a Supabase job
 * table) drops in without changing callers: a caller enqueues an
 * {@link ExecutionRequest} and later reads the {@link Execution}, regardless of
 * whether it ran inline or on a worker.
 */

/** A persisted background job wrapping a queued execution request. */
export interface Job<T> {
  id: string;
  request: ExecutionRequest<T>;
  status: 'queued' | 'running' | 'done' | 'failed';
  /** Populated once the job completes. */
  execution: Execution<T> | null;
  scheduledFor: string | null;
  createdAt: string;
}

/** FIFO (or priority) queue of pending execution requests. */
export interface ExecutionQueue {
  enqueue<T>(request: ExecutionRequest<T>): Promise<Job<T>>;
  /** Claim the next ready job, or `null` if none. */
  dequeue(): Promise<Job<unknown> | null>;
  size(): Promise<number>;
}

/** Durable store of jobs and their outcomes. */
export interface JobStore {
  save<T>(job: Job<T>): Promise<void>;
  get<T>(id: string): Promise<Job<T> | null>;
  listByWorkspace(workspaceId: string): Promise<Job<unknown>[]>;
}

/** Drains the queue, running each job through the execution runtime. */
export interface BackgroundWorker {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly running: boolean;
}

/** Schedules requests to run at a future time or on a recurrence. */
export interface Scheduler {
  schedule<T>(request: ExecutionRequest<T>, at: string): Promise<Job<T>>;
  scheduleRecurring<T>(request: ExecutionRequest<T>, cron: string): Promise<Job<T>>;
  cancel(jobId: string): Promise<void>;
}
