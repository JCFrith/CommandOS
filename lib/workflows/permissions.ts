import type { Workspace } from '@/types';
import { roleAtLeast } from '@/lib/authz/roles';

/**
 * Workflow authorization — RBAC + workspace isolation, mirroring operations and
 * agents. Isolation (a caller never touches another workspace's workflows) is
 * enforced by scoping every repository read to `ctx.workspace.id`; these
 * predicates gate what a member may do.
 */

export function canViewWorkflows(workspace: Workspace): boolean {
  return roleAtLeast(workspace.role, 'member');
}

export function canCreateWorkflow(workspace: Workspace): boolean {
  return roleAtLeast(workspace.role, 'member');
}

export function canManageWorkflow(workspace: Workspace): boolean {
  return roleAtLeast(workspace.role, 'member');
}

/** Whether the caller may run/cancel a workflow. */
export function canRunWorkflow(workspace: Workspace): boolean {
  return roleAtLeast(workspace.role, 'member');
}

/** Whether the caller satisfies an approval's required role. */
export function canApprove(workspace: Workspace, approvers: 'owner' | 'admin'): boolean {
  return roleAtLeast(workspace.role, approvers);
}
