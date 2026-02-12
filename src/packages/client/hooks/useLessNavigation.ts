/**
 * useLessNavigation - Less/Vim-style keyboard navigation for file viewers
 *
 * Provides keyboard-driven navigation with vim/less keybindings:
 * - j/k: scroll down/up by line
 * - d/u: scroll down/up by half page
 * - f/b: scroll down/up by full page
 * - g/G: jump to top/bottom of file
 * - h/l: horizontal scroll
 * - /: activate search (Phase 2)
 * - n/N: navigate matches (Phase 2)
 * - ?: toggle help overlay (Phase 4)
 * - q: close viewer (optional)
 */

import { useEffect, useRef, useCallback, RefObject, useState, useMemo } from 'react';

/**
 * Detect the scrollable container within a ref
 * Tries multiple selectors in priority order to find the appropriate scroll target
 */
function detectScrollContainer(ref: RefObject<HTMLDivElement>): HTMLElement | null {
  if (!ref.current) return null;

  // Priority order for finding scrollable element
  const selectors = [
    '.file-viewer-code-with-lines', // TextFileViewer with line numbers
    '.file-viewer-markdown-wrapper', // MarkdownFileViewer rendered
    '.file-viewer-code-wrapper', // MarkdownFileViewer source or other code views
    '.file-viewer-diagram-wrapper', // PlantUmlFileViewer
    '.file-viewer-image-wrapper', // ImageFileViewer
    '.file-viewer-pdf-wrapper', // PdfFileViewer
  ];

  for (const selector of selectors) {
    const el = ref.current.querySelector(selector);
    if (el && isScrollable(el as HTMLElement)) {
      return el as HTMLElement;
    }
  }

  // Fallback to the ref itself if it's scrollable
  if (isScrollable(ref.current)) {
    return ref.current;
  }

  return null;
}

/**
 * Check if an element is scrollable (has overflow and scrollHeight > clientHeight)
 */
function isScrollable(el: HTMLElement): boolean {
  const hasOverflow = ['auto', 'scroll'].includes(getComputedStyle(el).overflowY);
  const isOverflowing = el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth;
  return hasOverflow && isOverflowing;
}

/**
 * Calculate line height from an element's computed style
 */
function getLineHeight(element: HTMLElement | null): number {
  if (!element) return 19.5; // Default fallback
  const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
  return isNaN(lineHeight) ? 19.5 : lineHeight;
}

/**
 * Scroll by a number of lines (vertical)
 */
function scrollByLines(container: HTMLElement, lines: number, lineHeight: number = 19.5) {
  const scrollAmount = lines * lineHeight;
  container.scrollBy({ top: scrollAmount, behavior: 'smooth' });
}

/**
 * Scroll by a percentage of the visible area (half page, full page, etc.)
 */
function scrollByPages(container: HTMLElement, pages: number) {
  const pageHeight = container.clientHeight;
  const scrollAmount = pages * pageHeight;
  container.scrollBy({ top: scrollAmount, behavior: 'smooth' });
}

/**
 * Jump to the top or bottom of scrollable content
 */
function jumpToEnd(container: HTMLElement, toBottom: boolean = true) {
  const position = toBottom ? container.scrollHeight : 0;
  container.scrollTo({ top: position, behavior: 'smooth' });
}

/**
 * Horizontal scroll
 */
function scrollHorizontal(container: HTMLElement, direction: 'left' | 'right') {
  const scrollAmount = direction === 'right' ? 50 : -50;
  container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
}

/**
 * Get current scroll position as percentage (0-100)
 */
function getScrollPercentage(container: HTMLElement): number {
  const { scrollTop, scrollHeight, clientHeight } = container;
  if (scrollHeight <= clientHeight) return 100;
  return Math.round((scrollTop / (scrollHeight - clientHeight)) * 100);
}

/**
 * Get current line number based on scroll position (for TextFileViewer with line numbers)
 */
function getCurrentLineNumber(container: HTMLElement, content: string): number {
  const lineHeight = getLineHeight(container);
  const scrollTop = container.scrollTop;
  const lineNumber = Math.floor(scrollTop / lineHeight) + 1;
  const totalLines = content.split('\n').length;
  return Math.min(lineNumber, totalLines);
}

/**
 * Search match within a file
 */
export interface SearchMatch {
  index: number; // Match index (0-based)
  line: number; // Line number (1-based)
  column: number; // Column in line (0-based)
  length: number; // Length of match
  charIndex: number; // Character offset in entire content
}

/**
 * Find all matches of a query string in content
 * Case-insensitive search (can be extended for case-sensitive option)
 */
function findMatches(content: string, query: string, caseSensitive = false): SearchMatch[] {
  if (!query) return [];

  const text = caseSensitive ? content : content.toLowerCase();
  const search = caseSensitive ? query : query.toLowerCase();
  const matches: SearchMatch[] = [];

  let searchIndex = 0;
  let matchIndex = 0;
  const lines = content.split('\n');
  let charIndex = 0;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    const lineText = caseSensitive ? line : line.toLowerCase();

    let colIndex = 0;
    let matchPos = lineText.indexOf(search);

    while (matchPos !== -1) {
      const charOffset = charIndex + matchPos;

      matches.push({
        index: matchIndex++,
        line: lineNum + 1,
        column: matchPos,
        length: search.length,
        charIndex: charOffset,
      });

      colIndex = matchPos + search.length;
      matchPos = lineText.indexOf(search, colIndex);
    }

    charIndex += line.length + 1; // +1 for newline
  }

  return matches;
}

/**
 * Get character offset for a given line and column
 */
function getCharIndexFromLineCol(content: string, line: number, column: number): number {
  const lines = content.split('\n');
  let charIndex = 0;

  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    charIndex += lines[i].length + 1; // +1 for newline
  }

  return charIndex + column;
}

export interface UseLessNavigationOptions {
  containerRef: RefObject<HTMLDivElement>;
  isEnabled?: boolean;
  content?: string; // For line counting and search (Phase 2)
  onClose?: () => void; // Called when q or Escape is pressed
  onSearchOpen?: () => void; // Called when / is pressed (Phase 2)
}

export interface UseLessNavigationReturn {
  scrollPercentage: number;
  currentLine: number;
  totalLines: number;
  // Search state
  searchActive: boolean;
  searchQuery: string;
  searchMatches: SearchMatch[];
  currentMatchIndex: number;
  // Search actions
  startSearch: () => void;
  setSearchQuery: (query: string) => void;
  nextMatch: () => void;
  prevMatch: () => void;
  clearSearch: () => void;
  // Help state and actions
  helpActive: boolean;
  toggleHelp: () => void;
}

/**
 * Hook for less/vim-style navigation in file viewers
 *
 * Usage:
 * ```tsx
 * const containerRef = useRef<HTMLDivElement>(null);
 * const navigation = useLessNavigation({
 *   containerRef,
 *   isEnabled: true,
 *   content: fileContent,
 *   onClose: closeViewer,
 * });
 *
 * return (
 *   <div ref={containerRef} className="file-viewer-content">
 *     <ScrollIndicator percentage={navigation.scrollPercentage} line={navigation.currentLine} total={navigation.totalLines} />
 *   </div>
 * );
 * ```
 */
export function useLessNavigation(options: UseLessNavigationOptions): UseLessNavigationReturn {
  const { containerRef, isEnabled = true, content = '', onClose, onSearchOpen } = options;

  // State for tracking scroll position (updated on scroll events)
  const scrollRef = useRef<{ percentage: number; line: number }>({ percentage: 0, line: 1 });
  const containerState = useRef<HTMLElement | null>(null);
  const lineHeight = useRef<number>(19.5);

  // Search state
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // Help overlay state
  const [helpActive, setHelpActive] = useState(false);

  // Memoize search matches to avoid recalculating on every render
  const searchMatches = useMemo(
    () => findMatches(content, searchQuery, false),
    [content, searchQuery]
  );

  // Update scroll tracking on scroll events
  const updateScrollPosition = useCallback(() => {
    const container = containerState.current;
    if (!container) return;

    const percentage = getScrollPercentage(container);
    const line = getCurrentLineNumber(container, content);

    scrollRef.current = { percentage, line };
  }, [content]);

  // Search handlers
  const startSearch = useCallback(() => {
    setSearchActive(true);
    setSearchQuery('');
    setCurrentMatchIndex(0);
    onSearchOpen?.();
  }, [onSearchOpen]);

  const clearSearch = useCallback(() => {
    setSearchActive(false);
    setSearchQuery('');
    setCurrentMatchIndex(0);
  }, []);

  const toggleHelp = useCallback(() => {
    setHelpActive((prev) => !prev);
  }, []);

  const nextMatch = useCallback(() => {
    if (searchMatches.length === 0) return;

    setCurrentMatchIndex((prev) => (prev + 1) % searchMatches.length);

    // Auto-scroll to current match
    const currentMatch = searchMatches[(currentMatchIndex + 1) % searchMatches.length];
    if (currentMatch && containerState.current) {
      const lineHeight = getLineHeight(containerState.current);
      const targetTop = (currentMatch.line - 1) * lineHeight;
      containerState.current.scrollTo({
        top: Math.max(0, targetTop - 100),
        behavior: 'smooth',
      });
    }
  }, [searchMatches, currentMatchIndex]);

  const prevMatch = useCallback(() => {
    if (searchMatches.length === 0) return;

    setCurrentMatchIndex((prev) => (prev - 1 + searchMatches.length) % searchMatches.length);

    // Auto-scroll to current match
    const currentMatch = searchMatches[(currentMatchIndex - 1 + searchMatches.length) % searchMatches.length];
    if (currentMatch && containerState.current) {
      const lineHeight = getLineHeight(containerState.current);
      const targetTop = (currentMatch.line - 1) * lineHeight;
      containerState.current.scrollTo({
        top: Math.max(0, targetTop - 100),
        behavior: 'smooth',
      });
    }
  }, [searchMatches, currentMatchIndex]);

  // Main keyboard event handler
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;

    // Don't intercept if user is typing in input/textarea
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return;
    }

    const container = containerState.current;
    if (!container) return;

    // Determine if this is a less-style key
    let handled = false;

    // Vertical navigation
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      scrollByLines(container, 3, lineHeight.current);
      handled = true;
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      scrollByLines(container, -3, lineHeight.current);
      handled = true;
    } else if ((e.key === 'd' && e.ctrlKey) || e.key === 'd') {
      // d or Ctrl+D for half-page down
      e.preventDefault();
      e.stopPropagation();
      scrollByPages(container, 0.5);
      handled = true;
    } else if ((e.key === 'u' && e.ctrlKey) || e.key === 'u') {
      // u or Ctrl+U for half-page up
      e.preventDefault();
      e.stopPropagation();
      scrollByPages(container, -0.5);
      handled = true;
    } else if (e.key === 'f' || e.key === ' ' || e.key === 'PageDown') {
      // f, space, or PageDown for full page down
      e.preventDefault();
      e.stopPropagation();
      scrollByPages(container, 1);
      handled = true;
    } else if (e.key === 'b' || e.key === 'PageUp') {
      // b or PageUp for full page up
      e.preventDefault();
      e.stopPropagation();
      scrollByPages(container, -1);
      handled = true;
    } else if (e.key === 'g' || e.key === 'Home') {
      // g or Home to go to top
      if (e.key === 'g' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
      }
      jumpToEnd(container, false);
      handled = true;
    } else if ((e.key === 'G' && e.shiftKey) || e.key === 'End') {
      // G (Shift+G) or End to go to bottom
      if (e.key === 'G') {
        e.preventDefault();
        e.stopPropagation();
      }
      jumpToEnd(container, true);
      handled = true;
    }
    // Horizontal navigation
    else if (e.key === 'h' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      scrollHorizontal(container, 'left');
      handled = true;
    } else if (e.key === 'l' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      scrollHorizontal(container, 'right');
      handled = true;
    }
    // Search
    else if (e.key === '/') {
      e.preventDefault();
      e.stopPropagation();
      startSearch();
      handled = true;
    }
    // Next match
    else if (e.key === 'n' && !searchActive) {
      e.preventDefault();
      e.stopPropagation();
      nextMatch();
      handled = true;
    }
    // Previous match
    else if ((e.key === 'N' && e.shiftKey) && !searchActive) {
      e.preventDefault();
      e.stopPropagation();
      prevMatch();
      handled = true;
    }
    // Help overlay toggle
    else if (e.key === '?') {
      e.preventDefault();
      e.stopPropagation();
      toggleHelp();
      handled = true;
    }
    // Close (optional)
    else if (e.key === 'q') {
      e.preventDefault();
      e.stopPropagation();
      onClose?.();
      handled = true;
    } else if (e.key === 'Escape') {
      // Escape closes search bar if open, otherwise closes viewer
      // For now, just close the viewer
      e.preventDefault();
      e.stopPropagation();
      onClose?.();
      handled = true;
    }

    // Update scroll position after any handled key
    if (handled) {
      // Use requestAnimationFrame to update after scroll completes
      requestAnimationFrame(updateScrollPosition);
    }
  }, [onClose, onSearchOpen, updateScrollPosition]);

  // Setup and teardown event listeners
  useEffect(() => {
    if (!isEnabled) return;

    // Find the scrollable container
    const container = detectScrollContainer(containerRef);
    containerState.current = container;

    if (!container) {
      console.warn('[useLessNavigation] Could not find scrollable container');
      return;
    }

    // Store line height for this container
    lineHeight.current = getLineHeight(container);

    // Add scroll event listener for position tracking
    const handleScroll = () => {
      updateScrollPosition();
    };

    // Use capture phase like FileViewerModal to ensure we intercept before other handlers
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    container.addEventListener('scroll', handleScroll, { passive: true });

    // Initial scroll position
    updateScrollPosition();

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      container.removeEventListener('scroll', handleScroll);
    };
  }, [isEnabled, handleKeyDown, updateScrollPosition]);

  return {
    scrollPercentage: scrollRef.current.percentage,
    currentLine: scrollRef.current.line,
    totalLines: content.split('\n').length,
    searchActive,
    searchQuery,
    searchMatches,
    currentMatchIndex,
    startSearch,
    setSearchQuery,
    nextMatch,
    prevMatch,
    clearSearch,
    helpActive,
    toggleHelp,
  };
}
