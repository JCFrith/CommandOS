import type { AgentStatus } from '@/types';

/**
 * The agent management lifecycle state machine.
 *
 * `33_STATE_MACHINE_SPECIFICATION.md` defines execution ("AI Workflow") states
 * but no management lifecycle for an agent *definition*; this transcribes the
 * enable / disable / pause / resume / archive behavior the Sprint 4 directive
 * requires, following the "fail safely / under user control" principles of
 * `50_AI_AGENT_FRAMEWORK.md`. Recorded as decision D-401.
 *
 *   draft ─▶ active ⇄ paused
 *              │ ▲
 *              ▼ │
 *           disabled ──▶ (active)
 *   any non-archived ─▶ archived (terminal)
 *
 * Only `active` agents may execute.
 */
export const AGENT_STATUSES: readonly AgentStatus[] = [
  'draft',
  'active',
  'paused',
  'disabled',
  'archived',
] as const;

const TRANSITIONS: Record<AgentStatus, readonly AgentStatus[]> = {
  draft: ['active', 'archived'],
  active: ['paused', 'disabled', 'archived'],
  paused: ['active', 'disabled', 'archived'],
  disabled: ['active', 'archived'],
  archived: [],
};

export const STATUS_LABELS: Record<AgentStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  disabled: 'Disabled',
  archived: 'Archived',
};

/** The display label for a status. */
export function statusLabel(status: AgentStatus): string {
  return STATUS_LABELS[status];
}

/** The statuses an agent may legally move to from `from`. */
export function allowedTransitions(from: AgentStatus): readonly AgentStatus[] {
  return TRANSITIONS[from];
}

/** Whether moving `from` → `to` is a legal transition. */
export function canTransition(from: AgentStatus, to: AgentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** A terminal status has no outgoing transitions (`archived`). */
export function isTerminal(status: AgentStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Only `active` agents are eligible to execute. */
export function isExecutable(status: AgentStatus): boolean {
  return status === 'active';
}

/** The initial status for a newly created agent. */
export const INITIAL_STATUS: AgentStatus = 'draft';
