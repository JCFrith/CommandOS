import type { WorkflowRunStatus, WorkflowStatus } from './types';

/**
 * The workflow state machines — the definition management lifecycle, the run
 * lifecycle (which extends the platform execution status with suspended states),
 * and the step lifecycle. Transcribed as data so the service enforces exactly
 * these transitions and the UI only offers legal moves.
 */

// --- Definition management lifecycle (mirrors the agent lifecycle) ----------

const DEFINITION_TRANSITIONS: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
  draft: ['active', 'archived'],
  active: ['paused', 'archived'],
  paused: ['active', 'archived'],
  archived: [],
};

export const INITIAL_WORKFLOW_STATUS: WorkflowStatus = 'draft';

export const WORKFLOW_STATUS_LABELS: Record<WorkflowStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
};

export function canWorkflowTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return DEFINITION_TRANSITIONS[from].includes(to);
}

export function workflowAllowedTransitions(from: WorkflowStatus): readonly WorkflowStatus[] {
  return DEFINITION_TRANSITIONS[from];
}

export function isWorkflowTerminal(status: WorkflowStatus): boolean {
  return status === 'archived';
}

/** Only active workflows may be triggered/run. */
export function isTriggerable(status: WorkflowStatus): boolean {
  return status === 'active';
}

export function workflowStatusLabel(status: WorkflowStatus): string {
  return WORKFLOW_STATUS_LABELS[status];
}

// --- Run lifecycle ----------------------------------------------------------

const RUN_TRANSITIONS: Record<WorkflowRunStatus, readonly WorkflowRunStatus[]> = {
  queued: ['running', 'cancelled'],
  pending: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled', 'timed_out', 'waiting_approval', 'waiting_timer'],
  waiting_approval: ['running', 'cancelled', 'failed'],
  waiting_timer: ['running', 'cancelled', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
  timed_out: [],
};

export const TERMINAL_RUN_STATUSES: readonly WorkflowRunStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'timed_out',
];

export function canRunTransition(from: WorkflowRunStatus, to: WorkflowRunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function isRunTerminal(status: WorkflowRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}

/** A run is suspended (resumable) when waiting on an approval or a timer. */
export function isRunSuspended(status: WorkflowRunStatus): boolean {
  return status === 'waiting_approval' || status === 'waiting_timer';
}

export const RUN_STATUS_LABELS: Record<WorkflowRunStatus, string> = {
  queued: 'Queued',
  pending: 'Pending',
  running: 'Running',
  waiting_approval: 'Waiting for approval',
  waiting_timer: 'Waiting (timer)',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  timed_out: 'Timed out',
};

export function runStatusLabel(status: WorkflowRunStatus): string {
  return RUN_STATUS_LABELS[status];
}
