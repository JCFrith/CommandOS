'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';

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
import { useCommandPalette } from '@/store/command-palette';
import type { Command } from '@/types';

/**
 * Destinations for action commands until their dedicated features land. Each
 * still performs a real navigation to where the action is carried out, carrying
 * the intent as a query param the target surface can honor.
 */
const ACTION_ROUTES: Record<ActionCommandId, Route> = {
  'create.operation': '/console/operations?intent=new' as Route,
  'agent.dispatch': '/console/agents?intent=dispatch' as Route,
};

/**
 * Global ⌘K / Ctrl-K command palette. Mounted once at the root so an operator
 * can command the system from anywhere. Server state stays in TanStack Query;
 * palette open/query state lives in the Zustand store.
 */
export function CommandMenu() {
  const router = useRouter();
  const { open, setOpen, toggle, query, setQuery, reset } = useCommandPalette();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggle();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  const runCommand = (command: Command) => {
    reset();
    const destination = command.href ?? ACTION_ROUTES[command.id as ActionCommandId];
    if (destination) {
      router.push(destination);
    }
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
      </CommandList>
    </CommandDialog>
  );
}
