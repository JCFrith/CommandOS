'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { STATUS_META } from '@/lib/agents/display';
import { transitionAgentAction } from '@/app/console/agents/actions';
import type { AgentStatus } from '@/types';

/** Verb shown on the button for each target status. */
const VERB: Record<AgentStatus, string> = {
  draft: 'Return to draft',
  active: 'Activate',
  paused: 'Pause',
  disabled: 'Disable',
  archived: 'Archive',
};

/**
 * Lifecycle transition controls for an agent. Renders one button per legal next
 * status (computed server-side from the state machine) and dispatches the
 * transition action, which re-validates and revalidates the detail view.
 */
export function AgentLifecycleControls({
  agentId,
  next,
  canManage,
}: {
  agentId: string;
  next: AgentStatus[];
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<AgentStatus | null>(null);

  if (!canManage) {
    return (
      <p className="text-muted-foreground text-xs">
        You don’t have permission to change this agent.
      </p>
    );
  }

  if (next.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        This agent is archived — its lifecycle is complete.
      </p>
    );
  }

  const move = (to: AgentStatus) => {
    setError(null);
    setTarget(to);
    startTransition(async () => {
      const result = await transitionAgentAction(agentId, to);
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
              {VERB[to]}
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
