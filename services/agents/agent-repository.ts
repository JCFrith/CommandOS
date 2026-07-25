import type { Agent, AgentActivity, AgentExecution } from '@/types';

/**
 * Persistence boundary for {@link Agent} definitions, their activity timeline,
 * and their {@link AgentExecution} records. Feature code depends only on this
 * interface; the concrete store (in-memory today, Supabase later) is injected,
 * keeping domain logic decoupled from the database — the stable contract a
 * Supabase adapter implements without any UI or service change.
 *
 * Every method is scoped by `workspaceId` for tenant isolation (defense in depth
 * alongside the service's workspace resolution). Timeline and execution reads
 * return entries in chronological (append) order — a backend-agnostic contract
 * (`ORDER BY created_at, id`); callers reverse for newest-first display.
 */
export interface AgentRepository {
  // Definitions
  listByWorkspace(workspaceId: string): Promise<Agent[]>;
  getById(workspaceId: string, id: string): Promise<Agent | null>;
  create(agent: Agent): Promise<Agent>;
  update(agent: Agent): Promise<Agent>;

  // Activity timeline (append-only, chronological)
  listActivity(workspaceId: string, agentId: string): Promise<AgentActivity[]>;
  appendActivity(activity: AgentActivity): Promise<AgentActivity>;

  // Executions
  createExecution(execution: AgentExecution): Promise<AgentExecution>;
  updateExecution(execution: AgentExecution): Promise<AgentExecution>;
  getExecution(workspaceId: string, executionId: string): Promise<AgentExecution | null>;
  listExecutions(workspaceId: string, agentId: string): Promise<AgentExecution[]>;
  /** Whether the agent has a `pending` or `running` execution (dupe guard). */
  hasActiveExecution(workspaceId: string, agentId: string): Promise<boolean>;
}
