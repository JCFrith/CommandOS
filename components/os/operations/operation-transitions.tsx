'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { STATUS_META } from '@/lib/operations/display';
import { transitionOperationAction } from '@/app/console/operations/actions';
import type { OperationStatus } from '@/types';

/**
 * Lifecycle transition controls for an Operation. Renders one button per legal
 * next status (computed server-side from the state machine) and dispatches the
 * transition server action, which re-validates the move and revalidates the
 * detail view. Disabled entirely for operators without manage permission.
 */
export function OperationTransitions({
  operationId,
  next,
  canManage,
}: {
  operationId: string;
  next: OperationStatus[];
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<OperationStatus | null>(null);

  if (!canManage) {
    return (
      <p className="text-muted-foreground text-xs">
        You don’t have permission to change this operation.
      </p>
    );
  }

  if (next.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        This operation is archived — its lifecycle is complete.
      </p>
    );
  }

  const move = (to: OperationStatus) => {
    setError(null);
    setTarget(to);
    startTransition(async () => {
      const result = await transitionOperationAction(operationId, to);
      if (result.error) setError(result.error);
      setTarget(null);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {next.map((to) => {
          const meta = STATUS_META[to];
          const Icon = meta.icon;
          const isTarget = pending && target === to;
          return (
            <Button
              key={to}
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => move(to)}
            >
              {isTarget ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
              Move to {meta.label}
            </Button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
