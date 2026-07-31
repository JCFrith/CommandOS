import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect } from 'vitest';

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

/**
 * Mint a Supabase-compatible HS256 JWT for `userId` (role `authenticated`) using
 * the project JWT secret, so RLS `auth.uid()` resolves to a real identity. No
 * external dependency — HMAC-SHA256 by hand.
 */
export function signUserJwt(userId: string): string {
  const secret = process.env.SUPABASE_TEST_JWT_SECRET;
  if (!secret) throw new Error('SUPABASE_TEST_JWT_SECRET is required for RLS identity tests.');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({
      sub: userId,
      role: 'authenticated',
      aud: 'authenticated',
      iat: now,
      exp: now + 3600,
    }),
  );
  const sig = b64url(createHmac('sha256', secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

/** An RLS-bound client acting AS `userId` (anon key + a user JWT). */
export function userClient(userId: string): SupabaseClient {
  return createClient(
    process.env.SUPABASE_TEST_URL!,
    process.env.SUPABASE_TEST_ANON_KEY ?? 'anon-key',
    {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${signUserJwt(userId)}` } },
    },
  );
}

export const USER_A_OWNER = '00000000-0000-0000-0000-0000000a0001';
export const USER_A_MEMBER = '00000000-0000-0000-0000-0000000a0002';
export const USER_B_OWNER = '00000000-0000-0000-0000-0000000b0001';
export const USER_UNKNOWN = '00000000-0000-0000-0000-0000000c0001';

/** Service-role client for the VALIDATION database (bypasses RLS). */
export function testDb(): SupabaseClient {
  return createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

/** Anon (RLS-bound) client for RLS/identity tests, if the anon key is present. */
export function anonDb(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_TEST_URL!,
    process.env.SUPABASE_TEST_ANON_KEY ?? 'anon-key',
    { auth: { persistSession: false } },
  );
}

/** Reset the validation DB to a clean, seeded state (validation-only RPCs). */
export async function resetDb(): Promise<void> {
  const db = testDb();
  const { error } = await db.rpc('app_reset_validation');
  if (error)
    throw new Error(`reset failed (apply supabase/validation/reset.sql?): ${error.message}`);
  const { error: seedErr } = await db.rpc('app_seed_validation');
  if (seedErr) throw new Error(`seed failed: ${seedErr.message}`);
}

export const WS_A = '00000000-0000-0000-0000-00000000a001';
export const WS_B = '00000000-0000-0000-0000-00000000b001';

/**
 * Assert (and print) that every repository binding resolved to its Supabase
 * adapter — the production-smoke fails if any interface is still in-memory.
 */
export async function assertSupabaseBindings(): Promise<void> {
  const { operationsRepository } =
    await import('@/services/operations/in-memory-operations-repository');
  const { agentRepository } = await import('@/services/agents/in-memory-agent-repository');
  const { workflowRepository } = await import('@/services/workflows/in-memory-workflow-repository');
  const { executionLogger } = await import('@/lib/ai/runtime/logging');
  const { signalEventStore } = await import('@/lib/signals');
  const { jobStore } = await import('@/services/jobs');

  const bindings: Record<string, string> = {
    OperationsRepository: operationsRepository.constructor.name,
    AgentRepository: agentRepository.constructor.name,
    WorkflowRepository: workflowRepository.constructor.name,
    ExecutionLogger: executionLogger.constructor.name,
    SignalEventStore: signalEventStore.constructor.name,
    JobStore: jobStore.constructor.name,
  };
  for (const [iface, impl] of Object.entries(bindings)) {
    console.log(`  binding ${iface} → ${impl}`);
    expect(impl, `${iface} must be Supabase-backed during production validation`).toMatch(
      /^Supabase/,
    );
  }
}
