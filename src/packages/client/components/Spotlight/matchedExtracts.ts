/**
 * Conversation extracts shown under a Spotlight agent row — the "what is this
 * conversation about?" glimpse. The server returns up to MAX_EXTRACTS ranked,
 * role-tagged extracts per hit (user prompts containing the query first, then
 * agent text/reasoning, then tool output); the client may prepend one
 * store-side match (the agent's recent user query that matched — a user
 * prompt by construction) and must dedupe the two sources, which describe the
 * same prompts with different truncation windows.
 */

import type { SessionExtract } from '../../api/sessions';

export const MAX_EXTRACTS = 4;

/** Comparable form: lowercase, whitespace-collapsed, ellipsis-stripped. */
function normalizeExtract(text: string): string {
  return text
    .replace(/…|\.\.\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Containment only counts as "same prompt" when the shorter side is long
 * enough to be a real sentence fragment — a short extract like "convert A"
 * must not be swallowed by any longer one that happens to contain it. */
const CONTAINMENT_MIN_LEN = 24;

/** Same prompt seen through two windows: one normalized form contains the other. */
function sameExtract(a: string, b: string): boolean {
  const na = normalizeExtract(a);
  const nb = normalizeExtract(b);
  if (na === nb) return true;
  if (Math.min(na.length, nb.length) < CONTAINMENT_MIN_LEN) return false;
  return na.includes(nb) || nb.includes(na);
}

/**
 * Merge an optional leading user-prompt extract with the server's ranked
 * extracts into at most MAX_EXTRACTS distinct entries, preserving order.
 * Returns undefined when there is nothing to show (so callers can fall back
 * to single-line rendering).
 */
export function mergeExtracts(
  lead: string | undefined,
  extracts: readonly SessionExtract[] | undefined,
): SessionExtract[] | undefined {
  const out: SessionExtract[] = [];
  const push = (extract: SessionExtract | undefined) => {
    if (!extract || !extract.text.trim()) return;
    if (out.length >= MAX_EXTRACTS) return;
    if (out.some((existing) => sameExtract(existing.text, extract.text))) return;
    out.push(extract);
  };
  if (lead) push({ text: lead, kind: 'user' });
  for (const e of extracts ?? []) push(e);
  return out.length > 0 ? out : undefined;
}
