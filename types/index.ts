import type { Route } from 'next';
import type { LucideIcon } from 'lucide-react';

/**
 * Shared domain types for CommandOS.
 */

/** A single actionable command surfaced in the palette or agent feed. */
export interface Command {
  id: string;
  label: string;
  description?: string;
  group: CommandGroup;
  icon?: LucideIcon;
  /** Extra terms used for fuzzy matching in the palette. */
  keywords?: string[];
  /** Route-safe destination for navigation commands. */
  href?: Route;
  /** Display-only keyboard hint, e.g. `['⌘', 'K']`. */
  shortcut?: string[];
}

export type CommandGroup = 'navigate' | 'create' | 'agent' | 'system';

/** Human-readable heading for each command group, in display order. */
export const COMMAND_GROUP_LABELS: Record<CommandGroup, string> = {
  navigate: 'Navigate',
  create: 'Create',
  agent: 'Agents',
  system: 'System',
};

/** Status of an autonomous or user-triggered operation. */
export type OperationStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed';

/** A unit of work executed by the platform, human- or agent-initiated. */
export interface Operation {
  id: string;
  title: string;
  status: OperationStatus;
  createdAt: string;
  updatedAt: string;
}
