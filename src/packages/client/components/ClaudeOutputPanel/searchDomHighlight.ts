/**
 * searchDomHighlight - Native-style find highlighting for the Guake terminal.
 *
 * The old find swapped the markdown renderer for a raw-text version with
 * <mark> tags whenever search was active, destroying message formatting.
 * This module instead paints matches with the CSS Custom Highlight API on top
 * of the normally-rendered DOM (the same mechanism the browser's own Ctrl+F
 * uses):
 *
 *   - Messages keep their markdown rendering untouched while searching.
 *   - Matches are collected per virtualized row by walking rendered text
 *     nodes, so a hit can span inline formatting boundaries
 *     ("hello **world**" still matches the query "hello world").
 *   - Occurrences in the row the user navigated to paint with the stronger
 *     ::highlight(tc-search-active) style; every other hit paints with
 *     ::highlight(tc-search-match). Styles live in
 *     styles/components/guake-terminal/_search.scss.
 *
 * A MutationObserver keeps the painted ranges fresh while the virtualizer
 * mounts/unmounts rows and live output streams in. Browsers without the
 * Highlight API simply skip inline painting — match navigation and the
 * results panel still work.
 */

import { useEffect } from 'react';
import type { RefObject } from 'react';
import { tokenize } from './searchIndexing';

export const SEARCH_HIGHLIGHT_NAME = 'tc-search-match';
export const SEARCH_ACTIVE_HIGHLIGHT_NAME = 'tc-search-active';

/**
 * Class set on the active row when the matcher found the query in the item's
 * SOURCE text but no visibly painted range exists in the rendered row — the
 * hit lives in truncated previews, collapsed sections, or content the
 * renderer never mounts (e.g. bash output with inline outputs off).
 */
export const HIDDEN_MATCH_CLASS = 'search-match-hidden';

/**
 * Elements with this attribute are invisible to the row text scan. The in-row
 * "hidden match" note carries it — the note contains the query term, so
 * without the skip it would count as a visible hit and immediately dismiss
 * itself (mount → "visible" → unmount → "hidden" → mount … oscillation).
 */
export const SEARCH_SKIP_ATTR = 'data-search-skip';

export interface MatchSpan {
  start: number;
  end: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compute the [start, end) spans of every query hit in `text`.
 * The exact phrase and each individual token all count as hits; alternatives
 * are tried longest-first so the phrase wins over its own words at the same
 * offset. Case-insensitive; returned spans never overlap.
 */
export function computeMatchSpans(text: string, query: string): MatchSpan[] {
  const phrase = query.trim().toLowerCase();
  if (!phrase || !text) return [];
  const needles = Array.from(new Set([phrase, ...tokenize(phrase)])).sort(
    (a, b) => b.length - a.length
  );
  const re = new RegExp(needles.map(escapeRegExp).join('|'), 'gi');
  const spans: MatchSpan[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

/**
 * Elements that break visual text flow: a match must never span across them,
 * so the row-text builder inserts a '\n' separator at their boundaries
 * (queries are single-line, so a separator can never be inside a hit).
 */
const BLOCK_BOUNDARY_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BUTTON', 'DD', 'DETAILS',
  'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV',
  'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT',
  'TH', 'THEAD', 'TR', 'UL',
]);

export interface RowTextIndex {
  /** Concatenated rendered text with '\n' at block boundaries. */
  text: string;
  /** Every text node in document order with its start offset in `text`. */
  nodes: Array<{ node: Text; start: number }>;
}

function nearestBlockAncestor(node: Text, root: Element): Element {
  let el: Element | null = node.parentElement;
  while (el && el !== root) {
    if (BLOCK_BOUNDARY_TAGS.has(el.tagName)) return el;
    el = el.parentElement;
  }
  return root;
}

/**
 * Flatten a row's rendered text into one searchable string plus the node map
 * needed to convert string offsets back into DOM positions.
 */
export function buildRowTextIndex(root: Element): RowTextIndex {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (n) =>
        n.nodeType === Node.ELEMENT_NODE && (n as Element).hasAttribute(SEARCH_SKIP_ATTR)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    }
  );
  let text = '';
  const nodes: RowTextIndex['nodes'] = [];
  let prevBlock: Element | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      if ((n as Element).tagName === 'BR') text += '\n';
      continue;
    }
    const t = n as Text;
    if (!t.data) continue;
    const block = nearestBlockAncestor(t, root);
    if (prevBlock !== null && block !== prevBlock) text += '\n';
    prevBlock = block;
    nodes.push({ node: t, start: text.length });
    text += t.data;
  }
  return { text, nodes };
}

function locate(
  nodes: RowTextIndex['nodes'],
  offset: number
): { node: Text; local: number } | null {
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const entry = nodes[mid];
    if (offset < entry.start) hi = mid - 1;
    else if (offset >= entry.start + entry.node.data.length) lo = mid + 1;
    else return { node: entry.node, local: offset - entry.start };
  }
  return null;
}

/** Convert a span in the flattened row text into a (possibly multi-node) Range. */
export function spanToRange(index: RowTextIndex, span: MatchSpan): Range | null {
  const start = locate(index.nodes, span.start);
  const end = locate(index.nodes, span.end - 1);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.local);
  range.setEnd(end.node, end.local + 1);
  return range;
}

export function isHighlightApiSupported(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    'highlights' in CSS &&
    typeof Highlight === 'function'
  );
}

export function clearSearchHighlights(container?: HTMLElement): void {
  container
    ?.querySelectorAll('.' + HIDDEN_MATCH_CLASS)
    .forEach((el) => el.classList.remove(HIDDEN_MATCH_CLASS));
  if (!isHighlightApiSupported()) return;
  CSS.highlights.delete(SEARCH_HIGHLIGHT_NAME);
  CSS.highlights.delete(SEARCH_ACTIVE_HIGHLIGHT_NAME);
}

/** Whether a painted range is actually visible within its row's bounds. */
function rangeIsVisible(range: Range, rowRect: DOMRect): boolean {
  for (const r of range.getClientRects()) {
    if (
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > rowRect.top &&
      r.top < rowRect.bottom &&
      r.right > rowRect.left &&
      r.left < rowRect.right
    ) {
      return true;
    }
  }
  return false;
}

export interface ApplyHighlightsResult {
  /**
   * True when the active row is rendered but none of its query hits paint
   * visibly — the match text is truncated/collapsed/unmounted. The row gets
   * HIDDEN_MATCH_CLASS so CSS can flag it; the caller surfaces the matched
   * source text as an in-row note (marked with SEARCH_SKIP_ATTR).
   */
  activeMatchHidden: boolean;
}

/**
 * Paint every query hit inside the rendered virtualizer rows. Hits in the row
 * at `activeIndex` (the current find match) go into the stronger "active"
 * highlight; all others into the regular one.
 */
export function applySearchHighlights(
  container: HTMLElement,
  query: string,
  activeIndex: number | null
): ApplyHighlightsResult {
  const matchRanges: Range[] = [];
  const activeRanges: Range[] = [];
  let activeRow: HTMLElement | null = null;
  for (const row of container.querySelectorAll<HTMLElement>('[data-index]')) {
    const isActive = activeIndex !== null && Number(row.dataset.index) === activeIndex;
    if (isActive) activeRow = row;
    else row.classList.remove(HIDDEN_MATCH_CLASS);
    const target = isActive ? activeRanges : matchRanges;
    const index = buildRowTextIndex(row);
    if (!index.text) continue;
    for (const span of computeMatchSpans(index.text, query)) {
      const range = spanToRange(index, span);
      if (range) target.push(range);
    }
  }
  CSS.highlights.set(SEARCH_HIGHLIGHT_NAME, new Highlight(...matchRanges));
  CSS.highlights.set(SEARCH_ACTIVE_HIGHLIGHT_NAME, new Highlight(...activeRanges));

  let activeMatchHidden = false;
  if (activeRow) {
    const rowRect = activeRow.getBoundingClientRect();
    activeMatchHidden = !activeRanges.some((r) => rangeIsVisible(r, rowRect));
    activeRow.classList.toggle(HIDDEN_MATCH_CLASS, activeMatchHidden);
  }
  return { activeMatchHidden };
}

/**
 * Keep search highlights painted over the output while `query` is set.
 * Repaints (rAF-debounced) whenever the rendered DOM changes — virtualizer
 * row churn, live streaming — and clears all painting when search closes.
 *
 * `onActiveMatchHidden` reports whether the current match's hit text is
 * invisible in the rendered row (see ApplyHighlightsResult) so the caller
 * can surface the matched source text.
 */
export function useSearchDomHighlight(
  containerRef: RefObject<HTMLElement | null>,
  query: string | undefined,
  activeIndex: number | null,
  onActiveMatchHidden?: (hidden: boolean) => void
): void {
  useEffect(() => {
    if (!isHighlightApiSupported()) return;
    const container = containerRef.current;
    const trimmed = query?.trim();
    if (!container || !trimmed) {
      clearSearchHighlights(container ?? undefined);
      onActiveMatchHidden?.(false);
      return;
    }
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const result = applySearchHighlights(container, trimmed, activeIndex);
        onActiveMatchHidden?.(result.activeMatchHidden);
      });
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
      clearSearchHighlights(container);
      onActiveMatchHidden?.(false);
    };
  }, [containerRef, query, activeIndex, onActiveMatchHidden]);
}
