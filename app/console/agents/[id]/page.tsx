import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { AgentStatusBadge } from '@/components/os/agents/agent-status-badge';
import { AgentTypeBadge } from '@/components/os/agents/agent-type-badge';
import { AgentLifecycleControls } from '@/components/os/agents/agent-lifecycle-controls';
import { AgentRunner } from '@/components/os/agents/agent-runner';
import { AgentExecutionsList } from '@/components/os/agents/agent-executions-list';
import { AgentActivityTimeline } from '@/components/os/agents/agent-activity-timeline';
import { formatDateTime } from '@/lib/format';
import { CAPABILITY_LABELS, TYPE_META } from '@/lib/agents/display';
import {
  allowedTransitions,
  isExecutable,
  isTerminal,
  statusLabel,
} from '@/lib/agents/state-machine';
import { canManageAgent } from '@/lib/agents/permissions';
import { getWorkspaceContext } from '@/services/workspace/context';
import { AgentError, agentService } from '@/services/agents';
import { isAIAvailable } from '@/lib/ai';
import type { AgentStatus } from '@/types';

export const metadata: Metadata = { title: 'Agent' };

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
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

  const [executions, activity] = await Promise.all([
    agentService.listExecutions(ctx, id),
    agentService.activity(ctx, id),
  ]);

  const canManage = canManageAgent(ctx.user, ctx.workspace, agent);
  const canEdit = canManage && !isTerminal(agent.status);
  const next = [...allowedTransitions(agent.status)] as AgentStatus[];

  const availability = !canManage
    ? 'forbidden'
    : !isExecutable(agent.status)
      ? 'not-executable'
      : !isAIAvailable()
        ? 'unavailable'
        : 'ready';

  return (
    <div className="mx-auto w-full max-w-5xl">
      <Link
        href="/console/agents"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="size-4" />
        Agents
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>
            <AgentStatusBadge status={agent.status} />
          </div>
          <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2.5 text-xs">
            <AgentTypeBadge type={agent.type} />
            <span>Created {formatDateTime(agent.createdAt)}</span>
            <span aria-hidden>·</span>
            <span>Updated {formatDateTime(agent.updatedAt)}</span>
          </div>
        </div>
        {canEdit && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/console/agents/${agent.id}/edit` as Route}>
              <Pencil className="size-4" />
              Edit
            </Link>
          </Button>
        )}
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <main className="flex flex-col gap-8">
          <section>
            <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              About
            </h2>
            <p className="mt-2 text-sm">{agent.description ?? TYPE_META[agent.type].blurb}</p>
            {agent.capabilities.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {agent.capabilities.map((capability) => (
                  <span
                    key={capability}
                    className="border-border/60 bg-muted/40 text-muted-foreground rounded-full border px-2 py-0.5 text-[11px]"
                  >
                    {CAPABILITY_LABELS[capability]}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="border-border/60 bg-card/40 rounded-2xl border p-5 backdrop-blur">
            <h2 className="text-sm font-semibold">Run</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              Send a request; the agent reasons over it and returns structured guidance.
            </p>
            <div className="mt-4">
              <AgentRunner agentId={agent.id} availability={availability} />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold">Run history</h2>
            <div className="mt-4">
              <AgentExecutionsList executions={executions} />
            </div>
          </section>

          <section className="border-border/60 bg-card/40 rounded-2xl border p-5 backdrop-blur">
            <h2 className="text-sm font-semibold">Lifecycle</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              This agent is <span className="text-foreground">{statusLabel(agent.status)}</span>.
              {isExecutable(agent.status)
                ? ' It is eligible to run.'
                : ' Only Active agents can run.'}
            </p>
            <div className="mt-4">
              <AgentLifecycleControls agentId={agent.id} next={next} canManage={canManage} />
            </div>
          </section>
        </main>

        <aside>
          <h2 className="text-sm font-semibold">Activity</h2>
          <div className="mt-4">
            <AgentActivityTimeline activity={activity} />
          </div>
        </aside>
      </div>
    </div>
  );
}
