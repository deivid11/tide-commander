/**
 * Relative date-range presets for history filters.
 *
 * Filtering commits is almost always "the last N days" rather than a pair of
 * exact calendar dates, and the native <input type="date"> is a poor fit for
 * that: it renders in the browser's locale (mm/dd/yyyy on a Spanish UI), needs
 * two wide controls, and pops browser chrome we can't theme. Presets resolve to
 * plain YYYY-MM-DD strings, which is what git --since/--until accept.
 */

export type DateRangePresetId = 'any' | '24h' | '7d' | '30d' | '90d' | '1y' | 'custom';

export interface DateRangePreset {
  id: DateRangePresetId;
  label: string;
}

export const DATE_RANGE_PRESETS: DateRangePreset[] = [
  { id: 'any', label: 'Any date' },
  { id: '24h', label: 'Last 24 hours' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 3 months' },
  { id: '1y', label: 'Last year' },
  { id: 'custom', label: 'Custom…' },
];

const DAY_MS = 86_400_000;

/** Local calendar day as YYYY-MM-DD (never UTC — an evening commit must not
 *  land on tomorrow's date for users east of Greenwich). */
export function toISODate(timestamp: number): string {
  const d = new Date(timestamp);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Resolve a preset into the `since` value for git. `now` is injected so the
 * result is deterministic and testable.
 *
 * 'any' and 'custom' return an empty string: neither is a computed window —
 * 'any' clears the filter, 'custom' defers to whatever the user typed.
 */
export function resolvePresetSince(id: DateRangePresetId, now: number): string {
  switch (id) {
    case '24h': return toISODate(now - DAY_MS);
    case '7d': return toISODate(now - 7 * DAY_MS);
    case '30d': return toISODate(now - 30 * DAY_MS);
    case '90d': return toISODate(now - 90 * DAY_MS);
    case '1y': return toISODate(now - 365 * DAY_MS);
    default: return '';
  }
}

/** Human summary of an explicit range, for the collapsed filter chip. */
export function describeRange(since: string, until: string): string {
  if (since && until) return `${since} → ${until}`;
  if (since) return `desde ${since}`;
  if (until) return `hasta ${until}`;
  return '';
}
