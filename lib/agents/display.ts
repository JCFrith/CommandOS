import {
  Archive,
  BadgeCheck,
  Ban,
  Bot,
  Briefcase,
  CircleDashed,
  CircleDot,
  Loader2,
  Mail,
  PauseCircle,
  Plane,
  Building2,
  XCircle,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';

import type {
  AgentCapability,
  AgentExecutionStatus,
  AgentStatus,
  AgentType,
  AIConfidence,
} from '@/types';
import { STATUS_LABELS } from '@/lib/agents/state-machine';

interface Meta {
  label: string;
  icon: LucideIcon;
  badge: string;
  dot?: string;
}

/** Presentation for each management status. Design-token colours, dark-first. */
export const STATUS_META: Record<AgentStatus, Meta> = {
  draft: {
    label: STATUS_LABELS.draft,
    icon: CircleDashed,
    badge: 'border-border/60 bg-muted/40 text-muted-foreground',
    dot: 'bg-muted-foreground/60',
  },
  active: {
    label: STATUS_LABELS.active,
    icon: BadgeCheck,
    badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    dot: 'bg-emerald-400',
  },
  paused: {
    label: STATUS_LABELS.paused,
    icon: PauseCircle,
    badge: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    dot: 'bg-amber-400',
  },
  disabled: {
    label: STATUS_LABELS.disabled,
    icon: Ban,
    badge: 'border-border/60 bg-muted/40 text-muted-foreground',
    dot: 'bg-muted-foreground/50',
  },
  archived: {
    label: STATUS_LABELS.archived,
    icon: Archive,
    badge: 'border-border/50 bg-muted/30 text-muted-foreground/70',
    dot: 'bg-muted-foreground/40',
  },
};

/** Presentation for each agent type. */
export const TYPE_META: Record<AgentType, { label: string; icon: LucideIcon; blurb: string }> = {
  executive: {
    label: 'Executive',
    icon: Briefcase,
    blurb: 'Briefings, prioritisation, and decision support.',
  },
  operations: { label: 'Operations', icon: Bot, blurb: 'Monitors work and operational health.' },
  communications: { label: 'Communications', icon: Mail, blurb: 'Drafts messages and summaries.' },
  flight: { label: 'Flight', icon: Plane, blurb: 'Evaluates readiness and airspace risk.' },
  property: {
    label: 'Property Intelligence',
    icon: Building2,
    blurb: 'Coordinates inspections and portfolio health.',
  },
};

/** Human labels for capabilities. */
export const CAPABILITY_LABELS: Record<AgentCapability, string> = {
  summarize: 'Summarize',
  prioritize: 'Prioritize',
  draft: 'Draft',
  analyze: 'Analyze',
  recommend: 'Recommend',
};

/** Presentation for an execution status. */
export const EXECUTION_STATUS_META: Record<AgentExecutionStatus, Meta> = {
  pending: {
    label: 'Pending',
    icon: CircleDashed,
    badge: 'border-border/60 bg-muted/40 text-muted-foreground',
  },
  running: {
    label: 'Running',
    icon: Loader2,
    badge: 'border-primary/30 bg-primary/10 text-primary',
  },
  completed: {
    label: 'Completed',
    icon: CheckCircle2,
    badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  },
  failed: {
    label: 'Failed',
    icon: XCircle,
    badge: 'border-destructive/40 bg-destructive/10 text-destructive',
  },
  cancelled: {
    label: 'Cancelled',
    icon: CircleDot,
    badge: 'border-border/60 bg-muted/40 text-muted-foreground',
  },
};

/** Presentation for a confidence band. */
export const CONFIDENCE_META: Record<AIConfidence, { label: string; badge: string }> = {
  high: {
    label: 'High confidence',
    badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  },
  medium: { label: 'Medium confidence', badge: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
  low: { label: 'Low confidence', badge: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
};
