import type { Metadata } from 'next';
import { Bot } from 'lucide-react';

import { SectionShell, SectionRoadmapNote } from '@/components/os/section-shell';

export const metadata: Metadata = { title: 'Agents' };

export default function AgentsPage() {
  return (
    <SectionShell
      icon={Bot}
      title="Agents"
      description="Autonomous operators that plan, act, and report across your systems."
    >
      <SectionRoadmapNote
        sprint="Sprint 4 · Agents & AI"
        summary="The agent runtime and OpenAI-backed dispatch land here. Dispatch an agent from ⌘K to arrive on this surface."
      />
    </SectionShell>
  );
}
