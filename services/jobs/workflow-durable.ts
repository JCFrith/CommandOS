import 'server-only';

import { z } from 'zod';

import type { Job, JobHandler } from '@/lib/platform/background';
import {
  DurableTriggerEvaluator,
  type DurableTriggerPort,
} from '@/services/workflows/durable-trigger-evaluator';
import { DurableScheduleEvaluator } from '@/services/workflows/durable-schedule-evaluator';
import {
  SupabaseDurableTriggerPort,
  WORKFLOW_RESUME_JOB_KIND,
  WORKFLOW_RUN_JOB_KIND,
} from '@/services/workflows/supabase-durable-trigger-port';
import { workflowService } from '@/services/workflows';
import type { WorkerPass } from './worker';

/**
 * Server-only durable-trigger wiring (Sprint 7 Phase 1, D-666). Kept out of
 * `services/jobs/index.ts`'s module graph until persistence is enabled (lazily
 * required, mirroring the Supabase job store) so the in-memory dev path never
 * pulls `server-only` / the service-role client into non-server bundles.
 */

/** The minimal, server-derived payload the evaluator enqueues (payload shape D-*). */
const workflowRunPayload = z.object({
  workspaceId: z.string().uuid(),
  runId: z.string().uuid(),
  versionId: z.string().uuid(),
});

/**
 * The `workflow.run` job handler: drain a durably-enqueued run. The payload is
 * validated (malformed ⇒ reject), the workspace is re-derived from the trusted
 * job envelope (cross-workspace ⇒ reject), and execution is delegated to the
 * service, which loads the authoritative run + pinned version and drives it to a
 * checkpoint. Idempotent under the worker's at-least-once redelivery.
 */
export const workflowRunHandler: JobHandler = {
  kind: WORKFLOW_RUN_JOB_KIND,
  async handle(job: Job): Promise<void> {
    const payload = workflowRunPayload.parse(job.payload);
    if (payload.workspaceId !== job.workspaceId) {
      // The job envelope's workspace is authoritative; a mismatched payload is a
      // tampered/stale enqueue — never run it cross-workspace.
      throw new Error('workflow.run payload workspace does not match the job.');
    }
    await workflowService.runEnqueued(payload.workspaceId, payload.runId, payload.versionId);
  },
};

/** The server-derived resume payload (timer/approval). Client never sets these. */
const workflowResumePayload = z.object({
  workspaceId: z.string().uuid(),
  runId: z.string().uuid(),
  cause: z.enum(['timer', 'approval']),
  causeId: z.string().min(1),
});

/**
 * The `workflow.resume` job handler: drain a durably-enqueued resume for a
 * suspended run. Same trust boundary as `workflow.run` — payload validated,
 * workspace re-derived from the job envelope — then delegated to the service,
 * which loads the authoritative run + version, verifies the resume cause matches
 * the current suspension, and re-advances. Idempotent under redelivery.
 */
export const workflowResumeHandler: JobHandler = {
  kind: WORKFLOW_RESUME_JOB_KIND,
  async handle(job: Job): Promise<void> {
    const payload = workflowResumePayload.parse(job.payload);
    if (payload.workspaceId !== job.workspaceId) {
      throw new Error('workflow.resume payload workspace does not match the job.');
    }
    await workflowService.resumeEnqueued(
      payload.workspaceId,
      payload.runId,
      payload.cause,
      payload.causeId,
    );
  },
};

/**
 * The pre-claim worker pass that evaluates persisted signal triggers each tick,
 * enqueuing `workflow.run` jobs the same tick then drains. `port` is injectable
 * for tests; production uses the {@link SupabaseDurableTriggerPort}.
 */
export function buildDurableTriggerPass(
  port: DurableTriggerPort = new SupabaseDurableTriggerPort(),
): WorkerPass {
  const evaluator = new DurableTriggerEvaluator(port);
  return {
    name: 'workflow.signal-triggers',
    async run(): Promise<void> {
      await evaluator.evaluateSignals();
    },
  };
}

/** Pre-claim pass: evaluate due schedule occurrences and enqueue `workflow.run`. */
export function buildDurableSchedulePass(
  port: SupabaseDurableTriggerPort = new SupabaseDurableTriggerPort(),
): WorkerPass {
  const evaluator = new DurableScheduleEvaluator(port);
  return {
    name: 'workflow.schedules',
    async run(): Promise<void> {
      await evaluator.evaluateSchedules();
    },
  };
}

/** Pre-claim pass: claim due timers and enqueue `workflow.resume`. */
export function buildDurableTimerPass(
  port: SupabaseDurableTriggerPort = new SupabaseDurableTriggerPort(),
): WorkerPass {
  return {
    name: 'workflow.timers',
    async run(): Promise<void> {
      await port.claimDueTimers();
    },
  };
}

/** Pre-claim pass: catch up decided-but-unresumed approvals (enqueue `workflow.resume`). */
export function buildDurableApprovalResumePass(
  port: SupabaseDurableTriggerPort = new SupabaseDurableTriggerPort(),
): WorkerPass {
  return {
    name: 'workflow.approval-resumes',
    async run(): Promise<void> {
      await port.claimDueApprovalResumes();
    },
  };
}

/**
 * The ordered durable pre-claim passes (Sprint 7 worker sequence 2–5): signal
 * triggers → schedules → timers → approval resumes. One shared port instance.
 * Each is failure-isolated by the worker, so one failing pass never blocks the
 * others or the queued-job drain.
 */
export function buildDurablePasses(port = new SupabaseDurableTriggerPort()): WorkerPass[] {
  return [
    buildDurableTriggerPass(port),
    buildDurableSchedulePass(port),
    buildDurableTimerPass(port),
    buildDurableApprovalResumePass(port),
  ];
}

/** Both durable job handlers to register on the worker. */
export const durableJobHandlers: JobHandler[] = [workflowRunHandler, workflowResumeHandler];

/** Aggregate durable-runtime health from the DB (backlogs, overdue, queue depth). */
export function getDurableHealth(
  port: SupabaseDurableTriggerPort = new SupabaseDurableTriggerPort(),
): Promise<Record<string, unknown>> {
  return port.durableHealth();
}
