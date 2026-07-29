import 'server-only';

import type {
  Agent,
  AgentActivity,
  AgentCapability,
  AgentExecution,
  AgentExecutionResult,
  AgentStatus,
  AgentType,
} from '@/types';
import { serviceClient } from '@/lib/supabase/service';
import type { AgentRepository } from './agent-repository';

/* eslint-disable @typescript-eslint/no-explicit-any */
const toAgent = (r: any): Agent => ({
  id: r.id,
  workspaceId: r.workspace_id,
  name: r.name,
  type: r.type as AgentType,
  description: r.description,
  instructions: r.instructions,
  capabilities: (r.capabilities ?? []) as AgentCapability[],
  status: r.status as AgentStatus,
  createdBy: r.created_by,
  updatedBy: r.updated_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const toActivity = (r: any): AgentActivity => ({
  id: r.id,
  agentId: r.agent_id,
  workspaceId: r.workspace_id,
  actorId: r.actor_id,
  actorName: r.actor_name,
  type: r.type,
  message: r.message,
  fromStatus: r.from_status,
  toStatus: r.to_status,
  createdAt: r.created_at,
});
const toExec = (r: any): AgentExecution => ({
  id: r.id,
  agentId: r.agent_id,
  workspaceId: r.workspace_id,
  requestedBy: r.requested_by,
  status: r.status,
  input: r.input,
  result: (r.result ?? null) as AgentExecutionResult | null,
  error: r.error,
  model: r.model,
  promptVersion: r.prompt_version,
  durationMs: r.duration_ms,
  createdAt: r.created_at,
  completedAt: r.completed_at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * PRODUCTION {@link AgentRepository} over Postgres (service-role, workspace-scoped).
 * Pure row-mapping; the duplicate-run guard (`hasActiveExecution`) is backed by a
 * DB unique partial index in addition to this read.
 */
export class SupabaseAgentRepository implements AgentRepository {
  private get db() {
    return serviceClient();
  }

  async listByWorkspace(workspaceId: string): Promise<Agent[]> {
    const { data, error } = await this.db.from('agents').select().eq('workspace_id', workspaceId);
    if (error) throw new Error(error.message);
    return (data ?? []).map(toAgent);
  }
  async getById(workspaceId: string, id: string): Promise<Agent | null> {
    const { data, error } = await this.db
      .from('agents')
      .select()
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toAgent(data) : null;
  }
  async create(a: Agent): Promise<Agent> {
    const { error } = await this.db.from('agents').insert({
      id: a.id,
      workspace_id: a.workspaceId,
      name: a.name,
      type: a.type,
      description: a.description,
      instructions: a.instructions,
      capabilities: a.capabilities,
      status: a.status,
      created_by: a.createdBy,
      updated_by: a.updatedBy,
      created_at: a.createdAt,
      updated_at: a.updatedAt,
    });
    if (error) throw new Error(error.message);
    return a;
  }
  async update(a: Agent): Promise<Agent> {
    const { error } = await this.db
      .from('agents')
      .update({
        name: a.name,
        description: a.description,
        instructions: a.instructions,
        capabilities: a.capabilities,
        status: a.status,
        updated_by: a.updatedBy,
      })
      .eq('workspace_id', a.workspaceId)
      .eq('id', a.id);
    if (error) throw new Error(error.message);
    return a;
  }
  async listActivity(workspaceId: string, agentId: string): Promise<AgentActivity[]> {
    const { data, error } = await this.db
      .from('agent_activity')
      .select()
      .eq('workspace_id', workspaceId)
      .eq('agent_id', agentId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toActivity);
  }
  async appendActivity(a: AgentActivity): Promise<AgentActivity> {
    const { error } = await this.db.from('agent_activity').insert({
      id: a.id,
      workspace_id: a.workspaceId,
      agent_id: a.agentId,
      actor_id: a.actorId,
      actor_name: a.actorName,
      type: a.type,
      message: a.message,
      from_status: a.fromStatus,
      to_status: a.toStatus,
      created_at: a.createdAt,
    });
    if (error) throw new Error(error.message);
    return a;
  }
  async createExecution(e: AgentExecution): Promise<AgentExecution> {
    const { error } = await this.db.from('agent_executions').insert({
      id: e.id,
      workspace_id: e.workspaceId,
      agent_id: e.agentId,
      requested_by: e.requestedBy,
      status: e.status,
      input: e.input,
      result: e.result,
      error: e.error,
      model: e.model,
      prompt_version: e.promptVersion,
      duration_ms: e.durationMs,
      created_at: e.createdAt,
      completed_at: e.completedAt,
    });
    if (error) throw new Error(error.message);
    return e;
  }
  async updateExecution(e: AgentExecution): Promise<AgentExecution> {
    const { error } = await this.db
      .from('agent_executions')
      .update({
        status: e.status,
        result: e.result,
        error: e.error,
        model: e.model,
        prompt_version: e.promptVersion,
        duration_ms: e.durationMs,
        completed_at: e.completedAt,
      })
      .eq('workspace_id', e.workspaceId)
      .eq('id', e.id);
    if (error) throw new Error(error.message);
    return e;
  }
  async getExecution(workspaceId: string, executionId: string): Promise<AgentExecution | null> {
    const { data, error } = await this.db
      .from('agent_executions')
      .select()
      .eq('workspace_id', workspaceId)
      .eq('id', executionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toExec(data) : null;
  }
  async listExecutions(workspaceId: string, agentId: string): Promise<AgentExecution[]> {
    const { data, error } = await this.db
      .from('agent_executions')
      .select()
      .eq('workspace_id', workspaceId)
      .eq('agent_id', agentId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toExec);
  }
  async hasActiveExecution(workspaceId: string, agentId: string): Promise<boolean> {
    const { count, error } = await this.db
      .from('agent_executions')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('agent_id', agentId)
      .in('status', ['pending', 'running']);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }
}
