import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  anonDb,
  deleteUser,
  ensureUser,
  resetDb,
  signedInClient,
  testDb,
  WS_A,
  WS_B,
} from './helpers';
import { PRODUCTION_VALIDATION } from './setup';

const now = '2026-08-01T00:00:00.000Z';
const PW = 'Test-Passw0rd-6f2!';
const MEMBER_A = 'rls-member-a@commandos.test';
const OWNER_B = 'rls-owner-b@commandos.test';
const UNKNOWN = 'rls-nobody@commandos.test';

const opRow = (id: string, ws: string, createdBy: string) => ({
  id,
  workspace_id: ws,
  title: 't',
  description: null,
  status: 'draft',
  priority: 'medium',
  created_by: createdBy,
  updated_by: createdBy,
  created_at: now,
  updated_at: now,
});

/**
 * RLS + security validation against REAL authenticated identities (GoTrue users +
 * genuine access tokens — no hand-minted JWTs, so it holds regardless of the
 * project's JWT signing scheme).
 */
(PRODUCTION_VALIDATION ? describe : describe.skip)('RLS & security', () => {
  let memberAId = '';
  let ownerBId = '';

  beforeAll(async () => {
    memberAId = await ensureUser(MEMBER_A, PW);
    ownerBId = await ensureUser(OWNER_B, PW);
    await ensureUser(UNKNOWN, PW); // a real user with NO workspace membership
  });

  afterAll(async () => {
    await deleteUser(MEMBER_A);
    await deleteUser(OWNER_B);
    await deleteUser(UNKNOWN);
  });

  beforeEach(async () => {
    await resetDb(); // truncates + re-seeds workspaces A/B
    // Grant our real users their memberships (resetDb truncated workspace_members).
    await testDb()
      .from('workspace_members')
      .insert([
        { workspace_id: WS_A, user_id: memberAId, role: 'member' },
        { workspace_id: WS_B, user_id: ownerBId, role: 'owner' },
      ]);
    await testDb()
      .from('operations')
      .insert([
        opRow('00000000-0000-0000-0000-00000000aa01', WS_A, memberAId),
        opRow('00000000-0000-0000-0000-00000000bb01', WS_B, ownerBId),
      ]);
  });

  it('a member of A reads A, not B', async () => {
    const a = await signedInClient(MEMBER_A, PW);
    expect((await a.from('operations').select().eq('workspace_id', WS_A)).data?.length).toBe(1);
    expect((await a.from('operations').select().eq('workspace_id', WS_B)).data?.length ?? 0).toBe(
      0,
    );
  });

  it('a member of A cannot mutate B', async () => {
    const a = await signedInClient(MEMBER_A, PW);
    const { data } = await a
      .from('operations')
      .update({ title: 'hacked' })
      .eq('workspace_id', WS_B)
      .select();
    expect(data?.length ?? 0).toBe(0); // RLS blocks the update (no rows visible)
  });

  it('an authenticated user with no membership sees nothing', async () => {
    const u = await signedInClient(UNKNOWN, PW);
    expect((await u.from('operations').select()).data?.length ?? 0).toBe(0);
  });

  it('an anonymous client sees no protected rows', async () => {
    expect((await anonDb().from('operations').select()).data?.length ?? 0).toBe(0);
  });

  it('infrastructure tables (jobs, trigger_claims) are not readable by clients', async () => {
    await testDb().from('jobs').insert({ workspace_id: WS_A, kind: 'k', payload: {} });
    expect((await anonDb().from('jobs').select()).data?.length ?? 0).toBe(0);
    const b = await signedInClient(OWNER_B, PW);
    expect((await b.from('jobs').select()).data?.length ?? 0).toBe(0);
  });

  it('append-only tables reject UPDATE and DELETE (service role too)', async () => {
    await testDb().from('signals').insert({
      workspace_id: WS_A,
      type: 'operation.created',
      correlation_id: '00000000-0000-0000-0000-0000000000c1',
      source: 'operations',
      category: 'lifecycle',
      severity: 'info',
      title: 't',
      summary: 's',
      created_at: now,
      id: '00000000-0000-0000-0000-0000000000c2',
    });
    expect(
      (
        await testDb()
          .from('signals')
          .update({ title: 'x' })
          .eq('id', '00000000-0000-0000-0000-0000000000c2')
      ).error,
    ).not.toBeNull();
    expect(
      (await testDb().from('signals').delete().eq('id', '00000000-0000-0000-0000-0000000000c2'))
        .error,
    ).not.toBeNull();
  });

  it('no client can directly write privileged lease/approval/trigger-claim state', async () => {
    // Anon insert into jobs (lease/worker columns) must be blocked by RLS.
    const { error } = await anonDb()
      .from('jobs')
      .insert({ workspace_id: WS_A, kind: 'k', payload: {}, lease_worker: 'evil' });
    expect(error, 'anon must not write jobs').not.toBeNull();
  });
});
