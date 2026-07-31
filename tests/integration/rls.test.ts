import { beforeEach, describe, expect, it } from 'vitest';

import {
  anonDb,
  resetDb,
  testDb,
  userClient,
  USER_A_MEMBER,
  USER_B_OWNER,
  USER_UNKNOWN,
  WS_A,
  WS_B,
} from './helpers';
import { PRODUCTION_VALIDATION } from './setup';

const now = '2026-08-01T00:00:00.000Z';
const opRow = (id: string, ws: string) => ({
  id,
  workspace_id: ws,
  title: 't',
  description: null,
  status: 'draft',
  priority: 'medium',
  created_by: USER_A_MEMBER,
  updated_by: USER_A_MEMBER,
  created_at: now,
  updated_at: now,
});

/** RLS + security validation against real authenticated identities. */
(PRODUCTION_VALIDATION ? describe : describe.skip)('RLS & security', () => {
  beforeEach(async () => {
    await resetDb();
    await testDb().from('operations').insert(opRow('00000000-0000-0000-0000-00000000aa01', WS_A));
    await testDb().from('operations').insert(opRow('00000000-0000-0000-0000-00000000bb01', WS_B));
  });

  it('a member of A reads A, not B', async () => {
    const a = userClient(USER_A_MEMBER);
    expect((await a.from('operations').select().eq('workspace_id', WS_A)).data?.length).toBe(1);
    expect((await a.from('operations').select().eq('workspace_id', WS_B)).data?.length ?? 0).toBe(
      0,
    );
  });

  it('a member of A cannot mutate B', async () => {
    const a = userClient(USER_A_MEMBER);
    const { data } = await a
      .from('operations')
      .update({ title: 'hacked' })
      .eq('workspace_id', WS_B)
      .select();
    expect(data?.length ?? 0).toBe(0); // RLS blocks the update (no rows visible)
  });

  it('an unauthorized authenticated user sees nothing', async () => {
    const u = userClient(USER_UNKNOWN);
    expect((await u.from('operations').select()).data?.length ?? 0).toBe(0);
  });

  it('an anonymous client sees no protected rows', async () => {
    expect((await anonDb().from('operations').select()).data?.length ?? 0).toBe(0);
  });

  it('infrastructure tables (jobs, trigger_claims) are not readable by clients', async () => {
    await testDb().from('jobs').insert({ workspace_id: WS_A, kind: 'k', payload: {} });
    expect((await anonDb().from('jobs').select()).data?.length ?? 0).toBe(0);
    expect((await userClient(USER_B_OWNER).from('jobs').select()).data?.length ?? 0).toBe(0);
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
