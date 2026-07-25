'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';

import { cn } from '@/lib/utils';
import { SEVERITY_META, SOURCE_META, CATEGORY_META } from '@/lib/signals/display';
import { SIGNAL_CATEGORIES, SIGNAL_SEVERITIES, SIGNAL_SOURCES } from '@/lib/signals/types';

/**
 * Faceted signal filters. Client component: it reads the active facets from the
 * URL and pushes updated `searchParams`, so the server component re-queries the
 * (workspace-scoped) store with the new filter. State lives entirely in the URL,
 * so filters are shareable and survive refresh.
 */
export function SignalFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const query = next.toString();
    router.push((query ? `${pathname}?${query}` : pathname) as Route);
  };

  const view = params.get('view') ?? 'activity';

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="border-border/60 bg-card/40 inline-flex rounded-lg border p-0.5 text-xs">
        {(['activity', 'correlations'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => set('view', option === 'activity' ? '' : option)}
            className={cn(
              'rounded-md px-2.5 py-1 font-medium capitalize transition-colors',
              view === option
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
            aria-pressed={view === option}
          >
            {option}
          </button>
        ))}
      </div>

      <Facet
        label="Severity"
        value={params.get('severity') ?? ''}
        onChange={(v) => set('severity', v)}
        options={SIGNAL_SEVERITIES.map((s) => ({ value: s, label: SEVERITY_META[s].label }))}
      />
      <Facet
        label="Source"
        value={params.get('source') ?? ''}
        onChange={(v) => set('source', v)}
        options={SIGNAL_SOURCES.map((s) => ({ value: s, label: SOURCE_META[s].label }))}
      />
      <Facet
        label="Category"
        value={params.get('category') ?? ''}
        onChange={(v) => set('category', v)}
        options={SIGNAL_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_META[c].label }))}
      />
    </div>
  );
}

function Facet({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-border/60 bg-card/40 focus-visible:border-primary h-8 rounded-lg border px-2 text-sm focus-visible:outline-none"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
