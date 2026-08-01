import { describe, it, expect, beforeEach, vi } from 'vitest';

// The suite runs in the node environment (vitest.config.ts), so stub the one
// browser API this module touches rather than pulling in jsdom for it.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
});

import {
  sanitizeFilters,
  countActiveFilters,
  loadGitGraphFilters,
  saveGitGraphFilters,
  EMPTY_GIT_GRAPH_FILTERS,
} from './gitGraphFilters';

beforeEach(() => localStorage.clear());

describe('sanitizeFilters', () => {
  it('falls back to empty for junk input', () => {
    expect(sanitizeFilters(null)).toEqual(EMPTY_GIT_GRAPH_FILTERS);
    expect(sanitizeFilters('nope')).toEqual(EMPTY_GIT_GRAPH_FILTERS);
    expect(sanitizeFilters(42)).toEqual(EMPTY_GIT_GRAPH_FILTERS);
  });

  // A hand-edited or stale entry must not be able to build a broken query.
  it('drops values of the wrong type', () => {
    const out = sanitizeFilters({
      search: 123,
      branches: ['dev', 7, '', null, 'main'],
      author: { name: 'x' },
      since: '2026-01-01',
      datePreset: 'not-a-preset',
    });

    expect(out.search).toBe('');
    expect(out.branches).toEqual(['dev', 'main']);
    expect(out.author).toBe('');
    expect(out.since).toBe('2026-01-01');
    expect(out.datePreset).toBe('any');
  });

  it('keeps a valid preset', () => {
    expect(sanitizeFilters({ datePreset: '7d' }).datePreset).toBe('7d');
    expect(sanitizeFilters({ datePreset: 'custom' }).datePreset).toBe('custom');
  });
});

describe('countActiveFilters', () => {
  it('counts each set field once, branches as a group', () => {
    expect(countActiveFilters(EMPTY_GIT_GRAPH_FILTERS)).toBe(0);
    expect(countActiveFilters({ ...EMPTY_GIT_GRAPH_FILTERS, branches: ['a', 'b', 'c'] })).toBe(1);
    expect(countActiveFilters({
      ...EMPTY_GIT_GRAPH_FILTERS, search: 'fix', author: 'Erick', since: '2026-01-01',
    })).toBe(3);
  });
});

describe('persistence', () => {
  it('round-trips filters per repository', () => {
    const filters = { ...EMPTY_GIT_GRAPH_FILTERS, branches: ['dev'], author: 'Erick', datePreset: '7d' as const };
    saveGitGraphFilters('/repo/a', filters);

    expect(loadGitGraphFilters('/repo/a')).toEqual(filters);
    // Branch names are repo-specific — they must not leak across repos.
    expect(loadGitGraphFilters('/repo/b')).toEqual(EMPTY_GIT_GRAPH_FILTERS);
  });

  it('removes the entry when everything is cleared', () => {
    saveGitGraphFilters('/repo/a', { ...EMPTY_GIT_GRAPH_FILTERS, author: 'Erick' });
    expect(loadGitGraphFilters('/repo/a').author).toBe('Erick');

    saveGitGraphFilters('/repo/a', EMPTY_GIT_GRAPH_FILTERS);
    expect(loadGitGraphFilters('/repo/a')).toEqual(EMPTY_GIT_GRAPH_FILTERS);
    expect(localStorage.getItem('tide-git-graph-filters:/repo/a')).toBeNull();
  });

  it('survives corrupted storage', () => {
    localStorage.setItem('tide-git-graph-filters:/repo/a', '{not json');
    expect(loadGitGraphFilters('/repo/a')).toEqual(EMPTY_GIT_GRAPH_FILTERS);
  });
});
