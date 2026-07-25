import Link from 'next/link';
import type { Route } from 'next';
import { Waypoints } from 'lucide-react';

import { formatDateTime } from '@/lib/format';
import { SEVERITY_META } from '@/lib/signals/display';
import { SEVERITY_RANK } from '@/lib/signals/types';
import type { CorrelationChain } from '@/lib/signals/timeline';
import { SignalTimeline } from './signal-timeline';

/**
 * Correlation view — one card per correlation chain, each rendering the chain's
 * signals in causal (oldest-first) order. This is how an execution flow reads
 * end to end: agent run → runtime → provider → retry → completion, all sharing
 * one correlation id.
 */
export function CorrelationView({ chains }: { chains: CorrelationChain[] }) {
  if (chains.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No correlated activity yet. Run an agent to see a full execution chain here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {chains.map((chain) => {
        const peak = chain.severities.reduce((a, b) =>
          SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b,
        );
        const meta = SEVERITY_META[peak];
        return (
          <section
            key={chain.correlationId}
            className="border-border/60 bg-card/40 rounded-2xl border p-5 backdrop-blur"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                href={
                  `/console/signals?view=correlations&correlation=${chain.correlationId}` as Route
                }
                className="hover:text-primary inline-flex items-center gap-2 font-mono text-xs transition-colors"
              >
                <Waypoints className="size-3.5" aria-hidden />
                {chain.correlationId.slice(0, 8)}
              </Link>
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${meta.badge}`}
                >
                  {meta.label}
                </span>
                <span>
                  {chain.entries.length} event{chain.entries.length === 1 ? '' : 's'}
                </span>
                <span aria-hidden>·</span>
                <time dateTime={chain.start}>{formatDateTime(chain.start)}</time>
              </div>
            </div>
            <div className="mt-4">
              <SignalTimeline entries={chain.entries} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
