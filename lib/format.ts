/**
 * Absolute, locale-stable timestamp formatting. Used inside Server Components,
 * so the rendered string is produced once on the server — no client re-render,
 * hence no hydration mismatch from timezone or locale differences.
 */
const DATE_TIME = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Format an ISO timestamp as e.g. "Jul 24, 2026, 3:45 PM". */
export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}
