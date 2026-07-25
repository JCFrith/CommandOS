import { cn } from '@/lib/utils';

/**
 * Ambient platform health indicator — a pulsing dot plus label. Shared across
 * the landing surface and the console command bar. Pass `className` to adapt the
 * container (e.g. a bordered pill vs. a responsive inline label).
 */
export function SystemStatus({ className }: { className?: string }) {
  return (
    <span className={cn('text-muted-foreground flex items-center gap-2 text-xs', className)}>
      <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
      systems nominal
    </span>
  );
}
