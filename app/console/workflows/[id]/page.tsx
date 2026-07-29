import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import { WorkflowControls } from '@/components/os/workflows/workflow-controls';
import { RUN_STATUS_BADGE, WORKFLOW_STATUS_BADGE } from '@/lib/workflows/display';
import { runStatusLabel, workflowStatusLabel } from '@/lib/workflows/state-machine';
import { canRunWorkflow } from '@/lib/workflows/permissions';
import { getWorkspaceContext } from '@/services/workspace/context';
import { WorkflowError, workflowService } from '@/services/workflows';

export const metadata: Metadata = { title: 'Workflow' };

export default async function WorkflowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getWorkspaceContext();
  if (!ctx) notFound();

  let workflow;
  try {
    workflow = await workflowService.get(ctx, id);
  } catch (error) {
    if (error instanceof WorkflowError && error.code === 'not_found') notFound();
    throw error;
  }

  const [versions, runs] = await Promise.all([
    workflowService.listVersions(ctx, id),
    workflowService.listRuns(ctx, id),
  ]);
  const current = versions.find((v) => v.id === workflow.currentVersionId) ?? versions[0];

  return (
    <div className="mx-auto w-full max-w-5xl">
      <Link
        href="/console/workflows"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="size-4" />
        Workflows
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">{workflow.name}</h1>
            <span
              className={cn(
                'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
                WORKFLOW_STATUS_BADGE[workflow.status],
              )}
            >
              {workflowStatusLabel(workflow.status)}
            </span>
          </div>
          {workflow.description && (
            <p className="text-muted-foreground mt-2 text-sm">{workflow.description}</p>
          )}
        </div>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <main className="flex flex-col gap-8">
          <section className="border-border/60 bg-card/40 rounded-2xl border p-5 backdrop-blur">
            <h2 className="text-sm font-semibold">Lifecycle</h2>
            {!workflow.currentVersionId ? (
              <p className="text-muted-foreground mt-1 text-xs">
                Publish a version before activating. (Recreate the workflow from the New form to
                supply a definition.)
              </p>
            ) : (
              <p className="text-muted-foreground mt-1 text-xs">
                {workflow.status === 'active'
                  ? 'Active — triggers are live and it can be run on demand.'
                  : 'Activate to enable triggers and manual runs.'}
              </p>
            )}
            <div className="mt-4">
              <WorkflowControls
                id={workflow.id}
                status={workflow.status}
                canRun={canRunWorkflow(ctx.workspace)}
              />
            </div>
          </section>

          <section>
            <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Runs
            </h2>
            {runs.length === 0 ? (
              <p className="text-muted-foreground mt-2 text-sm">No runs yet.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {runs.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/console/workflows/${workflow.id}/runs/${r.id}` as Route}
                      className="border-border/60 bg-card/40 hover:border-primary/40 flex items-center justify-between gap-3 rounded-xl border p-3 text-sm transition-colors"
                    >
                      <span className="text-muted-foreground">
                        {r.trigger.type} · {formatDateTime(r.createdAt)}
                      </span>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                          RUN_STATUS_BADGE[r.status],
                        )}
                      >
                        {runStatusLabel(r.status)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>

        <aside className="flex flex-col gap-6">
          <section>
            <h2 className="text-sm font-semibold">Current version</h2>
            {current ? (
              <dl className="text-muted-foreground mt-3 flex flex-col gap-1 text-xs">
                <div className="flex justify-between">
                  <dt>Version</dt>
                  <dd className="text-foreground">v{current.version}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Nodes</dt>
                  <dd className="text-foreground">{current.nodes.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Triggers</dt>
                  <dd className="text-foreground">
                    {current.triggers.map((t) => t.type).join(', ') || 'none'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Variables</dt>
                  <dd className="text-foreground">{current.variables.length}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-muted-foreground mt-2 text-xs">No version published.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
