import { CirclePlus, PencilLine, ArrowRightLeft, Play, type LucideIcon } from 'lucide-react';

import { formatDateTime } from '@/lib/format';
import type { AgentActivity, AgentActivityType } from '@/types';

const TYPE_ICON: Record<AgentActivityType, LucideIcon> = {
  created: CirclePlus,
  updated: PencilLine,
  status_changed: ArrowRightLeft,
  executed: Play,
};

/** Activity/history timeline for an agent (newest first, pre-sorted). */
export function AgentActivityTimeline({ activity }: { activity: AgentActivity[] }) {
  if (activity.length === 0) {
    return <p className="text-muted-foreground text-sm">No activity recorded yet.</p>;
  }

  return (
    <ol className="relative flex flex-col gap-5">
      {activity.map((entry, index) => {
        const Icon = TYPE_ICON[entry.type];
        const isLast = index === activity.length - 1;
        return (
          <li key={entry.id} className="relative flex gap-3">
            {!isLast && (
              <span
                className="bg-border/70 absolute top-7 left-3 h-[calc(100%+0.25rem)] w-px"
                aria-hidden
              />
            )}
            <span className="bg-card text-muted-foreground ring-border/60 relative grid size-6 shrink-0 place-items-center rounded-full ring-1">
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className="font-medium">{entry.actorName}</span>{' '}
                <span className="text-muted-foreground">{entry.message}</span>
              </p>
              <time dateTime={entry.createdAt} className="text-muted-foreground text-xs">
                {formatDateTime(entry.createdAt)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
