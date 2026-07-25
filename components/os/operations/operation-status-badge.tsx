import { cn } from '@/lib/utils';
import { STATUS_META } from '@/lib/operations/display';
import type { OperationStatus } from '@/types';

/**
 * Status pill for an Operation. A pure, shared component (no directive, no
 * server-only APIs) so it renders in both server and client trees.
 */
export function OperationStatusBadge({
  status,
  className,
}: {
  status: OperationStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
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
