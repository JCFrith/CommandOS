import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Consistent header + body scaffold for a console section surface.
 */
export function SectionShell({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mx-auto w-full max-w-5xl', className)}>
      <div className="flex items-start gap-3">
        <span className="bg-primary/10 text-primary ring-primary/20 grid size-11 shrink-0 place-items-center rounded-xl ring-1">
          <Icon className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">{description}</p>
        </div>
      </div>
      {children && <div className="mt-8">{children}</div>}
    </div>
  );
}

/**
 * Honest placeholder for a section whose feature lands in a later sprint. It
 * states what is coming rather than faking functionality.
 */
export function SectionRoadmapNote({ sprint, summary }: { sprint: string; summary: string }) {
  return (
    <div className="border-border/60 bg-card/30 rounded-2xl border border-dashed p-8 text-center backdrop-blur">
      <p className="text-primary text-xs font-medium tracking-wide uppercase">{sprint}</p>
      <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">{summary}</p>
    </div>
  );
}
