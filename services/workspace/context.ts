import { cache } from 'react';

import { getCurrentUser } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/env';
import { workspaceRepository } from '@/services/workspaces/personal-workspace-repository';
import type { AuthUser, Workspace } from '@/types';

/** The resolved caller: who is acting and in which workspace. */
export interface WorkspaceContext {
  user: AuthUser;
  workspace: Workspace;
}

/**
 * Deterministic local operator, used ONLY when Supabase auth is not configured,
 * so the console (operations, agents) is usable via `next dev` without secrets —
 * mirroring how Sprint 2 keeps the console reachable. Never used when auth IS
 * configured (an unauthenticated caller resolves to `null` and middleware has
 * already redirected them to `/login`).
 */
const LOCAL_DEV_USER: AuthUser = {
  id: 'local-operator',
  email: null,
  displayName: 'Local Operator',
  avatarUrl: null,
};

/**
 * Resolve the current caller and their active workspace, memoized per request.
 *
 * When `requestedWorkspaceId` is given (e.g. from a workspace-scoped
 * command-palette request), the workspace is honored ONLY if the caller is a
 * member of it — otherwise `null` is returned, so a client can never read
 * another workspace's data by passing a foreign id (the fix for TD-13). Without
 * a requested id, the caller's first (personal) workspace is used.
 */
/**
 * Pure workspace-selection rule (extracted for testability): honor a requested
 * id ONLY if the caller is a member of it, else `null`; without a request, use
 * the first (personal) workspace. This is the guard that stops a client reading
 * another workspace's data by passing a foreign id (TD-13).
 */
export function resolveWorkspace(
  workspaces: Workspace[],
  requestedWorkspaceId?: string,
): Workspace | null {
  if (requestedWorkspaceId) {
    return workspaces.find((w) => w.id === requestedWorkspaceId) ?? null;
  }
  return workspaces[0] ?? null;
}

export const getWorkspaceContext = cache(
  async (requestedWorkspaceId?: string): Promise<WorkspaceContext | null> => {
    let user = await getCurrentUser();
    if (!user && !isSupabaseConfigured()) user = LOCAL_DEV_USER;
    if (!user) return null;

    const workspaces = await workspaceRepository.listForUser(user);
    const workspace = resolveWorkspace(workspaces, requestedWorkspaceId);
    if (!workspace) return null;

    return { user, workspace };
  },
);
