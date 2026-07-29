import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import { SignalTimeline } from '@/components/os/signals/signal-timeline';
import { RunControls } from '@/components/os/workflows/run-controls';
import { RUN_STATUS_BADGE } from '@/lib/workflows/display';
import { runStatusLabel } from '@/lib/workflows/state-machine';
import { canApprove } from '@/lib/workflows/permissions';
import { getWorkspaceContext } from '@/services/workspace/context';
import { WorkflowError, workflowService } from '@/services/workflows';
import { signalsService } from '@/services/signals';

export const metadata: Metadata = { title: 'Workflow Run' };

export default async function WorkflowRunPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  const { id, runId } = await params;
  const ctx = await getWorkspaceContext();
  if (!ctx) notFound();

  let run;
  try {
    run = await workflowService.getRun(ctx, runId);
  } catch (error) {
    if (error instanceof WorkflowError && error.code === 'not_found') notFound();
    throw error;
  }

  const [steps, allPending, timeline] = await Promise.all([
    workflowService.runSteps(ctx, runId),
    workflowService.listPendingApprovals(ctx),
    // Audit history is reconstructed from Signals (subject = this run).
    signalsService.timeline(ctx, { subjectType: 'workflow_run', subjectId: runId }),
  ]);
  const approvals = allPending.filter((a) => a.runId === runId);
  // The approvers role required by any pending approval on this run.
  const requiredRole = approvals[0]?.approvers ?? 'owner';

  return (
    <div className="mx-auto w-full max-w-5xl">
      <Link
        href={`/console/workflows/${id}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="size-4" />
        Workflow
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">Run</h1>
            <span
              className={cn(
                'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
                RUN_STATUS_BADGE[run.status],
              )}
            >
              {runStatusLabel(run.status)}
            </span>
          </div>
          <p className="text-muted-foreground mt-2 text-xs">
            {run.trigger.type} trigger · started {formatDateTime(run.createdAt)}
            {run.error ? ` · ${run.error}` : ''}
          </p>
        </div>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <main className="flex flex-col gap-8">
          <section className="border-border/60 bg-card/40 rounded-2xl border p-5 backdrop-blur">
            <h2 className="text-sm font-semibold">Controls</h2>
            <div className="mt-3">
              <RunControls
                workflowId={id}
                runId={runId}
                status={run.status}
                approvals={approvals}
                canApprove={canApprove(ctx.workspace, requiredRole)}
              />
            </div>
          </section>

          <section>
            <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Timeline
            </h2>
            <div className="mt-4">
              <SignalTimeline entries={timeline} emptyLabel="No workflow signals yet." />
            </div>
          </section>
        </main>

        <aside className="flex flex-col gap-6">
          <section>
            <h2 className="text-sm font-semibold">Steps</h2>
            {steps.length === 0 ? (
              <p className="text-muted-foreground mt-2 text-xs">No steps recorded yet.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-1.5 text-xs">
                {steps.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{s.nodeId}</span>
                    <span className="text-muted-foreground">{s.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {Object.keys(run.variables).length > 0 && (
            <section>
              <h2 className="text-sm font-semibold">Variables</h2>
              <dl className="text-muted-foreground mt-3 flex flex-col gap-1 text-xs">
                {Object.entries(run.variables).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="font-mono">{k}</dt>
                    <dd className="text-foreground min-w-0 truncate">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
