import type { AuthUser, Operation, Workspace, WorkspaceRole } from '@/types';

/**
 * Authorization rules for Operations.
 *
 * Follows the governance principles in `13_SECURITY_GOVERNANCE.md`: RBAC,
 * workspace (organization) isolation, least privilege, resource-level
 * permissions. Workspace isolation itself is enforced upstream (the service
 * only ever loads records for the caller's workspace); these predicates gate
 * *what* a member may do within a workspace they already belong to.
 *
 * Role hierarchy: owner ≥ admin ≥ member.
 */
const ROLE_RANK: Record<WorkspaceRole, number> = {
  member: 1,
  admin: 2,
  owner: 3,
};

/** Whether `role` is at least `min` in the hierarchy. */
export function roleAtLeast(role: WorkspaceRole, min: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** Any member of the workspace may view its operations. */
export function canViewOperations(workspace: Workspace): boolean {
  return roleAtLeast(workspace.role, 'member');
}

/** Any member may create operations in their workspace. */
export function canCreateOperation(workspace: Workspace): boolean {
  return roleAtLeast(workspace.role, 'member');
}

/**
 * A member may modify an operation they created; admins and owners may modify
 * any operation in the workspace. Covers both edits and lifecycle transitions.
 */
export function canManageOperation(
  user: AuthUser,
  workspace: Workspace,
  operation: Operation,
): boolean {
  return operation.createdBy === user.id || roleAtLeast(workspace.role, 'admin');
}
