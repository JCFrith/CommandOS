'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Command, Search } from 'lucide-react';
import { motion } from 'framer-motion';

import { cn } from '@/lib/utils';
import { commandGroups } from '@/lib/commands/registry';
import { useCommandPalette } from '@/store/command-palette';
import { SystemStatus } from '@/components/os/system-status';
import { UserMenu } from '@/components/os/user-menu';
import { WorkspaceSwitcher } from '@/components/os/workspace-switcher';
import { WorkspaceProvider } from '@/components/os/workspace-provider';
import { Button } from '@/components/ui/button';
import type { AuthUser, Workspace } from '@/types';

const navCommands = commandGroups().find((s) => s.group === 'navigate')?.commands ?? [];

/**
 * The CommandOS console shell: a slim icon+label navigation rail, a top command
 * bar that surfaces ⌘K, the workspace switcher, and the operator menu.
 */
export function AppShell({
  children,
  user,
  workspaces,
  currentWorkspace,
}: {
  children: React.ReactNode;
  user: AuthUser | null;
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
}) {
  const pathname = usePathname();
  const setOpen = useCommandPalette((s) => s.setOpen);

  return (
    <WorkspaceProvider workspaces={workspaces} initialWorkspaceId={currentWorkspace?.id ?? null}>
      <div className="grid min-h-dvh grid-cols-[auto_1fr]">
        <aside className="border-border/60 bg-card/30 sticky top-0 flex h-dvh w-16 flex-col items-center gap-1 border-r py-4 backdrop-blur lg:w-60 lg:items-stretch lg:px-3">
          <Link
            href="/console"
            className="mb-4 flex items-center gap-2.5 px-1 lg:px-2"
            aria-label="CommandOS console"
          >
            <span className="bg-primary/15 text-primary ring-primary/25 grid size-9 shrink-0 place-items-center rounded-lg ring-1">
              <Command className="size-4" />
            </span>
            <span className="hidden text-sm font-semibold tracking-tight lg:inline">CommandOS</span>
          </Link>

          {currentWorkspace && (
            <div className="mb-3 hidden lg:block">
              <WorkspaceSwitcher />
            </div>
          )}

          <nav className="flex flex-col gap-1">
            {navCommands.map((item) => {
              const href = item.href ?? '/console';
              const active =
                pathname === href || (href !== '/console' && pathname.startsWith(href));
              return (
                <Link
                  key={item.id}
                  href={href}
                  title={item.label}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group text-muted-foreground hover:text-foreground relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                    active && 'text-foreground',
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-active"
                      className="bg-primary/10 ring-primary/20 absolute inset-0 rounded-lg ring-1"
                      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    />
                  )}
                  {item.icon && <item.icon className="relative size-4.5 shrink-0" />}
                  <span className="relative hidden lg:inline">
                    {item.label.replace(/^Go to /, '')}
                  </span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="border-border/60 bg-background/70 sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b px-5 backdrop-blur">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="border-border/60 bg-card/40 text-muted-foreground hover:text-foreground hover:border-border flex h-9 w-full max-w-xs items-center gap-2 rounded-lg border px-3 text-sm transition-colors"
            >
              <Search className="size-4" />
              <span>Command…</span>
              <kbd className="border-border/60 bg-background/60 ml-auto rounded border px-1.5 py-0.5 font-mono text-[10px]">
                ⌘K
              </kbd>
            </button>
            <div className="flex items-center gap-4">
              <SystemStatus className="hidden sm:flex" />
              {user ? (
                <UserMenu user={user} />
              ) : (
                <Button asChild size="sm" variant="outline">
                  <Link href="/login">Sign in</Link>
                </Button>
              )}
            </div>
          </header>

          <main className="min-w-0 flex-1 px-5 py-8 lg:px-8">{children}</main>
        </div>
      </div>
    </WorkspaceProvider>
  );
}
