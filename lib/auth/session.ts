import { cache } from 'react';
import type { User } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import type { AuthUser } from '@/types';

/**
 * Project a Supabase auth user onto the app's {@link AuthUser} shape, deriving a
 * human display name from metadata or the email local-part.
 */
export function toAuthUser(user: User): AuthUser {
  const meta = user.user_metadata ?? {};
  const email = user.email ?? null;
  const displayName =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    email?.split('@')[0] ||
    'Operator';

  return {
    id: user.id,
    email,
    displayName,
    avatarUrl: typeof meta.avatar_url === 'string' ? meta.avatar_url : null,
  };
}

/**
 * The current authenticated operator, or `null` when signed out or when auth is
 * not configured. Request-memoized via React `cache` so multiple server
 * components share a single `getUser()` round-trip.
 */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ? toAuthUser(user) : null;
});
