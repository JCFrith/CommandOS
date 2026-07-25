'use client';

import { Check, ChevronsUpDown, Plus } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/components/os/workspace-provider';

/**
 * Switches the active workspace. Today every operator has a single personal
 * workspace; the switcher is ready to list shared team workspaces once they are
 * backed by the database.
 */
export function WorkspaceSwitcher() {
  const { workspaces, current, setCurrent } = useWorkspace();

  if (!current) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="border-border/60 bg-card/40 hover:border-border flex h-9 items-center gap-2 rounded-lg border px-2.5 text-sm transition-colors focus-visible:outline-none">
        <span className="bg-primary/15 text-primary grid size-5 shrink-0 place-items-center rounded text-[10px] font-semibold uppercase">
          {current.name.charAt(0)}
        </span>
        <span className="max-w-[10rem] truncate font-medium">{current.name}</span>
        <ChevronsUpDown className="text-muted-foreground size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-64">
        <DropdownMenuLabel className="text-muted-foreground text-xs">Workspaces</DropdownMenuLabel>
        {workspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.id}
            onSelect={() => setCurrent(workspace.id)}
            className="gap-2"
          >
            <span className="bg-primary/15 text-primary grid size-5 shrink-0 place-items-center rounded text-[10px] font-semibold uppercase">
              {workspace.name.charAt(0)}
            </span>
            <span className="flex-1 truncate">{workspace.name}</span>
            <Check
              className={cn('size-4', workspace.id === current.id ? 'opacity-100' : 'opacity-0')}
            />
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="text-muted-foreground gap-2">
          <Plus className="size-4" />
          New workspace
          <span className="ml-auto text-[10px] tracking-wide uppercase">Soon</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
