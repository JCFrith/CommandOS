import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Waypoints } from 'lucide-react';

import {
  SignalCategoryBadge,
  SignalSeverityBadge,
  SignalSourceBadge,
  SignalStatusBadge,
} from '@/components/os/signals/signal-badges';
import { SignalTimeline } from '@/components/os/signals/signal-timeline';
import { SignalLifecycleControls } from '@/components/os/signals/signal-lifecycle-controls';
import { formatDateTime } from '@/lib/format';
import { buildTimeline } from '@/lib/signals/timeline';
import type { SignalPayloadValue } from '@/lib/signals/types';
import { getWorkspaceContext } from '@/services/workspace/context';
import { SignalError, signalsService } from '@/services/signals';

export const metadata: Metadata = { title: 'Signal' };

function renderValue(value: SignalPayloadValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export default async function SignalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getWorkspaceContext();
  if (!ctx) notFound();

  let signal;
  try {
    signal = await signalsService.get(ctx, id);
  } catch (error) {
    if (error instanceof SignalError && error.code === 'not_found') notFound();
    throw error;
  }

  const [events, chains] = await Promise.all([
    signalsService.events(ctx, id),
    signalsService.correlations(ctx, signal.correlationId),
  ]);
  const chain = chains[0];

  // Timeline for this signal's subject (e.g. the agent/operation it concerns).
  const subjectSignals =
    signal.subjectType && signal.subjectId
      ? await signalsService.list(ctx, {
          subjectType: signal.subjectType,
          subjectId: signal.subjectId,
        })
      : [];
  const subjectTimeline = buildTimeline(subjectSignals);
  const payloadEntries = Object.entries(signal.payload);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <Link
        href="/console/signals"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="size-4" />
        Signals
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">{signal.title}</h1>
            <SignalSeverityBadge severity={signal.severity} />
            <SignalStatusBadge status={signal.status} />
          </div>
          <p className="text-muted-foreground mt-2 text-sm">{signal.summary}</p>
          <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2.5 text-xs">
            <SignalSourceBadge source={signal.source} />
            <SignalCategoryBadge category={signal.category} />
            <span className="font-mono">{signal.type}</span>
            {signal.actorName && (
              <>
                <span aria-hidden>·</span>
                <span>{signal.actorName}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span>{formatDateTime(signal.createdAt)}</span>
          </div>
        </div>
        <Link
          href={`/console/signals?view=correlations&correlation=${signal.correlationId}` as Route}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 font-mono text-xs transition-colors"
        >
          <Waypoints className="size-3.5" />
          {signal.correlationId.slice(0, 8)}
        </Link>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <main className="flex flex-col gap-8">
          {payloadEntries.length > 0 && (
            <section>
              <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Payload
              </h2>
              <dl className="border-border/60 bg-card/40 mt-2 grid gap-x-4 gap-y-2 rounded-2xl border p-4 text-sm backdrop-blur sm:grid-cols-[10rem_1fr]">
                {payloadEntries.map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-muted-foreground font-mono text-xs">{key}</dt>
                    <dd className="min-w-0 break-words">{renderValue(value)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section className="border-border/60 bg-card/40 rounded-2xl border p-5 backdrop-blur">
            <h2 className="text-sm font-semibold">Lifecycle</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              Acknowledging or resolving appends an append-only event — the original signal is never
              rewritten.
            </p>
            <div className="mt-4">
              <SignalLifecycleControls signalId={signal.id} status={signal.status} />
            </div>
            {events.length > 0 && (
              <ul className="text-muted-foreground mt-4 flex flex-col gap-1 text-xs">
                {events.map((event) => (
                  <li key={event.id} className="flex items-center gap-2">
                    <span className="font-medium capitalize">{event.type}</span>
                    {event.actorName && <span>by {event.actorName}</span>}
                    <time dateTime={event.at}>· {formatDateTime(event.at)}</time>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {chain && chain.entries.length > 1 && (
            <section>
              <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Correlation chain
              </h2>
              <p className="text-muted-foreground mt-1 text-xs">
                {chain.entries.length} events sharing correlation{' '}
                <span className="font-mono">{signal.correlationId.slice(0, 8)}</span>.
              </p>
              <div className="mt-4">
                <SignalTimeline entries={chain.entries} />
              </div>
            </section>
          )}
        </main>

        <aside>
          <h2 className="text-sm font-semibold">
            {signal.subjectType ? `${signal.subjectType} activity` : 'Related activity'}
          </h2>
          <div className="mt-4">
            <SignalTimeline entries={subjectTimeline} emptyLabel="No related signals." />
          </div>
        </aside>
      </div>
    </div>
  );
}
