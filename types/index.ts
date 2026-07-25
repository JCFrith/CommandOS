/**
 * Shared domain types for CommandOS.
 */

/** A single actionable command surfaced in the palette or agent feed. */
export interface Command {
  id: string;
  label: string;
  description?: string;
  group: CommandGroup;
  shortcut?: string[];
}

export type CommandGroup = 'navigate' | 'create' | 'agent' | 'system';

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
