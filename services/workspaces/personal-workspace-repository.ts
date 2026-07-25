import type { AuthUser, Workspace } from '@/types';
import type { WorkspaceRepository } from './workspace-repository';

/** Deterministic id for a user's personal workspace. */
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

/** The active workspace repository. Swap here when team workspaces arrive. */
export const workspaceRepository: WorkspaceRepository = new PersonalWorkspaceRepository();

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
