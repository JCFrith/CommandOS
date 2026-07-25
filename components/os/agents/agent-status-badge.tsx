import { cn } from '@/lib/utils';
import { STATUS_META } from '@/lib/agents/display';
import type { AgentStatus } from '@/types';

/** Status pill for an agent. Pure, shared (server- or client-rendered). */
export function AgentStatusBadge({
  status,
  className,
}: {
  status: AgentStatus;
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
