/**
 * Pure matching helpers for the Alfred workflow endpoints — same AND-of-words
 * semantics as the in-app Spotlight (each word may match a different field;
 * the item's tier is its weakest word). Kept free of service imports so tests
 * exercise them without the server boot chain.
 */

/** Lowercased whitespace-separated words of a query ('' → []). */
export function tokenizeAlfredQuery(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

// Tiered match quality (higher = better):
//   6 exact title · 5 prefix · 4 whole-word · 3 title substring
//   2 other-field substring · 0 no match.
function tierOf(needle: string, lowerTitle: string, lowerOther: string): number {
  if (lowerTitle === needle) return 6;
  if (lowerTitle.startsWith(needle)) return 5;
  if (lowerTitle.split(/[^a-z0-9]+/i).includes(needle)) return 4;
  if (lowerTitle.includes(needle)) return 3;
  if (lowerOther.includes(needle)) return 2;
  return 0;
}

/**
 * AND-of-words match tier for an item: every word must land somewhere (title
 * or other fields, each word independently), 0 = excluded. Empty queries rank
 * everything at 1 (recency decides the order).
 */
export function alfredMatchTier(tokens: string[], title: string, otherText: string): number {
  if (tokens.length === 0) return 1;
  const lowerTitle = title.toLowerCase();
  const lowerOther = otherText.toLowerCase();
  let weakest = 6;
  for (const token of tokens) {
    const tier = tierOf(token, lowerTitle, lowerOther);
    if (tier === 0) return 0;
    if (tier < weakest) weakest = tier;
  }
  return weakest;
}
