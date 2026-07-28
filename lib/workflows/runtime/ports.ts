import type { OperationPriority, OperationStatus } from '@/types';
import type {
  WorkflowApproval,
  WorkflowRun,
  WorkflowRunContext,
  WorkflowStepRun,
  WorkflowVariables,
} from '@/lib/workflows/types';

/**
 * The runtime's outbound ports (dependency inversion). The {@link WorkflowRuntime}
 * depends ONLY on these interfaces + the platform runtime — never on `lib/ai` or
 * feature services. The wiring layer injects adapters that call `AgentService` /
 * `OperationsService` and persist to the repository, so the runtime stays a pure,
 * testable orchestrator.
 */

/** The result of running an agent step (safe, structured — no secrets/prompts). */
export interface AgentStepResult {
  ok: boolean;
  /** A short, safe summary of the agent output (for a variable / audit). */
  summary: string;
  /** Extra safe outputs to merge into the run variables. */
  output: WorkflowVariables;
  /** Safe error message when `ok` is false. */
  error?: string;
}

/**
 * Actions a workflow can take on other subsystems. Each is authorized + executed
 * by the real service behind the adapter (so RBAC + workspace scoping are
 * enforced there), and receives the run's {@link WorkflowRunContext} (carrying
 * the correlation id) so downstream Signals join the workflow chain.
 */
export interface WorkflowCapabilities {
  runAgent(
    ctx: WorkflowRunContext,
    input: { agentId: string; input: string },
  ): Promise<AgentStepResult>;
  createOperation(
    ctx: WorkflowRunContext,
    input: { title: string; priority: OperationPriority },
  ): Promise<{ id: string }>;
  transitionOperation(
    ctx: WorkflowRunContext,
    input: { operationId: string; to: OperationStatus },
  ): Promise<void>;
}

/**
 * The persistence sink the runtime checkpoints to. Runs + steps are append-only
 * from the runtime's perspective (it overwrites the run projection and appends
 * step checkpoints), enabling resume. Implemented by the workflow repository.
 */
export interface WorkflowRunSink {
  saveRun(run: WorkflowRun): Promise<void>;
  appendStep(step: WorkflowStepRun): Promise<void>;
  listSteps(workspaceId: string, runId: string): Promise<WorkflowStepRun[]>;
  createApproval(approval: WorkflowApproval): Promise<void>;
  getApprovalForNode(
    workspaceId: string,
    runId: string,
    nodeId: string,
  ): Promise<WorkflowApproval | null>;
}
