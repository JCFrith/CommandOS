import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AuthForm } from '@/components/os/auth-form';
import { getCurrentUser } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Sign in' };

const NOTICES: Record<string, string> = {
  checkEmail: 'Check your inbox to confirm your email, then sign in.',
  auth: 'That sign-in link was invalid or expired. Please try again.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ checkEmail?: string; error?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect('/console');

  const params = await searchParams;
  const notice = params.checkEmail ? NOTICES.checkEmail : params.error ? NOTICES.auth : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Enter CommandOS</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">Sign in to command your operation.</p>
      </div>
      <AuthForm notice={notice} />
    </div>
  );
}
