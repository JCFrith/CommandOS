'use client';

import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { Activity } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import { commandGroups, type ActionCommandId } from '@/lib/commands/registry';
import { useCommandShortcut } from '@/hooks/use-command-shortcut';
import { useCommandPalette } from '@/store/command-palette';
import { statusLabel } from '@/lib/operations/state-machine';
import type { Command, OperationStatus } from '@/types';

/**
 * Destinations for action commands. `create.operation` opens the create form;
 * `agent.dispatch` still navigates to its surface until Sprint 4 lands.
 */
const ACTION_ROUTES: Record<ActionCommandId, Route> = {
  'create.operation': '/console/operations/new' as Route,
  'agent.dispatch': '/console/agents?intent=dispatch' as Route,
};

interface OperationSummary {
  id: string;
  title: string;
  status: OperationStatus;
}

/** Fetch the current workspace's operations for palette find/open. */
async function fetchOperations(): Promise<OperationSummary[]> {
  const res = await fetch('/api/operations');
  if (!res.ok) return [];
  const data = (await res.json()) as { operations?: OperationSummary[] };
  return data.operations ?? [];
}

/**
 * Global ⌘K / Ctrl-K command palette. Mounted once at the root so an operator
 * can command the system from anywhere. Server state stays in TanStack Query;
 * palette open/query state lives in the Zustand store.
 */
export function CommandMenu() {
  const router = useRouter();
  const { open, setOpen, toggle, query, setQuery, reset } = useCommandPalette();

  useCommandShortcut(toggle);

  // Load operations only while the palette is open, so find/open stay live
  // without polling in the background.
  const { data: operations = [] } = useQuery({
    queryKey: ['palette-operations'],
    queryFn: fetchOperations,
    enabled: open,
    staleTime: 10_000,
  });

  const runCommand = (command: Command) => {
    reset();
    const destination = command.href ?? ACTION_ROUTES[command.id as ActionCommandId];
    if (destination) {
      router.push(destination);
    }
  };

  const openOperation = (id: string) => {
    reset();
    router.push(`/console/operations/${id}` as Route);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : reset())}
      title="Command CommandOS"
      description="Search commands, navigate, and dispatch work."
    >
      <CommandInput
        placeholder="Type a command or search…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No matching commands.</CommandEmpty>
        {commandGroups().map((section) => (
          <CommandGroup key={section.group} heading={section.label}>
            {section.commands.map((command) => (
              <CommandItem
                key={command.id}
                value={`${command.label} ${command.keywords?.join(' ') ?? ''}`}
                onSelect={() => runCommand(command)}
              >
                {command.icon && <command.icon />}
                <span className="flex flex-col">
                  <span>{command.label}</span>
                  {command.description && (
                    <span className="text-muted-foreground text-xs">{command.description}</span>
                  )}
                </span>
                {command.shortcut && (
                  <CommandShortcut>{command.shortcut.join(' ')}</CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        {operations.length > 0 && (
          <CommandGroup heading="Operations">
            {operations.map((op) => (
              <CommandItem
                key={op.id}
                value={`operation ${op.title}`}
                onSelect={() => openOperation(op.id)}
              >
                <Activity />
                <span className="flex flex-col">
                  <span className="truncate">{op.title}</span>
                  <span className="text-muted-foreground text-xs">{statusLabel(op.status)}</span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
