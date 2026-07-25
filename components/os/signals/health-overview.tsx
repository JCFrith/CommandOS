import { cn } from '@/lib/utils';
import { HEALTH_META } from '@/lib/signals/display';
import type { PlatformHealth } from '@/lib/signals/health';

/**
 * Health overview — the platform's overall status plus a card per subsystem
 * (provider, runtime, signal-bus). Pure presentation of a computed
 * {@link PlatformHealth}; statuses reflect real availability/metrics, never a
 * fabricated value.
 */
export function HealthOverview({ health }: { health: PlatformHealth }) {
  const overall = HEALTH_META[health.overall];
  const OverallIcon = overall.icon;
  return (
    <section className="border-border/60 bg-card/40 rounded-2xl border p-5 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">System health</h2>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
            overall.badge,
          )}
        >
          <OverallIcon className="size-3.5" aria-hidden />
          {overall.label}
        </span>
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {health.subsystems.map((subsystem) => {
          const meta = HEALTH_META[subsystem.status];
          return (
            <li
              key={subsystem.subsystem}
              className="border-border/60 bg-background/40 rounded-xl border p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium capitalize">
                  {subsystem.subsystem.replace('-', ' ')}
                </span>
                <span
                  className={cn('inline-flex items-center gap-1 text-xs', 'text-muted-foreground')}
                >
                  <span className={cn('size-1.5 rounded-full', meta.dot)} aria-hidden />
                  {meta.label}
                </span>
              </div>
              <p className="text-muted-foreground mt-1.5 text-xs leading-snug">
                {subsystem.detail}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
