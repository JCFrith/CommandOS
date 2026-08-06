import type { Signal } from '@/lib/signals/types';
import type { Workflow, WorkflowVersion } from '@/lib/workflows/types';

/**
 * Durable, worker-driven trigger evaluation (Sprint 7 Phase 1, D-666).
 *
 * The worker scans persisted Signals — never an in-process registry — and enqueues
 * `workflow.run` jobs for matching active workflows. Deduplication is authoritative
 * via `trigger_claims` (the {@link DurableTriggerPort.claimAndEnqueueRun}
 * implementation); the per-workspace {@link SignalCursor} is only a progress marker
 * (D-665): a crash before the cursor advances may re-scan signals but never creates a
 * duplicate run, and a crash after it advances never skips unclaimed work.
 *
 * The evaluator is pure orchestration over an injected {@link DurableTriggerPort},
 * so its matching / self-trigger-guard / cursor-ordering logic is unit-testable
 * without a database.
 */

/** A deterministic scan position: order by `created_at ASC, id ASC`. */
export interface SignalCursor {
  createdAt: string;
  id: string;
}

/** Outcome of trying to start one matched trigger occurrence. */
export type ClaimOutcome = 'enqueued' | 'duplicate';

export interface ClaimAndEnqueueInput {
  version: WorkflowVersion;
  /** The source signal id (`WorkflowRunTrigger.ref`). */
  signalId: string;
  /** Inherit the source signal's correlation chain (D-666). */
  correlationId: string;
  /** Causation = the source signal. */
  causationId: string;
}

/** The durable dependencies the evaluator orchestrates (DB/queue/signal store). */
export interface DurableTriggerPort {
  now(): string;
  /** Active workflows across all workspaces (paused/draft/archived excluded). */
  listActiveWorkflows(): Promise<Workflow[]>;
  getVersion(workspaceId: string, versionId: string): Promise<WorkflowVersion | null>;
  /** The latest signal position in a workspace, or null if it has no signals. */
  latestSignalPosition(workspaceId: string): Promise<SignalCursor | null>;
  /** Signals strictly after `cursor`, ordered `(created_at, id)` ASC, bounded. */
  scanSignalsAfter(
    workspaceId: string,
    cursor: SignalCursor | null,
    limit: number,
  ): Promise<Signal[]>;
  readCursor(workspaceId: string): Promise<SignalCursor | null>;
  /** Monotonic advance (implementation refuses to move backward). */
  advanceCursor(workspaceId: string, to: SignalCursor): Promise<void>;
  /** Atomic claim (`trigger_claims`) + create run + enqueue `workflow.run`. */
  claimAndEnqueueRun(input: ClaimAndEnqueueInput): Promise<ClaimOutcome>;
}

export interface SignalPassResult {
  workspacesScanned: number;
  signalsScanned: number;
  matched: number;
  enqueued: number;
  duplicate: number;
  initializedWorkspaces: number;
}

/** True if `version` reacts to `signal` (same workspace + a matching signal trigger). */
export function signalMatchesVersion(signal: Signal, version: WorkflowVersion): boolean {
  if (version.workspaceId !== signal.workspaceId) return false; // no cross-workspace matching
  return version.triggers.some((t) => t.type === 'signal' && t.signalType === signal.type);
}

/** `a > b` under the deterministic `(created_at, id)` ordering. */
export function cursorAfter(a: SignalCursor, b: SignalCursor | null): boolean {
  if (!b) return true;
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt;
  return a.id > b.id;
}

export class DurableTriggerEvaluator {
  constructor(private readonly port: DurableTriggerPort) {}

  /**
   * One durable signal-trigger pass. Only signal-triggered active workflows are
   * considered; workflow-emitted signals are skipped (self-trigger guard). A
   * workspace seen for the first time initializes its cursor to the current signal
   * frontier so a newly-activated workflow fires on FUTURE signals, not history;
   * thereafter it catches up from the cursor (so downtime signals are not skipped).
   */
  async evaluateSignals(batchLimit = 200): Promise<SignalPassResult> {
    const result: SignalPassResult = {
      workspacesScanned: 0,
      signalsScanned: 0,
      matched: 0,
      enqueued: 0,
      duplicate: 0,
      initializedWorkspaces: 0,
    };

    // Resolve the active, signal-triggered current versions, grouped by workspace.
    const versionsByWorkspace = new Map<string, WorkflowVersion[]>();
    for (const wf of await this.port.listActiveWorkflows()) {
      if (!wf.currentVersionId) continue;
      const version = await this.port.getVersion(wf.workspaceId, wf.currentVersionId);
      if (!version) continue;
      if (!version.triggers.some((t) => t.type === 'signal' && t.signalType)) continue;
      const list = versionsByWorkspace.get(wf.workspaceId) ?? [];
      list.push(version);
      versionsByWorkspace.set(wf.workspaceId, list);
    }

    for (const [workspaceId, versions] of versionsByWorkspace) {
      result.workspacesScanned += 1;
      const cursor = await this.port.readCursor(workspaceId);

      // First sight: skip pre-existing history (future-only, matches the in-process
      // registration semantics we are replacing).
      if (cursor === null) {
        const latest = await this.port.latestSignalPosition(workspaceId);
        if (latest) {
          await this.port.advanceCursor(workspaceId, latest);
          result.initializedWorkspaces += 1;
          continue; // next tick starts matching from here forward
        }
      }

      const signals = await this.port.scanSignalsAfter(workspaceId, cursor, batchLimit);
      let advanceTo: SignalCursor | null = null;
      for (const signal of signals) {
        result.signalsScanned += 1;
        advanceTo = { createdAt: signal.createdAt, id: signal.id };
        if (signal.source === 'workflows') continue; // self-trigger guard (no cascades)
        for (const version of versions) {
          if (!signalMatchesVersion(signal, version)) continue;
          result.matched += 1;
          const outcome = await this.port.claimAndEnqueueRun({
            version,
            signalId: signal.id,
            correlationId: signal.correlationId,
            causationId: signal.id,
          });
          if (outcome === 'enqueued') result.enqueued += 1;
          else result.duplicate += 1;
        }
      }

      // Advance only after the whole batch is processed, and only forward. A crash
      // before this leaves the cursor put — the batch re-scans and `trigger_claims`
      // dedups, so no duplicate run is created.
      if (advanceTo && cursorAfter(advanceTo, cursor)) {
        await this.port.advanceCursor(workspaceId, advanceTo);
      }
    }

    return result;
  }
}
