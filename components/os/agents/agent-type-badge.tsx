import { cn } from '@/lib/utils';
import { TYPE_META } from '@/lib/agents/display';
import type { AgentType } from '@/types';

/** Type pill for an agent. Pure, shared. */
export function AgentTypeBadge({ type, className }: { type: AgentType; className?: string }) {
  const meta = TYPE_META[type];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'border-border/60 bg-muted/40 text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {meta.label}
    </span>
  );
}
