import { cn } from '@/lib/utils';
import { CATEGORY_META, SEVERITY_META, SOURCE_META, STATUS_META } from '@/lib/signals/display';
import type {
  SignalCategory,
  SignalSeverity,
  SignalSource,
  SignalStatus,
} from '@/lib/signals/types';

/**
 * Pure, shared signal badges (no directive, no server-only APIs) so they render
 * in both server and client trees — mirroring the operations/agents badges.
 */

export function SignalSeverityBadge({
  severity,
  className,
}: {
  severity: SignalSeverity;
  className?: string;
}) {
  const meta = SEVERITY_META[severity];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        meta.badge,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {meta.label}
    </span>
  );
}

export function SignalStatusBadge({
  status,
  className,
}: {
  status: SignalStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        meta.badge,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}

export function SignalSourceBadge({
  source,
  className,
}: {
  source: SignalSource;
  className?: string;
}) {
  const meta = SOURCE_META[source];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'border-border/60 bg-muted/40 text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {meta.label}
    </span>
  );
}

export function SignalCategoryBadge({
  category,
  className,
}: {
  category: SignalCategory;
  className?: string;
}) {
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  return (
    <span
      className={cn('text-muted-foreground inline-flex items-center gap-1.5 text-xs', className)}
    >
      <Icon className="size-3.5" aria-hidden />
      {meta.label}
    </span>
  );
}
