import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';

/**
 * OAuth / email-confirmation callback. Exchanges the returned `code` for a
 * session cookie, then redirects into the console (or a safe `next` path).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const nextParam = searchParams.get('next');
  // Only allow relative, single-segment-safe redirects to avoid open redirects.
  const next = nextParam && nextParam.startsWith('/') ? nextParam : '/console';

  if (code && isSupabaseConfigured()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
