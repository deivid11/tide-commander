import type { i18n as I18nType } from 'i18next';

// Lazy-load i18n to avoid circular dependencies
let _i18nInstance: I18nType | null = null;
function _getI18n(): I18nType | null {
  if (!_i18nInstance) {
    try {
      // Dynamic import resolved at module level after init
      _i18nInstance = (globalThis as Record<string, unknown>).__i18n as I18nType | null;
    } catch { /* i18n not yet initialized */ }
  }
  return _i18nInstance;
}

// Allow i18n instance to be set externally (called from i18n.ts after init)
export function setI18nInstance(instance: I18nType): void {
  _i18nInstance = instance;
}

// Format number with K/M suffix
export function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

// Format tokens with K suffix
export function formatTokens(tokens: number): string {
  if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M';
  if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K';
  return tokens.toString();
}

/** Compact model/context capacity labels: 200k, 272k, 1M, 1.5M. */
export function formatTokenCapacity(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

// Format relative time ago
export function formatTimeAgo(timestamp: number): string {
  const i18n = _getI18n();
  const t = i18n?.t?.bind(i18n);
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return t ? t('common:time.seconds', { count: seconds }) : `${seconds}s`;
  if (seconds < 3600) return t ? t('common:time.minutes', { count: Math.floor(seconds / 60) }) : `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return t ? t('common:time.hours', { count: Math.floor(seconds / 3600) }) : `${Math.floor(seconds / 3600)}h`;
  return t ? t('common:time.days', { count: Math.floor(seconds / 86400) }) : `${Math.floor(seconds / 86400)}d`;
}

// Format idle time in human readable format (for agent idle display)
export function formatIdleTime(timestamp: number): string {
  const i18n = _getI18n();
  const t = i18n?.t?.bind(i18n);
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 5) return t ? t('common:time.justNow') : 'just now';
  if (seconds < 60) return t ? t('common:time.secondsAgo', { count: seconds }) : `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const secs = seconds % 60;
    if (secs > 0) return t ? t('common:time.minutesSecondsAgo', { minutes, seconds: secs }) : `${minutes}m ${secs}s ago`;
    return t ? t('common:time.minutesAgo', { count: minutes }) : `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) {
    if (mins > 0) return t ? t('common:time.hoursMinutesAgo', { hours, minutes: mins }) : `${hours}h ${mins}m ago`;
    return t ? t('common:time.hoursAgo', { count: hours }) : `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  const hrs = hours % 24;
  if (hrs > 0) return t ? t('common:time.daysHoursAgo', { days, hours: hrs }) : `${days}d ${hrs}h ago`;
  return t ? t('common:time.daysAgo', { count: days }) : `${days}d ago`;
}

// getIdleTimerColor has been moved to utils/colors.ts
// Re-export for backwards compatibility
export { getIdleTimerColor } from './colors';

// Filter out cost/price mentions from text
// Used globally when hideCost setting is enabled
// Memo for filterCostText: OutputLine/HistoryLine call it on EVERY render
// (streaming rows re-render per chunk, history rows re-mount on scroll / the
// live→history swap / the virtualizer warm-up walk), and the regex passes are
// O(text) — ~10 ms for a 500 KB tool output. Keyed by the text itself: V8
// caches a string's hash on the string, so repeat lookups are O(1). Bounded
// by entries + total chars so long sessions can't pin memory.
const FILTER_COST_MAX_ENTRIES = 512;
const FILTER_COST_MAX_CHARS = 8 * 1024 * 1024;
const filterCostCache = new Map<string, string>();
let filterCostCacheChars = 0;

// What an API/session cost actually looks like: a plain, small amount —
// `$0.05`, `~$1.23`, `$12.4567`, `$2`. Deliberately NOT matched: amounts with
// thousands separators (`$217,501.30`) and bare amounts of $10,000 or more.
// Those are real-world money the user or an agent is talking ABOUT — invoices,
// salaries, budgets — and silently deleting them from a message is far worse
// than leaving a session cost visible. The trailing `(?![\d,.])` is what makes
// that hold: without it `$217,501.30` would match its `$217` prefix and render
// as a mangled `,501.30`.
const COST_AMOUNT = String.raw`~?\$\d{1,4}(?:\.\d{1,6})?(?![\d,.])`;
const HAS_COST_AMOUNT = new RegExp(COST_AMOUNT);

const BARE_AMOUNT_RE = new RegExp(String.raw`[^\S\n]*\(?[^\S\n]*${COST_AMOUNT}(?:[^\S\n]*\))?`, 'g');
const COST_LABEL_RE = new RegExp(String.raw`[^\S\n]*cost[:\s]+${COST_AMOUNT}`, 'gi');
const PRICE_LABEL_RE = new RegExp(String.raw`[^\S\n]*price[:\s]+${COST_AMOUNT}`, 'gi');
const PARENTHESISED_RE = new RegExp(String.raw`[^\S\n]*\(${COST_AMOUNT}[^\S\n]*(?:USD|cost|spent)?\)`, 'gi');
const TRAILING_DASH_RE = new RegExp(String.raw`[^\S\n]*-[^\S\n]*${COST_AMOUNT}[^\S\n]*$`, 'g');  // trailing " - $0.05"

function filterCostTextUncached(text: string): string {
  // Only spend the regex passes when there is an amount worth stripping — the
  // common case (prose, and code full of shell `$VAR`s) returns the exact
  // input, preserving indentation.
  if (text.indexOf('$') === -1 || !HAS_COST_AMOUNT.test(text)) return text;
  // Remove patterns like "$0.05", "cost: $1.23", "(cost $0.50)", "~$0.10", etc.
  // Whitespace is only touched around a removed match (the leading `\s*` in
  // each pattern absorbs the space before it); a blanket collapse would
  // destroy code indentation / table alignment in messages that mention a
  // price once.
  return text
    .replace(BARE_AMOUNT_RE, '')
    .replace(COST_LABEL_RE, '')
    .replace(PRICE_LABEL_RE, '')
    .replace(PARENTHESISED_RE, '')
    .replace(TRAILING_DASH_RE, '')
    .replace(/[^\S\n]+$/gm, '')  // trailing spaces left behind on a line
    .trim();
}

export function filterCostText(text: string | undefined, hideCost: boolean): string {
  if (!text) return '';
  if (!hideCost) return text;
  const hit = filterCostCache.get(text);
  if (hit !== undefined) {
    // Refresh recency (Map keeps insertion order).
    filterCostCache.delete(text);
    filterCostCache.set(text, hit);
    return hit;
  }
  const out = filterCostTextUncached(text);
  if (text.length <= FILTER_COST_MAX_CHARS) {
    filterCostCache.set(text, out);
    filterCostCacheChars += text.length;
    while (filterCostCache.size > FILTER_COST_MAX_ENTRIES || filterCostCacheChars > FILTER_COST_MAX_CHARS) {
      const oldest = filterCostCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      filterCostCache.delete(oldest);
      filterCostCacheChars -= oldest.length;
    }
  }
  return out;
}

/**
 * Detects a Codex message body that serialized to a content-block array whose
 * text fields are all empty (e.g. `[{"type":"output_text","text":""}]`).
 *
 * Such payloads occasionally reach the terminal/history when a Codex
 * agent_message resolves to nothing; they must render as an empty message
 * (or be dropped), never as raw JSON. This is a defensive client-side net —
 * the server normally strips these before they reach us.
 */
export function isEmptyCodexPayloadText(text: string | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed.startsWith('[')) return false;
  // Cheap pre-check before attempting JSON.parse.
  if (
    !trimmed.includes('output_text') &&
    !trimmed.includes('input_text') &&
    !trimmed.includes('"text"')
  ) {
    return false;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.length === 0) return false;
    return parsed.every((block) => {
      if (!block || typeof block !== 'object' || Array.isArray(block)) return false;
      const type = (block as { type?: unknown }).type;
      const blockText = (block as { text?: unknown }).text;
      const isTextBlock = type === 'output_text' || type === 'input_text' || type === 'text';
      return isTextBlock && (typeof blockText !== 'string' || blockText.trim().length === 0);
    });
  } catch {
    return false;
  }
}
