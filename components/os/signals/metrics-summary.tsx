import { cn } from '@/lib/utils';
import { SEVERITY_META } from '@/lib/signals/display';
import { SIGNAL_SEVERITIES } from '@/lib/signals/types';
import type { SignalMetrics } from '@/lib/signals/metrics';

/**
 * Observability metrics summary — stat cards + a severity distribution, all
 * computed from real signals. Values that are upstream estimates are labelled as
 * such (never presented as measured).
 */
function pct(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}
function ms(value: number | null): string {
  return value === null ? '—' : `${value}ms`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-border/60 bg-background/40 rounded-xl border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-muted-foreground text-[11px]">{hint}</p>}
    </div>
  );
}

export function MetricsSummary({ metrics }: { metrics: SignalMetrics }) {
  const { execution } = metrics;
  const cost = execution.estimatedCostUsd;
  const costLabel = cost > 0 ? `$${cost.toFixed(4)}` : '$0';
  const maxSeverity = Math.max(1, ...SIGNAL_SEVERITIES.map((s) => metrics.bySeverity[s]));

  return (
    <section className="border-border/60 bg-card/40 rounded-2xl border p-5 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Observability</h2>
        <p className="text-muted-foreground text-xs">
          {metrics.total} signal{metrics.total === 1 ? '' : 's'}
          {metrics.throughputPerMinute !== null && ` · ${metrics.throughputPerMinute}/min`}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Executions" value={String(execution.total)} />
        <Stat label="Success rate" value={pct(execution.successRate)} />
        <Stat
          label="Failures"
          value={String(execution.failed + execution.timedOut)}
          hint={`${execution.timedOut} timed out`}
        />
        <Stat label="Retries" value={String(execution.retries)} />
        <Stat label="Avg duration" value={ms(execution.avgDurationMs)} />
        <Stat label="Provider latency" value={ms(execution.avgProviderLatencyMs)} />
        <Stat
          label="Tokens"
          value={execution.totalTokens.toLocaleString('en-US')}
          hint={execution.costEstimated ? 'estimated' : undefined}
        />
        <Stat
          label="Est. cost"
          value={costLabel}
          hint={execution.costEstimated ? 'estimated' : undefined}
        />
      </div>

      <div className="mt-5">
        <p className="text-muted-foreground text-xs">By severity</p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {SIGNAL_SEVERITIES.map((severity) => {
            const count = metrics.bySeverity[severity];
            const meta = SEVERITY_META[severity];
            return (
              <li key={severity} className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground w-16 shrink-0">{meta.label}</span>
                <span className="bg-muted/40 relative h-2 flex-1 overflow-hidden rounded-full">
                  <span
                    className={cn('absolute inset-y-0 left-0 rounded-full', meta.dot)}
                    style={{ width: `${(count / maxSeverity) * 100}%` }}
                    aria-hidden
                  />
                </span>
                <span className="w-8 shrink-0 text-right tabular-nums">{count}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
