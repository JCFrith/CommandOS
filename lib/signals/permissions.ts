import type { Workspace } from '@/types';
import { roleAtLeast } from '@/lib/authz/roles';

/**
 * Signal authorization. Signals are workspace-scoped observability data: any
 * member of a workspace may view its signals and acknowledge/resolve them. The
 * hard isolation guarantee (a caller never sees another workspace's signals) is
 * enforced by scoping every query to `ctx.workspace.id` in the service and
 * store — these role checks are the RBAC layer on top of that boundary.
 */

/** Whether the caller may view signals in this workspace. */
export function canViewSignals(workspace: Workspace): boolean {
  return roleAtLeast(workspace.role, 'member');
}

/** Whether the caller may acknowledge/resolve signals in this workspace. */
export function canManageSignals(workspace: Workspace): boolean {
  return roleAtLeast(workspace.role, 'member');
}
