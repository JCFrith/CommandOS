import Link from 'next/link';
import type { Route } from 'next';

import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import { SEVERITY_META } from '@/lib/signals/display';
import type { TimelineEntry } from '@/lib/signals/timeline';

/**
 * A signal-derived timeline. Presentation only — entries are pre-ordered by the
 * timeline engine. Each entry is colored by severity and (optionally) links to
 * its signal detail. Reused for the workspace activity feed, a subject timeline,
 * and a correlation chain.
 */
export function SignalTimeline({
  entries,
  linkSignals = true,
  emptyLabel = 'No signals recorded yet.',
}: {
  entries: TimelineEntry[];
  linkSignals?: boolean;
  emptyLabel?: string;
}) {
  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyLabel}</p>;
  }

  return (
    <ol className="relative flex flex-col gap-5">
      {entries.map((entry, index) => {
        const meta = SEVERITY_META[entry.severity];
        const Icon = meta.icon;
        const isLast = index === entries.length - 1;
        const body = (
          <>
            <span className="text-sm">
              <span className="font-medium">{entry.title}</span>{' '}
              <span className="text-muted-foreground">— {entry.summary}</span>
            </span>
            <span className="text-muted-foreground flex items-center gap-2 text-xs">
              <span className="font-mono">{entry.type}</span>
              {entry.actorName && <span>· {entry.actorName}</span>}
              <time dateTime={entry.at}>· {formatDateTime(entry.at)}</time>
            </span>
          </>
        );
        return (
          <li key={entry.id} className="relative flex gap-3">
            {!isLast && (
              <span
                className="bg-border/70 absolute top-7 left-3 h-[calc(100%+0.25rem)] w-px"
                aria-hidden
              />
            )}
            <span
              className={cn(
                'bg-card ring-border/60 relative grid size-6 shrink-0 place-items-center rounded-full ring-1',
                meta.badge,
              )}
            >
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              {linkSignals ? (
                <Link
                  href={`/console/signals/${entry.id}` as Route}
                  className="hover:text-primary flex flex-col transition-colors"
                >
                  {body}
                </Link>
              ) : (
                <span className="flex flex-col">{body}</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
