import type {
  Workflow,
  WorkflowApproval,
  WorkflowRun,
  WorkflowStepRun,
  WorkflowVersion,
  TriggerClaim,
} from '@/lib/workflows/types';
import type { WorkflowRepository } from './workflow-repository';

/**
 * DEVELOPMENT-ONLY in-memory {@link WorkflowRepository}.
 *
 * Holds workflows, versions, runs, step checkpoints, and approvals in a worker
 * process's memory. Records are cloned in/out so callers can never mutate stored
 * state by reference. Step checkpoints are append-only; the run is a projection
 * overwritten as it advances. Same single-worker limitation as the other dev
 * stores (TD-09); the durable adapter implements this interface unchanged.
 */
export class InMemoryWorkflowRepository implements WorkflowRepository {
  private readonly workflows = new Map<string, Workflow>();
  private readonly versions = new Map<string, WorkflowVersion>();
  private readonly runs = new Map<string, WorkflowRun>();
  private readonly steps: WorkflowStepRun[] = [];
  private readonly approvals = new Map<string, WorkflowApproval>();
  /** Idempotency records keyed by `${workspaceId}:${triggerKey}` → runId. */
  private readonly triggerClaims = new Map<string, string>();

  private static clone<T>(v: T): T {
    return structuredClone(v);
  }

  async createWorkflow(workflow: Workflow): Promise<Workflow> {
    this.workflows.set(workflow.id, InMemoryWorkflowRepository.clone(workflow));
    return InMemoryWorkflowRepository.clone(workflow);
  }
  async updateWorkflow(workflow: Workflow): Promise<Workflow> {
    this.workflows.set(workflow.id, InMemoryWorkflowRepository.clone(workflow));
    return InMemoryWorkflowRepository.clone(workflow);
  }
  async getWorkflow(workspaceId: string, id: string): Promise<Workflow | null> {
    const w = this.workflows.get(id);
    return w && w.workspaceId === workspaceId ? InMemoryWorkflowRepository.clone(w) : null;
  }
  async listWorkflows(workspaceId: string): Promise<Workflow[]> {
    return [...this.workflows.values()]
      .filter((w) => w.workspaceId === workspaceId)
      .map((w) => InMemoryWorkflowRepository.clone(w));
  }
  async listActive(): Promise<Workflow[]> {
    return [...this.workflows.values()]
      .filter((w) => w.status === 'active')
      .map((w) => InMemoryWorkflowRepository.clone(w));
  }

  async createVersion(version: WorkflowVersion): Promise<WorkflowVersion> {
    this.versions.set(version.id, InMemoryWorkflowRepository.clone(version));
    return InMemoryWorkflowRepository.clone(version);
  }
  async getVersion(workspaceId: string, id: string): Promise<WorkflowVersion | null> {
    const v = this.versions.get(id);
    return v && v.workspaceId === workspaceId ? InMemoryWorkflowRepository.clone(v) : null;
  }
  async listVersions(workspaceId: string, workflowId: string): Promise<WorkflowVersion[]> {
    return [...this.versions.values()]
      .filter((v) => v.workspaceId === workspaceId && v.workflowId === workflowId)
      .sort((a, b) => b.version - a.version)
      .map((v) => InMemoryWorkflowRepository.clone(v));
  }

  async createRun(run: WorkflowRun): Promise<WorkflowRun> {
    this.runs.set(run.id, InMemoryWorkflowRepository.clone(run));
    return InMemoryWorkflowRepository.clone(run);
  }
  async saveRun(run: WorkflowRun): Promise<void> {
    this.runs.set(run.id, InMemoryWorkflowRepository.clone(run));
  }
  async getRun(workspaceId: string, id: string): Promise<WorkflowRun | null> {
    const r = this.runs.get(id);
    return r && r.workspaceId === workspaceId ? InMemoryWorkflowRepository.clone(r) : null;
  }
  async listRuns(workspaceId: string, workflowId: string): Promise<WorkflowRun[]> {
    return [...this.runs.values()]
      .filter((r) => r.workspaceId === workspaceId && r.workflowId === workflowId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => InMemoryWorkflowRepository.clone(r));
  }

  async claimTrigger(
    claim: TriggerClaim,
  ): Promise<{ claimed: boolean; existingRunId: string | null }> {
    const key = `${claim.workspaceId}:${claim.triggerKey}`;
    const existing = this.triggerClaims.get(key);
    if (existing !== undefined) return { claimed: false, existingRunId: existing };
    // Atomic check-and-set in a single JS realm (maps to a DB unique constraint).
    this.triggerClaims.set(key, claim.runId);
    return { claimed: true, existingRunId: null };
  }

  async appendStep(step: WorkflowStepRun): Promise<void> {
    this.steps.push(InMemoryWorkflowRepository.clone(step));
  }
  async listSteps(workspaceId: string, runId: string): Promise<WorkflowStepRun[]> {
    return this.steps
      .filter((s) => s.workspaceId === workspaceId && s.runId === runId)
      .map((s) => InMemoryWorkflowRepository.clone(s));
  }

  async createApproval(approval: WorkflowApproval): Promise<void> {
    this.approvals.set(approval.id, InMemoryWorkflowRepository.clone(approval));
  }
  async saveApproval(approval: WorkflowApproval): Promise<WorkflowApproval> {
    this.approvals.set(approval.id, InMemoryWorkflowRepository.clone(approval));
    return InMemoryWorkflowRepository.clone(approval);
  }
  async getApproval(workspaceId: string, id: string): Promise<WorkflowApproval | null> {
    const a = this.approvals.get(id);
    return a && a.workspaceId === workspaceId ? InMemoryWorkflowRepository.clone(a) : null;
  }
  async getApprovalForNode(
    workspaceId: string,
    runId: string,
    nodeId: string,
  ): Promise<WorkflowApproval | null> {
    const a = [...this.approvals.values()].find(
      (x) => x.workspaceId === workspaceId && x.runId === runId && x.nodeId === nodeId,
    );
    return a ? InMemoryWorkflowRepository.clone(a) : null;
  }
  async listPendingApprovals(workspaceId: string): Promise<WorkflowApproval[]> {
    return [...this.approvals.values()]
      .filter((a) => a.workspaceId === workspaceId && a.status === 'pending')
      .map((a) => InMemoryWorkflowRepository.clone(a));
  }
}

/**
 * The active workflow repository (dev in-memory; swap for Supabase later). Pinned
 * to `globalThis` within a realm — like the other dev stores — so Next's separate
 * module graphs share ONE store.
 */
const globalForWorkflows = globalThis as typeof globalThis & {
  __workflowRepository?: WorkflowRepository;
};

export const workflowRepository: WorkflowRepository =
  globalForWorkflows.__workflowRepository ?? new InMemoryWorkflowRepository();

globalForWorkflows.__workflowRepository = workflowRepository;
