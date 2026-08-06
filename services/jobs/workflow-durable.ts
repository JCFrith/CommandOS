import 'server-only';

import { z } from 'zod';

import type { Job, JobHandler } from '@/lib/platform/background';
import {
  DurableTriggerEvaluator,
  type DurableTriggerPort,
} from '@/services/workflows/durable-trigger-evaluator';
import {
  SupabaseDurableTriggerPort,
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
