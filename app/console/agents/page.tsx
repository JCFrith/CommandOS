import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { Bot, Plus } from 'lucide-react';

import { SectionShell } from '@/components/os/section-shell';
import { Button } from '@/components/ui/button';
import { AgentStatusBadge } from '@/components/os/agents/agent-status-badge';
import { AgentTypeBadge } from '@/components/os/agents/agent-type-badge';
import { AgentsEmptyState } from '@/components/os/agents/agents-empty-state';
import { formatDateTime } from '@/lib/format';
import { getWorkspaceContext } from '@/services/workspace/context';
import { agentService } from '@/services/agents';

export const metadata: Metadata = { title: 'Agents' };

export default async function AgentsPage() {
  const ctx = await getWorkspaceContext();
  const agents = ctx ? await agentService.list(ctx) : [];

  return (
    <SectionShell
      icon={Bot}
      title="Agents"
      description="Autonomous operators that reason over context you provide and return structured guidance."
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-muted-foreground text-sm">
          {agents.length === 0
            ? 'No agents configured'
            : `${agents.length} agent${agents.length === 1 ? '' : 's'}`}
        </p>
        <Button asChild size="sm">
          <Link href="/console/agents/new">
            <Plus className="size-4" />
            New agent
          </Link>
        </Button>
      </div>

      {agents.length === 0 ? (
        <AgentsEmptyState />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {agents.map((agent) => (
            <li key={agent.id}>
              <Link
                href={`/console/agents/${agent.id}` as Route}
                className="group border-border/60 bg-card/40 hover:border-primary/40 block rounded-2xl border p-4 backdrop-blur transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="group-hover:text-primary truncate font-medium transition-colors">
                      {agent.name}
                    </h3>
                    {agent.description && (
                      <p className="text-muted-foreground mt-1 line-clamp-1 text-sm">
                        {agent.description}
                      </p>
                    )}
                  </div>
                  <AgentStatusBadge status={agent.status} className="shrink-0" />
                </div>
                <div className="text-muted-foreground mt-3 flex items-center gap-2.5 text-xs">
                  <AgentTypeBadge type={agent.type} />
                  <span>Updated {formatDateTime(agent.updatedAt)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionShell>
  );
}
