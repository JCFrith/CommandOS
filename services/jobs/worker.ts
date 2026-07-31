import type { BackgroundWorker, Job, JobHandler, LeasedJobStore } from '@/lib/platform/background';
import type { SignalPublisher } from '@/lib/signals/bus';
import { createSignal, type SignalDeps } from '@/lib/signals/signal';
import { rootCorrelation } from '@/lib/platform/correlation';

export interface WorkerDeps extends SignalDeps {
  /** Stable id for this worker instance (audit + lease ownership). */
  workerId: string;
  /** Lease duration granted per claimed job (ms). */
  leaseMs: number;
  /** Max jobs drained per tick. */
  batchSize: number;
  publisher?: SignalPublisher;
}

export interface TickResult {
  claimed: number;
  completed: number;
  failed: number;
  reclaimed: number;
}

/** The reserved workspace for worker-level (non-tenant) signals. */
const SYSTEM_WS = 'system';

/**
 * The production background worker — **stateless**. It is driven by an external
 * scheduler (Vercel Cron → the worker endpoint), NOT a long-running loop: each
 * `tick()` atomically claims a batch of due/recoverable jobs from the
 * {@link LeasedJobStore}, runs each through its registered {@link JobHandler},
 * and completes or retries it. A crashed worker's leases expire and are reclaimed
 * on a later tick (`claimDue` includes expired leases), so execution is
 * at-least-once and crash-safe; handlers must be idempotent (the WorkflowRuntime
 * is — completed steps skip by node id). No persistent-process assumptions.
 */
export class LeasedBackgroundWorker implements BackgroundWorker {
  private readonly handlers = new Map<string, JobHandler>();
  private _running = false;

  constructor(
    private readonly store: LeasedJobStore,
    private readonly deps: WorkerDeps,
  ) {}

  register(handler: JobHandler): void {
    this.handlers.set(handler.kind, handler);
  }
  async start(): Promise<void> {
    this._running = true;
  }
  async stop(): Promise<void> {
    this._running = false;
  }
  get running(): boolean {
    return this._running;
  }

  /** Drain one batch of due work. Called per cron tick; returns a summary. */
  async tick(): Promise<TickResult> {
    const now = this.deps.now();
    const reclaimed = await this.store.reclaimExpired(now);
    const claimed = await this.store.claimDue(
      this.deps.workerId,
      this.deps.leaseMs,
      now,
      this.deps.batchSize,
    );

    let completed = 0;
    let failed = 0;
    for (const job of claimed) {
      const handler = this.handlers.get(job.kind);
      const at = this.deps.now();
      if (!handler) {
        await this.store.fail(job.id, this.deps.workerId, `No handler for kind "${job.kind}".`, at);
        failed += 1;
        continue;
      }
      try {
        await handler.handle(job);
        await this.store.complete(job.id, this.deps.workerId, this.deps.now());
        completed += 1;
        await this.emitJob(job, 'job.completed', 'trace');
      } catch {
        // Never leak handler internals; retry if attempts remain.
        await this.store.fail(job.id, this.deps.workerId, 'The job failed.', this.deps.now());
        failed += 1;
        await this.emitJob(job, 'job.failed', 'error');
      }
    }

    await this.emitHeartbeat(now, { claimed: claimed.length, completed, failed, reclaimed });
    return { claimed: claimed.length, completed, failed, reclaimed };
  }

  private async emitJob(job: Job, type: string, severity: 'trace' | 'error'): Promise<void> {
    if (!this.deps.publisher) return;
    try {
      await this.deps.publisher.publish(
        createSignal(
          {
            type,
            workspaceId: job.workspaceId,
            correlation: rootCorrelation(this.deps.id()),
            actorId: this.deps.workerId,
            actorName: null,
            summary: `${type} (${job.kind})`,
            subjectType: 'job',
            subjectId: job.id,
            severity,
            source: 'runtime',
            payload: { kind: job.kind, attempts: job.attempts },
          },
          this.deps,
        ),
      );
    } catch {
      /* observability must never break the worker */
    }
  }

  private async emitHeartbeat(nowIso: string, result: TickResult): Promise<void> {
    if (!this.deps.publisher) return;
    try {
      const stats = await this.store.stats(nowIso);
      await this.deps.publisher.publish(
        createSignal(
          {
            type: 'worker.heartbeat',
            workspaceId: SYSTEM_WS,
            correlation: rootCorrelation(this.deps.id()),
            actorId: this.deps.workerId,
            actorName: null,
            summary: `worker tick: ${result.completed} done, ${result.failed} failed, ${result.reclaimed} reclaimed`,
            severity: 'trace',
            source: 'runtime',
            payload: {
              ...result,
              queued: stats.queued,
              running: stats.running,
              expiredLeases: stats.expiredLeases,
            },
          },
          this.deps,
        ),
      );
    } catch {
      /* best effort */
    }
  }
}
