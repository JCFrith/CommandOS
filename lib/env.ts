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
