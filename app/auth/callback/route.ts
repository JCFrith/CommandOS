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
  // Only allow same-origin relative redirects to avoid open redirects. Reject
  // protocol-relative (`//host`) and backslash (`/\host`) forms that browsers
  // can resolve to a different origin.
  const isSafeNext =
    !!nextParam &&
    nextParam.startsWith('/') &&
    !nextParam.startsWith('//') &&
    !nextParam.startsWith('/\\');
  const next = isSafeNext ? nextParam : '/console';

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
