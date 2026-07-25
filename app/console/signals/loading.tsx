import { Radio } from 'lucide-react';

import { SectionShell } from '@/components/os/section-shell';

/** Route-segment loading state for the signals surfaces. */
export default function SignalsLoading() {
  return (
    <SectionShell
      icon={Radio}
      title="Signals"
      description="Every subsystem emits Signals — the canonical event model. Observe, correlate, and act."
    >
      <div className="flex flex-col gap-6" aria-hidden>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="border-border/60 bg-card/40 h-40 animate-pulse rounded-2xl border" />
          <div className="border-border/60 bg-card/40 h-40 animate-pulse rounded-2xl border" />
        </div>
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="border-border/60 bg-card/40 h-[86px] animate-pulse rounded-2xl border"
            />
          ))}
        </div>
      </div>
      <span className="sr-only">Loading signals…</span>
    </SectionShell>
  );
}
