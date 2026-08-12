import type { Workflow, WorkflowVersion } from '@/lib/workflows/types';
import type { ClaimOutcome } from './durable-trigger-evaluator';

/**
 * Durable, worker-driven schedule evaluation (Sprint 7 Phase 1, D-667).
 *
 * The worker computes each active, schedule-triggered workflow's due occurrence
 * from the persisted version — never an in-process registry — and enqueues a
 * `workflow.run` job for it. Interval schedules are anchored deterministically at
 * the immutable version's `createdAt`, so occurrence boundaries are a pure
 * function of `(anchor, intervalMs, now)`; the identity is stable and dedup is
 * authoritative via `schedule_occurrences` (the {@link DurableSchedulePort}).
 *
 * Catch-up policy (approved): only the SINGLE most-recent missed occurrence is
 * claimed per pass — a worker that was down for many intervals fires once, never
 * an unbounded historical backlog.
 */

/** What the evaluator hands the port to claim + create one scheduled run. */
export interface ScheduleClaimInput {
  version: WorkflowVersion;
  /** Server-derived occurrence identity: `${versionId}:sched${index}:${boundaryMs}`. */
  occurrenceKey: string;
  /** The scheduled occurrence boundary (ISO) — retained as causation, not `now`. */
  scheduledAt: string;
  /** A fresh root correlation id for this occurrence. */
  correlationId: string;
}

export interface DurableSchedulePort {
  now(): string;
  /** Active workflows across all workspaces (paused/draft/archived excluded). */
  listActiveWorkflows(): Promise<Workflow[]>;
  getVersion(workspaceId: string, versionId: string): Promise<WorkflowVersion | null>;
  /** A fresh id (new root correlation per occurrence). */
  newCorrelationId(): string;
  /** Atomic dedup (`schedule_occurrences`) + create run + enqueue `workflow.run`. */
  claimScheduleRun(input: ScheduleClaimInput): Promise<ClaimOutcome>;
}

export interface SchedulePassResult {
  workflowsScanned: number;
  due: number;
  enqueued: number;
  duplicate: number;
}

/**
 * The most-recent occurrence boundary at/after the first interval, or null if no
 * occurrence is yet due. Deterministic: `anchor + floor((now-anchor)/interval)*interval`.
 */
export function mostRecentOccurrence(
  anchorMs: number,
  intervalMs: number,
  nowMs: number,
): number | null {
  if (intervalMs <= 0) return null;
  if (nowMs < anchorMs + intervalMs) return null; // first occurrence not reached
  return anchorMs + Math.floor((nowMs - anchorMs) / intervalMs) * intervalMs;
}

export class DurableScheduleEvaluator {
  constructor(private readonly port: DurableSchedulePort) {}

  async evaluateSchedules(): Promise<SchedulePassResult> {
    const result: SchedulePassResult = {
      workflowsScanned: 0,
      due: 0,
      enqueued: 0,
      duplicate: 0,
    };
    const nowMs = Date.parse(this.port.now());

    for (const wf of await this.port.listActiveWorkflows()) {
      if (!wf.currentVersionId) continue;
      const version = await this.port.getVersion(wf.workspaceId, wf.currentVersionId);
      if (!version) continue;
      const anchorMs = Date.parse(version.createdAt);
      let hasSchedule = false;

      for (const [index, trigger] of version.triggers.entries()) {
        if (trigger.type !== 'schedule' || !trigger.intervalMs) continue;
        hasSchedule = true;
        const boundaryMs = mostRecentOccurrence(anchorMs, trigger.intervalMs, nowMs);
        if (boundaryMs === null) continue;
        result.due += 1;
        const outcome = await this.port.claimScheduleRun({
          version,
          occurrenceKey: `${version.id}:sched${index}:${boundaryMs}`,
          scheduledAt: new Date(boundaryMs).toISOString(),
          correlationId: this.port.newCorrelationId(),
        });
        if (outcome === 'enqueued') result.enqueued += 1;
        else result.duplicate += 1;
      }

      if (hasSchedule) result.workflowsScanned += 1;
    }

    return result;
  }
}
