'use client';

import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { Activity, Bot, Play } from 'lucide-react';
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
import { recordCommandAction } from '@/app/console/signals/actions';
import {
  paletteAgentsKey,
  paletteAgentsUrl,
  paletteOperationsKey,
  paletteOperationsUrl,
  paletteSignalsKey,
  paletteSignalsUrl,
} from '@/lib/commands/palette';
import { SEVERITY_META } from '@/lib/signals/display';
import type { SignalSeverity } from '@/lib/signals/types';
import { useCommandShortcut } from '@/hooks/use-command-shortcut';
import { useCommandPalette } from '@/store/command-palette';
import { useWorkspaceStore } from '@/store/workspace';
import { statusLabel as operationStatusLabel } from '@/lib/operations/state-machine';
import { statusLabel as agentStatusLabel } from '@/lib/agents/state-machine';
import { TYPE_META } from '@/lib/agents/display';
import type { Command, OperationStatus, AgentStatus, AgentType } from '@/types';

/** Static action-command destinations (dynamic find/open/run handled below). */
const ACTION_ROUTES: Record<ActionCommandId, Route> = {
  'create.operation': '/console/operations/new' as Route,
  'create.agent': '/console/agents/new' as Route,
  'signals.health': '/console/signals?view=health' as Route,
  'signals.correlations': '/console/signals?view=correlations' as Route,
  'signals.errors': '/console/signals?severity=error' as Route,
};

interface OperationSummary {
  id: string;
  title: string;
  status: OperationStatus;
}
interface AgentSummary {
  id: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  runnable: boolean;
}

async function fetchOperations(workspaceId: string): Promise<OperationSummary[]> {
  const res = await fetch(paletteOperationsUrl(workspaceId));
  if (!res.ok) return [];
  const data = (await res.json()) as { operations?: OperationSummary[] };
  return data.operations ?? [];
}

async function fetchAgents(workspaceId: string): Promise<AgentSummary[]> {
  const res = await fetch(paletteAgentsUrl(workspaceId));
  if (!res.ok) return [];
  const data = (await res.json()) as { agents?: AgentSummary[] };
  return data.agents ?? [];
}

interface SignalSummary {
  id: string;
  title: string;
  severity: SignalSeverity;
}

async function fetchSignals(workspaceId: string): Promise<SignalSummary[]> {
  const res = await fetch(paletteSignalsUrl(workspaceId));
  if (!res.ok) return [];
  const data = (await res.json()) as { signals?: SignalSummary[] };
  return data.signals ?? [];
}

/**
 * Global ⌘K / Ctrl-K command palette. Server state (operations, agents) is
 * loaded via TanStack Query only while open, scoped by the active workspace id
 * so a workspace switch never surfaces another workspace's results (TD-13).
 */
export function CommandMenu() {
  const router = useRouter();
  const { open, setOpen, toggle, query, setQuery, reset } = useCommandPalette();
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  useCommandShortcut(toggle);

  const enabled = open && !!workspaceId;
  const { data: operations = [] } = useQuery({
    queryKey: paletteOperationsKey(workspaceId),
    queryFn: () => fetchOperations(workspaceId as string),
    enabled,
    staleTime: 10_000,
  });
  const { data: agents = [] } = useQuery({
    queryKey: paletteAgentsKey(workspaceId),
    queryFn: () => fetchAgents(workspaceId as string),
    enabled,
    staleTime: 10_000,
  });
  const { data: signals = [] } = useQuery({
    queryKey: paletteSignalsKey(workspaceId),
    queryFn: () => fetchSignals(workspaceId as string),
    enabled,
    staleTime: 10_000,
  });

  // Record the palette action as a Signal (best-effort, fire-and-forget so
  // navigation is never delayed). The server honors the workspace id only for a
  // workspace the caller belongs to.
  const record = (commandId: string) => {
    void recordCommandAction(commandId, workspaceId ?? undefined);
  };

  const go = (href: Route) => {
    reset();
    router.push(href);
  };

  const runCommand = (command: Command) => {
    record(command.id);
    const destination = command.href ?? ACTION_ROUTES[command.id as ActionCommandId];
    if (destination) go(destination);
  };

  const runnableAgents = agents.filter((a) => a.runnable);

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

        {runnableAgents.length > 0 && (
          <CommandGroup heading="Run agent">
            {runnableAgents.map((agent) => (
              <CommandItem
                key={`run-${agent.id}`}
                value={`run agent ${agent.name}`}
                onSelect={() => {
                  record('run.agent');
                  go(`/console/agents/${agent.id}` as Route);
                }}
              >
                <Play />
                <span className="flex flex-col">
                  <span className="truncate">Run {agent.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {TYPE_META[agent.type].label}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {agents.length > 0 && (
          <CommandGroup heading="Agents">
            {agents.map((agent) => (
              <CommandItem
                key={agent.id}
                value={`agent ${agent.name}`}
                onSelect={() => {
                  record('open.agent');
                  go(`/console/agents/${agent.id}` as Route);
                }}
              >
                <Bot />
                <span className="flex flex-col">
                  <span className="truncate">{agent.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {TYPE_META[agent.type].label} · {agentStatusLabel(agent.status)}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {operations.length > 0 && (
          <CommandGroup heading="Operations">
            {operations.map((op) => (
              <CommandItem
                key={op.id}
                value={`operation ${op.title}`}
                onSelect={() => {
                  record('open.operation');
                  go(`/console/operations/${op.id}` as Route);
                }}
              >
                <Activity />
                <span className="flex flex-col">
                  <span className="truncate">{op.title}</span>
                  <span className="text-muted-foreground text-xs">
                    {operationStatusLabel(op.status)}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {signals.length > 0 && (
          <CommandGroup heading="Signals">
            {signals.map((signal) => {
              const meta = SEVERITY_META[signal.severity];
              const Icon = meta.icon;
              return (
                <CommandItem
                  key={signal.id}
                  value={`signal ${signal.title}`}
                  onSelect={() => {
                    record('open.signal');
                    go(`/console/signals/${signal.id}` as Route);
                  }}
                >
                  <Icon />
                  <span className="flex flex-col">
                    <span className="truncate">{signal.title}</span>
                    <span className="text-muted-foreground text-xs">{meta.label}</span>
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
