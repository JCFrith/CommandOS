import type { Metadata } from 'next';
import { Settings } from 'lucide-react';

import { SectionShell, SectionRoadmapNote } from '@/components/os/section-shell';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <SectionShell
      icon={Settings}
      title="Settings"
      description="Workspace, membership, and platform preferences."
    >
      <SectionRoadmapNote
        sprint="Sprint 2 · Auth & Workspaces"
        summary="Workspace context, membership, and preferences land here alongside Supabase auth."
      />
    </SectionShell>
  );
}
