import { redirect } from 'next/navigation';

import { AppShell } from '@/components/os/app-shell';
import { getCurrentUser } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/env';
import { getWorkspaceContext } from '@/services/workspaces/personal-workspace-repository';

// Authenticated surface: always server-render per request so session state and
// route protection are never served from a static cache.
export const dynamic = 'force-dynamic';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  // Enforce auth when configured; middleware also guards, this is defense in
  // depth and gives the RSC tree the resolved user. Without Supabase configured
  // the console remains reachable for local development.
  if (isSupabaseConfigured() && !user) {
    redirect('/login');
  }

  const { workspaces, current } = await getWorkspaceContext(user);

  return (
    <AppShell user={user} workspaces={workspaces} currentWorkspace={current}>
      {children}
    </AppShell>
  );
}
