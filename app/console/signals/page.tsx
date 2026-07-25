import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { Radio } from 'lucide-react';

import { SectionShell } from '@/components/os/section-shell';
import { HealthOverview } from '@/components/os/signals/health-overview';
import { MetricsSummary } from '@/components/os/signals/metrics-summary';
import { SignalFilters } from '@/components/os/signals/signal-filters';
import { CorrelationView } from '@/components/os/signals/correlation-view';
import {
  SignalSeverityBadge,
  SignalSourceBadge,
  SignalStatusBadge,
} from '@/components/os/signals/signal-badges';
import { formatDateTime } from '@/lib/format';
import {
  SIGNAL_CATEGORIES,
  SIGNAL_SEVERITIES,
  SIGNAL_SOURCES,
  type SignalCategory,
  type SignalSeverity,
  type SignalSource,
} from '@/lib/signals/types';
import { getWorkspaceContext } from '@/services/workspace/context';
import { signalsService, type SignalQuery } from '@/services/signals';

export const metadata: Metadata = { title: 'Signals' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignalsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const ctx = await getWorkspaceContext();

  const view = one(params.view) === 'correlations' ? 'correlations' : 'activity';
  const correlation = one(params.correlation);

  // Build a validated, workspace-agnostic query (the service forces the scope).
  const severity = one(params.severity) as SignalSeverity | undefined;
  const source = one(params.source) as SignalSource | undefined;
  const category = one(params.category) as SignalCategory | undefined;
  const query: SignalQuery = {};
  if (severity && SIGNAL_SEVERITIES.includes(severity)) query.minSeverity = severity;
  if (source && SIGNAL_SOURCES.includes(source)) query.sources = [source];
  if (category && SIGNAL_CATEGORIES.includes(category)) query.categories = [category];

  if (!ctx) {
    return (
      <SectionShell
        icon={Radio}
        title="Signals"
        description="Real-time operational telemetry unified into a single context surface."
      >
        <p className="text-muted-foreground text-sm">Sign in to view signals.</p>
      </SectionShell>
    );
  }

  const [health, metrics, signals, chains] = await Promise.all([
    signalsService.health(ctx),
    signalsService.metrics(ctx),
    view === 'activity' ? signalsService.list(ctx, query) : Promise.resolve([]),
    view === 'correlations' ? signalsService.correlations(ctx, correlation) : Promise.resolve([]),
  ]);

  return (
    <SectionShell
      icon={Radio}
      title="Signals"
      description="Every subsystem emits Signals — the canonical event model. Observe, correlate, and act."
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <HealthOverview health={health} />
          <MetricsSummary metrics={metrics} />
        </div>

        <div className="flex flex-col gap-4">
          <SignalFilters />

          {view === 'correlations' ? (
            <CorrelationView chains={chains} />
          ) : signals.length === 0 ? (
            <div className="border-border/60 bg-card/30 rounded-2xl border border-dashed p-8 text-center backdrop-blur">
              <p className="text-muted-foreground text-sm">
                No signals match the current filter. Activity across Operations, Agents, and the AI
                runtime appears here as it happens.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {signals.map((signal) => (
                <li key={signal.id}>
                  <Link
                    href={`/console/signals/${signal.id}` as Route}
                    className="group border-border/60 bg-card/40 hover:border-primary/40 block rounded-2xl border p-4 backdrop-blur transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="group-hover:text-primary truncate font-medium transition-colors">
                          {signal.title}
                        </h3>
                        <p className="text-muted-foreground mt-1 line-clamp-1 text-sm">
                          {signal.summary}
                        </p>
                      </div>
                      <SignalSeverityBadge severity={signal.severity} className="shrink-0" />
                    </div>
                    <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-2.5 text-xs">
                      <SignalSourceBadge source={signal.source} />
                      {signal.status !== 'open' && <SignalStatusBadge status={signal.status} />}
                      <span className="font-mono">{signal.type}</span>
                      <span aria-hidden>·</span>
                      <span>{formatDateTime(signal.createdAt)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SectionShell>
  );
}
