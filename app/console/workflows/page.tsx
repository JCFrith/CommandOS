import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { Plus, Workflow } from 'lucide-react';

import { SectionShell } from '@/components/os/section-shell';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import { WORKFLOW_STATUS_BADGE } from '@/lib/workflows/display';
import { workflowStatusLabel } from '@/lib/workflows/state-machine';
import { getWorkspaceContext } from '@/services/workspace/context';
import { workflowService } from '@/services/workflows';

export const metadata: Metadata = { title: 'Workflows' };

export default async function WorkflowsPage() {
  const ctx = await getWorkspaceContext();
  const workflows = ctx ? await workflowService.list(ctx) : [];

  return (
    <SectionShell
      icon={Workflow}
      title="Workflows"
      description="Automation graphs that orchestrate Operations, Agents, and the AI runtime — triggered by signals, schedules, or on demand."
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-muted-foreground text-sm">
          {workflows.length === 0
            ? 'No workflows yet'
            : `${workflows.length} workflow${workflows.length === 1 ? '' : 's'}`}
        </p>
        <Button asChild size="sm">
          <Link href="/console/workflows/new">
            <Plus className="size-4" />
            New workflow
          </Link>
        </Button>
      </div>

      {workflows.length === 0 ? (
        <div className="border-border/60 bg-card/30 rounded-2xl border border-dashed p-8 text-center backdrop-blur">
          <p className="text-muted-foreground text-sm">
            Create a workflow to automate work across the platform. Start from the built-in template
            and edit its graph.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {workflows.map((wf) => (
            <li key={wf.id}>
              <Link
                href={`/console/workflows/${wf.id}` as Route}
                className="group border-border/60 bg-card/40 hover:border-primary/40 block rounded-2xl border p-4 backdrop-blur transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="group-hover:text-primary truncate font-medium transition-colors">
                      {wf.name}
                    </h3>
                    {wf.description && (
                      <p className="text-muted-foreground mt-1 line-clamp-1 text-sm">
                        {wf.description}
                      </p>
                    )}
                  </div>
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
                      WORKFLOW_STATUS_BADGE[wf.status],
                    )}
                  >
                    {workflowStatusLabel(wf.status)}
                  </span>
                </div>
                <p className="text-muted-foreground mt-3 text-xs">
                  Updated {formatDateTime(wf.updatedAt)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionShell>
  );
}
