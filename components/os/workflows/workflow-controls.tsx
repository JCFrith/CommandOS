'use client';

import { useState, useTransition } from 'react';
import { Play } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { startWorkflowAction, transitionWorkflowAction } from '@/app/console/workflows/actions';
import { workflowAllowedTransitions, workflowStatusLabel } from '@/lib/workflows/state-machine';
import type { WorkflowStatus } from '@/lib/workflows/types';

/** Lifecycle controls + a "Run now" button (only when active). */
export function WorkflowControls({
  id,
  status,
  canRun,
}: {
  id: string;
  status: WorkflowStatus;
  canRun: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const next = workflowAllowedTransitions(status);

  const act = (fn: () => Promise<{ error: string | null }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result?.error) setError(result.error);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {status === 'active' && canRun && (
          <Button size="sm" disabled={pending} onClick={() => act(() => startWorkflowAction(id))}>
            <Play className="size-4" />
            Run now
          </Button>
        )}
        {next.map((to) => (
          <Button
            key={to}
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => act(() => transitionWorkflowAction(id, to as WorkflowStatus))}
          >
            {to === 'active' ? 'Activate' : to === 'paused' ? 'Pause' : workflowStatusLabel(to)}
          </Button>
        ))}
      </div>
      {error && (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
