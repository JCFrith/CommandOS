import { z } from 'zod';

/**
 * Environment validation.
 *
 * Schemas are declared once and validated lazily on first access so that
 * static builds (which may not have secrets injected) never crash at import
 * time. Access via `serverEnv()` / `clientEnv()`; both memoize their result.
 */

const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default('gpt-4o'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
});

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type ClientEnv = z.infer<typeof clientSchema>;

/**
 * Non-throwing check for whether Supabase credentials are present. Auth flows
 * and route protection are gated on this so the app builds and runs locally
 * without secrets configured.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * Whether the production Supabase persistence path is enabled. Requires Supabase
 * to be configured, the service-role key to be present, AND an explicit opt-in
 * flag — so `next dev`, tests, and unconfigured environments keep using the
 * development in-memory stores with identical behavior (Sprint 6.5 is an
 * infrastructure swap, not a behavior change). The worker also uses this gate.
 */
export function isSupabasePersistenceEnabled(): boolean {
  return (
    isSupabaseConfigured() &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
    process.env.USE_SUPABASE_PERSISTENCE === '1'
  );
}

/**
 * The service-role Supabase config (URL + service key). Bypasses RLS — SERVER +
 * WORKER ONLY, never exposed to the client. Throws if the persistence path is
 * not fully configured (callers gate on {@link isSupabasePersistenceEnabled}).
 */
export function supabaseServiceConfig(): { url: string; serviceKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Supabase service persistence is not configured (URL / service-role key).');
  }
  return { url, serviceKey };
}

/**
 * Non-throwing check for whether OpenAI credentials are present. AI execution is
 * gated on this so the app builds and runs without an API key configured, and
 * surfaces an honest "unavailable" state instead of fabricating output.
 */
export function isOpenAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Centralized AI provider configuration — the single source of model selection.
 * The model is NEVER taken from client input. Throws if OpenAI is not configured
 * (callers gate on {@link isOpenAIConfigured} first).
 */
export function openAIConfig(): { apiKey: string; model: string } {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OpenAI is not configured (missing OPENAI_API_KEY).');
  }
  return { apiKey, model: process.env.OPENAI_MODEL || 'gpt-4o' };
}

/**
 * The configured public app URL, if present. Used to build absolute auth
 * redirect URLs; callers fall back to the request host when it is absent
 * (e.g. preview deploys). Read through here rather than touching `process.env`
 * directly in feature code, per project conventions.
 */
export function configuredAppUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_APP_URL || undefined;
}

/**
 * The two public Supabase values needed to construct auth clients. Intentionally
 * narrower than {@link serverEnv} so auth does not depend on unrelated secrets
 * (OpenAI, service role). Throws a clear error if Supabase is not configured.
 */
export function supabasePublicConfig(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured (missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).',
    );
  }
  return { url, anonKey };
}

let cachedServerEnv: ServerEnv | null = null;
let cachedClientEnv: ClientEnv | null = null;

function format(error: z.ZodError): string {
  return error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
}

/**
 * Validated server-side environment. Throws with a readable report if any
 * required variable is missing. Call inside server code (Server Actions,
 * Route Handlers, RSC), never in the browser.
 */
export function serverEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid server environment:\n${format(parsed.error)}`);
  }
  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

/**
 * Validated public environment, safe to reference from client components.
 */
export function clientEnv(): ClientEnv {
  if (cachedClientEnv) return cachedClientEnv;
  const parsed = clientSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });
  if (!parsed.success) {
    throw new Error(`Invalid client environment:\n${format(parsed.error)}`);
  }
  cachedClientEnv = parsed.data;
  return cachedClientEnv;
}
