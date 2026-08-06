import 'server-only';

import { serviceClient } from '@/lib/supabase/service';
import type { AuthUser, Workspace, WorkspaceKind, WorkspaceRole } from '@/types';
import type { WorkspaceRepository } from './workspace-repository';

/** A `workspaces` row (durable). */
interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  kind: WorkspaceKind;
  owner_id: string | null;
}

/** A `workspace_members` row with its embedded workspace. */
interface MembershipRow {
  role: WorkspaceRole;
  workspaces: WorkspaceRow | null;
}

/**
 * Production, Postgres-backed {@link WorkspaceRepository}.
 *
 * Personal workspaces are **persisted** as real `workspaces` rows (valid uuid ids)
 * with an owner `workspace_members` row — unlike the dev {@link
 * PersonalWorkspaceRepository}, which derives an application-only id. Provisioning
 * is done by the `app_provision_personal_workspace` RPC (idempotent + race-safe,
 * server-only), so the durable domain tables' `uuid` + foreign-key constraints on
 * `workspace_id` are satisfied for real authenticated users.
 *
 * Resolution is by **membership** (forward-compatible with team workspaces): the
 * caller sees every workspace they belong to, personal first.
 */
export class SupabaseWorkspaceRepository implements WorkspaceRepository {
  private get db() {
    return serviceClient();
  }

  async listForUser(user: AuthUser): Promise<Workspace[]> {
    // Ensure the user's personal workspace + owner membership exist (idempotent,
    // concurrency-safe). The user id is trusted (from the server session) — the
    // RPC is service-role-only, so this can never be client-driven.
    const { data: provisioned, error: provErr } = await this.db.rpc(
      'app_provision_personal_workspace',
      { p_user_id: user.id, p_name: personalWorkspaceName(user) },
    );
    if (provErr) throw new Error(`workspace provisioning failed: ${provErr.message}`);

    const { data, error } = await this.db
      .from('workspace_members')
      .select('role, workspaces(id, name, slug, kind, owner_id)')
      .eq('user_id', user.id);
    if (error) throw new Error(`workspace list failed: ${error.message}`);

    const rows = (data ?? []) as unknown as MembershipRow[];
    const workspaces = rows
      .filter((m): m is MembershipRow & { workspaces: WorkspaceRow } => m.workspaces !== null)
      .map((m) => toWorkspace(m.workspaces, m.role));

    // Personal first (stable), then by name — forward-compatible with teams.
    workspaces.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'personal' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    // Guard against a read lagging the just-committed provisioning write.
    const personal = provisioned as WorkspaceRow | null;
    if (personal && !workspaces.some((w) => w.id === personal.id)) {
      workspaces.unshift(toWorkspace(personal, 'owner'));
    }
    return workspaces;
  }

  async getForUser(user: AuthUser, workspaceId: string): Promise<Workspace | null> {
    const { data, error } = await this.db
      .from('workspace_members')
      .select('role, workspaces(id, name, slug, kind, owner_id)')
      .eq('user_id', user.id)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (error) throw new Error(`workspace lookup failed: ${error.message}`);
    const row = data as unknown as MembershipRow | null;
    if (!row || !row.workspaces) return null;
    return toWorkspace(row.workspaces, row.role);
  }
}

function personalWorkspaceName(user: AuthUser): string {
  const handle = user.displayName || user.email?.split('@')[0] || 'operator';
  return `${handle}'s workspace`;
}

function toWorkspace(row: WorkspaceRow, role: WorkspaceRole): Workspace {
  return { id: row.id, name: row.name, slug: row.slug, role, kind: row.kind };
}
