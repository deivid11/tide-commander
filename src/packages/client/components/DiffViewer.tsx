import React, { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-docker';

interface DiffViewerProps {
  originalContent: string;
  modifiedContent: string;
  filename: string;
  language: string;
}

interface DiffLine {
  num: number;
  text: string;
  highlighted: string;
  type: 'unchanged' | 'added' | 'removed';
}

// Alignment point for scroll synchronization
interface AlignmentPoint {
  leftLine: number;  // Line index in left panel (0-based)
  rightLine: number; // Line index in right panel (0-based)
}

// A connected change block linking removed lines on the left to added lines on the right
interface ChangeBlock {
  leftStart: number;   // Start line index in left panel (0-based)
  leftCount: number;   // Number of lines in left panel
  rightStart: number;  // Start line index in right panel (0-based)
  rightCount: number;  // Number of lines in right panel
  type: 'modified' | 'added' | 'removed'; // Whether it has both sides, or only one
}

// Highlight a single line using Prism
function highlightLine(line: string, language: string): string {
  if (!line) return '';
  const grammar = Prism.languages[language];
  if (!grammar) return escapeHtml(line);
  return Prism.highlight(line, grammar, language);
}

// Escape HTML for safe rendering
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Compute diff lines and alignment points for intelligent scroll sync
function computeDiff(original: string, modified: string, language: string): {
  leftLines: DiffLine[];
  rightLines: DiffLine[];
  alignments: AlignmentPoint[];
  changeBlocks: ChangeBlock[];
} {
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');

  const prismLang = language === 'tsx' ? 'tsx' :
                    language === 'typescript' ? 'typescript' :
                    language === 'javascript' ? 'javascript' :
                    language === 'jsx' ? 'jsx' :
                    language || 'plaintext';

  // Build LCS table
  const m = originalLines.length;
  const n = modifiedLines.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (originalLines[i - 1] === modifiedLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find operations
  type Op = { type: 'equal' | 'delete' | 'insert'; origIdx?: number; modIdx?: number };
  const ops: Op[] = [];
  let i = m, j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && originalLines[i - 1] === modifiedLines[j - 1]) {
      ops.push({ type: 'equal', origIdx: i - 1, modIdx: j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'insert', modIdx: j - 1 });
      j--;
    } else if (i > 0) {
      ops.push({ type: 'delete', origIdx: i - 1 });
      i--;
    }
  }

  ops.reverse();

  // Build lines for each side and track alignment points + change blocks
  const leftLines: DiffLine[] = [];
  const rightLines: DiffLine[] = [];
  const alignments: AlignmentPoint[] = [];
  const changeBlocks: ChangeBlock[] = [];

  // Start alignment
  alignments.push({ leftLine: 0, rightLine: 0 });

  // Track current change block being built
  let pendingDeleteStart = -1;
  let pendingDeleteCount = 0;
  let pendingInsertStart = -1;
  let pendingInsertCount = 0;

  const flushChangeBlock = () => {
    if (pendingDeleteCount > 0 || pendingInsertCount > 0) {
      changeBlocks.push({
        leftStart: pendingDeleteStart >= 0 ? pendingDeleteStart : leftLines.length,
        leftCount: pendingDeleteCount,
        rightStart: pendingInsertStart >= 0 ? pendingInsertStart : rightLines.length,
        rightCount: pendingInsertCount,
        type: pendingDeleteCount > 0 && pendingInsertCount > 0
          ? 'modified'
          : pendingDeleteCount > 0 ? 'removed' : 'added',
      });
    }
    pendingDeleteStart = -1;
    pendingDeleteCount = 0;
    pendingInsertStart = -1;
    pendingInsertCount = 0;
  };

  for (const op of ops) {
    if (op.type === 'equal') {
      // Flush any pending change block before processing equal line
      flushChangeBlock();

      // Add alignment point at each matching line
      const text = originalLines[op.origIdx!];
      const highlighted = highlightLine(text, prismLang);

      leftLines.push({
        num: op.origIdx! + 1,
        text,
        highlighted,
        type: 'unchanged'
      });

      rightLines.push({
        num: op.modIdx! + 1,
        text,
        highlighted,
        type: 'unchanged'
      });

      // Track alignment for matching lines
      alignments.push({
        leftLine: leftLines.length,
        rightLine: rightLines.length
      });
    } else if (op.type === 'delete') {
      if (pendingDeleteStart < 0) {
        pendingDeleteStart = leftLines.length;
      }
      pendingDeleteCount++;

      const text = originalLines[op.origIdx!];
      const highlighted = highlightLine(text, prismLang);
      leftLines.push({
        num: op.origIdx! + 1,
        text,
        highlighted,
        type: 'removed'
      });
    } else {
      if (pendingInsertStart < 0) {
        pendingInsertStart = rightLines.length;
      }
      pendingInsertCount++;

      const text = modifiedLines[op.modIdx!];
      const highlighted = highlightLine(text, prismLang);
      rightLines.push({
        num: op.modIdx! + 1,
        text,
        highlighted,
        type: 'added'
      });
    }
  }

  // Flush any remaining change block
  flushChangeBlock();

  // End alignment
  alignments.push({
    leftLine: leftLines.length,
    rightLine: rightLines.length
  });

  return { leftLines, rightLines, alignments, changeBlocks };
}

// Calculate target scroll position using alignment points
function calculateTargetScroll(
  sourceScroll: number,
  sourceHeight: number,
  targetHeight: number,
  alignments: AlignmentPoint[],
  lineHeight: number,
  isLeftToRight: boolean
): number {
  if (sourceHeight <= 0 || targetHeight <= 0) return 0;

  // Find which alignment segment we're in based on source scroll position
  const sourceLine = sourceScroll / lineHeight;

  let prevAlign: AlignmentPoint | null = null;
  let nextAlign: AlignmentPoint | null = null;

  for (let i = 0; i < alignments.length - 1; i++) {
    const current = alignments[i];
    const next = alignments[i + 1];
    const currentSourceLine = isLeftToRight ? current.leftLine : current.rightLine;
    const nextSourceLine = isLeftToRight ? next.leftLine : next.rightLine;

    if (sourceLine >= currentSourceLine && sourceLine < nextSourceLine) {
      prevAlign = current;
      nextAlign = next;
      break;
    }
  }

  if (!prevAlign || !nextAlign) {
    // Fallback: proportional scroll
    const ratio = sourceScroll / Math.max(1, sourceHeight - 1);
    return ratio * targetHeight;
  }

  // Interpolate within the segment
  const prevSourceLine = isLeftToRight ? prevAlign.leftLine : prevAlign.rightLine;
  const nextSourceLine = isLeftToRight ? nextAlign.leftLine : nextAlign.rightLine;
  const prevTargetLine = isLeftToRight ? prevAlign.rightLine : prevAlign.leftLine;
  const nextTargetLine = isLeftToRight ? nextAlign.rightLine : nextAlign.leftLine;

  const segmentSourceLines = nextSourceLine - prevSourceLine;
  const segmentTargetLines = nextTargetLine - prevTargetLine;

  if (segmentSourceLines === 0) {
    return prevTargetLine * lineHeight;
  }

  const positionInSegment = (sourceLine - prevSourceLine) / segmentSourceLines;
  const targetLine = prevTargetLine + positionInSegment * segmentTargetLines;

  return targetLine * lineHeight;
}

const MARKDOWN_EXTENSIONS = ['.md', '.mdx', '.markdown'];

export function DiffViewer({ originalContent, modifiedContent, filename, language }: DiffViewerProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const markdownContentRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const connectorRafRef = useRef<number | null>(null);
  const isScrollingRef = useRef<'left' | 'right' | null>(null);
  const scrollTimeoutRef = useRef<number | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [copyHtmlStatus, setCopyHtmlStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [viewOnlyModified, setViewOnlyModified] = useState(false);

  // Check if file is markdown
  const isMarkdown = useMemo(() => {
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    return MARKDOWN_EXTENSIONS.includes(ext);
  }, [filename]);

  const handleCopyModified = useCallback(async () => {
    try {
      // For markdown in rendered view, copy as rich text
      if (isMarkdown && viewOnlyModified && markdownContentRef.current) {
        const html = markdownContentRef.current.innerHTML;
        const plainText = markdownContentRef.current.innerText;
        const htmlBlob = new Blob([html], { type: 'text/html' });
        const textBlob = new Blob([plainText], { type: 'text/plain' });
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': htmlBlob,
            'text/plain': textBlob,
          }),
        ]);
      } else {
        // For code or diff view, copy as plain text
        await navigator.clipboard.writeText(modifiedContent);
      }
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch {
      setCopyStatus('error');
      setTimeout(() => setCopyStatus('idle'), 2000);
    }
  }, [modifiedContent, isMarkdown, viewOnlyModified]);

  // Copy HTML tags as plain text (for pasting into Google Docs source, HTML editors, etc.)
  const handleCopyAsHtml = useCallback(async () => {
    if (!markdownContentRef.current) {
      setCopyHtmlStatus('error');
      setTimeout(() => setCopyHtmlStatus('idle'), 2000);
      return;
    }
    try {
      const html = markdownContentRef.current.innerHTML;
      await navigator.clipboard.writeText(html);
      setCopyHtmlStatus('copied');
      setTimeout(() => setCopyHtmlStatus('idle'), 2000);
    } catch {
      setCopyHtmlStatus('error');
      setTimeout(() => setCopyHtmlStatus('idle'), 2000);
    }
  }, []);

  const { leftLines, rightLines, alignments, changeBlocks } = useMemo(
    () => computeDiff(originalContent, modifiedContent, language),
    [originalContent, modifiedContent, language]
  );

  // Paint connector gutter canvas - called outside React render cycle for performance
  const paintConnector = useCallback(() => {
    const canvas = canvasRef.current;
    const left = leftRef.current;
    const right = rightRef.current;
    if (!canvas || !left || !right) return;

    const dpr = window.devicePixelRatio || 1;
    const gutterEl = canvas.parentElement;
    if (!gutterEl) return;
    const w = gutterEl.clientWidth;
    const h = gutterEl.clientHeight;
    if (w === 0 || h === 0) return;

    // Resize canvas backing store if needed
    const canvasW = Math.round(w * dpr);
    const canvasH = Math.round(h * dpr);
    if (canvas.width !== canvasW || canvas.height !== canvasH) {
      canvas.width = canvasW;
      canvas.height = canvasH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Calculate offset: how far the panel content top is from the gutter top
    // This accounts for the panel header height precisely
    const gutterRect = gutterEl.getBoundingClientRect();
    const leftRect = left.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();
    const leftOffsetY = leftRect.top - gutterRect.top;
    const rightOffsetY = rightRect.top - gutterRect.top;

    const leftScroll = left.scrollTop;
    const rightScroll = right.scrollTop;
    const leftViewH = left.clientHeight;
    const rightViewH = right.clientHeight;

    for (const block of changeBlocks) {
      // Y positions in canvas coordinates
      const leftTopY = leftOffsetY + block.leftStart * LINE_HEIGHT - leftScroll;
      const leftBottomY = leftOffsetY + (block.leftStart + Math.max(block.leftCount, 0.5)) * LINE_HEIGHT - leftScroll;
      const rightTopY = rightOffsetY + block.rightStart * LINE_HEIGHT - rightScroll;
      const rightBottomY = rightOffsetY + (block.rightStart + Math.max(block.rightCount, 0.5)) * LINE_HEIGHT - rightScroll;

      // Skip if completely out of view
      if (leftBottomY < leftOffsetY && rightBottomY < rightOffsetY) continue;
      if (leftTopY > leftOffsetY + leftViewH + 20 && rightTopY > rightOffsetY + rightViewH + 20) continue;

      // Colors based on type
      if (block.type === 'modified') {
        ctx.fillStyle = 'rgba(90, 130, 180, 0.2)';
        ctx.strokeStyle = 'rgba(90, 130, 180, 0.45)';
      } else if (block.type === 'removed') {
        ctx.fillStyle = 'rgba(200, 90, 90, 0.2)';
        ctx.strokeStyle = 'rgba(200, 90, 90, 0.45)';
      } else {
        ctx.fillStyle = 'rgba(92, 184, 138, 0.2)';
        ctx.strokeStyle = 'rgba(92, 184, 138, 0.45)';
      }

      const cx = w * 0.5;
      ctx.lineWidth = 1;

      // Clip connector shapes to the content area (below the header)
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, leftOffsetY, w, h - leftOffsetY);
      ctx.clip();

      // Draw bezier-connected shape
      ctx.beginPath();
      ctx.moveTo(0, leftTopY);
      ctx.bezierCurveTo(cx, leftTopY, cx, rightTopY, w, rightTopY);
      ctx.lineTo(w, rightBottomY);
      ctx.bezierCurveTo(cx, rightBottomY, cx, leftBottomY, 0, leftBottomY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }, [changeBlocks]);

  // Wire up canvas painting on scroll and resize
  useEffect(() => {
    if (viewOnlyModified) return;

    const canvas = canvasRef.current;
    const left = leftRef.current;
    const right = rightRef.current;
    if (!canvas || !left || !right) return;

    const gutterEl = canvas.parentElement;
    if (!gutterEl) return;

    const resizeObserver = new ResizeObserver(() => {
      paintConnector();
    });
    resizeObserver.observe(gutterEl);

    // Initial paint after a frame to ensure layout is settled
    requestAnimationFrame(() => paintConnector());

    return () => {
      resizeObserver.disconnect();
      if (connectorRafRef.current) {
        cancelAnimationFrame(connectorRafRef.current);
      }
    };
  }, [viewOnlyModified, paintConnector]);

  // Compute boundary line indices for horizontal hunk markers
  const { leftBoundaries, rightBoundaries } = useMemo(() => {
    const lb = new Map<number, 'top' | 'bottom' | 'both'>();
    const rb = new Map<number, 'top' | 'bottom' | 'both'>();

    for (const block of changeBlocks) {
      // Left panel boundaries (removed lines)
      if (block.leftCount > 0) {
        const topIdx = block.leftStart;
        const bottomIdx = block.leftStart + block.leftCount - 1;
        lb.set(topIdx, lb.has(topIdx) ? 'both' : 'top');
        if (topIdx === bottomIdx) {
          lb.set(topIdx, 'both');
        } else {
          lb.set(bottomIdx, lb.has(bottomIdx) ? 'both' : 'bottom');
        }
      }
      // Right panel boundaries (added lines)
      if (block.rightCount > 0) {
        const topIdx = block.rightStart;
        const bottomIdx = block.rightStart + block.rightCount - 1;
        rb.set(topIdx, rb.has(topIdx) ? 'both' : 'top');
        if (topIdx === bottomIdx) {
          rb.set(topIdx, 'both');
        } else {
          rb.set(bottomIdx, rb.has(bottomIdx) ? 'both' : 'bottom');
        }
      }
    }

    return { leftBoundaries: lb, rightBoundaries: rb };
  }, [changeBlocks]);

  // Stats
  const stats = useMemo(() => {
    const added = rightLines.filter(l => l.type === 'added').length;
    const removed = leftLines.filter(l => l.type === 'removed').length;
    return { added, removed };
  }, [leftLines, rightLines]);

  // Find diff hunk positions (line indices where changes start)
  const diffHunks = useMemo(() => {
    const hunks: number[] = [];
    let inHunk = false;

    // Use the right panel (modified) to find hunks
    rightLines.forEach((line, idx) => {
      if (line.type === 'added') {
        if (!inHunk) {
          hunks.push(idx);
          inHunk = true;
        }
      } else {
        inHunk = false;
      }
    });

    // Also check left panel for removed-only hunks
    let leftInHunk = false;
    leftLines.forEach((line, idx) => {
      if (line.type === 'removed') {
        if (!leftInHunk) {
          // Find corresponding position in right panel
          // Use alignments to map left position to right
          const rightIdx = Math.min(idx, rightLines.length - 1);
          if (!hunks.includes(rightIdx)) {
            hunks.push(rightIdx);
          }
          leftInHunk = true;
        }
      } else {
        leftInHunk = false;
      }
    });

    return hunks.sort((a, b) => a - b);
  }, [leftLines, rightLines]);

  // Current hunk index for navigation
  const [currentHunkIndex, setCurrentHunkIndex] = useState(0);

  const LINE_HEIGHT = 20; // Must match CSS

  // Intelligent scroll synchronization
  const handleScroll = useCallback((source: 'left' | 'right') => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;

    // Prevent feedback loops
    if (isScrollingRef.current && isScrollingRef.current !== source) return;
    isScrollingRef.current = source;

    // Clear any pending timeout
    if (scrollTimeoutRef.current) {
      cancelAnimationFrame(scrollTimeoutRef.current);
    }

    const sourceEl = source === 'left' ? left : right;
    const targetEl = source === 'left' ? right : left;

    // Sync horizontal scroll directly
    targetEl.scrollLeft = sourceEl.scrollLeft;

    // Calculate intelligent vertical scroll position
    const targetScroll = calculateTargetScroll(
      sourceEl.scrollTop,
      sourceEl.scrollHeight - sourceEl.clientHeight,
      targetEl.scrollHeight - targetEl.clientHeight,
      alignments,
      LINE_HEIGHT,
      source === 'left'
    );

    targetEl.scrollTop = targetScroll;

    // Repaint connector gutter via canvas (no React re-render)
    if (connectorRafRef.current) {
      cancelAnimationFrame(connectorRafRef.current);
    }
    connectorRafRef.current = requestAnimationFrame(() => {
      paintConnector();
      connectorRafRef.current = null;
    });

    // Reset scroll lock after animation frame
    scrollTimeoutRef.current = requestAnimationFrame(() => {
      isScrollingRef.current = null;
    });
  }, [alignments, paintConnector]);

  useEffect(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;

    const leftHandler = () => handleScroll('left');
    const rightHandler = () => handleScroll('right');

    left.addEventListener('scroll', leftHandler);
    right.addEventListener('scroll', rightHandler);

    return () => {
      left.removeEventListener('scroll', leftHandler);
      right.removeEventListener('scroll', rightHandler);
      if (scrollTimeoutRef.current) {
        cancelAnimationFrame(scrollTimeoutRef.current);
      }
    };
  }, [handleScroll]);

  // Navigate to a specific hunk
  const goToHunk = useCallback((hunkIndex: number) => {
    if (hunkIndex < 0 || hunkIndex >= diffHunks.length) return;

    const lineIndex = diffHunks[hunkIndex];
    const scrollTop = lineIndex * LINE_HEIGHT;

    // Scroll the right panel (modified), which will sync the left
    if (rightRef.current) {
      rightRef.current.scrollTop = scrollTop;
    }

    setCurrentHunkIndex(hunkIndex);
  }, [diffHunks]);

  const goToNextHunk = useCallback(() => {
    const nextIndex = Math.min(currentHunkIndex + 1, diffHunks.length - 1);
    goToHunk(nextIndex);
  }, [currentHunkIndex, diffHunks.length, goToHunk]);

  const goToPrevHunk = useCallback(() => {
    const prevIndex = Math.max(currentHunkIndex - 1, 0);
    goToHunk(prevIndex);
  }, [currentHunkIndex, goToHunk]);

  // Jump to first diff on mount and repaint connector
  useEffect(() => {
    if (diffHunks.length > 0) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        goToHunk(0);
        requestAnimationFrame(() => paintConnector());
      }, 100);
    }
  }, [diffHunks, goToHunk, paintConnector]);

  return (
    <div className="diff-viewer">
      <div className="diff-viewer-header">
        <div className="diff-viewer-filename">{filename}</div>
        <div className="diff-viewer-nav">
          {diffHunks.length > 0 && (
            <>
              <button
                className="diff-nav-btn"
                onClick={goToPrevHunk}
                disabled={currentHunkIndex === 0}
                title="Previous change (Up)"
              >
                ↑
              </button>
              <span className="diff-nav-counter">
                {currentHunkIndex + 1} / {diffHunks.length}
              </span>
              <button
                className="diff-nav-btn"
                onClick={goToNextHunk}
                disabled={currentHunkIndex === diffHunks.length - 1}
                title="Next change (Down)"
              >
                ↓
              </button>
            </>
          )}
        </div>
        <div className="diff-viewer-stats">
          {stats.added > 0 && <span className="diff-stat added">+{stats.added}</span>}
          {stats.removed > 0 && <span className="diff-stat removed">-{stats.removed}</span>}
        </div>
        <div className="diff-viewer-actions">
          <button
            className={`diff-toggle-btn ${viewOnlyModified ? 'active' : ''}`}
            onClick={() => setViewOnlyModified(!viewOnlyModified)}
            title={viewOnlyModified ? 'Show diff view' : 'View only modified'}
          >
            {viewOnlyModified ? t('terminal:diffViewer.showDiff') : t('terminal:diffViewer.modifiedOnly')}
          </button>
          <button
            className={`diff-copy-btn ${copyStatus}`}
            onClick={handleCopyModified}
            title={isMarkdown && viewOnlyModified ? 'Copy as rich text' : 'Copy modified content'}
          >
            {copyStatus === 'copied' ? `✓ ${t('terminal:diffViewer.copied')}` : copyStatus === 'error' ? `✗ ${t('terminal:diffViewer.errorCopy')}` : (isMarkdown && viewOnlyModified ? t('terminal:diffViewer.copyRichText') : t('common:buttons.copy'))}
          </button>
          {isMarkdown && viewOnlyModified && (
            <button
              className={`diff-copy-btn ${copyHtmlStatus}`}
              onClick={handleCopyAsHtml}
              title="Copy as HTML tags (for Google Docs, HTML editors)"
            >
              {copyHtmlStatus === 'copied' ? `✓ ${t('terminal:diffViewer.copied')}` : copyHtmlStatus === 'error' ? `✗ ${t('terminal:diffViewer.errorCopy')}` : t('terminal:diffViewer.copyHtml')}
            </button>
          )}
        </div>
      </div>

      <div className={`diff-viewer-panels ${viewOnlyModified ? 'modified-only' : ''}`}>
        {/* Original (Left) - hidden when viewOnlyModified */}
        {!viewOnlyModified && (
          <div className="diff-panel diff-panel-original">
            <div className="diff-panel-header">
              <span className="diff-panel-label">{t('terminal:diffViewer.originalHead')}</span>
            </div>
            <div className="diff-panel-content" ref={leftRef}>
              {leftLines.map((line, idx) => {
                const boundary = leftBoundaries.get(idx);
                const boundaryClass = boundary === 'both' ? 'diff-hunk-top diff-hunk-bottom'
                  : boundary === 'top' ? 'diff-hunk-top'
                  : boundary === 'bottom' ? 'diff-hunk-bottom' : '';
                return (
                  <div key={idx} className={`diff-line diff-line-${line.type} ${boundaryClass}`}>
                    <span className="diff-line-num">{line.num}</span>
                    <span
                      className="diff-line-content"
                      dangerouslySetInnerHTML={{ __html: line.highlighted || '&nbsp;' }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Connector gutter between panels (canvas for performance) */}
        {!viewOnlyModified && (
          <div className="diff-connector-gutter">
            <canvas ref={canvasRef} />
          </div>
        )}

        {/* Modified (Right) */}
        <div className="diff-panel diff-panel-modified">
          <div className="diff-panel-header">
            <span className="diff-panel-label">{viewOnlyModified ? t('terminal:diffViewer.modifiedContent') : t('terminal:diffViewer.modifiedWorking')}</span>
          </div>
          {viewOnlyModified && isMarkdown ? (
            // Render markdown when in modified-only view
            <div className="diff-panel-content diff-markdown-content" ref={markdownContentRef}>
              <div className="markdown-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{modifiedContent}</ReactMarkdown>
              </div>
            </div>
          ) : (
            <div className="diff-panel-content" ref={rightRef}>
              {rightLines.map((line, idx) => {
                const boundary = rightBoundaries.get(idx);
                const boundaryClass = boundary === 'both' ? 'diff-hunk-top diff-hunk-bottom'
                  : boundary === 'top' ? 'diff-hunk-top'
                  : boundary === 'bottom' ? 'diff-hunk-bottom' : '';
                return (
                  <div key={idx} className={`diff-line diff-line-${line.type} ${boundaryClass}`}>
                    <span className="diff-line-num">{line.num}</span>
                    <span
                      className="diff-line-content"
                      dangerouslySetInnerHTML={{ __html: line.highlighted || '&nbsp;' }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
