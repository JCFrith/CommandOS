import type {
  Workflow,
  WorkflowApproval,
  WorkflowRun,
  WorkflowStepRun,
  WorkflowVersion,
  TriggerClaim,
} from '@/lib/workflows/types';
import type { WorkflowRunSink } from '@/lib/workflows/runtime/ports';

/**
 * The workflow persistence boundary. Feature code depends on this interface, not
 * the store, so the Supabase adapter swaps in without touching the service or
 * runtime (ADR 0002). Extends {@link WorkflowRunSink} — the narrow write surface
 * the runtime checkpoints through — so the repository satisfies the runtime port
 * directly. Runs + steps are append-only (the run is a mutable projection over
 * its append-only step checkpoints; step checkpoints are never rewritten).
 */
export interface WorkflowRepository extends WorkflowRunSink {
  // Definitions
  createWorkflow(workflow: Workflow): Promise<Workflow>;
  updateWorkflow(workflow: Workflow): Promise<Workflow>;
  getWorkflow(workspaceId: string, id: string): Promise<Workflow | null>;
  listWorkflows(workspaceId: string): Promise<Workflow[]>;
  /** All active workflows across every workspace (for trigger registration). */
  listActive(): Promise<Workflow[]>;

  // Versions
  createVersion(version: WorkflowVersion): Promise<WorkflowVersion>;
  getVersion(workspaceId: string, id: string): Promise<WorkflowVersion | null>;
  listVersions(workspaceId: string, workflowId: string): Promise<WorkflowVersion[]>;

  // Runs
  createRun(run: WorkflowRun): Promise<WorkflowRun>;
  getRun(workspaceId: string, id: string): Promise<WorkflowRun | null>;
  listRuns(workspaceId: string, workflowId: string): Promise<WorkflowRun[]>;

  /**
   * Atomically claim a trigger occurrence: returns `{ claimed: true }` if this is
   * the first time `(workspaceId, triggerKey)` is seen, or `{ claimed: false,
   * existingRunId }` if it was already claimed. This is the deduplication seam —
   * in-memory it is an atomic check-and-set; a durable adapter implements it with
   * `INSERT … ON CONFLICT DO NOTHING` on a unique `(workspace_id, trigger_key)`.
   */
  claimTrigger(claim: TriggerClaim): Promise<{ claimed: boolean; existingRunId: string | null }>;

  // Approvals
  getApproval(workspaceId: string, id: string): Promise<WorkflowApproval | null>;
  saveApproval(approval: WorkflowApproval): Promise<WorkflowApproval>;
  listPendingApprovals(workspaceId: string): Promise<WorkflowApproval[]>;
}

export type { Workflow, WorkflowApproval, WorkflowRun, WorkflowStepRun, WorkflowVersion };
