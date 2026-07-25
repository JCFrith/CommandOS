import type { WorkspaceRole } from '@/types';

/**
 * Workspace role hierarchy, shared by every feature's permission rules so RBAC
 * is defined once. owner ≥ admin ≥ member (per `13_SECURITY_GOVERNANCE.md`).
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
