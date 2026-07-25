import {
  Archive,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Ban,
  type LucideIcon,
} from 'lucide-react';

import type { OperationPriority, OperationStatus } from '@/types';
import { STATUS_LABELS } from '@/lib/operations/state-machine';

/** Presentational metadata for an Operation status. */
export interface StatusMeta {
  label: string;
  icon: LucideIcon;
  /** Badge classes (border + surface + text), design-token based. */
  badge: string;
  /** Small status dot color. */
  dot: string;
}

/**
 * Display metadata for every lifecycle status. Pure presentation — colors are
 * drawn from the CommandOS palette (semantic Tailwind hues over the dark
 * surfaces, matching the existing `bg-emerald-400` status idiom). Kept separate
 * from `state-machine.ts` so logic and presentation don't entangle.
 */
export const STATUS_META: Record<OperationStatus, StatusMeta> = {
  draft: {
    label: STATUS_LABELS.draft,
    icon: CircleDashed,
    badge: 'border-border/60 bg-muted/40 text-muted-foreground',
    dot: 'bg-muted-foreground/60',
  },
  planned: {
    label: STATUS_LABELS.planned,
    icon: CalendarClock,
    badge: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
    dot: 'bg-sky-400',
  },
  in_progress: {
    label: STATUS_LABELS.in_progress,
    icon: CircleDot,
    badge: 'border-primary/30 bg-primary/10 text-primary',
    dot: 'bg-primary',
  },
  blocked: {
    label: STATUS_LABELS.blocked,
    icon: Ban,
    badge: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    dot: 'bg-amber-400',
  },
  completed: {
    label: STATUS_LABELS.completed,
    icon: CheckCircle2,
    badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    dot: 'bg-emerald-400',
  },
  archived: {
    label: STATUS_LABELS.archived,
    icon: Archive,
    badge: 'border-border/50 bg-muted/30 text-muted-foreground/70',
    dot: 'bg-muted-foreground/40',
  },
};

/** Presentational metadata for an Operation priority. */
export interface PriorityMeta {
  label: string;
  badge: string;
}

export const PRIORITY_META: Record<OperationPriority, PriorityMeta> = {
  low: { label: 'Low', badge: 'border-border/60 bg-muted/40 text-muted-foreground' },
  medium: { label: 'Medium', badge: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
  high: { label: 'High', badge: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
};
