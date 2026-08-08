import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { anonDb, deleteUser, ensureUser, resetDb, signedInClient, testDb, WS_A } from './helpers';
import { PRODUCTION_VALIDATION } from './setup';

/**
 * Privilege / grant validation through the REAL PostgREST role boundary (service
 * role key, anon key, and a genuine authenticated GoTrue session). This is the
 * behavioural half of the Defect-2 guard — the SQL-level matrix lives in
 * scripts/validation/privileges.mjs. Together they assert: server-only RPCs are
 * service-role-only, and no browser role can mutate infrastructure state.
 */
const PW = 'Test-Passw0rd-6f2!';
const AUTHED = 'priv-authed@commandos.test';
const now = '2026-08-07T00:00:00.000Z';

(PRODUCTION_VALIDATION ? describe : describe.skip)('privileges & grants', () => {
  let authedId = '';

  beforeAll(async () => {
    authedId = await ensureUser(AUTHED, PW);
  });
  afterAll(async () => {
    await deleteUser(AUTHED);
  });
  beforeEach(async () => {
    await resetDb();
  });

  // ---- app_provision_personal_workspace: server-only -------------------------

  it('service_role CAN execute app_provision_personal_workspace', async () => {
    const userId = '00000000-0000-0000-0000-0000000d0001';
    const { data, error } = await testDb().rpc('app_provision_personal_workspace', {
      p_user_id: userId,
      p_name: 'Personal',
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });

  it('anon CANNOT execute app_provision_personal_workspace', async () => {
    const { error } = await anonDb().rpc('app_provision_personal_workspace', {
      p_user_id: '00000000-0000-0000-0000-0000000d0002',
      p_name: 'Hijack',
    });
    expect(error, 'anon must be denied EXECUTE on the provisioning RPC').not.toBeNull();
  });

  it('authenticated CANNOT execute app_provision_personal_workspace', async () => {
    const authed = await signedInClient(AUTHED, PW);
    const { error } = await authed.rpc('app_provision_personal_workspace', {
      p_user_id: authedId, // even provisioning for THEMSELVES must be denied (server-only)
      p_name: 'Self',
    });
    expect(error, 'authenticated must be denied EXECUTE on the provisioning RPC').not.toBeNull();
  });

  // ---- durable trigger/lease/resume infrastructure RPCs: server-only ---------

  it('service_role CAN execute durable infrastructure RPCs', async () => {
    const health = await testDb().rpc('app_durable_health', { p_now: now });
    expect(health.error).toBeNull();
    // Claiming due timers on an empty DB is a safe no-op that returns a count.
    const timers = await testDb().rpc('app_claim_due_timers', {
      p_now: now,
      p_limit: 10,
      p_job_kind: 'workflow.resume',
    });
    expect(timers.error).toBeNull();
    expect(typeof timers.data).toBe('number');
  });

  it('browser roles CANNOT execute durable infrastructure RPCs', async () => {
    const authed = await signedInClient(AUTHED, PW);
    for (const client of [anonDb(), authed]) {
      expect((await client.rpc('app_durable_health', { p_now: now })).error).not.toBeNull();
      expect(
        (
          await client.rpc('app_claim_due_timers', {
            p_now: now,
            p_limit: 10,
            p_job_kind: 'workflow.resume',
          })
        ).error,
      ).not.toBeNull();
      expect(
        (
          await client.rpc('app_advance_trigger_cursor', {
            p_workspace: WS_A,
            p_created_at: now,
            p_signal_id: '00000000-0000-0000-0000-0000000000e1',
            p_now: now,
          })
        ).error,
      ).not.toBeNull();
      expect(
        (
          await client.rpc('app_claim_approval_resume', {
            p_workspace: WS_A,
            p_approval_id: '00000000-0000-0000-0000-0000000000e2',
            p_run_id: '00000000-0000-0000-0000-0000000000e3',
            p_job_kind: 'workflow.resume',
            p_now: now,
          })
        ).error,
      ).not.toBeNull();
    }
  });

  it('browser roles CANNOT execute the job-lease RPC (claim_jobs)', async () => {
    const authed = await signedInClient(AUTHED, PW);
    for (const client of [anonDb(), authed]) {
      const { error } = await client.rpc('claim_jobs', {
        p_worker: 'evil',
        p_lease_ms: 1000,
        p_now: now,
        p_limit: 1,
      });
      expect(error, 'browser roles must not lease jobs').not.toBeNull();
    }
  });

  // ---- direct writes to infrastructure tables: denied for browser roles -------

  it('browser roles CANNOT mutate cursor / trigger-claim / job infrastructure tables', async () => {
    const authed = await signedInClient(AUTHED, PW);
    for (const client of [anonDb(), authed]) {
      expect(
        (
          await client
            .from('trigger_scan_cursor')
            .insert({ workspace_id: WS_A, last_signal_created_at: now })
        ).error,
        'no browser role may write trigger_scan_cursor',
      ).not.toBeNull();
      expect(
        (
          await client
            .from('trigger_claims')
            .insert({ workspace_id: WS_A, trigger_key: 'x', run_id: WS_A })
        ).error,
        'no browser role may write trigger_claims',
      ).not.toBeNull();
      expect(
        (await client.from('jobs').insert({ workspace_id: WS_A, kind: 'k', payload: {} })).error,
        'no browser role may write jobs',
      ).not.toBeNull();
    }
  });
});
