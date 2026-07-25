import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Pencil } from 'lucide-react';

import { SectionShell } from '@/components/os/section-shell';
import { Button } from '@/components/ui/button';
import { OperationForm } from '@/components/os/operations/operation-form';
import { isTerminal } from '@/lib/operations/state-machine';
import { canManageOperation } from '@/lib/operations/permissions';
import { getOperationsContext } from '@/services/operations/context';
import { OperationError, operationsService } from '@/services/operations/operations-service';

export const metadata: Metadata = { title: 'Edit operation' };

export default async function EditOperationPage({ params }: { params: Promise<{ id: string }> }) {
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

  // Archived operations are read-only — send the operator back to the detail view.
  if (isTerminal(operation.status)) redirect(`/console/operations/${operation.id}` as Route);

  const canManage = canManageOperation(ctx.user, ctx.workspace, operation);
  const detailHref = `/console/operations/${operation.id}` as Route;

  return (
    <SectionShell
      icon={Pencil}
      title="Edit operation"
      description="Update this operation’s details."
    >
      {canManage ? (
        <div className="max-w-xl">
          <OperationForm
            mode="edit"
            operationId={operation.id}
            initial={{
              title: operation.title,
              description: operation.description ?? '',
              priority: operation.priority,
            }}
            cancelHref={detailHref}
          />
        </div>
      ) : (
        <div className="border-border/60 bg-card/30 rounded-2xl border border-dashed p-8 text-center">
          <p className="text-muted-foreground text-sm">
            You don’t have permission to edit this operation.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link href={detailHref}>Back to operation</Link>
          </Button>
        </div>
      )}
    </SectionShell>
  );
}
