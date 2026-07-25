import { cn } from '@/lib/utils';
import { PRIORITY_META } from '@/lib/operations/display';
import type { OperationPriority } from '@/types';

/** Priority pill for an Operation. Pure, shared component. */
export function OperationPriorityBadge({
  priority,
  className,
}: {
  priority: OperationPriority;
  className?: string;
}) {
  const meta = PRIORITY_META[priority];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        meta.badge,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}
