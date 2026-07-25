import type { Metadata } from 'next';
import { Radio } from 'lucide-react';

import { SectionShell, SectionRoadmapNote } from '@/components/os/section-shell';

export const metadata: Metadata = { title: 'Signals' };

export default function SignalsPage() {
  return (
    <SectionShell
      icon={Radio}
      title="Signals"
      description="Real-time operational telemetry unified into a single context surface."
    >
      <SectionRoadmapNote
        sprint="Sprint 5 · Signals & Observability"
        summary="Live telemetry via Supabase realtime subscriptions surfaces here."
      />
    </SectionShell>
  );
}
