import { signalBus, signalPublisher } from '@/lib/signals';
import { WorkflowRuntime } from '@/lib/workflows/runtime/runtime';
import { workflowRepository } from './in-memory-workflow-repository';
import { workflowCapabilities } from './capabilities';
import { WorkflowService } from './workflow-service';

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

export const workflowService = new WorkflowService(
  workflowRepository,
  runtime,
  signalBus,
  signalPublisher,
);

export { WorkflowError } from './workflow-service';
export type { WorkflowContext, WorkflowErrorCode } from './workflow-service';
