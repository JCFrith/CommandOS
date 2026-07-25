'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { acknowledgeSignalAction, resolveSignalAction } from '@/app/console/signals/actions';
import type { SignalStatus } from '@/lib/signals/types';

/**
 * Acknowledge / resolve / dismiss controls for a signal. Each action appends an
 * append-only lifecycle event server-side (the emitted record is never mutated)
 * and revalidates the detail view. Controls reflect the current projected
 * status.
 */
export function SignalLifecycleControls({
  signalId,
  status,
}: {
  signalId: string;
  status: SignalStatus;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ error: string | null }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) setError(result.error);
    });
  };

  if (status === 'resolved') {
    return <p className="text-muted-foreground text-xs">This signal is resolved.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {status === 'open' && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => acknowledgeSignalAction(signalId))}
          >
            Acknowledge
          </Button>
        )}
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run(() => resolveSignalAction(signalId, 'resolved'))}
        >
          Resolve
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run(() => resolveSignalAction(signalId, 'dismissed'))}
        >
          Dismiss
        </Button>
      </div>
      {error && (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
