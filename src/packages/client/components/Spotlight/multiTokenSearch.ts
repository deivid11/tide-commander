/**
 * Multi-word ("token") search helpers for Spotlight.
 *
 * Fuse.js treats the whole query as ONE contiguous fuzzy pattern, so a query
 * whose words hit DIFFERENT fields of the same item never matches: "daisy
 * designer" cannot find an agent titled "Designer 3D print" parked in the
 * "DaisySeed" area, because no single region of the searchable text is within
 * edit distance of the full phrase. These helpers add AND-of-words semantics
 * on top of the existing Fuse instances: every word must match the item, but
 * each word may match on its own (and in any field/order).
 */

import type Fuse from 'fuse.js';

export interface TokenSearchHit<T> {
  item: T;
  score?: number;
}

/** Lowercased whitespace-separated words of a query ('' → []). */
export function tokenizeQuery(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Fuse search with AND-of-words semantics. Single-word queries behave exactly
 * like fuse.search(query); multi-word queries intersect the per-word result
 * sets (by refIndex), so an item qualifies only when EVERY word matches it
 * somewhere. Scores are averaged across words (Fuse: lower = better) so the
 * combined score stays comparable to a plain single-word search.
 */
export function searchAllTokens<T>(fuse: Fuse<T>, query: string): TokenSearchHit<T>[] {
  const trimmed = query.trim();
  const tokens = tokenizeQuery(trimmed);
  if (tokens.length <= 1) return fuse.search(trimmed);

  const [first, ...rest] = tokens.map((t) => fuse.search(t));
  // refIndex → score maps for the remaining words, for O(1) intersection.
  const restByRefIndex = rest.map((results) => {
    const map = new Map<number, number>();
    for (const r of results) map.set(r.refIndex, r.score ?? 1);
    return map;
  });

  const hits: TokenSearchHit<T>[] = [];
  for (const r of first) {
    let total = r.score ?? 1;
    let matchesAll = true;
    for (const byRef of restByRefIndex) {
      const score = byRef.get(r.refIndex);
      if (score === undefined) {
        matchesAll = false;
        break;
      }
      total += score;
    }
    if (matchesAll) hits.push({ item: r.item, score: total / tokens.length });
  }
  hits.sort((a, b) => (a.score ?? 1) - (b.score ?? 1));
  return hits;
}

// Tiered match quality (higher = better):
//   6 exact title  ·  5 prefix  ·  4 whole-word  ·  3 title substring
//   2 other-field substring  ·  1 fuzzy/subsequence only.
function tierOf(needle: string, lowerTitle: string, lowerOther: string): number {
  if (lowerTitle === needle) return 6;
  if (lowerTitle.startsWith(needle)) return 5;
  if (lowerTitle.split(/[^a-z0-9]+/i).includes(needle)) return 4;
  if (lowerTitle.includes(needle)) return 3;
  if (lowerOther.includes(needle)) return 2;
  return 1;
}

/**
 * Match tier for a (possibly multi-word) query. The full phrase is tiered
 * first — an exact/prefix/substring phrase match keeps its old rank — and the
 * per-word minimum ("weakest word") is used as a fallback so cross-field
 * matches land at tier ≥ 2 instead of the fuzzy-only floor.
 */
export function matchTierForQuery(query: string, title: string, otherText: string): number {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return 1;
  const lowerTitle = title.toLowerCase();
  const lowerOther = otherText.toLowerCase();
  const phraseTier = tierOf(tokens.join(' '), lowerTitle, lowerOther);
  if (tokens.length === 1) return phraseTier;
  let weakest = 6;
  for (const t of tokens) {
    weakest = Math.min(weakest, tierOf(t, lowerTitle, lowerOther));
  }
  return Math.max(phraseTier, weakest);
}
