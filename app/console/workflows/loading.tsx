import { Workflow } from 'lucide-react';

import { SectionShell } from '@/components/os/section-shell';

/** Route-segment loading state for the workflows surfaces. */
export default function WorkflowsLoading() {
  return (
    <SectionShell
      icon={Workflow}
      title="Workflows"
      description="Automation graphs that orchestrate Operations, Agents, and the AI runtime."
    >
      <div className="flex flex-col gap-2.5" aria-hidden>
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="border-border/60 bg-card/40 h-[86px] animate-pulse rounded-2xl border"
          />
        ))}
      </div>
      <span className="sr-only">Loading workflows…</span>
    </SectionShell>
  );
}
