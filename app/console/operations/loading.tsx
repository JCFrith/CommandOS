import { Activity } from 'lucide-react';

import { SectionShell } from '@/components/os/section-shell';

/** Route-segment loading state for the operations surfaces. */
export default function OperationsLoading() {
  return (
    <SectionShell
      icon={Activity}
      title="Operations"
      description="Every unit of work — human- or agent-initiated — tracked from intent to outcome."
    >
      <div className="flex flex-col gap-2.5" aria-hidden>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="border-border/60 bg-card/40 h-[86px] animate-pulse rounded-2xl border"
          />
        ))}
      </div>
      <span className="sr-only">Loading operations…</span>
    </SectionShell>
  );
}
