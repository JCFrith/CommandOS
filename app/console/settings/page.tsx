import type { Metadata } from 'next';
import { Settings } from 'lucide-react';

import { SectionShell } from '@/components/os/section-shell';
import { SignOutButton } from '@/components/os/sign-out-button';
import { getCurrentUser } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/env';
import { getWorkspaceContext } from '@/services/workspaces/personal-workspace-repository';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const user = await getCurrentUser();
  const { current: workspace } = await getWorkspaceContext(user);

  return (
    <SectionShell
      icon={Settings}
      title="Settings"
      description="Your account and the workspace you're operating within."
    >
      <div className="grid gap-4">
        <section className="border-border/60 bg-card/40 rounded-2xl border p-6 backdrop-blur">
          <h2 className="text-sm font-semibold">Account</h2>
          {user ? (
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
              <dt className="text-muted-foreground">Name</dt>
              <dd>{user.displayName}</dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd>{user.email ?? '—'}</dd>
            </dl>
          ) : (
            <p className="text-muted-foreground mt-3 text-sm">
              {isSupabaseConfigured()
                ? 'You are not signed in.'
                : 'Running without authentication — configure Supabase to enable accounts.'}
            </p>
          )}
        </section>

        {workspace && (
          <section className="border-border/60 bg-card/40 rounded-2xl border p-6 backdrop-blur">
            <h2 className="text-sm font-semibold">Workspace</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
              <dt className="text-muted-foreground">Name</dt>
              <dd>{workspace.name}</dd>
              <dt className="text-muted-foreground">Role</dt>
              <dd className="capitalize">{workspace.role}</dd>
              <dt className="text-muted-foreground">Type</dt>
              <dd className="capitalize">{workspace.kind}</dd>
            </dl>
            <p className="text-muted-foreground mt-4 text-xs">
              Shared team workspaces arrive in a later sprint.
            </p>
          </section>
        )}

        {user && (
          <div>
            <SignOutButton />
          </div>
        )}
      </div>
    </SectionShell>
  );
}
