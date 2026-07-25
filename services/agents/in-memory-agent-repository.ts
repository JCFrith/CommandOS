import type { Agent, AgentActivity, AgentExecution } from '@/types';
import type { AgentRepository } from './agent-repository';

/**
 * DEVELOPMENT-ONLY {@link AgentRepository}.
 *
 * Holds agents, activity, and executions in a worker process's memory. State
 * persists across requests served by the SAME realm and resets on restart —
 * ideal for local development and tests, NOT for production. The Supabase-backed
 * adapter (scheduled with the persistence sprint) drops in via the
 * `agentRepository` binding below without touching service or UI code.
 *
 * Records are cloned in and out so callers cannot mutate stored state by
 * reference. Chronological order is preserved for activity and executions.
 *
 * Limitation: a multi-worker server (`next start` / serverless) does not share
 * this memory across workers (TECH_DEBT TD-09) — the reason execution workflows
 * are deterministically validated in a single process until Supabase lands.
 */
export class InMemoryAgentRepository implements AgentRepository {
  private readonly agents = new Map<string, Agent>();
  private readonly activities: AgentActivity[] = [];
  private readonly executions: AgentExecution[] = [];

  private static clone<T>(value: T): T {
    return structuredClone(value);
  }

  async listByWorkspace(workspaceId: string): Promise<Agent[]> {
    return [...this.agents.values()]
      .filter((a) => a.workspaceId === workspaceId)
      .map((a) => InMemoryAgentRepository.clone(a));
  }

  async getById(workspaceId: string, id: string): Promise<Agent | null> {
    const agent = this.agents.get(id);
    if (!agent || agent.workspaceId !== workspaceId) return null;
    return InMemoryAgentRepository.clone(agent);
  }

  async create(agent: Agent): Promise<Agent> {
    this.agents.set(agent.id, InMemoryAgentRepository.clone(agent));
    return InMemoryAgentRepository.clone(agent);
  }

  async update(agent: Agent): Promise<Agent> {
    this.agents.set(agent.id, InMemoryAgentRepository.clone(agent));
    return InMemoryAgentRepository.clone(agent);
  }

  async listActivity(workspaceId: string, agentId: string): Promise<AgentActivity[]> {
    return this.activities
      .filter((a) => a.workspaceId === workspaceId && a.agentId === agentId)
      .map((a) => InMemoryAgentRepository.clone(a));
  }

  async appendActivity(activity: AgentActivity): Promise<AgentActivity> {
    this.activities.push(InMemoryAgentRepository.clone(activity));
    return InMemoryAgentRepository.clone(activity);
  }

  async createExecution(execution: AgentExecution): Promise<AgentExecution> {
    this.executions.push(InMemoryAgentRepository.clone(execution));
    return InMemoryAgentRepository.clone(execution);
  }

  async updateExecution(execution: AgentExecution): Promise<AgentExecution> {
    const idx = this.executions.findIndex((e) => e.id === execution.id);
    if (idx >= 0) this.executions[idx] = InMemoryAgentRepository.clone(execution);
    return InMemoryAgentRepository.clone(execution);
  }

  async getExecution(workspaceId: string, executionId: string): Promise<AgentExecution | null> {
    const exec = this.executions.find((e) => e.id === executionId && e.workspaceId === workspaceId);
    return exec ? InMemoryAgentRepository.clone(exec) : null;
  }

  async listExecutions(workspaceId: string, agentId: string): Promise<AgentExecution[]> {
    return this.executions
      .filter((e) => e.workspaceId === workspaceId && e.agentId === agentId)
      .map((e) => InMemoryAgentRepository.clone(e));
  }

  async hasActiveExecution(workspaceId: string, agentId: string): Promise<boolean> {
    return this.executions.some(
      (e) =>
        e.workspaceId === workspaceId &&
        e.agentId === agentId &&
        (e.status === 'pending' || e.status === 'running'),
    );
  }
}

/**
 * The active agent repository. Development uses the in-memory store above; swap
 * this binding for the Supabase adapter when it lands. Pinned to `globalThis` so
 * that, within a single JS realm, one store is shared across Next's separate
 * Server Action / Route Handler / RSC module graphs (see the operations store
 * for the full rationale). It does NOT bridge separate `next start` workers
 * (TD-09); the Supabase adapter closes that.
 */
const globalForAgents = globalThis as typeof globalThis & {
  __agentRepository?: AgentRepository;
};

export const agentRepository: AgentRepository =
  globalForAgents.__agentRepository ?? new InMemoryAgentRepository();

globalForAgents.__agentRepository = agentRepository;
