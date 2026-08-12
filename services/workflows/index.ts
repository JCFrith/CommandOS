import { isSupabasePersistenceEnabled } from '@/lib/env';
import { signalBus, signalPublisher } from '@/lib/signals';
import { WorkflowRuntime } from '@/lib/workflows/runtime/runtime';
import { workflowRepository } from './in-memory-workflow-repository';
import { workflowCapabilities } from './capabilities';
import { WorkflowService, type DurableApprovalResumer } from './workflow-service';
// Type-only (erased) so the server-only adapter stays out of the dev bundle.
import type * as DurablePortModule from './supabase-durable-trigger-port';

/**
 * The shared workflow service, wired to the dev repository, a {@link
 * WorkflowRuntime} over the real capability adapters, and the platform Signal
 * bus. Server-only (the capability adapter imports `server-only` via the agent
 * service). Pages, Server Actions, and route handlers import this; tests
 * construct {@link WorkflowService} + {@link WorkflowRuntime} directly with fakes.
 */
const runtime = new WorkflowRuntime({
  now: () => new Date().toISOString(),
  id: () => crypto.randomUUID(),
  publisher: signalPublisher,
  capabilities: workflowCapabilities,
  store: workflowRepository,
});

/**
 * In durable mode, an approval decision enqueues a `workflow.resume` job rather
 * than executing the workflow in the deciding request (D-668). The resumer is the
 * durable trigger port (its `claimApprovalResume` RPC); lazily required so the
 * `server-only` adapter never enters the dev bundle. Undefined in dev/in-memory
 * mode, where decisions resume synchronously.
 */
const approvalResumer: DurableApprovalResumer | undefined = isSupabasePersistenceEnabled()
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    new (
      require('@/services/workflows/supabase-durable-trigger-port') as typeof DurablePortModule
    ).SupabaseDurableTriggerPort()
  : undefined;

export const workflowService = new WorkflowService(
  workflowRepository,
  runtime,
  signalBus,
  signalPublisher,
  undefined,
  approvalResumer,
);

export { WorkflowError } from './workflow-service';
export type { WorkflowContext, WorkflowErrorCode } from './workflow-service';
