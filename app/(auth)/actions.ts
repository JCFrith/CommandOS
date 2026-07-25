'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { Route } from 'next';

import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import { credentialsSchema, OAUTH_PROVIDERS, type OAuthProvider } from '@/lib/auth/schema';

export interface AuthActionState {
  error: string | null;
}

const NOT_CONFIGURED: AuthActionState = {
  error: 'Authentication is not configured. Set Supabase credentials to sign in.',
};

function readCredentials(formData: FormData) {
  return credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
}

/** Resolve the app origin for building auth redirect URLs. */
async function origin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured;
  const host = (await headers()).get('host') ?? 'localhost:3000';
  const protocol = host.startsWith('localhost') ? 'http' : 'https';
  return `${protocol}://${host}`;
}

export async function signInWithPassword(formData: FormData): Promise<AuthActionState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;

  const parsed = readCredentials(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid credentials.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: error.message };

  redirect('/console');
}

export async function signUpWithPassword(formData: FormData): Promise<AuthActionState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;

  const parsed = readCredentials(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid credentials.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${await origin()}/auth/callback` },
  });
  if (error) return { error: error.message };

  redirect('/login?checkEmail=1' as Route);
}

export async function signInWithOAuth(formData: FormData): Promise<AuthActionState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;

  const provider = formData.get('provider');
  if (typeof provider !== 'string' || !OAUTH_PROVIDERS.includes(provider as OAuthProvider)) {
    return { error: 'Unsupported sign-in provider.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider as OAuthProvider,
    options: { redirectTo: `${await origin()}/auth/callback` },
  });
  if (error) return { error: error.message };
  if (data.url) redirect(data.url as Route);

  return { error: 'Could not start the sign-in flow.' };
}

export async function signOut(): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect('/login');
}
