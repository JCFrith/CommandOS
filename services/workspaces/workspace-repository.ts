import type { AuthUser, Workspace } from '@/types';

/**
 * Persistence boundary for {@link Workspace} access. Feature code depends on
 * this interface; the backing implementation (personal-derived today, Supabase
 * team workspaces later) is swapped without touching call sites.
 */
export interface WorkspaceRepository {
  /** Every workspace the user can act within, current-first. */
  listForUser(user: AuthUser): Promise<Workspace[]>;
  /** Resolve a single workspace the user belongs to, or `null`. */
  getForUser(user: AuthUser, workspaceId: string): Promise<Workspace | null>;
}
