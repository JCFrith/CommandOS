import { cache } from 'react';

import { getCurrentUser } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/env';
import { workspaceRepository } from '@/services/workspaces/personal-workspace-repository';
import type { AuthUser } from '@/types';
import type { OperationsContext } from './operations-service';

/**
 * Deterministic local operator, used ONLY when Supabase auth is not configured,
 * so the Operations slice is fully usable via `npm run dev` without secrets —
 * mirroring how Sprint 2 keeps the console reachable without auth. When auth IS
 * configured, this is never used: an unauthenticated caller resolves to `null`
 * (and middleware has already redirected them to `/login`).
 */
const LOCAL_DEV_USER: AuthUser = {
  id: 'local-operator',
  email: null,
  displayName: 'Local Operator',
  avatarUrl: null,
};

/**
 * Resolve the current operations caller — the authenticated operator and their
 * active workspace — or `null` when signed out with auth configured. Memoized
 * per request via React `cache`.
 */
export const getOperationsContext = cache(async (): Promise<OperationsContext | null> => {
  let user = await getCurrentUser();
  if (!user && !isSupabaseConfigured()) user = LOCAL_DEV_USER;
  if (!user) return null;

  const workspaces = await workspaceRepository.listForUser(user);
  const workspace = workspaces[0];
  if (!workspace) return null;

  return { user, workspace };
});
