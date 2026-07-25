import { Bot } from 'lucide-react';

import { SectionShell } from '@/components/os/section-shell';

/** Route-segment loading state for the agents surfaces. */
export default function AgentsLoading() {
  return (
    <SectionShell
      icon={Bot}
      title="Agents"
      description="Autonomous operators that reason over context you provide and return structured guidance."
    >
      <div className="flex flex-col gap-2.5" aria-hidden>
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="border-border/60 bg-card/40 h-[86px] animate-pulse rounded-2xl border"
          />
        ))}
      </div>
      <span className="sr-only">Loading agents…</span>
    </SectionShell>
  );
}
