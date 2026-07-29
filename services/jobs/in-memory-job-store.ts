import type {
  ExecutionQueue,
  Job,
  LeasedJobStore,
  NewJob,
  QueueStats,
  Scheduler,
} from '@/lib/platform/background';

/** Injectable id + clock so leasing/claim logic is deterministic under test. */
export interface JobStoreDeps {
  id: () => string;
  now: () => string;
}

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * DEVELOPMENT-ONLY leased job store — a production-SHAPED in-memory implementation
 * of {@link LeasedJobStore} + {@link ExecutionQueue} + {@link Scheduler}.
 *
 * The leasing/claim/recovery semantics are exactly those the Supabase adapter
 * implements with SQL, so the durable-execution logic (crash/stale recovery,
 * idempotency, retry, backoff) is real and unit-testable here. Atomic within a
 * single JS realm (like the other dev stores, TD-09); the Postgres adapter is the
 * multi-worker production path (`... FOR UPDATE SKIP LOCKED`).
 */
export class InMemoryLeasedJobStore implements LeasedJobStore, ExecutionQueue, Scheduler {
  private readonly jobs = new Map<string, Job>();

  constructor(private readonly deps: JobStoreDeps) {}

  private clone<T>(j: Job<T>): Job<T> {
    return structuredClone(j);
  }

  private make<T>(input: NewJob<T>): Job<T> {
    const now = this.deps.now();
    return {
      id: this.deps.id(),
      workspaceId: input.workspaceId,
      kind: input.kind,
      payload: input.payload,
      status: 'queued',
      scheduledFor: input.scheduledFor ?? null,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      leaseUntil: null,
      leaseWorker: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  // --- ExecutionQueue -------------------------------------------------------

  async enqueue<T>(input: NewJob<T>): Promise<Job<T>> {
    const job = this.make(input);
    this.jobs.set(job.id, job as Job);
    return this.clone(job);
  }

  async dequeue(): Promise<Job | null> {
    const claimed = await this.claimDue('inline', 30_000, this.deps.now(), 1);
    return claimed[0] ?? null;
  }

  async size(): Promise<number> {
    const now = this.deps.now();
    return [...this.jobs.values()].filter((j) => j.status === 'queued' && this.isDue(j, now))
      .length;
  }

  // --- JobStore -------------------------------------------------------------

  async save<T>(job: Job<T>): Promise<void> {
    this.jobs.set(job.id, this.clone(job) as Job);
  }
  async get<T>(id: string): Promise<Job<T> | null> {
    const j = this.jobs.get(id);
    return j ? (this.clone(j) as Job<T>) : null;
  }
  async listByWorkspace(workspaceId: string): Promise<Job[]> {
    return [...this.jobs.values()]
      .filter((j) => j.workspaceId === workspaceId)
      .map((j) => this.clone(j));
  }

  // --- LeasedJobStore -------------------------------------------------------

  private isDue(job: Job, nowIso: string): boolean {
    return job.scheduledFor === null || job.scheduledFor <= nowIso;
  }

  async claimDue(workerId: string, leaseMs: number, nowIso: string, limit: number): Promise<Job[]> {
    const leaseUntil = new Date(new Date(nowIso).getTime() + leaseMs).toISOString();
    const runnable = [...this.jobs.values()]
      .filter(
        (j) =>
          (j.status === 'queued' && this.isDue(j, nowIso)) ||
          (j.status === 'running' && j.leaseUntil !== null && j.leaseUntil < nowIso),
      )
      .sort((a, b) => (a.scheduledFor ?? a.createdAt).localeCompare(b.scheduledFor ?? b.createdAt))
      .slice(0, limit);

    const claimed: Job[] = [];
    for (const job of runnable) {
      job.status = 'running';
      job.attempts += 1; // each claim is an attempt
      job.leaseUntil = leaseUntil;
      job.leaseWorker = workerId;
      job.updatedAt = nowIso;
      claimed.push(this.clone(job));
    }
    return claimed;
  }

  async renewLease(
    jobId: string,
    workerId: string,
    leaseMs: number,
    nowIso: string,
  ): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.leaseWorker !== workerId || job.status !== 'running') return false;
    if (job.leaseUntil !== null && job.leaseUntil < nowIso) return false; // lease lost
    job.leaseUntil = new Date(new Date(nowIso).getTime() + leaseMs).toISOString();
    job.updatedAt = nowIso;
    return true;
  }

  async complete(jobId: string, workerId: string, nowIso: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.status === 'done') return; // idempotent
    if (job.leaseWorker !== workerId) return; // lost lease — someone else owns it
    job.status = 'done';
    job.leaseUntil = null;
    job.leaseWorker = null;
    job.updatedAt = nowIso;
  }

  async fail(jobId: string, workerId: string, error: string, nowIso: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.leaseWorker !== workerId) return;
    job.error = error;
    job.leaseUntil = null;
    job.leaseWorker = null;
    job.updatedAt = nowIso;
    if (job.attempts < job.maxAttempts) {
      // Re-queue with a simple backoff so a retry isn't claimed immediately.
      job.status = 'queued';
      job.scheduledFor = new Date(new Date(nowIso).getTime() + 1_000 * job.attempts).toISOString();
    } else {
      job.status = 'failed';
    }
  }

  async reclaimExpired(nowIso: string): Promise<number> {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.status === 'running' && job.leaseUntil !== null && job.leaseUntil < nowIso) {
        job.status = 'queued';
        job.leaseUntil = null;
        job.leaseWorker = null;
        job.updatedAt = nowIso;
        count += 1;
      }
    }
    return count;
  }

  async stats(nowIso: string): Promise<QueueStats> {
    const all = [...this.jobs.values()];
    const queued = all.filter((j) => j.status === 'queued');
    const oldest = queued
      .map((j) => new Date(nowIso).getTime() - new Date(j.createdAt).getTime())
      .sort((a, b) => b - a)[0];
    return {
      queued: queued.length,
      running: all.filter((j) => j.status === 'running').length,
      failed: all.filter((j) => j.status === 'failed').length,
      oldestQueuedMs: oldest ?? null,
      expiredLeases: all.filter(
        (j) => j.status === 'running' && j.leaseUntil !== null && j.leaseUntil < nowIso,
      ).length,
    };
  }

  // --- Scheduler ------------------------------------------------------------

  async schedule<T>(input: NewJob<T>, at: string): Promise<Job<T>> {
    return this.enqueue({ ...input, scheduledFor: at });
  }

  /**
   * Recurrence is expressed by the domain (e.g. a workflow's `intervalMs` trigger
   * + `schedule_occurrences` dedup); the durable path re-enqueues the next
   * occurrence when one fires. Full cron parsing is future work — this enqueues
   * the first occurrence deterministically.
   */
  async scheduleRecurring<T>(input: NewJob<T>, _cron: string): Promise<Job<T>> {
    return this.enqueue(input);
  }

  async cancel(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job && job.status !== 'done') {
      job.status = 'cancelled';
      job.leaseUntil = null;
      job.leaseWorker = null;
      job.updatedAt = this.deps.now();
    }
  }
}
