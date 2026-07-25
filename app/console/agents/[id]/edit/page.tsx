import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Pencil } from 'lucide-react';

import { SectionShell } from '@/components/os/section-shell';
import { Button } from '@/components/ui/button';
import { AgentForm } from '@/components/os/agents/agent-form';
import { isTerminal } from '@/lib/agents/state-machine';
import { canManageAgent } from '@/lib/agents/permissions';
import { getWorkspaceContext } from '@/services/workspace/context';
import { AgentError, agentService } from '@/services/agents';

export const metadata: Metadata = { title: 'Edit agent' };

export default async function EditAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getWorkspaceContext();
  if (!ctx) notFound();

  let agent;
  try {
    agent = await agentService.get(ctx, id);
  } catch (error) {
    if (error instanceof AgentError && error.code === 'not_found') notFound();
    throw error;
  }

  // Archived agents are read-only — send the operator back to the detail view.
  if (isTerminal(agent.status)) redirect(`/console/agents/${agent.id}` as Route);

  const canManage = canManageAgent(ctx.user, ctx.workspace, agent);
  const detailHref = `/console/agents/${agent.id}` as Route;

  return (
    <SectionShell icon={Pencil} title="Edit agent" description="Update this agent’s configuration.">
      {canManage ? (
        <div className="max-w-xl">
          <AgentForm
            mode="edit"
            agentId={agent.id}
            initial={{
              name: agent.name,
              type: agent.type,
              description: agent.description ?? '',
              instructions: agent.instructions ?? '',
              capabilities: agent.capabilities,
            }}
            cancelHref={detailHref}
          />
        </div>
      ) : (
        <div className="border-border/60 bg-card/30 rounded-2xl border border-dashed p-8 text-center">
          <p className="text-muted-foreground text-sm">
            You don’t have permission to edit this agent.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link href={detailHref}>Back to agent</Link>
          </Button>
        </div>
      )}
    </SectionShell>
  );
}
