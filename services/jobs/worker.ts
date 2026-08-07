import type { BackgroundWorker, Job, JobHandler, LeasedJobStore } from '@/lib/platform/background';
import type { SignalPublisher } from '@/lib/signals/bus';
import { createSignal, type SignalDeps } from '@/lib/signals/signal';
import { rootCorrelation } from '@/lib/platform/correlation';

/**
 * A worker "pass" — a unit of pre-claim work run once per tick between lease
 * reclamation and job claiming (e.g. durable trigger evaluation, which enqueues
 * the very jobs the same tick then claims). Passes are failure-isolated: a
 * throwing pass never prevents queued jobs from being drained.
 */
export interface WorkerPass {
  readonly name: string;
  run(): Promise<void>;
}

export interface WorkerDeps extends SignalDeps {
  /** Stable id for this worker instance (audit + lease ownership). */
  workerId: string;
  /** Lease duration granted per claimed job (ms). */
  leaseMs: number;
  /** Max jobs drained per tick. */
  batchSize: number;
  publisher?: SignalPublisher;
  /**
   * Pre-claim passes run (in order) after reclaim and before claim, each isolated
   * so one failing pass cannot block unrelated queued work. Empty in the in-memory
   * dev path (triggers fire in-process via the {@link SignalBus}); populated in the
   * durable path with the signal-trigger evaluation.
   */
  passes?: WorkerPass[];
}

export interface TickResult {
  claimed: number;
  completed: number;
  failed: number;
  reclaimed: number;
  /** Pre-claim passes that ran this tick and how many threw (failure-isolated). */
  passesRun: number;
  passesFailed: number;
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
/** Per-pass liveness (last run / last success / last failure) for Health/Metrics. */
export interface PassMetric {
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
}

export class LeasedBackgroundWorker implements BackgroundWorker {
  private readonly handlers = new Map<string, JobHandler>();
  /** Ephemeral per-pass liveness; surfaced via {@link metrics} (null = never run). */
  private readonly passMetrics = new Map<string, PassMetric>();
  private _running = false;

  constructor(
    private readonly store: LeasedJobStore,
    private readonly deps: WorkerDeps,
  ) {}

  register(handler: JobHandler): void {
    this.handlers.set(handler.kind, handler);
  }

  /** A snapshot of each pass's last run / success / failure time (in-memory). */
  metrics(): Record<string, PassMetric> {
    return Object.fromEntries(this.passMetrics);
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

    // Pre-claim passes (e.g. durable trigger evaluation) run after reclaim and
    // before claim so any jobs they enqueue are drained this same tick. Each is
    // failure-isolated: a throwing pass is logged and skipped, never blocking the
    // queued-job drain below.
    let passesRun = 0;
    let passesFailed = 0;
    for (const pass of this.deps.passes ?? []) {
      passesRun += 1;
      const startedAt = this.deps.now();
      try {
        await pass.run();
        this.passMetrics.set(pass.name, {
          lastRunAt: startedAt,
          lastOkAt: startedAt,
          lastError: null,
        });
      } catch {
        passesFailed += 1;
        const prior = this.passMetrics.get(pass.name);
        this.passMetrics.set(pass.name, {
          lastRunAt: startedAt,
          lastOkAt: prior?.lastOkAt ?? null,
          lastError: startedAt,
        });
        await this.emitPassFailure(pass.name);
      }
    }

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

    const result: TickResult = {
      claimed: claimed.length,
      completed,
      failed,
      reclaimed,
      passesRun,
      passesFailed,
    };
    await this.emitHeartbeat(now, result);
    return result;
  }

  /** Best-effort worker-level signal that a pre-claim pass threw (never rethrows). */
  private async emitPassFailure(passName: string): Promise<void> {
    if (!this.deps.publisher) return;
    try {
      await this.deps.publisher.publish(
        createSignal(
          {
            type: 'worker.pass.failed',
            workspaceId: SYSTEM_WS,
            correlation: rootCorrelation(this.deps.id()),
            actorId: this.deps.workerId,
            actorName: null,
            summary: `worker pass failed: ${passName}`,
            severity: 'error',
            source: 'runtime',
            payload: { pass: passName },
          },
          this.deps,
        ),
      );
    } catch {
      /* observability must never break the worker */
    }
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
