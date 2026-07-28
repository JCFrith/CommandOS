import {
  Activity,
  Bot,
  HeartPulse,
  LayoutDashboard,
  Plus,
  Radio,
  Settings,
  Waypoints,
  Workflow,
} from 'lucide-react';

import type { Command, CommandGroup } from '@/types';
import { COMMAND_GROUP_LABELS } from '@/types';

/**
 * The canonical command registry. Everything an operator can do from the ⌘K
 * palette is declared here as typed, route-safe data — no side effects, safe to
 * import from server or client. Navigation is driven by `href`; action commands
 * are dispatched by `id` in the palette.
 */
export const COMMANDS: readonly Command[] = [
  {
    id: 'nav.console',
    label: 'Go to Console',
    description: 'The CommandOS operations home',
    group: 'navigate',
    icon: LayoutDashboard,
    href: '/console',
    keywords: ['home', 'dashboard', 'overview'],
  },
  {
    id: 'nav.agents',
    label: 'Go to Agents',
    description: 'Autonomous operators',
    group: 'navigate',
    icon: Bot,
    href: '/console/agents',
    keywords: ['ai', 'automation', 'workers'],
  },
  {
    id: 'nav.signals',
    label: 'Go to Signals',
    description: 'Live operational telemetry',
    group: 'navigate',
    icon: Radio,
    href: '/console/signals',
    keywords: ['telemetry', 'events', 'metrics'],
  },
  {
    id: 'nav.operations',
    label: 'Go to Operations',
    description: 'Every unit of work, intent to outcome',
    group: 'navigate',
    icon: Activity,
    href: '/console/operations',
    keywords: ['tasks', 'jobs', 'work'],
  },
  {
    id: 'nav.workflows',
    label: 'Go to Workflows',
    description: 'Automation across the platform',
    group: 'navigate',
    icon: Workflow,
    href: '/console/workflows',
    keywords: ['automation', 'triggers', 'orchestration', 'pipelines'],
  },
  {
    id: 'nav.settings',
    label: 'Go to Settings',
    group: 'navigate',
    icon: Settings,
    href: '/console/settings',
    keywords: ['preferences', 'config'],
  },
  {
    id: 'create.operation',
    label: 'New Operation',
    description: 'Start a new unit of work',
    group: 'create',
    icon: Plus,
    keywords: ['add', 'task', 'create'],
    shortcut: ['⌘', 'N'],
  },
  {
    id: 'create.agent',
    label: 'New Agent',
    description: 'Configure an AI collaborator',
    group: 'create',
    icon: Bot,
    keywords: ['add', 'ai', 'assistant', 'create'],
  },
  {
    id: 'create.workflow',
    label: 'New Workflow',
    description: 'Automate work across the platform',
    group: 'create',
    icon: Workflow,
    keywords: ['add', 'automation', 'workflow', 'create'],
  },
  {
    id: 'signals.health',
    label: 'View Runtime & Provider Health',
    description: 'Provider, runtime, and signal-bus status',
    group: 'system',
    icon: HeartPulse,
    keywords: ['health', 'status', 'provider', 'runtime', 'uptime', 'monitoring'],
  },
  {
    id: 'signals.correlations',
    label: 'View Correlations',
    description: 'Trace execution chains end to end',
    group: 'system',
    icon: Waypoints,
    keywords: ['correlation', 'trace', 'chain', 'flow'],
  },
  {
    id: 'signals.errors',
    label: 'Filter Signals: Errors',
    description: 'Signals at error severity and above',
    group: 'system',
    icon: Radio,
    keywords: ['filter', 'errors', 'failures', 'signals', 'alerts'],
  },
] as const;

/** Command ids that trigger an action rather than navigation. */
export type ActionCommandId =
  | 'create.operation'
  | 'create.agent'
  | 'create.workflow'
  | 'signals.health'
  | 'signals.correlations'
  | 'signals.errors';

/** Ordered list of the groups that actually contain commands. */
export function commandGroups(): { group: CommandGroup; label: string; commands: Command[] }[] {
  const order: CommandGroup[] = ['navigate', 'create', 'agent', 'system'];
  return order
    .map((group) => ({
      group,
      label: COMMAND_GROUP_LABELS[group],
      commands: COMMANDS.filter((c) => c.group === group),
    }))
    .filter((section) => section.commands.length > 0);
}
