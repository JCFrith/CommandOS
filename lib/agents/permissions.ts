import type { Agent, AuthUser, Workspace } from '@/types';
import { roleAtLeast } from '@/lib/authz/roles';
import { isExecutable } from '@/lib/agents/state-machine';

/**
 * Authorization rules for Agents — RBAC + workspace isolation + least privilege
 * (`13_SECURITY_GOVERNANCE.md`), mirroring the Operations rules. Workspace
 * isolation is enforced upstream (the service only loads records for the
 * caller's workspace); these predicates gate what a member may do.
 */

/** Any member may view the workspace's agents. */
export function canViewAgents(workspace: Workspace): boolean {
  return roleAtLeast(workspace.role, 'member');
}

/** Any member may create agents. */
export function canCreateAgent(workspace: Workspace): boolean {
  return roleAtLeast(workspace.role, 'member');
}

/** The creator, or an admin/owner, may edit or transition an agent. */
export function canManageAgent(user: AuthUser, workspace: Workspace, agent: Agent): boolean {
  return agent.createdBy === user.id || roleAtLeast(workspace.role, 'admin');
}

/**
 * An agent may be executed only by someone who can manage it AND only when it is
 * in an executable (active) status. Archived/disabled/paused/draft never run.
 */
export function canExecuteAgent(user: AuthUser, workspace: Workspace, agent: Agent): boolean {
  return canManageAgent(user, workspace, agent) && isExecutable(agent.status);
}
