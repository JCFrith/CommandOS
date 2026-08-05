import { beforeEach, describe, expect, it } from 'vitest';

import { SupabaseAgentRepository } from '@/services/agents/supabase-agent-repository';
import { SupabaseOperationsRepository } from '@/services/operations/supabase-operations-repository';
import { SupabaseWorkspaceRepository } from '@/services/workspaces/supabase-workspace-repository';
import { SupabaseWorkflowRepository } from '@/services/workflows/supabase-workflow-repository';
import type { AuthUser } from '@/types';
import { anonDb, resetDb, testDb } from './helpers';
import { PRODUCTION_VALIDATION } from './setup';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const now = '2026-08-01T00:00:00.000Z';
const user = (id: string, email = 'op@commandos.test'): AuthUser => ({
  id,
  email,
  displayName: email.split('@')[0] ?? 'op',
  avatarUrl: null,
});

/** Durable personal-workspace provisioning (the fix for the staging-blocking gap). */
(PRODUCTION_VALIDATION ? describe : describe.skip)('workspace provisioning — Supabase', () => {
  const repo = new SupabaseWorkspaceRepository();

  beforeEach(async () => {
    await resetDb();
  });

  it('first request provisions a personal workspace (valid uuid) + owner membership', async () => {
    const workspaces = await repo.listForUser(user(USER_A));
    expect(workspaces).toHaveLength(1);
    const ws = workspaces[0]!;
    expect(ws.kind).toBe('personal');
    expect(ws.role).toBe('owner');
    expect(ws.id).toMatch(UUID_RE); // a REAL uuid, not "personal-<id>"

    const { data: rows } = await testDb()
      .from('workspaces')
      .select('id, owner_id, kind')
      .eq('owner_id', USER_A);
    expect(rows).toHaveLength(1);
    const { data: mem } = await testDb()
      .from('workspace_members')
      .select('role')
      .eq('user_id', USER_A)
      .eq('workspace_id', ws.id);
    expect(mem).toHaveLength(1);
    expect(mem![0]!.role).toBe('owner');
  });

  it('subsequent requests reuse the same workspace (idempotent)', async () => {
    const a = await repo.listForUser(user(USER_A));
    const b = await repo.listForUser(user(USER_A));
    expect(b[0]!.id).toBe(a[0]!.id);
    const { count } = await testDb()
      .from('workspaces')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', USER_A);
    expect(count).toBe(1);
  });

  it('concurrent first requests create exactly one workspace + one owner membership', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => repo.listForUser(user(USER_A))),
    );
    expect(new Set(results.map((r) => r[0]!.id)).size).toBe(1);
    const { count: wsCount } = await testDb()
      .from('workspaces')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', USER_A);
    expect(wsCount).toBe(1);
    const { count: memCount } = await testDb()
      .from('workspace_members')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', USER_A);
    expect(memCount).toBe(1);
  });

  it('a user cannot resolve another user’s personal workspace (isolation)', async () => {
    const [wsA] = await repo.listForUser(user(USER_A));
    await repo.listForUser(user(USER_B));
    expect(await repo.getForUser(user(USER_A), wsA!.id)).not.toBeNull();
    expect(await repo.getForUser(user(USER_B), wsA!.id)).toBeNull();
  });

  it('anonymous clients cannot provision or write workspace/membership rows', async () => {
    expect(
      (await anonDb().rpc('app_provision_personal_workspace', { p_user_id: USER_A, p_name: 'x' }))
        .error,
      'anon RPC must be rejected',
    ).not.toBeNull();
    expect(
      (
        await anonDb()
          .from('workspaces')
          .insert({ name: 'x', slug: 'x', kind: 'personal', owner_id: USER_A })
      ).error,
      'anon workspace insert must be rejected',
    ).not.toBeNull();
    expect(
      (
        await anonDb()
          .from('workspace_members')
          .insert({ workspace_id: USER_A, user_id: USER_A, role: 'owner' })
      ).error,
      'anon membership insert must be rejected',
    ).not.toBeNull();
  });

  it('Operations, Agents, and Workflows create against the provisioned workspace (FK satisfied)', async () => {
    const [ws] = await repo.listForUser(user(USER_A));
    const wsId = ws!.id;

    const ops = new SupabaseOperationsRepository();
    await ops.create({
      id: '00000000-0000-0000-0000-0000000000d1',
      workspaceId: wsId,
      title: 'op',
      description: null,
      status: 'draft',
      priority: 'medium',
      createdBy: USER_A,
      updatedBy: USER_A,
      createdAt: now,
      updatedAt: now,
    });
    expect(await ops.getById(wsId, '00000000-0000-0000-0000-0000000000d1')).not.toBeNull();

    const agents = new SupabaseAgentRepository();
    await agents.create({
      id: '00000000-0000-0000-0000-0000000000d2',
      workspaceId: wsId,
      name: 'a',
      type: 'operations',
      description: null,
      instructions: null,
      capabilities: [],
      status: 'draft',
      createdBy: USER_A,
      updatedBy: USER_A,
      createdAt: now,
      updatedAt: now,
    });
    expect(await agents.getById(wsId, '00000000-0000-0000-0000-0000000000d2')).not.toBeNull();

    const workflows = new SupabaseWorkflowRepository();
    await workflows.createWorkflow({
      id: '00000000-0000-0000-0000-0000000000d3',
      workspaceId: wsId,
      name: 'w',
      description: null,
      status: 'draft',
      currentVersionId: null,
      createdBy: USER_A,
      updatedBy: USER_A,
      createdAt: now,
      updatedAt: now,
    });
    const { data: wfRow } = await testDb()
      .from('workflows')
      .select('id')
      .eq('id', '00000000-0000-0000-0000-0000000000d3')
      .maybeSingle();
    expect(wfRow).not.toBeNull();
  });
});
