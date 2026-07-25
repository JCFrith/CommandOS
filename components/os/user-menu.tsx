'use client';

import { LogOut, Settings, User as UserIcon } from 'lucide-react';
import Link from 'next/link';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOut } from '@/app/(auth)/actions';
import type { AuthUser } from '@/types';

function initials(user: AuthUser): string {
  const source = user.displayName || user.email || 'O';
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

/**
 * Authenticated operator menu: identity, quick links, and sign-out (a server
 * action that clears the session and redirects to `/login`).
 */
export function UserMenu({ user }: { user: AuthUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="focus-visible:ring-ring/50 rounded-full focus-visible:ring-2 focus-visible:outline-none">
        <Avatar>
          {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.displayName} />}
          <AvatarFallback>{initials(user)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{user.displayName}</span>
          {user.email && (
            <span className="text-muted-foreground truncate text-xs font-normal">{user.email}</span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/console/settings">
            <UserIcon className="size-4" />
            Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/console/settings">
            <Settings className="size-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => {
            void signOut();
          }}
        >
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
