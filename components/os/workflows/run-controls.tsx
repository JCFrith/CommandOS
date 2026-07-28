'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { cancelRunAction, decideApprovalAction } from '@/app/console/workflows/actions';
import type { WorkflowApproval, WorkflowRunStatus } from '@/lib/workflows/types';
import { isRunTerminal } from '@/lib/workflows/state-machine';

/** Cancel control + approval decisions for a run. */
export function RunControls({
  workflowId,
  runId,
  status,
  approvals,
  canApprove,
}: {
  workflowId: string;
  runId: string;
  status: WorkflowRunStatus;
  approvals: WorkflowApproval[];
  canApprove: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const act = (fn: () => Promise<{ error: string | null }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result?.error) setError(result.error);
    });
  };

  const pendingApprovals = approvals.filter((a) => a.status === 'pending');

  return (
    <div className="flex flex-col gap-3">
      {pendingApprovals.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          {pendingApprovals.map((approval) => (
            <div key={approval.id} className="flex flex-col gap-2">
              <p className="text-sm">{approval.prompt}</p>
              {canApprove ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      act(() => decideApprovalAction(workflowId, runId, approval.id, 'approved'))
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      act(() => decideApprovalAction(workflowId, runId, approval.id, 'rejected'))
                    }
                  >
                    Reject
                  </Button>
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">
                  Requires a workspace {approval.approvers} to decide.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {!isRunTerminal(status) && (
        <div>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => act(() => cancelRunAction(workflowId, runId))}
          >
            Cancel run
          </Button>
        </div>
      )}

      {error && (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
