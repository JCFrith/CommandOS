import type { WorkflowRunStatus, WorkflowStatus } from './types';

/**
 * Presentation metadata for workflow surfaces. Pure, token-based classes (no
 * server-only, no logic) so badges render in both server and client trees —
 * mirroring the operations/agents/signals display modules.
 */

export const WORKFLOW_STATUS_BADGE: Record<WorkflowStatus, string> = {
  draft: 'border-border/60 bg-muted/40 text-muted-foreground',
  active: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  paused: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  archived: 'border-border/50 bg-muted/30 text-muted-foreground/70',
};

export const RUN_STATUS_BADGE: Record<WorkflowRunStatus, string> = {
  queued: 'border-border/60 bg-muted/40 text-muted-foreground',
  pending: 'border-border/60 bg-muted/40 text-muted-foreground',
  running: 'border-primary/30 bg-primary/10 text-primary',
  waiting_approval: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  waiting_timer: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  failed: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  cancelled: 'border-border/60 bg-muted/40 text-muted-foreground',
  timed_out: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
};
