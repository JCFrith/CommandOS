import type { Metadata } from 'next';
import { Activity } from 'lucide-react';

import { SectionShell, SectionRoadmapNote } from '@/components/os/section-shell';

export const metadata: Metadata = { title: 'Operations' };

export default function OperationsPage() {
  return (
    <SectionShell
      icon={Activity}
      title="Operations"
      description="Every unit of work — human- or agent-initiated — tracked from intent to outcome."
    >
      <SectionRoadmapNote
        sprint="Sprint 3 · Operations"
        summary="The operations model, repository, and live feed land here. New Operation from ⌘K arrives on this surface."
      />
    </SectionShell>
  );
}
