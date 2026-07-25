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

// --- Agents (Sprint 4) ------------------------------------------------------

/** The specialised agent roles from `50_AI_AGENT_FRAMEWORK.md`. */
export type AgentType = 'executive' | 'operations' | 'communications' | 'flight' | 'property';

/**
 * Management lifecycle status of an agent definition (distinct from an
 * execution's status). `active` is the only status eligible to run.
 * See `lib/agents/state-machine.ts`.
 */
export type AgentStatus = 'draft' | 'active' | 'paused' | 'disabled' | 'archived';

/** A capability an agent is permitted to exercise (fixed, server-defined set). */
export type AgentCapability = 'summarize' | 'prioritize' | 'draft' | 'analyze' | 'recommend';

/**
 * An agent DEFINITION — a configured, workspace-owned AI collaborator. This is
 * the trusted configuration; operator-provided free text (`instructions`) is
 * carried as context, never as system instructions (see `lib/ai`).
 */
export interface Agent {
  id: string;
  workspaceId: string;
  name: string;
  type: AgentType;
  description: string | null;
  /** Operator-provided guidance — treated as untrusted context at execution. */
  instructions: string | null;
  capabilities: AgentCapability[];
  status: AgentStatus;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Kinds of audit events on an agent's activity timeline. */
export type AgentActivityType = 'created' | 'updated' | 'status_changed' | 'executed';

/** An immutable, chronological audit entry for an agent. */
export interface AgentActivity {
  id: string;
  agentId: string;
  workspaceId: string;
  actorId: string;
  actorName: string;
  type: AgentActivityType;
  message: string;
  fromStatus: AgentStatus | null;
  toStatus: AgentStatus | null;
  createdAt: string;
}

/** Lifecycle status of a single execution (the "AI Workflow" of spec 33). */
export type AgentExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Confidence band the model reports with a result (per `06_AI_BEHAVIOR.md`). */
export type AIConfidence = 'high' | 'medium' | 'low';

/**
 * The structured, validated output of an agent execution. Deterministic shape —
 * enforced by the provider's structured-output mode and re-validated with Zod.
 */
export interface AgentExecutionResult {
  summary: string;
  keyPoints: string[];
  risks: string[];
  recommendations: string[];
  confidence: AIConfidence;
}

/**
 * A record of one agent run: the operator's request, the result (or a safe
 * error), and audit-appropriate model metadata (never secrets or raw prompts).
 */
export interface AgentExecution {
  id: string;
  agentId: string;
  workspaceId: string;
  requestedBy: string;
  status: AgentExecutionStatus;
  /** Operator-provided input (their content). */
  input: string;
  result: AgentExecutionResult | null;
  /** Safe, user-facing error message — never provider internals or secrets. */
  error: string | null;
  /** Audit metadata: model + prompt version + timing; no secrets, no key. */
  model: string | null;
  promptVersion: string | null;
  durationMs: number | null;
  createdAt: string;
  completedAt: string | null;
}
