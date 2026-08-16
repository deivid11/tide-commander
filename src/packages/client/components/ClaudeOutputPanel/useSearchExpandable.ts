/**
 * Let a collapsible region open itself when the finder lands on a match hidden
 * inside it.
 *
 * The search highlighter cannot paint text that is collapsed away, and a note
 * quoting the source is a poor substitute for seeing the hit in place. Instead
 * it asks the row's collapsed regions to expand (see requestExpandHiddenContent);
 * this hook is how a component opts into being asked.
 *
 * Two lines to join:
 *
 *   const rootRef = useRef<HTMLDivElement>(null);
 *   useSearchExpandable(rootRef, isCollapsed, expand);
 *
 * The attribute is present ONLY while collapsed, which is what stops the
 * expand → repaint → expand loop: once open, the row has nothing left to ask.
 */

import { useEffect } from 'react';
import type { RefObject } from 'react';
import { SEARCH_EXPANDABLE_ATTR, SEARCH_EXPAND_EVENT } from './searchDomHighlight';

export function useSearchExpandable(
  ref: RefObject<HTMLElement | null>,
  collapsed: boolean,
  expand: () => void
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !collapsed) return;

    el.setAttribute(SEARCH_EXPANDABLE_ATTR, 'true');
    const onExpand = () => expand();
    el.addEventListener(SEARCH_EXPAND_EVENT, onExpand);

    return () => {
      el.removeAttribute(SEARCH_EXPANDABLE_ATTR);
      el.removeEventListener(SEARCH_EXPAND_EVENT, onExpand);
    };
  }, [ref, collapsed, expand]);
}
