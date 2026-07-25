import type { AuthUser, Operation, Workspace } from '@/types';
import { roleAtLeast } from '@/lib/authz/roles';

/**
 * Authorization rules for Operations.
 *
 * Follows the governance principles in `13_SECURITY_GOVERNANCE.md`: RBAC,
 * workspace (organization) isolation, least privilege, resource-level
 * permissions. Workspace isolation itself is enforced upstream (the service
 * only ever loads records for the caller's workspace); these predicates gate
 * *what* a member may do within a workspace they already belong to.
 *
 * The role hierarchy (owner ≥ admin ≥ member) lives in `@/lib/authz/roles`.
 */
export { roleAtLeast };

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
