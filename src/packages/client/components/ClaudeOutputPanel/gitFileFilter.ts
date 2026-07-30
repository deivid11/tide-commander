/**
 * gitFileFilter - Smart filename filtering for the Guake git panel.
 *
 * Pure helpers (no React/DOM) so they can be unit-tested in isolation.
 *
 * Query language — every term must match (AND):
 *   runner         fuzzy on the filename, then a plain substring of the path
 *   server/claude  a term containing "/" matches (fuzzily) against the full path
 *   .tsx  *.tsx    extension filter
 *   "use client"   quoted = contiguous substring, no fuzzy scatter
 *   !test          exclude everything the term would match
 *   status:mod     keep only that git status (m/a/d/u/r/c or the full name)
 *   !status:u      drop that git status
 *
 * Matching is smart-case: an all-lowercase term is case-insensitive, a term
 * containing an uppercase letter is matched case-sensitively.
 */

import { fuzzyMatch } from './searchIndexing';
import type { GitFileStatusType } from '../FileExplorerPanel/types';

// ==========================================================================
// TYPES
// ==========================================================================

/**
 * Minimal shape a candidate needs — satisfied by GitFileStatus. `status` is
 * optional so plain (unchanged) files from the explorer can be filtered too;
 * they simply never satisfy a `status:` term.
 */
export interface FilterableFile {
  name: string;
  path: string;
  status?: GitFileStatusType;
}

type TermKind = 'fuzzy' | 'exact' | 'ext' | 'path';

export interface FilterTerm {
  kind: TermKind;
  /** Term text, lowercased unless the term is case-sensitive (smart-case). */
  text: string;
  caseSensitive: boolean;
}

export interface ParsedFileFilter {
  raw: string;
  /** Nothing usable was typed — every file passes. */
  isEmpty: boolean;
  include: FilterTerm[];
  exclude: FilterTerm[];
  statuses: Set<GitFileStatusType> | null;
  excludedStatuses: Set<GitFileStatusType> | null;
}

/** Inclusive-exclusive character range of a match, for highlighting. */
export type MatchRange = [start: number, end: number];

// ==========================================================================
// PARSING
// ==========================================================================

const STATUS_ALIASES: Record<string, GitFileStatusType> = {
  m: 'modified', mod: 'modified', modified: 'modified',
  a: 'added', add: 'added', added: 'added',
  d: 'deleted', del: 'deleted', deleted: 'deleted',
  u: 'untracked', untracked: 'untracked', new: 'untracked',
  r: 'renamed', ren: 'renamed', renamed: 'renamed',
  c: 'conflict', conflict: 'conflict', conflicted: 'conflict',
};

// ".ts", "*.tsx", ".test.ts" — a leading dot (optionally after a star) and no
// path separator. Anything else is treated as a name/path term.
const EXT_TERM_RE = /^\*?\.[A-Za-z0-9][A-Za-z0-9._-]*$/;
const STATUS_PREFIX_RE = /^(?:status|s|is):(.+)$/i;

/** Split on whitespace, keeping "quoted phrases" together as one token. */
function tokenize(raw: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;

  for (const ch of raw) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ''; }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function buildTerm(token: string): FilterTerm | null {
  let text = token;
  let kind: TermKind = 'fuzzy';

  const quoted =
    text.length >= 2 && (text[0] === '"' || text[0] === "'") && text[text.length - 1] === text[0];
  if (quoted) {
    text = text.slice(1, -1);
    kind = 'exact';
  } else if (EXT_TERM_RE.test(text)) {
    kind = 'ext';
    text = text.replace(/^\*/, '');
  } else if (text.includes('/')) {
    kind = 'path';
  }

  if (!text) return null;
  const caseSensitive = /[A-Z]/.test(text);
  return { kind, text: caseSensitive ? text : text.toLowerCase(), caseSensitive };
}

export function parseFileFilter(raw: string): ParsedFileFilter {
  const include: FilterTerm[] = [];
  const exclude: FilterTerm[] = [];
  let statuses: Set<GitFileStatusType> | null = null;
  let excludedStatuses: Set<GitFileStatusType> | null = null;

  for (const token of tokenize(raw)) {
    const negated = token.startsWith('!');
    const body = negated ? token.slice(1) : token;
    if (!body) continue;

    const statusToken = STATUS_PREFIX_RE.exec(body);
    if (statusToken) {
      const status = STATUS_ALIASES[statusToken[1].toLowerCase()];
      if (status) {
        if (negated) {
          if (!excludedStatuses) excludedStatuses = new Set();
          excludedStatuses.add(status);
        } else {
          if (!statuses) statuses = new Set();
          statuses.add(status);
        }
        continue;
      }
      // Unknown alias (e.g. "s:omething") — fall through and match it as text.
    }

    const term = buildTerm(body);
    if (!term) continue;
    (negated ? exclude : include).push(term);
  }

  return {
    raw,
    isEmpty: include.length === 0 && exclude.length === 0 && !statuses && !excludedStatuses,
    include,
    exclude,
    statuses,
    excludedStatuses,
  };
}

// ==========================================================================
// MATCHING
// ==========================================================================

function fold(term: FilterTerm, value: string): string {
  return term.caseSensitive ? value : value.toLowerCase();
}

/**
 * Score one term against one file. `null` means "no match".
 * Basename hits outrank path hits, prefix hits outrank inner hits, and a
 * contiguous substring always outranks a scattered fuzzy hit.
 */
function scoreTerm(term: FilterTerm, file: FilterableFile): number | null {
  const name = fold(term, file.name);
  const path = fold(term, file.path);
  const fuzzyOpts = { caseSensitive: term.caseSensitive };

  switch (term.kind) {
    case 'ext':
      return name.endsWith(term.text) ? 60 : null;

    case 'exact': {
      const inName = name.indexOf(term.text);
      if (inName === 0) return 110;
      if (inName > 0) return 90;
      return path.includes(term.text) ? 55 : null;
    }

    case 'path': {
      const idx = path.indexOf(term.text);
      if (idx >= 0) return 85 - Math.min(20, Math.floor(idx / 8));
      const fz = fuzzyMatch(term.text, path, fuzzyOpts);
      return fz.matched ? fz.score : null;
    }

    default: {
      const inName = name.indexOf(term.text);
      if (inName === 0) return 120;
      if (inName > 0) return 95;
      const fzName = fuzzyMatch(term.text, name, fuzzyOpts);
      if (fzName.matched) return 40 + fzName.score;
      // Substring only against the path: scattering a bare term across a long
      // path matches almost every file ("icon" hitting .../client/components/…),
      // which makes the filter useless. Type a "/" term for path fuzziness.
      return path.includes(term.text) ? 50 : null;
    }
  }
}

/**
 * Score a file against the whole filter. `null` means the file is filtered out.
 * Higher scores are better matches; an empty filter scores everything 0.
 */
export function scoreFile(filter: ParsedFileFilter, file: FilterableFile): number | null {
  if (filter.isEmpty) return 0;

  // A file with no git status (an unchanged file in the explorer) can never
  // satisfy a `status:` term, but nothing excludes it either.
  if (filter.statuses && (!file.status || !filter.statuses.has(file.status))) return null;
  if (filter.excludedStatuses && file.status && filter.excludedStatuses.has(file.status)) return null;

  for (const term of filter.exclude) {
    if (scoreTerm(term, file) !== null) return null;
  }

  let total = 0;
  for (const term of filter.include) {
    const score = scoreTerm(term, file);
    if (score === null) return null;
    total += score;
  }

  // Shallow, short paths win ties — `src/api.ts` before `a/b/c/d/api.test.ts`.
  total += Math.max(0, 12 - file.path.length / 12);
  return total;
}

/** Filter + rank a list of files, best match first. */
export function filterFiles<T extends FilterableFile>(filter: ParsedFileFilter, files: T[]): T[] {
  if (filter.isEmpty) return files;

  const scored: Array<{ file: T; score: number }> = [];
  for (const file of files) {
    const score = scoreFile(filter, file);
    if (score !== null) scored.push({ file, score });
  }
  scored.sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));
  return scored.map((s) => s.file);
}

// ==========================================================================
// HIGHLIGHTING
// ==========================================================================

function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: MatchRange[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1];
    const cur = sorted[i];
    if (cur[0] <= prev[1]) prev[1] = Math.max(prev[1], cur[1]);
    else out.push(cur);
  }
  return out;
}

/**
 * Character ranges of `text` that the filter's positive terms matched, for
 * <mark> rendering. Terms that don't match this particular string (e.g. a path
 * term checked against a bare filename) simply contribute nothing.
 */
export function highlightRanges(filter: ParsedFileFilter, text: string): MatchRange[] {
  if (filter.isEmpty || filter.include.length === 0 || !text) return [];

  const ranges: MatchRange[] = [];
  for (const term of filter.include) {
    const hay = fold(term, text);

    if (term.kind === 'ext') {
      if (hay.endsWith(term.text)) ranges.push([text.length - term.text.length, text.length]);
      continue;
    }

    const idx = hay.indexOf(term.text);
    if (idx >= 0) {
      ranges.push([idx, idx + term.text.length]);
      continue;
    }

    if (term.kind === 'exact') continue; // exact terms never scatter
    const fz = fuzzyMatch(term.text, text, { caseSensitive: term.caseSensitive, withIndices: true });
    if (fz.matched && fz.indices) {
      for (const i of fz.indices) ranges.push([i, i + 1]);
    }
  }

  return mergeRanges(ranges);
}
