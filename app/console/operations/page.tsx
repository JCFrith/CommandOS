import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { Activity, Plus } from 'lucide-react';

import { SectionShell } from '@/components/os/section-shell';
import { Button } from '@/components/ui/button';
import { OperationStatusBadge } from '@/components/os/operations/operation-status-badge';
import { OperationPriorityBadge } from '@/components/os/operations/operation-priority-badge';
import { OperationsEmptyState } from '@/components/os/operations/operations-empty-state';
import { formatDateTime } from '@/lib/format';
import { getOperationsContext } from '@/services/operations/context';
import { operationsService } from '@/services/operations/operations-service';

export const metadata: Metadata = { title: 'Operations' };

export default async function OperationsPage() {
  const ctx = await getOperationsContext();
  const operations = ctx ? await operationsService.list(ctx) : [];

  return (
    <SectionShell
      icon={Activity}
      title="Operations"
      description="Every unit of work — human- or agent-initiated — tracked from intent to outcome."
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-muted-foreground text-sm">
          {operations.length === 0
            ? 'Nothing in flight'
            : `${operations.length} operation${operations.length === 1 ? '' : 's'}`}
        </p>
        <Button asChild size="sm">
          <Link href="/console/operations/new">
            <Plus className="size-4" />
            New operation
          </Link>
        </Button>
      </div>

      {operations.length === 0 ? (
        <OperationsEmptyState />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {operations.map((op) => (
            <li key={op.id}>
              <Link
                href={`/console/operations/${op.id}` as Route}
                className="group border-border/60 bg-card/40 hover:border-primary/40 block rounded-2xl border p-4 backdrop-blur transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="group-hover:text-primary truncate font-medium transition-colors">
                      {op.title}
                    </h3>
                    {op.description && (
                      <p className="text-muted-foreground mt-1 line-clamp-1 text-sm">
                        {op.description}
                      </p>
                    )}
                  </div>
                  <OperationStatusBadge status={op.status} className="shrink-0" />
                </div>
                <div className="text-muted-foreground mt-3 flex items-center gap-2.5 text-xs">
                  <OperationPriorityBadge priority={op.priority} />
                  <span>Updated {formatDateTime(op.updatedAt)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionShell>
  );
}
