import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { OperationStatusBadge } from '@/components/os/operations/operation-status-badge';
import { OperationPriorityBadge } from '@/components/os/operations/operation-priority-badge';
import { OperationTransitions } from '@/components/os/operations/operation-transitions';
import { OperationTimeline } from '@/components/os/operations/operation-timeline';
import { formatDateTime } from '@/lib/format';
import { allowedTransitions, isTerminal, statusLabel } from '@/lib/operations/state-machine';
import { canManageOperation } from '@/lib/operations/permissions';
import { getOperationsContext } from '@/services/operations/context';
import { OperationError, operationsService } from '@/services/operations/operations-service';
import type { OperationStatus } from '@/types';

export const metadata: Metadata = { title: 'Operation' };

export default async function OperationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getOperationsContext();
  if (!ctx) notFound();

  let operation;
  try {
    operation = await operationsService.get(ctx, id);
  } catch (error) {
    if (error instanceof OperationError && error.code === 'not_found') notFound();
    throw error;
  }

  const activity = await operationsService.activity(ctx, id);
  const canManage = canManageOperation(ctx.user, ctx.workspace, operation);
  const canEdit = canManage && !isTerminal(operation.status);
  const next = [...allowedTransitions(operation.status)] as OperationStatus[];

  return (
    <div className="mx-auto w-full max-w-5xl">
      <Link
        href="/console/operations"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="size-4" />
        Operations
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">{operation.title}</h1>
            <OperationStatusBadge status={operation.status} />
          </div>
          <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2.5 text-xs">
            <OperationPriorityBadge priority={operation.priority} />
            <span>Created {formatDateTime(operation.createdAt)}</span>
            <span aria-hidden>·</span>
            <span>Updated {formatDateTime(operation.updatedAt)}</span>
          </div>
        </div>
        {canEdit && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/console/operations/${operation.id}/edit` as Route}>
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
              Description
            </h2>
            {operation.description ? (
              <p className="mt-2 text-sm whitespace-pre-wrap">{operation.description}</p>
            ) : (
              <p className="text-muted-foreground mt-2 text-sm">No description.</p>
            )}
          </section>

          <section className="border-border/60 bg-card/40 rounded-2xl border p-5 backdrop-blur">
            <h2 className="text-sm font-semibold">Lifecycle</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              This operation is{' '}
              <span className="text-foreground">{statusLabel(operation.status)}</span>. Move it to
              its next valid state.
            </p>
            <div className="mt-4">
              <OperationTransitions operationId={operation.id} next={next} canManage={canManage} />
            </div>
          </section>
        </main>

        <aside>
          <h2 className="text-sm font-semibold">Activity</h2>
          <div className="mt-4">
            <OperationTimeline activity={activity} />
          </div>
        </aside>
      </div>
    </div>
  );
}
