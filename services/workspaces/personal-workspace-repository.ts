import type * as EnvMod from '@/lib/env';
import type { AuthUser, Workspace } from '@/types';
import type { WorkspaceRepository } from './workspace-repository';
import type * as SupabaseWorkspaceMod from './supabase-workspace-repository';

/** Deterministic id for a user's personal workspace (dev/in-memory only). */
export function personalWorkspaceId(userId: string): string {
  return `personal-${userId}`;
}

/**
 * Every authenticated operator owns exactly one personal workspace, derived
 * from their identity. This is real data — no placeholder rows — and satisfies
 * the {@link WorkspaceRepository} contract until shared team workspaces (backed
 * by a Supabase table) land in a later sprint.
 */
export class PersonalWorkspaceRepository implements WorkspaceRepository {
  private build(user: AuthUser): Workspace {
    const handle = user.displayName || user.email?.split('@')[0] || 'operator';
    return {
      id: personalWorkspaceId(user.id),
      name: `${handle}'s workspace`,
      slug: 'personal',
      role: 'owner',
      kind: 'personal',
    };
  }

  async listForUser(user: AuthUser): Promise<Workspace[]> {
    return [this.build(user)];
  }

  async getForUser(user: AuthUser, workspaceId: string): Promise<Workspace | null> {
    const workspace = this.build(user);
    return workspace.id === workspaceId ? workspace : null;
  }
}

/**
 * The active workspace repository, gated on persistence: the Postgres-backed
 * {@link SupabaseWorkspaceRepository} (persisted uuid workspaces + memberships)
 * when Supabase persistence is enabled, otherwise the dev in-memory
 * {@link PersonalWorkspaceRepository} — unchanged behavior with persistence off.
 * The server-only Supabase adapter is lazily required so the dev path never pulls
 * `server-only` into non-server bundles.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
function buildWorkspaceRepository(): WorkspaceRepository {
  try {
    const env = require('@/lib/env') as typeof EnvMod;
    if (env.isSupabasePersistenceEnabled()) {
      const mod =
        require('@/services/workspaces/supabase-workspace-repository') as typeof SupabaseWorkspaceMod;
      return new mod.SupabaseWorkspaceRepository();
    }
  } catch {
    /* fall through to the dev in-memory repository */
  }
  return new PersonalWorkspaceRepository();
}
/* eslint-enable @typescript-eslint/no-require-imports */

export const workspaceRepository: WorkspaceRepository = buildWorkspaceRepository();

/**
 * Resolve the workspaces available to a (possibly signed-out) operator and the
 * current one. Shared by the console shell and settings so the "first workspace
 * is current" rule lives in a single place.
 */
export async function getWorkspaceContext(
  user: AuthUser | null,
): Promise<{ workspaces: Workspace[]; current: Workspace | null }> {
  const workspaces = user ? await workspaceRepository.listForUser(user) : [];
  return { workspaces, current: workspaces[0] ?? null };
}
