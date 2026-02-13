/**
 * useLessNavigation - Vim-style keyboard navigation for file viewers
 *
 * Navigation:
 * - j/k: move cursor down/up by line
 * - h/l: move cursor left/right by character
 * - w/e/b: word motions (next word, end of word, back word)
 * - 0/$: start/end of line
 * - ^: first non-whitespace
 * - d/u: half page down/up
 * - f/b: full page down/up
 * - g/G: top/bottom of file
 *
 * Visual mode:
 * - v: enter character-wise visual mode
 * - V: enter line-wise visual mode
 * - y: yank (copy) selection to clipboard
 * - Escape: exit visual mode
 *
 * Search:
 * - /: open search, n/N: next/prev match
 * - ?: toggle help overlay
 * - q: close viewer
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
function _scrollByLines(container: HTMLElement, lines: number, lineHeight: number = 19.5) {
  const scrollAmount = lines * lineHeight;
  container.scrollBy({ top: scrollAmount, behavior: 'smooth' });
}

/**
 * Scroll by a percentage of the visible area (half page, full page, etc.)
 */
function _scrollByPages(container: HTMLElement, pages: number) {
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
function _scrollHorizontal(container: HTMLElement, direction: 'left' | 'right') {
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

  const _text = caseSensitive ? content : content.toLowerCase();
  const search = caseSensitive ? query : query.toLowerCase();
  const matches: SearchMatch[] = [];

  let _searchIndex = 0;
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
function _getCharIndexFromLineCol(content: string, line: number, column: number): number {
  const lines = content.split('\n');
  let charIndex = 0;

  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    charIndex += lines[i].length + 1; // +1 for newline
  }

  return charIndex + column;
}

// ============================================================================
// WORD MOTION HELPERS
// ============================================================================

/** Check if a character is a "word" char (alphanumeric/underscore) */
function isWordChar(ch: string): boolean {
  return /[\w]/.test(ch);
}

/** Check if a character is whitespace */
function isWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}

/**
 * vim `w` motion: move to the start of the next word.
 * Returns { line, col } (1-based line, 0-based col).
 */
function nextWordStart(lines: string[], line: number, col: number): { line: number; col: number } {
  let l = line - 1; // 0-based
  let c = col;
  const totalLines = lines.length;

  // Phase 1: skip over current word/punctuation class
  const currentLine = lines[l] || '';
  if (c < currentLine.length) {
    const startIsWord = isWordChar(currentLine[c]);
    const startIsWs = isWhitespace(currentLine[c]);
    if (!startIsWs) {
      // Skip chars of same class
      while (c < currentLine.length && !isWhitespace(currentLine[c]) && isWordChar(currentLine[c]) === startIsWord) {
        c++;
      }
    }
  }

  // Phase 2: skip whitespace (including across newlines)
  while (l < totalLines) {
    const ln = lines[l] || '';
    while (c < ln.length && isWhitespace(ln[c])) {
      c++;
    }
    if (c < ln.length) {
      return { line: l + 1, col: c };
    }
    // Move to next line
    l++;
    c = 0;
  }

  // Reached end of file
  const lastLine = totalLines;
  const lastCol = Math.max(0, (lines[totalLines - 1] || '').length - 1);
  return { line: lastLine, col: lastCol };
}

/**
 * vim `e` motion: move to the end of the current/next word.
 */
function nextWordEnd(lines: string[], line: number, col: number): { line: number; col: number } {
  let l = line - 1;
  let c = col + 1; // advance at least one
  const totalLines = lines.length;

  // Skip whitespace (including across newlines)
  while (l < totalLines) {
    const ln = lines[l] || '';
    while (c < ln.length && isWhitespace(ln[c])) {
      c++;
    }
    if (c < ln.length) break;
    l++;
    c = 0;
  }

  if (l >= totalLines) {
    return { line: totalLines, col: Math.max(0, (lines[totalLines - 1] || '').length - 1) };
  }

  // Now skip to end of word class
  const ln = lines[l] || '';
  const startIsWord = isWordChar(ln[c]);
  while (c + 1 < ln.length && !isWhitespace(ln[c + 1]) && isWordChar(ln[c + 1]) === startIsWord) {
    c++;
  }

  return { line: l + 1, col: c };
}

/**
 * vim `b` motion: move to the start of the previous word.
 */
function prevWordStart(lines: string[], line: number, col: number): { line: number; col: number } {
  let l = line - 1;
  let c = col - 1; // move back at least one

  // Skip whitespace backward (including across newlines)
  while (l >= 0) {
    const ln = lines[l] || '';
    while (c >= 0 && isWhitespace(ln[c])) {
      c--;
    }
    if (c >= 0) break;
    l--;
    if (l >= 0) c = (lines[l] || '').length - 1;
  }

  if (l < 0) return { line: 1, col: 0 };

  // Now skip backward to start of word class
  const ln = lines[l] || '';
  const startIsWord = isWordChar(ln[c]);
  while (c > 0 && !isWhitespace(ln[c - 1]) && isWordChar(ln[c - 1]) === startIsWord) {
    c--;
  }

  return { line: l + 1, col: c };
}

// ============================================================================
// VISUAL MODE TYPES
// ============================================================================

export type VisualMode = 'none' | 'char' | 'line';

export interface SelectionRange {
  /** Anchor position (where visual mode started) */
  anchorLine: number; // 1-based
  anchorCol: number; // 0-based
  /** Head position (current cursor, moves with navigation) */
  headLine: number;
  headCol: number;
}

/**
 * Extract selected text from content given a selection range and visual mode
 */
function getSelectedText(content: string, lines: string[], selection: SelectionRange, mode: VisualMode): string {
  if (mode === 'none') return '';

  const { anchorLine, anchorCol, headLine, headCol } = selection;

  if (mode === 'line') {
    const startLine = Math.min(anchorLine, headLine);
    const endLine = Math.max(anchorLine, headLine);
    return lines.slice(startLine - 1, endLine).join('\n');
  }

  // char mode
  let startLine: number, startCol: number, endLine: number, endCol: number;
  if (anchorLine < headLine || (anchorLine === headLine && anchorCol <= headCol)) {
    startLine = anchorLine; startCol = anchorCol;
    endLine = headLine; endCol = headCol;
  } else {
    startLine = headLine; startCol = headCol;
    endLine = anchorLine; endCol = anchorCol;
  }

  if (startLine === endLine) {
    return (lines[startLine - 1] || '').substring(startCol, endCol + 1);
  }

  const result: string[] = [];
  result.push((lines[startLine - 1] || '').substring(startCol));
  for (let i = startLine; i < endLine - 1; i++) {
    result.push(lines[i] || '');
  }
  result.push((lines[endLine - 1] || '').substring(0, endCol + 1));
  return result.join('\n');
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
  currentColumn: number; // Column position (estimated from scroll position)
  totalLines: number;
  cursorLine: number; // The active cursor line (1-based), like vim
  cursorCol: number; // The active cursor column (0-based), like vim
  cursorModeActive: boolean; // Whether vim cursor mode is active (Escape to exit)
  // Visual mode
  visualMode: VisualMode;
  selection: SelectionRange | null;
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
  const scrollRef = useRef<{ percentage: number; line: number; column: number }>({ percentage: 0, line: 1, column: 1 });
  const containerState = useRef<HTMLElement | null>(null);
  const lineHeight = useRef<number>(19.5);

  // Cursor state - tracks the cursor position (line + column) like vim
  const lines = useMemo(() => content.split('\n'), [content]);
  const totalLines = lines.length;
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(0);
  const [cursorModeActive, setCursorModeActive] = useState(false);

  // Visual mode state
  const [visualMode, setVisualMode] = useState<VisualMode>('none');
  const [selection, setSelection] = useState<SelectionRange | null>(null);

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

    // Estimate column position based on horizontal scroll (1-based)
    const charWidth = 7.8; // Approximate character width in pixels at font size 13px
    const column = Math.max(1, Math.round(container.scrollLeft / charWidth) + 1);

    scrollRef.current = { percentage, line, column };
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

    // Auto-scroll to current match and move cursor
    const currentMatch = searchMatches[(currentMatchIndex + 1) % searchMatches.length];
    if (currentMatch && containerState.current) {
      setCursorLine(currentMatch.line);
      setCursorCol(currentMatch.column);
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

    // Auto-scroll to current match and move cursor
    const currentMatch = searchMatches[(currentMatchIndex - 1 + searchMatches.length) % searchMatches.length];
    if (currentMatch && containerState.current) {
      setCursorLine(currentMatch.line);
      setCursorCol(currentMatch.column);
      const lineHeight = getLineHeight(containerState.current);
      const targetTop = (currentMatch.line - 1) * lineHeight;
      containerState.current.scrollTo({
        top: Math.max(0, targetTop - 100),
        behavior: 'smooth',
      });
    }
  }, [searchMatches, currentMatchIndex]);

  /**
   * Ensure the cursor line is visible within the scroll container.
   * Finds the actual <pre> element to compute precise cursor position,
   * then scrolls the container to keep the cursor in view.
   */
  const ensureCursorVisible = useCallback((line: number) => {
    const container = containerState.current;
    if (!container) return;

    // Find the <pre> element inside the container to get accurate offsets
    const preEl = container.querySelector('.file-viewer-pre') as HTMLElement | null;
    if (!preEl) return;

    // Get computed line height from the <pre> element (where text actually lives)
    const computedLh = parseFloat(getComputedStyle(preEl).lineHeight);
    const lh = isNaN(computedLh) ? lineHeight.current : computedLh;

    // Get the <pre> element's padding-top
    const prePaddingTop = parseFloat(getComputedStyle(preEl).paddingTop) || 0;

    // Cursor position relative to the <pre> element's content area
    // Then offset by the <pre>'s position within the scroll container
    const preOffsetTop = preEl.offsetTop;
    const cursorTop = preOffsetTop + prePaddingTop + (line - 1) * lh;
    const cursorBottom = cursorTop + lh;

    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;

    // Scroll up if cursor is above viewport
    if (cursorTop < viewTop) {
      container.scrollTo({ top: Math.max(0, cursorTop), behavior: 'auto' });
    }
    // Scroll down if cursor is below viewport
    else if (cursorBottom > viewBottom) {
      container.scrollTo({ top: cursorBottom - container.clientHeight, behavior: 'auto' });
    }
  }, []);

  // Helper: move cursor and update visual selection head if in visual mode
  const moveCursor = useCallback((newLine: number, newCol: number) => {
    setCursorLine(newLine);
    setCursorCol(newCol);
    ensureCursorVisible(newLine);
    // Update selection head in visual mode
    if (visualMode !== 'none') {
      setSelection((prev) => prev ? { ...prev, headLine: newLine, headCol: newCol } : null);
    }
  }, [visualMode, ensureCursorVisible]);

  // Yank (copy) selected text to clipboard
  const yankSelection = useCallback(() => {
    if (visualMode === 'none' || !selection) return;
    const text = getSelectedText(content, lines, selection, visualMode);
    if (text) {
      navigator.clipboard.writeText(text).catch(() => {
        // Fallback: use execCommand
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      });
    }
    // Exit visual mode after yank
    setVisualMode('none');
    setSelection(null);
  }, [visualMode, selection, content, lines]);

  // Main keyboard event handler
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const isInInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

    // Always handle Escape, even when typing in input
    if (isInInput && e.key !== 'Escape') {
      return;
    }

    const container = containerState.current;
    if (!container) return;

    let handled = false;

    // Calculate lines per half/full page
    const lh = lineHeight.current;
    const linesPerPage = Math.max(1, Math.floor(container.clientHeight / lh));
    const linesPerHalfPage = Math.max(1, Math.floor(linesPerPage / 2));

    // Clamp column to target line length
    const clampCol = (line: number, col: number) => {
      const lineLen = Math.max(0, (lines[line - 1] || '').length - 1);
      return Math.min(col, Math.max(0, lineLen));
    };

    // Shorthand: move to line + clamp col
    const moveToLine = (newLine: number, col: number) => {
      const clamped = clampCol(newLine, col);
      moveCursor(newLine, clamped);
    };

    // =================== VISUAL MODE TOGGLE ===================
    if (e.key === 'v' && !e.shiftKey && !e.ctrlKey && !searchActive) {
      e.preventDefault();
      e.stopPropagation();
      if (visualMode === 'char') {
        // Toggle off
        setVisualMode('none');
        setSelection(null);
      } else {
        setVisualMode('char');
        setSelection({ anchorLine: cursorLine, anchorCol: cursorCol, headLine: cursorLine, headCol: cursorCol });
      }
      handled = true;
    } else if (e.key === 'V' && e.shiftKey && !e.ctrlKey && !searchActive) {
      e.preventDefault();
      e.stopPropagation();
      if (visualMode === 'line') {
        setVisualMode('none');
        setSelection(null);
      } else {
        setVisualMode('line');
        setSelection({ anchorLine: cursorLine, anchorCol: 0, headLine: cursorLine, headCol: 0 });
      }
      handled = true;
    }
    // =================== YANK ===================
    else if (e.key === 'y' && !e.ctrlKey && visualMode !== 'none') {
      e.preventDefault();
      e.stopPropagation();
      yankSelection();
      handled = true;
    }
    // =================== VERTICAL NAVIGATION ===================
    else if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      const next = Math.min(cursorLine + 1, totalLines);
      moveToLine(next, cursorCol);
      handled = true;
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const next = Math.max(cursorLine - 1, 1);
      moveToLine(next, cursorCol);
      handled = true;
    } else if ((e.key === 'd' && e.ctrlKey) || (e.key === 'd' && visualMode === 'none' && !searchActive)) {
      e.preventDefault();
      e.stopPropagation();
      const next = Math.min(cursorLine + linesPerHalfPage, totalLines);
      moveToLine(next, cursorCol);
      handled = true;
    } else if ((e.key === 'u' && e.ctrlKey) || (e.key === 'u' && visualMode === 'none' && !searchActive)) {
      e.preventDefault();
      e.stopPropagation();
      const next = Math.max(cursorLine - linesPerHalfPage, 1);
      moveToLine(next, cursorCol);
      handled = true;
    } else if (e.key === 'f' && visualMode === 'none' && !searchActive) {
      e.preventDefault();
      e.stopPropagation();
      const next = Math.min(cursorLine + linesPerPage, totalLines);
      moveToLine(next, cursorCol);
      handled = true;
    } else if (e.key === ' ' || e.key === 'PageDown') {
      e.preventDefault();
      e.stopPropagation();
      const next = Math.min(cursorLine + linesPerPage, totalLines);
      moveToLine(next, cursorCol);
      handled = true;
    } else if ((e.key === 'b' && !cursorModeActive && visualMode === 'none' && !searchActive) || e.key === 'PageUp') {
      // b = page up only when NOT in cursor mode (legacy less behavior); PageUp always works
      e.preventDefault();
      e.stopPropagation();
      const next = Math.max(cursorLine - linesPerPage, 1);
      moveToLine(next, cursorCol);
      handled = true;
    } else if (e.key === 'g' && !e.shiftKey && visualMode === 'none' && !searchActive) {
      e.preventDefault();
      e.stopPropagation();
      moveCursor(1, 0);
      jumpToEnd(container, false);
      handled = true;
    } else if (e.key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      moveCursor(1, 0);
      jumpToEnd(container, false);
      handled = true;
    } else if ((e.key === 'G' && e.shiftKey) || e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      moveCursor(totalLines, 0);
      jumpToEnd(container, true);
      handled = true;
    }
    // =================== HORIZONTAL NAVIGATION ===================
    else if (e.key === 'h' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      moveCursor(cursorLine, Math.max(0, cursorCol - 1));
      handled = true;
    } else if (e.key === 'l' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      const lineLen = (lines[cursorLine - 1] || '').length;
      moveCursor(cursorLine, Math.min(cursorCol + 1, Math.max(0, lineLen - 1)));
      handled = true;
    }
    // =================== WORD MOTIONS ===================
    else if (e.key === 'w' && !e.ctrlKey && !searchActive) {
      e.preventDefault();
      e.stopPropagation();
      const pos = nextWordStart(lines, cursorLine, cursorCol);
      moveCursor(pos.line, pos.col);
      handled = true;
    } else if (e.key === 'e' && !e.ctrlKey && !searchActive) {
      e.preventDefault();
      e.stopPropagation();
      const pos = nextWordEnd(lines, cursorLine, cursorCol);
      moveCursor(pos.line, pos.col);
      handled = true;
    } else if (e.key === 'b' && !searchActive) {
      // b = word back (in cursor mode or visual mode; page-up case handled above)
      e.preventDefault();
      e.stopPropagation();
      const pos = prevWordStart(lines, cursorLine, cursorCol);
      moveCursor(pos.line, pos.col);
      handled = true;
    }
    // =================== LINE POSITION ===================
    else if (e.key === '0') {
      e.preventDefault();
      e.stopPropagation();
      moveCursor(cursorLine, 0);
      handled = true;
    } else if (e.key === '$') {
      e.preventDefault();
      e.stopPropagation();
      moveCursor(cursorLine, Math.max(0, (lines[cursorLine - 1] || '').length - 1));
      handled = true;
    } else if (e.key === '^') {
      e.preventDefault();
      e.stopPropagation();
      const line = lines[cursorLine - 1] || '';
      const firstNonWs = line.search(/\S/);
      moveCursor(cursorLine, firstNonWs >= 0 ? firstNonWs : 0);
      handled = true;
    }
    // =================== SEARCH ===================
    else if (e.key === '/') {
      e.preventDefault();
      e.stopPropagation();
      startSearch();
      handled = true;
    } else if (e.key === 'n' && !searchActive) {
      e.preventDefault();
      e.stopPropagation();
      nextMatch();
      handled = true;
    } else if (e.key === 'N' && e.shiftKey && !searchActive) {
      e.preventDefault();
      e.stopPropagation();
      prevMatch();
      handled = true;
    }
    // =================== HELP ===================
    else if (e.key === '?' && visualMode === 'none') {
      e.preventDefault();
      e.stopPropagation();
      toggleHelp();
      handled = true;
    }
    // =================== CLOSE / ESCAPE ===================
    else if (e.key === 'q' && visualMode === 'none') {
      e.preventDefault();
      e.stopPropagation();
      onClose?.();
      handled = true;
    } else if (e.key === 'Escape') {
      if (visualMode !== 'none') {
        e.preventDefault();
        e.stopPropagation();
        setVisualMode('none');
        setSelection(null);
        handled = true;
      } else if (searchActive) {
        e.preventDefault();
        e.stopPropagation();
        clearSearch();
        handled = true;
      } else if (cursorModeActive) {
        e.preventDefault();
        e.stopPropagation();
        // Exit cursor mode entirely
        setCursorModeActive(false);
        handled = true;
      }
      // If nothing to close, let Escape propagate to parent (closes panel)
    }

    if (handled) {
      // Activate cursor mode on any vim key (except Escape which deactivates it)
      if (e.key !== 'Escape' && !cursorModeActive) {
        setCursorModeActive(true);
      }
      requestAnimationFrame(updateScrollPosition);
    }
  }, [onClose, updateScrollPosition, totalLines, lines, cursorLine, cursorCol, ensureCursorVisible, searchActive, clearSearch, visualMode, cursorModeActive, moveCursor, yankSelection, startSearch, nextMatch, prevMatch, toggleHelp]);

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
    currentColumn: scrollRef.current.column,
    totalLines,
    cursorLine,
    cursorCol,
    cursorModeActive,
    visualMode,
    selection,
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
