import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import { EXECUTION_STATUS_META } from '@/lib/agents/display';
import { AgentExecutionResultView } from './agent-execution-result';
import type { AgentExecution } from '@/types';

/**
 * Execution history for an agent (newest first, pre-sorted by the service).
 * Completed runs show their structured result; failed runs show a safe error.
 */
export function AgentExecutionsList({ executions }: { executions: AgentExecution[] }) {
  if (executions.length === 0) {
    return <p className="text-muted-foreground text-sm">No runs yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {executions.map((execution) => {
        const meta = EXECUTION_STATUS_META[execution.status];
        const Icon = meta.icon;
        return (
          <li
            key={execution.id}
            className="border-border/60 bg-card/40 rounded-2xl border p-4 backdrop-blur"
          >
            <div className="flex items-center justify-between gap-3">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                  meta.badge,
                )}
              >
                <Icon
                  className={cn('size-3.5', execution.status === 'running' && 'animate-spin')}
                  aria-hidden
                />
                {meta.label}
              </span>
              <time dateTime={execution.createdAt} className="text-muted-foreground text-xs">
                {formatDateTime(execution.createdAt)}
              </time>
            </div>

            <p className="text-muted-foreground mt-3 text-xs">Request</p>
            <p className="mt-0.5 text-sm whitespace-pre-wrap">{execution.input}</p>

            {execution.result && (
              <div className="border-border/50 mt-4 border-t pt-4">
                <AgentExecutionResultView result={execution.result} />
              </div>
            )}
            {execution.status === 'failed' && execution.error && (
              <p className="text-destructive mt-3 text-sm">{execution.error}</p>
            )}
            {execution.model && (
              <p className="text-muted-foreground mt-3 text-[11px]">
                {execution.model}
                {execution.durationMs != null && ` · ${execution.durationMs}ms`}
                {execution.promptVersion && ` · prompt ${execution.promptVersion}`}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
