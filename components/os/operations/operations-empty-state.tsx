import Link from 'next/link';
import { Activity, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';

/** Empty state for the operations list — states the intent, offers the action. */
export function OperationsEmptyState() {
  return (
    <div className="border-border/60 bg-card/30 flex flex-col items-center rounded-2xl border border-dashed p-12 text-center backdrop-blur">
      <span className="bg-primary/10 text-primary ring-primary/20 grid size-12 place-items-center rounded-xl ring-1">
        <Activity className="size-6" />
      </span>
      <h2 className="mt-4 text-sm font-semibold">No operations yet</h2>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">
        Every unit of work — human- or agent-initiated — lives here. Create your first operation to
        get started.
      </p>
      <Button asChild className="mt-5">
        <Link href="/console/operations/new">
          <Plus className="size-4" />
          New operation
        </Link>
      </Button>
    </div>
  );
}
