import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { supabaseServiceConfig } from '@/lib/env';

/**
 * The **service-role** Supabase client — bypasses Row Level Security, so it is
 * SERVER + WORKER ONLY and its key is never exposed to the client. Production
 * repository adapters and the background worker use it, and every query they run
 * is explicitly scoped by `workspace_id` (the service layer already authorizes
 * before calling), so bypassing RLS never means bypassing tenant isolation.
 *
 * No cookies / no session — a plain client with auth persistence disabled, safe
 * to reuse across stateless serverless invocations.
 */
let cached: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient {
  if (cached) return cached;
  const { url, serviceKey } = supabaseServiceConfig();
  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
