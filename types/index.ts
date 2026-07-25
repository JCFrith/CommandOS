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

/**
 * Lifecycle state of an Operation. The set and its legal transitions are the
 * "Task" state machine from `33_STATE_MACHINE_SPECIFICATION.md` — the canonical
 * lifecycle for a unit of work. See `lib/operations/state-machine.ts`.
 */
export type OperationStatus =
  'draft' | 'planned' | 'in_progress' | 'blocked' | 'completed' | 'archived';

/** Relative importance of an Operation (indexed per `03_DATABASE_SCHEMA.md`). */
export type OperationPriority = 'low' | 'medium' | 'high';

/**
 * A unit of work — human- or agent-initiated — tracked from intent to outcome.
 * Scoped to a {@link Workspace} (the tenant boundary; `organization_id` in the
 * schema) and carrying the audit fields the schema mandates (`created_by` /
 * `updated_by`, timestamps).
 */
export interface Operation {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  status: OperationStatus;
  priority: OperationPriority;
  /** User id of the operator who created the record. */
  createdBy: string;
  /** User id of the operator who last modified the record. */
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

/** The kinds of audit events an Operation records on its activity timeline. */
export type OperationActivityType = 'created' | 'updated' | 'status_changed';

/**
 * An immutable, timestamped entry on an Operation's activity timeline. Every
 * create / update / transition appends one (per the audit-logging rules in
 * `03_DATABASE_SCHEMA.md` and the event model in `32_EVENT_DRIVEN_ARCHITECTURE.md`).
 */
export interface OperationActivity {
  id: string;
  operationId: string;
  workspaceId: string;
  /** User id of the actor who caused the event. */
  actorId: string;
  /** Display-name snapshot of the actor at event time. */
  actorName: string;
  type: OperationActivityType;
  /** Human-readable summary, e.g. "moved from Planned to In Progress". */
  message: string;
  /** Previous status, for `status_changed` events. */
  fromStatus: OperationStatus | null;
  /** New status, for `status_changed` events. */
  toStatus: OperationStatus | null;
  createdAt: string;
}

/** The authenticated operator, projected from the auth provider. */
export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
}

/** A tenant boundary: the context an operator works within. */
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  kind: WorkspaceKind;
}

export type WorkspaceRole = 'owner' | 'admin' | 'member';

/** `personal` workspaces are derived from a single user; `team` are shared. */
export type WorkspaceKind = 'personal' | 'team';
