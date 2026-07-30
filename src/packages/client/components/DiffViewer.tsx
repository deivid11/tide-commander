import React, { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { highlightCode, ensureLanguageLoaded } from './FileExplorerPanel/syntaxHighlighting';
import { copyRichContentToClipboard, copyTextToClipboard, inlineStylesForRichCopy } from '../utils/clipboard';
import { revealInFileExplorer } from '../api/files';
import { apiUrl, getAuthToken } from '../utils/storage';
import { downloadServerFile } from '../utils/file-download';
import { PdfJsViewer } from './shared/PdfJsViewer';
import { Tooltip } from './shared/Tooltip';
import { Icon } from './Icon';
import { VirtualLineList } from './shared/VirtualLineList';
import { computeDiffOps } from './diffLineOps';

interface DiffViewerProps {
  originalContent: string;
  modifiedContent: string;
  filename: string;
  filePath?: string;
  language: string;
  /** Start in "Modified Only" view mode */
  initialModifiedOnly?: boolean;
}

interface DiffLine {
  num: number;
  text: string;
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
  return highlightCode(line, language || 'plaintext');
}

// Compute diff lines and alignment points for intelligent scroll sync
function computeDiff(original: string, modified: string): {
  leftLines: DiffLine[];
  rightLines: DiffLine[];
  alignments: AlignmentPoint[];
  changeBlocks: ChangeBlock[];
} {
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');

  const ops = computeDiffOps(originalLines, modifiedLines);

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

      leftLines.push({
        num: op.origIdx! + 1,
        text,
        type: 'unchanged'
      });

      rightLines.push({
        num: op.modIdx! + 1,
        text,
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

      leftLines.push({
        num: op.origIdx! + 1,
        text: originalLines[op.origIdx!],
        type: 'removed'
      });
    } else {
      if (pendingInsertStart < 0) {
        pendingInsertStart = rightLines.length;
      }
      pendingInsertCount++;

      rightLines.push({
        num: op.modIdx! + 1,
        text: modifiedLines[op.modIdx!],
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
// Binary image formats render as an <img> instead of a text diff (raw bytes are
// unreadable garbage). SVG is deliberately excluded: it's text, so its diff is
// meaningful.
const BINARY_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'];
// Other well-known binary formats: no text view makes sense, so the modal shows
// a "Binary file" placeholder with the download action instead of empty panels.
const KNOWN_BINARY_EXTENSIONS = [
  '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a', '.class', '.pyc',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.wav', '.ogg', '.flac', '.mp4', '.avi', '.mov', '.webm', '.mkv',
  '.apk', '.jar', '.db', '.sqlite', '.sqlite3', '.parquet',
];

export function DiffViewer({ originalContent, modifiedContent, filename, filePath, language, initialModifiedOnly = false }: DiffViewerProps) {
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
  const [copyMarkdownStatus, setCopyMarkdownStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [revealStatus, setRevealStatus] = useState<'idle' | 'opening' | 'error'>('idle');
  const [viewOnlyModified, setViewOnlyModified] = useState(initialModifiedOnly);
  const [langReady, setLangReady] = useState(0);

  // Ensure lazy-loaded languages (e.g. PHP) are available before highlighting
  useEffect(() => {
    if (language && language !== 'plaintext') {
      ensureLanguageLoaded(language).then(() => setLangReady(v => v + 1));
    }
  }, [language]);

  // Detect new (added) or deleted files
  const isNewFile = !originalContent;
  const isDeletedFile = !modifiedContent;

  // Check if file is markdown
  const isMarkdown = useMemo(() => {
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    return MARKDOWN_EXTENSIONS.includes(ext);
  }, [filename]);

  const { isBinaryImage, isSvg, isPdf, isKnownBinary } = useMemo(() => {
    const name = filePath || filename;
    const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
    return {
      isBinaryImage: BINARY_IMAGE_EXTENSIONS.includes(ext),
      isSvg: ext === '.svg',
      isPdf: ext === '.pdf',
      isKnownBinary: KNOWN_BINARY_EXTENSIONS.includes(ext),
    };
  }, [filename, filePath]);

  // SVG is both image and text: default to the rendered view, with a toggle to
  // the source/diff view (binary images have no source view).
  const [svgShowSource, setSvgShowSource] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'error'>('idle');
  // The image failed to load (file deleted from the working tree, or unreadable).
  const [imageError, setImageError] = useState(false);
  // False until the current image finishes loading — drives the modal spinner
  // so navigating files never flashes the PREVIOUS image while the next loads.
  const [imageLoaded, setImageLoaded] = useState(false);

  // Working-tree image URL; the version stamp keeps one URL per opened file but
  // still busts the browser cache across openings (in a changes viewer the
  // image on disk just changed by definition).
  const imageVersion = useMemo(() => Date.now(), [filePath]);
  const imageUrl = useMemo(() => {
    if (!(isBinaryImage || isSvg) || !filePath) return null;
    const token = getAuthToken();
    return apiUrl(`/api/files/binary?path=${encodeURIComponent(filePath)}&v=${imageVersion}${token ? `&token=${encodeURIComponent(token)}` : ''}`);
  }, [isBinaryImage, isSvg, filePath, imageVersion]);

  // Reset the per-image state whenever another file is shown (the modal
  // reuses one DiffViewer instance while navigating between files).
  useEffect(() => {
    setImageError(false);
    setImageLoaded(false);
  }, [imageUrl]);

  const handleDownloadFile = useCallback(async () => {
    if (!filePath || downloadStatus === 'downloading') return;
    try {
      setDownloadStatus('downloading');
      // downloadServerFile authenticates itself (header / native), so no token param
      await downloadServerFile(
        apiUrl(`/api/files/binary?path=${encodeURIComponent(filePath)}&download=true`),
        filename || filePath.split('/').pop() || 'download',
      );
      setDownloadStatus('idle');
    } catch (err) {
      console.error('Download file failed:', err);
      setDownloadStatus('error');
      setTimeout(() => setDownloadStatus('idle'), 2000);
    }
  }, [filePath, filename, downloadStatus]);

  const downloadButton = filePath ? (
    <Tooltip content={isBinaryImage ? t('terminal:fileExplorer.downloadImage') : t('terminal:fileExplorer.downloadFileTitle')} position="bottom">
      <button
        className={`diff-copy-btn ${downloadStatus === 'error' ? 'error' : ''}`}
        onClick={handleDownloadFile}
        disabled={downloadStatus === 'downloading'}
      >
        {downloadStatus === 'error'
          ? <><Icon name="cross" size={12} /> {t('terminal:diffViewer.errorCopy')}</>
          : <><Icon name="download" size={12} /> {t('common:buttons.download')}</>}
      </button>
    </Tooltip>
  ) : null;

  const handleCopyModified = useCallback(async () => {
    try {
      // For markdown in rendered view, copy as rich text
      if (isMarkdown && viewOnlyModified && markdownContentRef.current) {
        const rawHtml = markdownContentRef.current.innerHTML;
        const html = inlineStylesForRichCopy(rawHtml);
        const plainText = markdownContentRef.current.innerText;
        await copyRichContentToClipboard(html, plainText);
      } else {
        // For code or diff view, copy as plain text
        await copyTextToClipboard(modifiedContent);
      }
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch (err) {
      console.error('Copy modified content failed:', err);
      setCopyStatus('error');
      setTimeout(() => setCopyStatus('idle'), 2000);
    }
  }, [modifiedContent, isMarkdown, viewOnlyModified]);

  // Copy HTML tags as plain text (for pasting into Google Docs source, HTML editors, etc.)
  const handleCopyAsHtml = useCallback(async () => {
    if (!markdownContentRef.current) {
      console.error('Copy HTML: markdown content ref is not available');
      setCopyHtmlStatus('error');
      setTimeout(() => setCopyHtmlStatus('idle'), 2000);
      return;
    }
    try {
      const html = markdownContentRef.current.innerHTML;
      await copyTextToClipboard(html);
      setCopyHtmlStatus('copied');
      setTimeout(() => setCopyHtmlStatus('idle'), 2000);
    } catch (err) {
      console.error('Copy HTML failed:', err);
      setCopyHtmlStatus('error');
      setTimeout(() => setCopyHtmlStatus('idle'), 2000);
    }
  }, []);

  // Copy raw markdown source of the modified content
  const handleCopyMarkdown = useCallback(async () => {
    try {
      await copyTextToClipboard(modifiedContent);
      setCopyMarkdownStatus('copied');
      setTimeout(() => setCopyMarkdownStatus('idle'), 2000);
    } catch (err) {
      console.error('Copy Markdown failed:', err);
      setCopyMarkdownStatus('error');
      setTimeout(() => setCopyMarkdownStatus('idle'), 2000);
    }
  }, [modifiedContent]);

  const handleRevealInFileExplorer = useCallback(async () => {
    if (!filePath || revealStatus === 'opening') return;

    try {
      setRevealStatus('opening');
      await revealInFileExplorer(filePath);
      setRevealStatus('idle');
    } catch (err) {
      console.error('Open in file explorer failed:', err);
      setRevealStatus('error');
      setTimeout(() => setRevealStatus('idle'), 2000);
    }
  }, [filePath, revealStatus]);

  const { leftLines, rightLines, alignments, changeBlocks } = useMemo(
    () => computeDiff(originalContent, modifiedContent),
    [originalContent, modifiedContent]
  );

  /**
   * Highlight one line, memoized by its text. Only the ~100 rows the windowed
   * panes have mounted ever reach Prism, so even a 31,841-line file pays for a
   * screenful instead of two full passes over the file before first paint.
   *
   * The cache is built in a useMemo (not a ref cleared by an effect) so a
   * lazily-loaded grammar landing via `langReady` invalidates it during the
   * same render that repaints the rows — an effect would clear it one commit
   * too late and leave the visible lines unhighlighted.
   */
  const getHighlighted = useMemo(() => {
    const cache = new Map<string, string>();
    const prismLang = language || 'plaintext';
    return (text: string): string => {
      if (!text) return '';
      const cached = cache.get(text);
      if (cached !== undefined) return cached;
      const html = highlightLine(text, prismLang);
      cache.set(text, html);
      return html;
    };
  }, [language, langReady]);

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
    if (viewOnlyModified || isNewFile || isDeletedFile) return;

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
  }, [viewOnlyModified, isNewFile, isDeletedFile, paintConnector]);

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
  const openExplorerLabel = t('terminal:diffViewer.openInFileExplorer');

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

  // Images: render the working-tree image instead of raw-bytes-as-text. SVG
  // starts here too (rendered by default) but can toggle to the source view.
  // (Placed after every hook so the hook order never changes between modes.)
  if (imageUrl && !(isSvg && svgShowSource)) {
    return (
      <div className="diff-viewer">
        <div className="diff-viewer-header">
          <div className="diff-viewer-filename">{filename}</div>
          <div className="diff-viewer-actions">
            <Tooltip content={openExplorerLabel} position="bottom">
              <button
                className={`diff-copy-btn ${revealStatus === 'error' ? 'error' : ''}`}
                onClick={handleRevealInFileExplorer}
                disabled={!filePath || revealStatus === 'opening'}
                title={openExplorerLabel}
                aria-label={openExplorerLabel}
              >
                <Icon name="folder-open" size={12} />
              </button>
            </Tooltip>
            {isSvg && (
              <Tooltip content={t('terminal:fileExplorer.showSource')} position="bottom">
                <button className="diff-toggle-btn" onClick={() => setSvgShowSource(true)}>
                  {t('terminal:fileExplorer.showSource')}
                </button>
              </Tooltip>
            )}
            {!imageError && downloadButton}
          </div>
        </div>
        <div className="diff-image-view">
          {imageError ? (
            // The binary endpoint could not serve it (e.g. file deleted from
            // the working tree) — nothing to render or download.
            <span className="diff-image-deleted">{t('terminal:diffViewer.binaryFile')}</span>
          ) : (
            <>
              {!imageLoaded && <div className="diff-image-spinner" aria-label={t('terminal:diffViewer.loading')} />}
              {/* key remounts the <img> per URL so the browser never shows the
                  PREVIOUS file's pixels while the next one is still loading */}
              <img
                key={imageUrl}
                src={imageUrl}
                alt={filename}
                className={imageLoaded ? undefined : 'diff-image-pending'}
                onLoad={() => setImageLoaded(true)}
                onError={() => setImageError(true)}
              />
            </>
          )}
        </div>
      </div>
    );
  }

  // PDFs: inline preview via the shared pdf.js viewer (same one the file
  // viewer modal uses — works in the Android WebView, unlike an iframe).
  if (isPdf && filePath) {
    return (
      <div className="diff-viewer">
        <div className="diff-viewer-header">
          <div className="diff-viewer-filename">{filename}</div>
          <div className="diff-viewer-actions">
            <Tooltip content={openExplorerLabel} position="bottom">
              <button
                className={`diff-copy-btn ${revealStatus === 'error' ? 'error' : ''}`}
                onClick={handleRevealInFileExplorer}
                disabled={revealStatus === 'opening'}
                title={openExplorerLabel}
                aria-label={openExplorerLabel}
              >
                <Icon name="folder-open" size={12} />
              </button>
            </Tooltip>
            {downloadButton}
          </div>
        </div>
        <div className="diff-pdf-view">
          <PdfJsViewer
            url={apiUrl(`/api/files/binary?path=${encodeURIComponent(filePath)}&v=${imageVersion}`)}
            authToken={getAuthToken() || undefined}
          />
        </div>
      </div>
    );
  }

  // Known non-image binaries (zip, media, executables, …): no text view makes
  // sense, so show a placeholder with the download action instead of empty panels.
  if (isKnownBinary && filePath) {
    return (
      <div className="diff-viewer">
        <div className="diff-viewer-header">
          <div className="diff-viewer-filename">{filename}</div>
          <div className="diff-viewer-actions">
            <Tooltip content={openExplorerLabel} position="bottom">
              <button
                className={`diff-copy-btn ${revealStatus === 'error' ? 'error' : ''}`}
                onClick={handleRevealInFileExplorer}
                disabled={revealStatus === 'opening'}
                title={openExplorerLabel}
                aria-label={openExplorerLabel}
              >
                <Icon name="folder-open" size={12} />
              </button>
            </Tooltip>
            {downloadButton}
          </div>
        </div>
        <div className="diff-image-view">
          <span className="diff-image-deleted">{t('terminal:diffViewer.binaryFile')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="diff-viewer">
      <div className="diff-viewer-header">
        <div className="diff-viewer-filename">{filename}</div>
        <div className="diff-viewer-nav">
          {diffHunks.length > 0 && (
            <>
              <Tooltip content="Previous change (Up)" position="bottom">
                <button
                  className="diff-nav-btn"
                  onClick={goToPrevHunk}
                  disabled={currentHunkIndex === 0}
                >
                  <Icon name="caret-up" size={12} />
                </button>
              </Tooltip>
              <span className="diff-nav-counter">
                {currentHunkIndex + 1} / {diffHunks.length}
              </span>
              <Tooltip content="Next change (Down)" position="bottom">
                <button
                  className="diff-nav-btn"
                  onClick={goToNextHunk}
                  disabled={currentHunkIndex === diffHunks.length - 1}
                >
                  <Icon name="caret-down" size={12} />
                </button>
              </Tooltip>
            </>
          )}
        </div>
        <div className="diff-viewer-stats">
          {stats.added > 0 && <span className="diff-stat added">+{stats.added}</span>}
          {stats.removed > 0 && <span className="diff-stat removed">-{stats.removed}</span>}
        </div>
        <div className="diff-viewer-actions">
          <Tooltip content={openExplorerLabel} position="bottom">
            <button
              className={`diff-copy-btn ${revealStatus === 'error' ? 'error' : ''}`}
              onClick={handleRevealInFileExplorer}
              disabled={!filePath || revealStatus === 'opening'}
              title={openExplorerLabel}
              aria-label={openExplorerLabel}
            >
              <Icon name="folder-open" size={12} />
            </button>
          </Tooltip>
          {isSvg && svgShowSource && (
            <Tooltip content={t('terminal:diffViewer.showRendered')} position="bottom">
              <button className="diff-toggle-btn" onClick={() => setSvgShowSource(false)}>
                {t('terminal:diffViewer.showRendered')}
              </button>
            </Tooltip>
          )}
          {downloadButton}
          {!isNewFile && !isDeletedFile && (
            <Tooltip content={viewOnlyModified ? 'Show diff view' : 'View only modified'} position="bottom">
              <button
                className={`diff-toggle-btn ${viewOnlyModified ? 'active' : ''}`}
                onClick={() => setViewOnlyModified(!viewOnlyModified)}
              >
                {viewOnlyModified ? t('terminal:diffViewer.showDiff') : t('terminal:diffViewer.modifiedOnly')}
              </button>
            </Tooltip>
          )}
          <Tooltip content={isMarkdown && viewOnlyModified ? 'Copy as rich text' : 'Copy modified content'} position="bottom">
            <button
              className={`diff-copy-btn ${copyStatus}`}
              onClick={handleCopyModified}
            >
              {copyStatus === 'copied' ? <><Icon name="check" size={12} /> {t('terminal:diffViewer.copied')}</> : copyStatus === 'error' ? <><Icon name="cross" size={12} /> {t('terminal:diffViewer.errorCopy')}</> : (isMarkdown && viewOnlyModified ? t('terminal:diffViewer.copyRichText') : t('common:buttons.copy'))}
            </button>
          </Tooltip>
          {isMarkdown && viewOnlyModified && (
            <Tooltip content="Copy as HTML tags (for Google Docs, HTML editors)" position="bottom">
              <button
                className={`diff-copy-btn ${copyHtmlStatus}`}
                onClick={handleCopyAsHtml}
              >
                {copyHtmlStatus === 'copied' ? <><Icon name="check" size={12} /> {t('terminal:diffViewer.copied')}</> : copyHtmlStatus === 'error' ? <><Icon name="cross" size={12} /> {t('terminal:diffViewer.errorCopy')}</> : t('terminal:diffViewer.copyHtml')}
              </button>
            </Tooltip>
          )}
          {isMarkdown && viewOnlyModified && (
            <Tooltip content="Copy as markdown source" position="bottom">
              <button
                className={`diff-copy-btn ${copyMarkdownStatus}`}
                onClick={handleCopyMarkdown}
              >
                {copyMarkdownStatus === 'copied' ? <><Icon name="check" size={12} /> {t('terminal:diffViewer.copied')}</> : copyMarkdownStatus === 'error' ? <><Icon name="cross" size={12} /> {t('terminal:diffViewer.errorCopy')}</> : t('terminal:diffViewer.copyMarkdown')}
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      <div className={`diff-viewer-panels ${(viewOnlyModified || isNewFile || isDeletedFile) ? 'modified-only' : ''}`}>
        {/* Original (Left) - hidden when viewOnlyModified or new file */}
        {!viewOnlyModified && !isNewFile && (
          <div className="diff-panel diff-panel-original">
            <div className="diff-panel-header">
              <span className="diff-panel-label">{t('terminal:diffViewer.originalHead')}</span>
            </div>
            <div className="diff-panel-content" ref={leftRef}>
              <VirtualLineList
                count={leftLines.length}
                lineHeight={LINE_HEIGHT}
                scrollRef={leftRef}
                renderLine={(idx) => {
                  const line = leftLines[idx];
                  const boundary = leftBoundaries.get(idx);
                  const boundaryClass = boundary === 'both' ? 'diff-hunk-top diff-hunk-bottom'
                    : boundary === 'top' ? 'diff-hunk-top'
                    : boundary === 'bottom' ? 'diff-hunk-bottom' : '';
                  return (
                    <div className={`diff-line diff-line-${line.type} ${boundaryClass}`}>
                      <span className="diff-line-num">{line.num}</span>
                      <span
                        className="diff-line-content"
                        dangerouslySetInnerHTML={{ __html: getHighlighted(line.text) || '&nbsp;' }}
                      />
                    </div>
                  );
                }}
              />
            </div>
          </div>
        )}

        {/* Connector gutter between panels (canvas for performance) */}
        {!viewOnlyModified && !isNewFile && !isDeletedFile && (
          <div className="diff-connector-gutter">
            <canvas ref={canvasRef} />
          </div>
        )}

        {/* Modified (Right) - hidden when deleted file */}
        {!isDeletedFile && (
          <div className="diff-panel diff-panel-modified">
            <div className="diff-panel-header">
              <span className="diff-panel-label">{(viewOnlyModified || isNewFile) ? t('terminal:diffViewer.modifiedContent') : t('terminal:diffViewer.modifiedWorking')}</span>
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
                <VirtualLineList
                  count={rightLines.length}
                  lineHeight={LINE_HEIGHT}
                  scrollRef={rightRef}
                  renderLine={(idx) => {
                    const line = rightLines[idx];
                    const boundary = rightBoundaries.get(idx);
                    const boundaryClass = boundary === 'both' ? 'diff-hunk-top diff-hunk-bottom'
                      : boundary === 'top' ? 'diff-hunk-top'
                      : boundary === 'bottom' ? 'diff-hunk-bottom' : '';
                    return (
                      <div className={`diff-line diff-line-${line.type} ${boundaryClass}`}>
                        <span className="diff-line-num">{line.num}</span>
                        <span
                          className="diff-line-content"
                          dangerouslySetInnerHTML={{ __html: getHighlighted(line.text) || '&nbsp;' }}
                        />
                      </div>
                    );
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
