import 'server-only';

import type {
  TriggerClaim,
  Workflow,
  WorkflowApproval,
  WorkflowRun,
  WorkflowStepRun,
  WorkflowVersion,
} from '@/lib/workflows/types';
import { serviceClient } from '@/lib/supabase/service';
import type { WorkflowRepository } from './workflow-repository';

/* eslint-disable @typescript-eslint/no-explicit-any */
const toWf = (r: any): Workflow => ({
  id: r.id,
  workspaceId: r.workspace_id,
  name: r.name,
  description: r.description,
  status: r.status,
  currentVersionId: r.current_version_id,
  createdBy: r.created_by,
  updatedBy: r.updated_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const toVer = (r: any): WorkflowVersion => ({
  id: r.id,
  workflowId: r.workflow_id,
  workspaceId: r.workspace_id,
  version: r.version,
  nodes: r.nodes,
  edges: r.edges,
  triggers: r.triggers,
  variables: r.variables,
  startNodeId: r.start_node_id,
  createdBy: r.created_by,
  createdAt: r.created_at,
});
const toRun = (r: any): WorkflowRun => ({
  id: r.id,
  workflowId: r.workflow_id,
  versionId: r.version_id,
  workspaceId: r.workspace_id,
  correlationId: r.correlation_id,
  status: r.status,
  trigger: r.trigger,
  triggerKey: r.trigger_key,
  variables: r.variables,
  frontier: r.frontier ?? [],
  joinArrivals: r.join_arrivals ?? {},
  error: r.error,
  startedBy: r.started_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  completedAt: r.completed_at,
});
const toStep = (r: any): WorkflowStepRun => ({
  id: r.id,
  runId: r.run_id,
  workspaceId: r.workspace_id,
  nodeId: r.node_id,
  nodeType: r.node_type,
  status: r.status,
  attempts: r.attempts,
  output: r.output ?? {},
  error: r.error,
  startedAt: r.started_at,
  completedAt: r.completed_at,
});
const toApp = (r: any): WorkflowApproval => ({
  id: r.id,
  runId: r.run_id,
  workspaceId: r.workspace_id,
  nodeId: r.node_id,
  prompt: r.prompt,
  approvers: r.approvers,
  status: r.status,
  decidedBy: r.decided_by,
  decidedAt: r.decided_at,
  comment: r.comment,
  createdAt: r.created_at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * PRODUCTION {@link WorkflowRepository} + `WorkflowRunSink` over Postgres
 * (service-role, workspace-scoped). Versions are immutable (DB trigger), step
 * checkpoints append-only, and `claimTrigger` maps onto the unique
 * `(workspace_id, trigger_key)` constraint via `insert … on conflict do nothing`.
 */
export class SupabaseWorkflowRepository implements WorkflowRepository {
  private get db() {
    return serviceClient();
  }

  async createWorkflow(w: Workflow): Promise<Workflow> {
    const { error } = await this.db.from('workflows').insert({
      id: w.id,
      workspace_id: w.workspaceId,
      name: w.name,
      description: w.description,
      status: w.status,
      current_version_id: w.currentVersionId,
      created_by: w.createdBy,
      updated_by: w.updatedBy,
      created_at: w.createdAt,
      updated_at: w.updatedAt,
    });
    if (error) throw new Error(error.message);
    return w;
  }
  async updateWorkflow(w: Workflow): Promise<Workflow> {
    const { error } = await this.db
      .from('workflows')
      .update({
        name: w.name,
        description: w.description,
        status: w.status,
        current_version_id: w.currentVersionId,
        updated_by: w.updatedBy,
      })
      .eq('workspace_id', w.workspaceId)
      .eq('id', w.id);
    if (error) throw new Error(error.message);
    return w;
  }
  async getWorkflow(ws: string, id: string): Promise<Workflow | null> {
    const { data, error } = await this.db
      .from('workflows')
      .select()
      .eq('workspace_id', ws)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toWf(data) : null;
  }
  async listWorkflows(ws: string): Promise<Workflow[]> {
    const { data, error } = await this.db.from('workflows').select().eq('workspace_id', ws);
    if (error) throw new Error(error.message);
    return (data ?? []).map(toWf);
  }
  async listActive(): Promise<Workflow[]> {
    const { data, error } = await this.db.from('workflows').select().eq('status', 'active');
    if (error) throw new Error(error.message);
    return (data ?? []).map(toWf);
  }
  async createVersion(v: WorkflowVersion): Promise<WorkflowVersion> {
    const { error } = await this.db.from('workflow_versions').insert({
      id: v.id,
      workspace_id: v.workspaceId,
      workflow_id: v.workflowId,
      version: v.version,
      nodes: v.nodes,
      edges: v.edges,
      triggers: v.triggers,
      variables: v.variables,
      start_node_id: v.startNodeId,
      created_by: v.createdBy,
      created_at: v.createdAt,
    });
    if (error) throw new Error(error.message);
    return v;
  }
  async getVersion(ws: string, id: string): Promise<WorkflowVersion | null> {
    const { data, error } = await this.db
      .from('workflow_versions')
      .select()
      .eq('workspace_id', ws)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toVer(data) : null;
  }
  async listVersions(ws: string, workflowId: string): Promise<WorkflowVersion[]> {
    const { data, error } = await this.db
      .from('workflow_versions')
      .select()
      .eq('workspace_id', ws)
      .eq('workflow_id', workflowId)
      .order('version', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toVer);
  }
  async createRun(r: WorkflowRun): Promise<WorkflowRun> {
    await this.saveRun(r, true);
    return r;
  }
  async saveRun(r: WorkflowRun, insert = false): Promise<void> {
    const row = {
      id: r.id,
      workspace_id: r.workspaceId,
      workflow_id: r.workflowId,
      version_id: r.versionId,
      correlation_id: r.correlationId,
      status: r.status,
      trigger: r.trigger,
      trigger_key: r.triggerKey,
      variables: r.variables,
      frontier: r.frontier,
      join_arrivals: r.joinArrivals,
      error: r.error,
      started_by: r.startedBy,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
      completed_at: r.completedAt,
    };
    const { error } = insert
      ? await this.db.from('workflow_runs').insert(row)
      : await this.db
          .from('workflow_runs')
          .update(row)
          .eq('workspace_id', r.workspaceId)
          .eq('id', r.id);
    if (error) throw new Error(error.message);
  }
  async getRun(ws: string, id: string): Promise<WorkflowRun | null> {
    const { data, error } = await this.db
      .from('workflow_runs')
      .select()
      .eq('workspace_id', ws)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toRun(data) : null;
  }
  async listRuns(ws: string, workflowId: string): Promise<WorkflowRun[]> {
    const { data, error } = await this.db
      .from('workflow_runs')
      .select()
      .eq('workspace_id', ws)
      .eq('workflow_id', workflowId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toRun);
  }
  async claimTrigger(
    claim: TriggerClaim,
  ): Promise<{ claimed: boolean; existingRunId: string | null }> {
    // Atomic idempotency: insert … on conflict do nothing on the unique PK.
    const { data, error } = await this.db
      .from('trigger_claims')
      .insert({
        workspace_id: claim.workspaceId,
        trigger_key: claim.triggerKey,
        run_id: claim.runId,
        created_at: claim.createdAt,
      })
      .select('run_id');
    if (error && !/duplicate key|conflict/i.test(error.message)) throw new Error(error.message);
    if (data && data.length > 0) return { claimed: true, existingRunId: null };
    const { data: existing } = await this.db
      .from('trigger_claims')
      .select('run_id')
      .eq('workspace_id', claim.workspaceId)
      .eq('trigger_key', claim.triggerKey)
      .maybeSingle();
    return { claimed: false, existingRunId: (existing?.run_id as string) ?? null };
  }
  async appendStep(s: WorkflowStepRun): Promise<void> {
    const { error } = await this.db.from('workflow_step_runs').insert({
      id: s.id,
      workspace_id: s.workspaceId,
      run_id: s.runId,
      node_id: s.nodeId,
      node_type: s.nodeType,
      status: s.status,
      attempts: s.attempts,
      output: s.output,
      error: s.error,
      started_at: s.startedAt,
      completed_at: s.completedAt,
    });
    if (error) throw new Error(error.message);
  }
  async listSteps(ws: string, runId: string): Promise<WorkflowStepRun[]> {
    const { data, error } = await this.db
      .from('workflow_step_runs')
      .select()
      .eq('workspace_id', ws)
      .eq('run_id', runId)
      .order('started_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toStep);
  }
  async createApproval(a: WorkflowApproval): Promise<void> {
    const { error } = await this.db.from('workflow_approvals').insert({
      id: a.id,
      workspace_id: a.workspaceId,
      run_id: a.runId,
      node_id: a.nodeId,
      prompt: a.prompt,
      approvers: a.approvers,
      status: a.status,
      decided_by: a.decidedBy,
      decided_at: a.decidedAt,
      comment: a.comment,
      created_at: a.createdAt,
    });
    if (error) throw new Error(error.message);
  }
  async saveApproval(a: WorkflowApproval): Promise<WorkflowApproval> {
    const { error } = await this.db
      .from('workflow_approvals')
      .update({
        status: a.status,
        decided_by: a.decidedBy,
        decided_at: a.decidedAt,
        comment: a.comment,
      })
      .eq('workspace_id', a.workspaceId)
      .eq('id', a.id);
    if (error) throw new Error(error.message);
    return a;
  }
  async getApproval(ws: string, id: string): Promise<WorkflowApproval | null> {
    const { data, error } = await this.db
      .from('workflow_approvals')
      .select()
      .eq('workspace_id', ws)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toApp(data) : null;
  }
  async getApprovalForNode(
    ws: string,
    runId: string,
    nodeId: string,
  ): Promise<WorkflowApproval | null> {
    const { data, error } = await this.db
      .from('workflow_approvals')
      .select()
      .eq('workspace_id', ws)
      .eq('run_id', runId)
      .eq('node_id', nodeId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toApp(data) : null;
  }
  async listPendingApprovals(ws: string): Promise<WorkflowApproval[]> {
    const { data, error } = await this.db
      .from('workflow_approvals')
      .select()
      .eq('workspace_id', ws)
      .eq('status', 'pending');
    if (error) throw new Error(error.message);
    return (data ?? []).map(toApp);
  }
}
