import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';

import { SectionShell } from '@/components/os/section-shell';
import { Button } from '@/components/ui/button';
import { AgentForm } from '@/components/os/agents/agent-form';
import { getWorkspaceContext } from '@/services/workspace/context';
import { canCreateAgent } from '@/lib/agents/permissions';

export const metadata: Metadata = { title: 'New agent' };

export default async function NewAgentPage() {
  const ctx = await getWorkspaceContext();
  const allowed = ctx ? canCreateAgent(ctx.workspace) : false;

  return (
    <SectionShell
      icon={Plus}
      title="New agent"
      description="Configure an AI collaborator. It starts as a draft — activate it to run."
    >
      {allowed ? (
        <div className="max-w-xl">
          <AgentForm mode="create" cancelHref="/console/agents" />
        </div>
      ) : (
        <div className="border-border/60 bg-card/30 rounded-2xl border border-dashed p-8 text-center">
          <p className="text-muted-foreground text-sm">
            You don’t have permission to create agents in this workspace.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/console/agents">Back to agents</Link>
          </Button>
        </div>
      )}
    </SectionShell>
  );
}
