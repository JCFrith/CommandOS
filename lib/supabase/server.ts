import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { serverEnv } from '@/lib/env';

/**
 * Server Supabase client bound to the request cookie store. Use inside
 * Server Components, Server Actions and Route Handlers.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const env = serverEnv();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // `setAll` was called from a Server Component. Safe to ignore when
          // middleware is refreshing sessions.
        }
      },
    },
  });
}
