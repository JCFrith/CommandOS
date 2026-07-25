import {
  AlertTriangle,
  Activity,
  Ban,
  Bot,
  CheckCircle2,
  CircleAlert,
  CircleDot,
  Flame,
  Info,
  KeyRound,
  Radio,
  ShieldAlert,
  Terminal,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import type { SignalCategory, SignalSeverity, SignalSource, SignalStatus } from './types';
import type { HealthStatus } from './health';

/**
 * Presentation metadata for the Signal surfaces. Pure, token-based classes (no
 * `server-only`, no logic) so badges render identically in server and client
 * trees — mirroring the operations/agents display modules. Kept separate from
 * the domain so taxonomy and styling never entangle.
 */

export interface Badge {
  label: string;
  icon: LucideIcon;
  /** Border + surface + text classes. */
  badge: string;
  /** Small status-dot color. */
  dot: string;
}

export const SEVERITY_META: Record<SignalSeverity, Badge> = {
  trace: {
    label: 'Trace',
    icon: CircleDot,
    badge: 'border-border/60 bg-muted/40 text-muted-foreground',
    dot: 'bg-muted-foreground/50',
  },
  info: {
    label: 'Info',
    icon: Info,
    badge: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
    dot: 'bg-sky-400',
  },
  notice: {
    label: 'Notice',
    icon: CircleDot,
    badge: 'border-primary/30 bg-primary/10 text-primary',
    dot: 'bg-primary',
  },
  warning: {
    label: 'Warning',
    icon: AlertTriangle,
    badge: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    dot: 'bg-amber-400',
  },
  error: {
    label: 'Error',
    icon: CircleAlert,
    badge: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
    dot: 'bg-rose-400',
  },
  critical: {
    label: 'Critical',
    icon: Flame,
    badge: 'border-red-500/40 bg-red-500/15 text-red-300',
    dot: 'bg-red-500',
  },
};

export const CATEGORY_META: Record<SignalCategory, { label: string; icon: LucideIcon }> = {
  lifecycle: { label: 'Lifecycle', icon: Activity },
  execution: { label: 'Execution', icon: Zap },
  security: { label: 'Security', icon: ShieldAlert },
  system: { label: 'System', icon: Workflow },
  interaction: { label: 'Interaction', icon: Terminal },
};

export const SOURCE_META: Record<SignalSource, { label: string; icon: LucideIcon }> = {
  operations: { label: 'Operations', icon: Activity },
  agents: { label: 'Agents', icon: Bot },
  runtime: { label: 'Runtime', icon: Zap },
  provider: { label: 'Provider', icon: Radio },
  auth: { label: 'Auth', icon: KeyRound },
  authz: { label: 'Authorization', icon: ShieldAlert },
  workspace: { label: 'Workspace', icon: Workflow },
  commands: { label: 'Commands', icon: Terminal },
  signals: { label: 'Signals', icon: Radio },
};

export const STATUS_META: Record<SignalStatus, { label: string; badge: string }> = {
  open: { label: 'Open', badge: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
  acknowledged: {
    label: 'Acknowledged',
    badge: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  },
  resolved: {
    label: 'Resolved',
    badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  },
};

export const HEALTH_META: Record<HealthStatus, Badge> = {
  healthy: {
    label: 'Healthy',
    icon: CheckCircle2,
    badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    dot: 'bg-emerald-400',
  },
  warning: {
    label: 'Warning',
    icon: AlertTriangle,
    badge: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    dot: 'bg-amber-400',
  },
  degraded: {
    label: 'Degraded',
    icon: CircleAlert,
    badge: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
    dot: 'bg-rose-400',
  },
  unavailable: {
    label: 'Unavailable',
    icon: Ban,
    badge: 'border-red-500/40 bg-red-500/15 text-red-300',
    dot: 'bg-red-500',
  },
  unknown: {
    label: 'Unknown',
    icon: CircleDot,
    badge: 'border-border/60 bg-muted/40 text-muted-foreground',
    dot: 'bg-muted-foreground/50',
  },
};
