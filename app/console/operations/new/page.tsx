import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';

import { SectionShell } from '@/components/os/section-shell';
import { Button } from '@/components/ui/button';
import { OperationForm } from '@/components/os/operations/operation-form';
import { getOperationsContext } from '@/services/operations/context';
import { canCreateOperation } from '@/lib/operations/permissions';

export const metadata: Metadata = { title: 'New operation' };

export default async function NewOperationPage() {
  const ctx = await getOperationsContext();
  const allowed = ctx ? canCreateOperation(ctx.workspace) : false;

  return (
    <SectionShell
      icon={Plus}
      title="New operation"
      description="Define a unit of work. It starts as a draft — you drive it through its lifecycle from the operation view."
    >
      {allowed ? (
        <div className="max-w-xl">
          <OperationForm mode="create" cancelHref="/console/operations" />
        </div>
      ) : (
        <div className="border-border/60 bg-card/30 rounded-2xl border border-dashed p-8 text-center">
          <p className="text-muted-foreground text-sm">
            You don’t have permission to create operations in this workspace.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/console/operations">Back to operations</Link>
          </Button>
        </div>
      )}
    </SectionShell>
  );
}
