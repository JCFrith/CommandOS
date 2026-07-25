'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { credentialsSchema, type Credentials, type OAuthProvider } from '@/lib/auth/schema';
import { signInWithOAuth, signInWithPassword, signUpWithPassword } from '@/app/(auth)/actions';

type Mode = 'signin' | 'signup';

/**
 * Email/password + OAuth authentication form. Client-side validation is owned by
 * React Hook Form + Zod; submission calls the server actions, which re-validate
 * with the same schema and own the redirect on success.
 */
export function AuthForm({ notice }: { notice?: string }) {
  const [mode, setMode] = useState<Mode>('signin');
  const [serverError, setServerError] = useState<string | null>(null);
  const [oauthPending, setOAuthPending] = useState<OAuthProvider | null>(null);

  const form = useForm<Credentials>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onBlur',
  });

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    const formData = new FormData();
    formData.set('email', values.email);
    formData.set('password', values.password);
    const action = mode === 'signin' ? signInWithPassword : signUpWithPassword;
    const result = await action(formData);
    // Success redirects; only an error state returns here.
    if (result?.error) setServerError(result.error);
  });

  const startOAuth = async (provider: OAuthProvider) => {
    setServerError(null);
    setOAuthPending(provider);
    const formData = new FormData();
    formData.set('provider', provider);
    const result = await signInWithOAuth(formData);
    if (result?.error) {
      setServerError(result.error);
      setOAuthPending(null);
    }
  };

  const busy = form.formState.isSubmitting || oauthPending !== null;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-2">
        {(['google', 'github'] as const).map((provider) => (
          <Button
            key={provider}
            type="button"
            variant="outline"
            disabled={busy}
            aria-label={`Continue with ${provider}`}
            onClick={() => startOAuth(provider)}
          >
            {oauthPending === provider ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <span className="capitalize">{provider}</span>
            )}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <span className="bg-border h-px flex-1" />
        <span className="text-muted-foreground text-xs">or continue with email</span>
        <span className="bg-border h-px flex-1" />
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="operator@commandos.app"
            aria-invalid={!!form.formState.errors.email}
            aria-describedby={form.formState.errors.email ? 'email-error' : undefined}
            {...form.register('email')}
          />
          {form.formState.errors.email && (
            <p id="email-error" className="text-destructive text-xs">
              {form.formState.errors.email.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            placeholder="••••••••"
            aria-invalid={!!form.formState.errors.password}
            aria-describedby={form.formState.errors.password ? 'password-error' : undefined}
            {...form.register('password')}
          />
          {form.formState.errors.password && (
            <p id="password-error" className="text-destructive text-xs">
              {form.formState.errors.password.message}
            </p>
          )}
        </div>

        {(serverError || notice) && (
          <p
            role={serverError ? 'alert' : 'status'}
            aria-live={serverError ? 'assertive' : 'polite'}
            className={cn(
              'rounded-lg border px-3 py-2 text-xs',
              serverError
                ? 'border-destructive/40 bg-destructive/10 text-destructive'
                : 'border-primary/40 bg-primary/10 text-primary',
            )}
          >
            {serverError ?? notice}
          </p>
        )}

        <Button type="submit" disabled={busy} className="mt-1">
          {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </Button>
      </form>

      <p className="text-muted-foreground text-center text-sm">
        {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
        <button
          type="button"
          className="text-foreground font-medium underline-offset-4 hover:underline"
          onClick={() => {
            setServerError(null);
            setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
          }}
        >
          {mode === 'signin' ? 'Create one' : 'Sign in'}
        </button>
      </p>
    </div>
  );
}
