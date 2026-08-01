/**
 * Persisted filter state for the branch graph.
 *
 * Stored per repository: branch names are repo-specific, so carrying one repo's
 * selection into another would silently filter the view down to nothing.
 * Anything unrecognised in storage is discarded rather than trusted — a stale
 * or hand-edited entry must not be able to produce a broken query.
 */

import { getStorage, setStorage } from './storage';
import type { DateRangePresetId } from './dateRangePresets';

export interface GitGraphFilters {
  search: string;
  branches: string[];
  author: string;
  since: string;
  until: string;
  datePreset: DateRangePresetId;
}

export const EMPTY_GIT_GRAPH_FILTERS: GitGraphFilters = {
  search: '',
  branches: [],
  author: '',
  since: '',
  until: '',
  datePreset: 'any',
};

const VALID_PRESETS: DateRangePresetId[] = ['any', '24h', '7d', '30d', '90d', '1y', 'custom'];

function storageKey(dir: string): string {
  return `tide-git-graph-filters:${dir}`;
}

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');

export function sanitizeFilters(raw: unknown): GitGraphFilters {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_GIT_GRAPH_FILTERS };
  const r = raw as Record<string, unknown>;
  const preset = asString(r.datePreset) as DateRangePresetId;
  return {
    search: asString(r.search),
    branches: Array.isArray(r.branches)
      ? r.branches.filter((b): b is string => typeof b === 'string' && b.length > 0)
      : [],
    author: asString(r.author),
    since: asString(r.since),
    until: asString(r.until),
    datePreset: VALID_PRESETS.includes(preset) ? preset : 'any',
  };
}

export function countActiveFilters(f: GitGraphFilters): number {
  return (f.search ? 1 : 0)
    + (f.branches.length > 0 ? 1 : 0)
    + (f.author ? 1 : 0)
    + (f.since ? 1 : 0)
    + (f.until ? 1 : 0);
}

export function loadGitGraphFilters(dir: string): GitGraphFilters {
  return sanitizeFilters(getStorage<unknown>(storageKey(dir), null));
}

export function saveGitGraphFilters(dir: string, filters: GitGraphFilters): void {
  // Nothing set → drop the entry instead of persisting an empty object.
  if (countActiveFilters(filters) === 0 && filters.datePreset === 'any') {
    try { localStorage.removeItem(storageKey(dir)); } catch { /* private mode */ }
    return;
  }
  setStorage(storageKey(dir), filters);
}
