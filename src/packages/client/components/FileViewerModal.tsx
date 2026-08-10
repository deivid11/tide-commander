import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PlantUmlDiagram } from './PlantUmlDiagram';
import { DiffViewer } from './DiffViewer';
import { PdfJsViewer } from './shared/PdfJsViewer';
import { apiUrl, authFetch, getAuthToken } from '../utils/storage';
import { copyRichContentToClipboard, copyTextToClipboard, inlineStylesForRichCopy } from '../utils/clipboard';
import { downloadServerFile } from '../utils/file-download';
import { revealInFileExplorer } from '../api/files';
import { store } from '../store';
import { useModalClose } from '../hooks';
import { parseFilePathReference, resolveAgentFilePath } from '../utils/filePaths';
import { ModalPortal } from './shared/ModalPortal';
import { getLanguageForExtension, ensureLanguageLoaded, Prism } from './FileExplorerPanel/syntaxHighlighting';
import { Icon } from './Icon';
import { ZoomableImage } from './shared/ZoomableImage';
import { VirtualLineList, scrollLineIntoView } from './shared/VirtualLineList';

const StlViewer = React.lazy(async () => {
  const module = await import('./shared/StlViewer');
  return { default: module.StlViewer };
});
const FcStdViewer = React.lazy(async () => {
  const module = await import('./shared/FcStdViewer');
  return { default: module.FcStdViewer };
});
const GcodeViewer = React.lazy(async () => {
  const module = await import('./shared/GcodeViewer');
  return { default: module.GcodeViewer };
});

// Row heights from _file-viewer.scss: 12px font at line-height 1.6 (normal
// view) and 1.5 (read-highlight view). Rows never wrap (`white-space: pre`),
// so these are exact and the windowed list keeps the real scroll height.
const CODE_LINE_HEIGHT = 19.2;
const HIGHLIGHT_LINE_HEIGHT = 18;

interface FileViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string;
  action: 'created' | 'modified' | 'deleted' | 'read';
  // Optional: edit data for showing diff view OR line highlight
  editData?: {
    oldString?: string;
    newString?: string;
    operation?: string;
    unifiedDiff?: string;
    // For Read tool - highlight these lines
    highlightRange?: { offset: number; limit: number };
    // For direct file references like path/to/file.ts:16
    targetLine?: number;
  };
  // Optional: project root for fallback file search when file not found
  searchRoot?: string;
}

interface ResolveResult {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  extension: string;
}

type ResolutionStrategy =
  | 'exact'
  | 'cached'
  | 'parent-walk'
  | 'git-root'
  | 'suffix-match'
  | 'node-modules-match'
  | 'area-root'
  | 'area-suffix-match';

interface FileData {
  path: string;
  filename: string;
  extension: string;
  content: string;
  size: number;
  modified: string;
  strategy?: ResolutionStrategy;
  areaId?: string;
  areaName?: string;
}

interface NotFoundDetail {
  message: string;
  triedRoots: string[];
  requested?: string;
}

/**
 * Reconstruct the original file content from the current (modified) content
 * and a unified diff. Reverses the diff: removes added lines, restores removed lines.
 */
function reconstructOriginalFromUnifiedDiff(currentContent: string, diffText: string): string | null {
  try {
    if (/^\*\*\* (?:Update|Add|Delete) File:/m.test(diffText)) {
      const header = diffText.match(/^\*\*\* (Update|Add|Delete) File:/m)?.[1];
      if (header === 'Add') return '';
      let reconstructed = currentContent;
      const body = diffText.replace(/^\*\*\* (?:Update|Add|Delete) File:.*$/m, '');
      const hunks = body.split(/^@@.*$/m).filter((part) => part.trim());
      for (const hunk of hunks) {
        const oldLines: string[] = [];
        const newLines: string[] = [];
        for (const line of hunk.replace(/^\n/, '').split('\n')) {
          if (line.startsWith('***')) continue;
          if (line.startsWith('-')) oldLines.push(line.slice(1));
          else if (line.startsWith('+')) newLines.push(line.slice(1));
          else {
            const context = line.startsWith(' ') ? line.slice(1) : line;
            oldLines.push(context);
            newLines.push(context);
          }
        }
        const oldBlock = oldLines.join('\n');
        const newBlock = newLines.join('\n');
        if (!newBlock) continue;
        const index = reconstructed.indexOf(newBlock);
        if (index < 0) return null;
        reconstructed = reconstructed.slice(0, index) + oldBlock + reconstructed.slice(index + newBlock.length);
      }
      return reconstructed;
    }
    const currentLines = currentContent.split('\n');
    const diffLines = diffText.split('\n');
    const result: string[] = [];
    let currentIdx = 0; // 0-based index into currentLines

    for (let d = 0; d < diffLines.length; d++) {
      const line = diffLines[d];
      // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (!hunkMatch) continue;

      const newStart = parseInt(hunkMatch[3], 10); // 1-based line in modified file
      const _newCount = parseInt(hunkMatch[4] ?? '1', 10);

      // Copy unchanged lines before this hunk
      const hunkStartIdx = newStart - 1; // 0-based
      while (currentIdx < hunkStartIdx && currentIdx < currentLines.length) {
        result.push(currentLines[currentIdx]);
        currentIdx++;
      }

      // Process hunk lines
      let _newLinesConsumed = 0;
      for (let h = d + 1; h < diffLines.length; h++) {
        const hLine = diffLines[h];
        if (hLine.startsWith('@@') || hLine.startsWith('diff ')) break;
        if (hLine.startsWith('---') || hLine.startsWith('+++') ||
            hLine.startsWith('index ') || hLine.startsWith('new file') ||
            hLine.startsWith('deleted file') || hLine.startsWith('\\')) continue;

        if (hLine.startsWith('-')) {
          // Removed line: add to original (restore it)
          result.push(hLine.slice(1));
        } else if (hLine.startsWith('+')) {
          // Added line: skip (don't include in original), consume from current
          _newLinesConsumed++;
          currentIdx++;
        } else {
          // Context line: include in original, consume from current
          result.push(hLine.startsWith(' ') ? hLine.slice(1) : hLine);
          _newLinesConsumed++;
          currentIdx++;
        }
      }
    }

    // Copy remaining unchanged lines after last hunk
    while (currentIdx < currentLines.length) {
      result.push(currentLines[currentIdx]);
      currentIdx++;
    }

    return result.join('\n');
  } catch {
    return null;
  }
}


const MARKDOWN_EXTENSIONS = ['.md', '.mdx', '.markdown'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg'];
const PDF_EXTENSIONS = ['.pdf'];
const STL_EXTENSIONS = ['.stl'];
const FCSTD_EXTENSIONS = ['.fcstd'];
const GCODE_EXTENSIONS = ['.gcode', '.gco'];

function hasFileExtension(extension: string | undefined, path: string, extensions: string[]): boolean {
  const normalizedExtension = extension?.toLowerCase();
  if (normalizedExtension && extensions.includes(normalizedExtension)) return true;
  const normalizedPath = path.toLowerCase().split(/[?#]/, 1)[0];
  return extensions.some((candidate) => normalizedPath.endsWith(candidate));
}

/** Flatten react-markdown code children into the raw fenced-block text. */
function extractCodeText(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(extractCodeText).join('');
  return children == null ? '' : String(children);
}

function getCodeLanguage(className: string | undefined): string | undefined {
  return /language-(\w+)/.exec(className || '')?.[1];
}

/**
 * Markdown renderer overrides for the file viewer:
 *  - fenced ```plantuml blocks render as actual diagrams (PlantUmlDiagram)
 *  - all other code blocks and inline code keep rendering normally
 */
const MARKDOWN_COMPONENTS: Components = {
  code({ node: _node, className, children, ...rest }) {
    if (getCodeLanguage(className) === 'plantuml') {
      return <PlantUmlDiagram source={extractCodeText(children).replace(/\n$/, '')} />;
    }
    return <code className={className} {...rest}>{children}</code>;
  },
  pre({ children }) {
    // PlantUmlDiagram renders its own block container, so unwrap the <pre> for
    // plantuml blocks to avoid invalid <pre><div> nesting. Other blocks keep <pre>.
    const child = Array.isArray(children) ? children[0] : children;
    const childClass =
      React.isValidElement<{ className?: string }>(child) ? child.props.className : undefined;
    if (getCodeLanguage(childClass) === 'plantuml') {
      return <>{children}</>;
    }
    return <pre>{children}</pre>;
  },
};

export function FileViewerModal({ isOpen, onClose, filePath, action, editData, searchRoot }: FileViewerModalProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<NotFoundDetail | null>(null);
  const [copyPathStatus, setCopyPathStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [resolvedCandidates, setResolvedCandidates] = useState<ResolveResult[]>([]);
  const [directoryEntries, setDirectoryEntries] = useState<ResolveResult[]>([]);
  // Absolute path of the folder currently being browsed inside the modal (null
  // when a file — not a directory — is being shown). Drives the in-modal
  // directory listing + up-navigation instead of opening the File Explorer.
  const [directoryPath, setDirectoryPath] = useState<string | null>(null);
  const [copyRichTextStatus, setCopyRichTextStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [copyHtmlStatus, setCopyHtmlStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [copyMarkdownStatus, setCopyMarkdownStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [copyOriginalStatus, setCopyOriginalStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [copyAllStatus, setCopyAllStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [revealStatus, setRevealStatus] = useState<'idle' | 'opening' | 'success' | 'error'>('idle');
  const [fetchedUnifiedDiff, setFetchedUnifiedDiff] = useState<string | null>(null);
  const [fetchedOriginalContent, setFetchedOriginalContent] = useState<string | null>(null);
  const [languageReady, setLanguageReady] = useState(false);
  const markdownContentRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const parsedReference = useMemo(() => parseFilePathReference(filePath), [filePath]);
  // Resolve relative paths against searchRoot (the agent's cwd) so the modal
  // displays a canonical absolute path before the server response comes back.
  // Absolute paths and missing searchRoot pass through unchanged.
  const effectivePath = useMemo(
    () => resolveAgentFilePath(parsedReference.path, searchRoot),
    [parsedReference.path, searchRoot],
  );
  const targetLine = editData?.targetLine ?? parsedReference.line;
  const effectiveHighlightRange = editData?.highlightRange
    || undefined;

  useEffect(() => {
    if (isOpen && effectivePath) {
      setResolvedCandidates([]);
      setDirectoryEntries([]);
      setDirectoryPath(null);
      setFetchedUnifiedDiff(null);
      setFetchedOriginalContent(null);
      loadFile();
    } else {
      setFileData(null);
      setError(null);
      setResolvedCandidates([]);
      setDirectoryEntries([]);
      setDirectoryPath(null);
      setFetchedUnifiedDiff(null);
      setFetchedOriginalContent(null);
    }
  }, [isOpen, effectivePath]);

  // Focus overlay when modal opens to capture keyboard events
  useEffect(() => {
    if (isOpen && overlayRef.current) {
      overlayRef.current.focus();
    }
  }, [isOpen]);

  // Global keyboard listener for j/k scrolling and Escape
  // Uses capture phase to intercept before other handlers (like message navigation)
  useEffect(() => {
    if (!isOpen) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      // Vim-style scrolling: j to scroll down, k to scroll up
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        e.stopPropagation();
        const scrollAmount = e.key === 'j' ? 100 : -100;

        // Find the scrollable element - could be contentRef or diff panels
        if (contentRef.current) {
          // Check if we're in diff view - scroll both diff panels
          const diffPanels = contentRef.current.querySelectorAll('.diff-panel-content');
          if (diffPanels.length > 0) {
            diffPanels.forEach(panel => {
              panel.scrollBy({ top: scrollAmount, behavior: 'smooth' });
            });
          } else {
            // Check for code-with-lines container (has its own scroll)
            const codeWithLines = contentRef.current.querySelector('.file-viewer-code-with-lines');
            if (codeWithLines) {
              codeWithLines.scrollBy({ top: scrollAmount, behavior: 'smooth' });
            } else {
              // Regular content view
              contentRef.current.scrollBy({ top: scrollAmount, behavior: 'smooth' });
            }
          }
        }
        return;
      }

      // Stop propagation for any other key to prevent focus-on-type behavior
      // from the message navigation hook
      e.stopPropagation();
    };

    // Use capture phase to intercept before other handlers
    window.addEventListener('keydown', handleGlobalKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, { capture: true });
  }, [isOpen, onClose]);

  // Compute original content by reversing the edit operation where possible.
  const originalContent = useMemo(() => {
    if (!fileData || !editData) return null;
    // Skip if this is a highlight range (not an edit)
    if (editData.highlightRange) return null;
    const { oldString = '', newString = '', operation } = editData;

    if (!oldString && !newString) return null;

    // Append operations are common in inferred Codex shell edits (e.g. printf >> file).
    if (operation === 'append' && newString) {
      if (fileData.content.endsWith(newString)) {
        return fileData.content.slice(0, fileData.content.length - newString.length);
      }
      const appendIndex = fileData.content.lastIndexOf(newString);
      if (appendIndex !== -1) {
        return fileData.content.slice(0, appendIndex) + fileData.content.slice(appendIndex + newString.length);
      }
      return null;
    }

    // Generic replacement/reconstruction fallback.
    if (newString) {
      const index = fileData.content.indexOf(newString);
      if (index !== -1) {
        return fileData.content.slice(0, index) + oldString + fileData.content.slice(index + newString.length);
      }
      return null;
    }

    // Deletions with only oldString cannot be reliably reconstructed without full pre-edit context.
    return null;
  }, [fileData, editData]);

  // Codex apply_patch cards may know the touched file but not carry Claude's
  // old_string/new_string pair. Treat that as edit intent so the modal fetches
  // the file's Git diff and original content just like a native Edit tool.
  const hasEditStrings = !!editData && (!editData.highlightRange) && (
    !!editData.oldString || !!editData.newString || editData.operation === 'codex-patch'
  );
  const resolvedUnifiedDiff = editData?.unifiedDiff || fetchedUnifiedDiff;
  const hasUnifiedDiff = !!resolvedUnifiedDiff;

  // When direct reconstruction fails but we have a unified diff,
  // reconstruct original from the diff to enable the side-by-side DiffViewer
  const originalFromDiff = useMemo(() => {
    if (originalContent !== null) return null; // Direct reconstruction succeeded
    if (!fileData || !resolvedUnifiedDiff) return null;
    return reconstructOriginalFromUnifiedDiff(fileData.content, resolvedUnifiedDiff);
  }, [originalContent, fileData, resolvedUnifiedDiff]);

  const effectiveOriginal = originalContent ?? originalFromDiff ?? fetchedOriginalContent;
  const showDiffView = effectiveOriginal !== null && (hasEditStrings || hasUnifiedDiff);
  // Fall back to raw unified diff only when DiffViewer cannot be used
  const showUnifiedDiffView = hasUnifiedDiff && !showDiffView;
  const showHighlightView = effectiveHighlightRange !== undefined;

  // Fetch git diff from server when reconstruction fails and no unified diff is available
  useEffect(() => {
    if (!fileData || !editData || editData.highlightRange) return;
    if (showDiffView) return; // Side-by-side works, no need
    if (editData.unifiedDiff) return; // Already have unified diff
    if (fetchedUnifiedDiff !== null) return; // Already fetched (or failed)

    const fetchDiff = async () => {
      try {
        const diffPath = fileData.path || effectivePath;
        const res = await authFetch(apiUrl(`/api/files/git-diff?path=${encodeURIComponent(diffPath)}${baseDirParam}`));
        if (res.ok) {
          const data = await res.json();
          if (data.diff && data.diff.trim()) {
            setFetchedUnifiedDiff(data.diff);
            return;
          }
        }
      } catch { /* ignore */ }
      setFetchedUnifiedDiff(''); // Mark as attempted (empty = no diff available)
    };
    fetchDiff();
  }, [fileData, editData, showDiffView, effectivePath, fetchedUnifiedDiff]);

  // Fetch original file content from git HEAD when reconstruction fails
  // This enables the proper DiffViewer side-by-side component
  useEffect(() => {
    if (!fileData || !editData || editData.highlightRange) return;
    // Skip if we already have original content from direct reconstruction or diff reconstruction
    if (originalContent !== null || originalFromDiff !== null) return;
    if (fetchedOriginalContent !== null) return; // Already fetched (or failed)
    // Only fetch if we have reason to show a diff (edit strings or unified diff)
    if (!hasEditStrings && !hasUnifiedDiff) return;

    const fetchOriginal = async () => {
      try {
        const filePath = fileData.path || effectivePath;
        const res = await authFetch(apiUrl(`/api/files/git-original?path=${encodeURIComponent(filePath)}${baseDirParam}`));
        if (res.ok) {
          const data = await res.json();
          if (data.content !== undefined && data.content !== fileData.content) {
            setFetchedOriginalContent(data.content);
            return;
          }
        }
      } catch { /* ignore */ }
      setFetchedOriginalContent(''); // Mark as attempted
    };
    fetchOriginal();
  }, [fileData, editData, originalContent, originalFromDiff, fetchedOriginalContent, hasEditStrings, hasUnifiedDiff, effectivePath]);

  // Ensure the Prism language for the current file is loaded (handles lazy languages like PHP)
  useEffect(() => {
    if (!fileData) return;
    const lang = getLanguageForExtension(fileData.extension);
    if (lang === 'plaintext' || lang in Prism.languages) {
      setLanguageReady(true);
      return;
    }
    setLanguageReady(false);
    ensureLanguageLoaded(lang).then(() => setLanguageReady(true));
  }, [fileData]);

  // Markdown is NOT excluded here: the read-highlight view (Read with
  // offset/limit) renders .md as plain lines too, and takes priority over the
  // rendered-markdown branch below.
  const codeLines = useMemo(() => {
    if (!fileData || showDiffView || showUnifiedDiffView) return [];
    return fileData.content.split('\n');
  }, [fileData, showDiffView, showUnifiedDiffView]);

  /**
   * Highlight a single line, memoized per line index — the windowed list only
   * ever asks for the ~50 rows on screen. Highlighting the whole file up front
   * cost 31,842 Prism passes on a 1 MB JSON before anything painted.
   *
   * The cache lives in the useMemo (not a ref cleared by an effect) so a
   * lazily-loaded grammar landing via `languageReady` invalidates it during the
   * same render that repaints the rows; an effect would clear it one commit too
   * late and leave the visible lines unhighlighted.
   */
  const getHighlightedLine = useMemo(() => {
    const cache = new Map<number, string>();
    const codeLanguage = fileData ? getLanguageForExtension(fileData.extension) : 'plaintext';
    const grammar = Prism.languages[codeLanguage];
    return (index: number): string => {
      const cached = cache.get(index);
      if (cached !== undefined) return cached;
      const line = codeLines[index] ?? '';
      const html = grammar
        ? Prism.highlight(line || ' ', grammar, codeLanguage)
        : (line || ' ')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
      cache.set(index, html);
      return html;
    };
  }, [codeLines, fileData, languageReady]);

  // When a specific line is requested, center it in view. The line lists are
  // windowed, so the target row usually isn't mounted yet — seek by arithmetic
  // (rows are fixed-height) instead of querySelector + scrollIntoView.
  useEffect(() => {
    if (!isOpen || !fileData || !contentRef.current) return;
    const lineIndex = showHighlightView
      ? (effectiveHighlightRange ? effectiveHighlightRange.offset - 1 : null)
      : (targetLine ? targetLine - 1 : null);
    if (lineIndex === null || lineIndex < 0) return;

    const id = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        const scroller = contentRef.current;
        if (!scroller) return;
        const lineHeight = showHighlightView ? HIGHLIGHT_LINE_HEIGHT : CODE_LINE_HEIGHT;
        scrollLineIntoView(scroller, lineIndex, lineHeight);
      });
    }, 0);
    return () => window.clearTimeout(id);
  }, [isOpen, fileData, showHighlightView, effectiveHighlightRange?.offset, targetLine]);

  const baseDirParam = searchRoot ? `&baseDir=${encodeURIComponent(searchRoot)}` : '';

  const loadFileByPath = async (filePath: string): Promise<{ ok: boolean; data?: any; error?: string; isDirectory?: boolean; triedRoots?: string[]; requested?: string }> => {
    const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
    const isPdfFile = PDF_EXTENSIONS.includes(ext);
    const isImageFile = IMAGE_EXTENSIONS.includes(ext);
    const isStlFile = STL_EXTENSIONS.includes(ext);
    const isFcStdFile = FCSTD_EXTENSIONS.includes(ext);
    const isGcodeFile = GCODE_EXTENSIONS.includes(ext);

    const endpoint = (isPdfFile || isImageFile || isStlFile || isFcStdFile || isGcodeFile)
      ? `/api/files/info?path=${encodeURIComponent(filePath)}${baseDirParam}`
      : `/api/files/read?path=${encodeURIComponent(filePath)}${baseDirParam}`;

    const res = await authFetch(apiUrl(endpoint));
    const data = await res.json();

    if (!res.ok) {
      const isDir = data.error === 'Path is a directory';
      return {
        ok: false,
        error: data.error,
        isDirectory: isDir,
        triedRoots: Array.isArray(data.triedRoots) ? data.triedRoots : undefined,
        requested: typeof data.path === 'string' ? data.path : undefined,
      };
    }

    if (isPdfFile || isImageFile || isStlFile || isFcStdFile || isGcodeFile) {
      data.content = '';
    }

    return { ok: true, data };
  };

  const tryResolveFile = async (filename: string, root: string): Promise<ResolveResult[]> => {
    try {
      const res = await authFetch(apiUrl(`/api/files/resolve?name=${encodeURIComponent(filename)}&root=${encodeURIComponent(root)}`));
      const data = await res.json();
      if (res.ok && data.results?.length > 0) {
        return data.results;
      }
    } catch { /* ignore */ }
    return [];
  };

  const loadDirectoryContents = async (dirPath: string): Promise<ResolveResult[]> => {
    try {
      const res = await authFetch(apiUrl(`/api/files/list?path=${encodeURIComponent(dirPath)}${baseDirParam}`));
      const data = await res.json();
      if (res.ok && data.files?.length > 0) {
        // The /list endpoint already sorts directories-first, then alphabetically.
        // Cap generously (folders rarely exceed this) so a captures/images folder
        // shows every entry rather than an arbitrary first-20 slice.
        return data.files.slice(0, 1000).map((f: any) => ({
          name: f.name,
          path: f.path,
          isDirectory: f.isDirectory,
          size: f.size || 0,
          extension: f.extension || '',
        }));
      }
    } catch { /* ignore */ }
    return [];
  };

  // A directory target has no file to render — list its entries inside THIS
  // modal (reusing the same /api/files/list endpoint the File Explorer uses)
  // instead of resolving it as a file. Folders are shown first, then files.
  const loadDirectoryInto = async (dirPath: string) => {
    // Drop the trailing slash (except root) so the listed path and up-navigation
    // parent computation stay canonical.
    const normalized = dirPath.length > 1 ? dirPath.replace(/\/+$/, '') : dirPath;
    setLoading(true);
    setError(null);
    setNotFound(null);
    setResolvedCandidates([]);
    setFileData(null);
    try {
      const entries = await loadDirectoryContents(normalized);
      setDirectoryEntries(entries);
      setDirectoryPath(normalized);
    } finally {
      setLoading(false);
    }
  };

  // Navigate the in-modal listing up to the parent folder.
  const handleDirectoryUp = () => {
    if (!directoryPath || directoryPath === '/') return;
    const parent = directoryPath.substring(0, directoryPath.lastIndexOf('/')) || '/';
    void loadDirectoryInto(parent);
  };

  const loadFile = async () => {
    // A trailing-slash absolute path is unambiguously a directory. Skip the
    // whole file-resolution dance (which would reject the dir at every
    // candidate and surface a bogus "Tried N candidate locations" error) and
    // list its contents directly in the modal.
    if (effectivePath.startsWith('/') && effectivePath.endsWith('/') && effectivePath !== '/') {
      await loadDirectoryInto(effectivePath);
      return;
    }

    setLoading(true);
    setError(null);
    setNotFound(null);
    setResolvedCandidates([]);
    setDirectoryEntries([]);
    setDirectoryPath(null);

    try {
      // Bare basenames (no directory component) can't be probed directly —
      // resolveAgentFilePath just glues cwd + basename, which almost never
      // exists. Skip the direct read (which would 404 and noise the console)
      // and go straight to tree search for matching candidates.
      const originalIsBareBasename = !parsedReference.path.includes('/');

      if (!originalIsBareBasename) {
        // First, try loading the file directly
        const result = await loadFileByPath(effectivePath);

        if (result.ok) {
          setFileData(result.data);
          return;
        }

        // If it's a directory, list its contents inside the modal instead of
        // trying to render it as a file. (The server reports this for absolute
        // directory paths that arrive without a trailing slash.)
        if (result.isDirectory) {
          await loadDirectoryInto(result.requested || effectivePath);
          return;
        }

        // File not found — try fallback search, then fall through to notFound view
        const filename = effectivePath.split('/').pop() || effectivePath;
        const root = searchRoot || (effectivePath.startsWith('/') ? effectivePath.split('/').slice(0, -1).join('/') : '');

        if (root && filename) {
          const candidates = await tryResolveFile(filename, root);

          if (candidates.length === 1 && !candidates[0].isDirectory) {
            const resolved = await loadFileByPath(candidates[0].path);
            if (resolved.ok) {
              setFileData(resolved.data);
              return;
            }
          } else if (candidates.length > 0) {
            setResolvedCandidates(candidates);
            return;
          }
        }

        // No fallback worked — show structured "Tried N candidate locations" view
        if (result.error === 'File not found' && (result.triedRoots?.length ?? 0) > 0) {
          setNotFound({
            message: result.error,
            triedRoots: result.triedRoots ?? [],
            requested: result.requested,
          });
        } else {
          setError(result.error || t('terminal:fileExplorer.failedToLoad'));
        }
        return;
      }

      // Bare basename path: search the tree directly
      const filename = parsedReference.path;
      const root = searchRoot || (effectivePath.startsWith('/') ? effectivePath.split('/').slice(0, -1).join('/') : '');

      if (root) {
        const candidates = await tryResolveFile(filename, root);

        if (candidates.length === 1 && !candidates[0].isDirectory) {
          const resolved = await loadFileByPath(candidates[0].path);
          if (resolved.ok) {
            setFileData(resolved.data);
            return;
          }
        } else if (candidates.length > 0) {
          setResolvedCandidates(candidates);
          return;
        }
      }

      // Nothing found — probe the synthesized path so the user still gets
      // the canonical "Tried N candidate locations" view.
      const result = await loadFileByPath(effectivePath);
      if (result.ok) {
        setFileData(result.data);
        return;
      }
      if (result.error === 'File not found' && (result.triedRoots?.length ?? 0) > 0) {
        setNotFound({
          message: result.error,
          triedRoots: result.triedRoots ?? [],
          requested: result.requested,
        });
      } else {
        setError(result.error || t('terminal:fileExplorer.failedToLoad'));
      }
    } catch (err: any) {
      setError(err.message || t('terminal:fileExplorer.failedToLoad'));
    } finally {
      setLoading(false);
    }
  };

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(notFound?.requested || effectivePath);
      setCopyPathStatus('copied');
    } catch {
      setCopyPathStatus('error');
    } finally {
      window.setTimeout(() => setCopyPathStatus('idle'), 1500);
    }
  };

  const handleCandidateClick = async (candidate: ResolveResult) => {
    if (candidate.isDirectory) {
      // Navigate the in-modal listing into this subfolder.
      await loadDirectoryInto(candidate.path);
      return;
    }
    // Open the clicked file in this same viewer, replacing any directory listing.
    setLoading(true);
    setResolvedCandidates([]);
    setDirectoryEntries([]);
    setDirectoryPath(null);
    setError(null);
    try {
      const result = await loadFileByPath(candidate.path);
      if (result.ok) {
        setFileData(result.data);
      } else if (result.isDirectory) {
        // Reported as a file but is actually a directory — browse it instead.
        await loadDirectoryInto(result.requested || candidate.path);
      } else {
        setError(result.error || t('terminal:fileExplorer.failedToLoad'));
      }
    } catch (err: any) {
      setError(err.message || t('terminal:fileExplorer.failedToLoad'));
    } finally {
      setLoading(false);
    }
  };

  const { handleMouseDown: handleOverlayMouseDown, handleClick: handleOverlayClick } = useModalClose(onClose);

  const getActionLabel = () => {
    switch (action) {
      case 'created': return t('common:status.created');
      case 'modified': return t('common:status.modified');
      case 'deleted': return t('common:status.deleted');
      case 'read': return t('common:status.read');
    }
  };

  const getActionColor = () => {
    switch (action) {
      case 'created': return 'var(--accent-green)';
      case 'modified': return 'var(--accent-orange)';
      case 'deleted': return 'var(--accent-red)';
      case 'read': return 'var(--text-secondary)';
    }
  };

  const handleCopyAsRichText = useCallback(async () => {
    if (!markdownContentRef.current) {
      console.error('Copy Rich Text: markdown content ref is not available');
      setCopyRichTextStatus('error');
      setTimeout(() => setCopyRichTextStatus('idle'), 2000);
      return;
    }

    try {
      const rawHtml = markdownContentRef.current.innerHTML;
      const html = inlineStylesForRichCopy(rawHtml);
      const plainText = markdownContentRef.current.innerText;
      await copyRichContentToClipboard(html, plainText);

      setCopyRichTextStatus('copied');
      setTimeout(() => setCopyRichTextStatus('idle'), 2000);
    } catch (err) {
      console.error('Copy Rich Text failed:', err);
      setCopyRichTextStatus('error');
      setTimeout(() => setCopyRichTextStatus('idle'), 2000);
    }
  }, []);

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

  const handleCopyMarkdown = useCallback(async () => {
    if (!fileData) {
      setCopyMarkdownStatus('error');
      setTimeout(() => setCopyMarkdownStatus('idle'), 2000);
      return;
    }

    try {
      await copyTextToClipboard(fileData.content);
      setCopyMarkdownStatus('copied');
      setTimeout(() => setCopyMarkdownStatus('idle'), 2000);
    } catch {
      setCopyMarkdownStatus('error');
      setTimeout(() => setCopyMarkdownStatus('idle'), 2000);
    }
  }, [fileData]);

  const handleCopyOriginal = useCallback(async () => {
    if (!fileData) {
      setCopyOriginalStatus('error');
      setTimeout(() => setCopyOriginalStatus('idle'), 2000);
      return;
    }

    try {
      await copyTextToClipboard(fileData.content);
      setCopyOriginalStatus('copied');
      setTimeout(() => setCopyOriginalStatus('idle'), 2000);
    } catch {
      setCopyOriginalStatus('error');
      setTimeout(() => setCopyOriginalStatus('idle'), 2000);
    }
  }, [fileData]);

  const handleCopyAll = useCallback(async () => {
    if (!fileData) {
      setCopyAllStatus('error');
      setTimeout(() => setCopyAllStatus('idle'), 2000);
      return;
    }

    try {
      await copyTextToClipboard(fileData.content);
      setCopyAllStatus('copied');
      setTimeout(() => setCopyAllStatus('idle'), 2000);
    } catch {
      setCopyAllStatus('error');
      setTimeout(() => setCopyAllStatus('idle'), 2000);
    }
  }, [fileData]);

  const handleDownloadTextFile = useCallback(async () => {
    if (!fileData) return;
    const url = apiUrl(
      `/api/files/binary?path=${encodeURIComponent(fileData.path || effectivePath)}${baseDirParam}&download=true`,
    );
    await downloadServerFile(
      url,
      fileData.filename || effectivePath.split('/').pop() || 'download',
      'text/plain;charset=utf-8',
    );
  }, [fileData, effectivePath, baseDirParam]);

  const handleRevealInFileExplorer = useCallback(async () => {
    if (!fileData?.path || revealStatus === 'opening') return;

    try {
      setRevealStatus('opening');
      await revealInFileExplorer(fileData.path);
      setRevealStatus('success');
      setTimeout(() => setRevealStatus('idle'), 2000);
    } catch (err) {
      console.error('Open in file explorer failed:', err);
      setRevealStatus('error');
      setTimeout(() => setRevealStatus('idle'), 2000);
    }
  }, [fileData?.path, revealStatus]);

  const handleOpenInExplorerPanel = useCallback(() => {
    const path = fileData?.path;
    if (!path) return;

    // Pick a folder root for the panel: prefer the agent cwd (searchRoot) when
    // it actually contains the file, else fall back to the file's parent dir.
    let folderRoot = searchRoot && (path === searchRoot || path.startsWith(`${searchRoot}/`))
      ? searchRoot
      : path.substring(0, path.lastIndexOf('/')) || '/';

    store.revealFileInExplorer(path, folderRoot);
    onClose();
  }, [fileData?.path, searchRoot, onClose]);

  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'error'>('idle');
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleDownload = useCallback(async () => {
    setDownloadStatus('downloading');
    setDownloadError(null);
    try {
      const url = apiUrl(
        `/api/files/binary?path=${encodeURIComponent(fileData?.path || effectivePath)}${baseDirParam}&download=true`,
      );
      const filename = fileData?.filename || effectivePath.split('/').pop() || 'download';
      const mimeType = fileData?.extension?.toLowerCase() === '.pdf' ? 'application/pdf' : undefined;
      await downloadServerFile(url, filename, mimeType);
      setDownloadStatus('idle');
    } catch (err: any) {
      setDownloadError(err?.message || 'Download failed');
      setDownloadStatus('error');
      setTimeout(() => {
        setDownloadStatus('idle');
        setDownloadError(null);
      }, 4000);
    }
  }, [effectivePath, baseDirParam, fileData?.path, fileData?.filename, fileData?.extension]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const displayedPath = fileData?.path || effectivePath;
  const isMarkdown = fileData && MARKDOWN_EXTENSIONS.includes(fileData.extension);
  const isSvg = Boolean(fileData && hasFileExtension(fileData.extension, displayedPath, ['.svg']));
  const isImage = Boolean(fileData && hasFileExtension(fileData.extension, displayedPath, IMAGE_EXTENSIONS));
  const isPdf = Boolean(fileData && hasFileExtension(fileData.extension, displayedPath, PDF_EXTENSIONS));
  const isStl = Boolean(fileData && hasFileExtension(fileData.extension, displayedPath, STL_EXTENSIONS));
  const isFcStd = Boolean(fileData && hasFileExtension(fileData.extension, displayedPath, FCSTD_EXTENSIONS));
  const isGcode = Boolean(fileData && hasFileExtension(fileData.extension, displayedPath, GCODE_EXTENSIONS));
  const language = isSvg ? 'SVG' : isImage ? 'Image' : isPdf ? 'PDF' : isStl ? 'STL · 3D' : isFcStd ? 'FreeCAD · 3D' : isGcode ? 'G-code · Print' : (fileData ? getLanguageForExtension(fileData.extension) : 'text');
  const authToken = getAuthToken();
  // Use the resolved file path (a clicked directory entry has its own path that
  // differs from the modal's original effectivePath — which may be the folder).
  const binaryPath = fileData?.path || effectivePath;
  const imageUrl = isImage ? apiUrl(`/api/files/binary?path=${encodeURIComponent(binaryPath)}${baseDirParam}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}`) : null;
  const pdfUrl = isPdf ? apiUrl(`/api/files/binary?path=${encodeURIComponent(binaryPath)}${baseDirParam}`) : null;
  const stlUrl = isStl ? apiUrl(`/api/files/binary?path=${encodeURIComponent(binaryPath)}${baseDirParam}`) : null;
  const fcstdUrl = isFcStd ? apiUrl(`/api/files/binary?path=${encodeURIComponent(binaryPath)}${baseDirParam}`) : null;
  const gcodeUrl = isGcode ? apiUrl(`/api/files/binary?path=${encodeURIComponent(binaryPath)}${baseDirParam}`) : null;
  // The text preview endpoint deliberately rejects files over 1 MB, but those
  // files can still be saved through the streaming binary endpoint.
  const canDownloadWithoutPreview = !fileData && error?.startsWith('File too large');
  const openInFileExplorerLabel = t('terminal:fileExplorer.openInFileExplorer');
  // Folder name for the header/path when browsing a directory (basename of the
  // current directory path, or '/' at the filesystem root).
  const directoryName = directoryPath ? (directoryPath.split('/').filter(Boolean).pop() || '/') : null;
  const headerName = fileData?.filename || directoryName || effectivePath.split('/').pop();

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div
        ref={overlayRef}
        className="file-viewer-overlay"
        onMouseDown={handleOverlayMouseDown}
        onClick={handleOverlayClick}
        tabIndex={-1}
      >
        <div className="file-viewer-modal">
        <div className="file-viewer-header">
          <div className="file-viewer-title">
            <span className="file-viewer-action" style={{ color: getActionColor() }}>
              {getActionLabel()}
            </span>
            <span className="file-viewer-filename">{headerName}</span>
            {fileData?.strategy && fileData.strategy !== 'exact' && (
              <span
                className={`file-viewer-strategy-badge file-viewer-strategy-${fileData.strategy}`}
                title={
                  fileData.areaName
                    ? `matched in area: ${fileData.areaName}`
                    : fileData.strategy === 'suffix-match'
                      ? `matched by suffix from ${searchRoot ?? 'agent cwd'}`
                      : `resolved via ${fileData.strategy}`
                }
              >
                {fileData.strategy}
                {fileData.areaName ? ` · ${fileData.areaName}` : ''}
              </span>
            )}
          </div>
          <div className="file-viewer-header-buttons">
            {fileData && (
              <button
                type="button"
                className="file-viewer-reveal-explorer-btn"
                onClick={handleOpenInExplorerPanel}
                disabled={!fileData.path}
                title={t('terminal:fileExplorer.revealInTree')}
                aria-label={t('terminal:fileExplorer.revealInTree')}
              >
                <Icon name="tree" size={14} />
              </button>
            )}
            {fileData && (
              <button
                type="button"
                className={`file-viewer-reveal-explorer-btn ${revealStatus}`}
                onClick={handleRevealInFileExplorer}
                disabled={!fileData.path || revealStatus === 'opening'}
                title={openInFileExplorerLabel}
                aria-label={openInFileExplorerLabel}
              >
                {revealStatus === 'success' ? (
                  <Icon name="check" size={14} />
                ) : revealStatus === 'error' ? (
                  <Icon name="cross" size={14} />
                ) : (
                  <Icon name="folder-open" size={14} />
                )}
              </button>
            )}
            {isMarkdown && fileData && !showDiffView && !showUnifiedDiffView && !showHighlightView && (
              <>
                <button
                  className={`file-viewer-copy-html-btn ${copyRichTextStatus}`}
                  onClick={handleCopyAsRichText}
                  title={t('terminal:fileExplorer.copyRichTextTitle')}
                >
                  {copyRichTextStatus === 'copied' ? t('common:status.copied') : copyRichTextStatus === 'error' ? t('common:status.error') : t('terminal:fileExplorer.copyRichText')}
                </button>
                <button
                  className={`file-viewer-copy-html-btn ${copyHtmlStatus}`}
                  onClick={handleCopyAsHtml}
                  title={t('terminal:fileExplorer.copyHtmlTitle')}
                >
                  {copyHtmlStatus === 'copied' ? t('common:status.copied') : copyHtmlStatus === 'error' ? t('common:status.error') : t('terminal:fileExplorer.copyHtml')}
                </button>
                <button
                  className={`file-viewer-copy-html-btn ${copyMarkdownStatus}`}
                  onClick={handleCopyMarkdown}
                  title={t('terminal:fileExplorer.copyMarkdownTitle')}
                >
                  {copyMarkdownStatus === 'copied' ? t('common:status.copied') : copyMarkdownStatus === 'error' ? t('common:status.error') : t('terminal:fileExplorer.copyMarkdown')}
                </button>
                <button
                  className={`file-viewer-copy-html-btn ${copyOriginalStatus}`}
                  onClick={handleCopyOriginal}
                  title={t('terminal:fileExplorer.copyOriginalTitle')}
                >
                  {copyOriginalStatus === 'copied' ? t('common:status.copied') : copyOriginalStatus === 'error' ? t('common:status.error') : t('terminal:fileExplorer.copyOriginal')}
                </button>
              </>
            )}
            {fileData && !isImage && !isPdf && !isStl && !isFcStd && !isGcode && !isMarkdown && (
              <button
                type="button"
                className={`file-viewer-copy-html-btn ${copyAllStatus}`}
                onClick={handleCopyAll}
                title={t('terminal:fileExplorer.copyAllTitle')}
              >
                {copyAllStatus === 'copied' ? t('common:status.copied') : copyAllStatus === 'error' ? t('common:status.error') : t('terminal:fileExplorer.copyAll')}
              </button>
            )}
            {fileData && !isImage && !isPdf && !isStl && !isFcStd && !isGcode && (
              <button
                type="button"
                className="file-viewer-copy-html-btn"
                onClick={handleDownloadTextFile}
                title={t('terminal:fileExplorer.downloadFileTitle')}
              >
                {t('common:buttons.download')}
              </button>
            )}
            {(isImage || isPdf || isStl || isFcStd || isGcode) && fileData ? (
              <button
                type="button"
                className={`file-viewer-copy-html-btn ${downloadStatus}`}
                onClick={handleDownload}
                disabled={downloadStatus === 'downloading'}
                title={downloadError
                  || (isImage
                    ? t('terminal:fileExplorer.downloadImage')
                    : isPdf
                      ? t('terminal:fileExplorer.downloadPdf')
                      : t('terminal:fileExplorer.downloadFileTitle'))}
              >
                {downloadStatus === 'downloading'
                  ? '…'
                  : downloadStatus === 'error'
                    ? t('common:status.error')
                    : t('common:buttons.download')}
              </button>
            ) : null}
            {canDownloadWithoutPreview && (
              <button
                type="button"
                className={`file-viewer-copy-html-btn ${downloadStatus}`}
                onClick={handleDownload}
                disabled={downloadStatus === 'downloading'}
                title={downloadError || t('terminal:fileExplorer.downloadFileTitle')}
              >
                {downloadStatus === 'downloading'
                  ? '…'
                  : downloadStatus === 'error'
                    ? t('common:status.error')
                    : t('common:buttons.download')}
              </button>
            )}
            <button className="file-viewer-close" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="file-viewer-path">
          {fileData?.path || directoryPath || effectivePath}
        </div>

        {fileData && (
          <div className="file-viewer-meta">
            <span>{formatFileSize(fileData.size)}</span>
            <span>•</span>
            <span>{language}</span>
            {fileData.content && !isImage && !isPdf && !isStl && !isFcStd && !isGcode && (
              <>
                <span>•</span>
                <span>{t('terminal:fileViewer.lineCount', { count: fileData.content.split('\n').length })}</span>
              </>
            )}
          </div>
        )}

        <div className="file-viewer-content" ref={contentRef}>
          {loading && (
            <div className="file-viewer-loading">{t('terminal:fileExplorer.loadingFile')}</div>
          )}

          {error && !resolvedCandidates.length && directoryPath === null && !notFound && (
            <div className="file-viewer-error">{error}</div>
          )}

          {notFound && !resolvedCandidates.length && directoryPath === null && (
            <div className="file-viewer-error file-viewer-not-found">
              <div className="file-viewer-not-found-headline">
                {`Tried ${notFound.triedRoots.length} candidate location${notFound.triedRoots.length === 1 ? '' : 's'}. None matched.`}
              </div>
              {notFound.requested && (
                <div className="file-viewer-not-found-path">{notFound.requested}</div>
              )}
              <button
                type="button"
                className={`file-viewer-copy-html-btn ${copyPathStatus}`}
                onClick={handleCopyPath}
              >
                {copyPathStatus === 'copied'
                  ? t('common:status.copied')
                  : copyPathStatus === 'error'
                    ? t('common:status.error')
                    : 'Copy path'}
              </button>
            </div>
          )}

          {resolvedCandidates.length > 0 && (
            <div className="file-viewer-resolve-results">
              <div className="file-viewer-resolve-header">
                Found {resolvedCandidates.length} matching file{resolvedCandidates.length > 1 ? 's' : ''} in project:
              </div>
              <div className="file-viewer-resolve-list">
                {resolvedCandidates.map((candidate) => (
                  <button
                    key={candidate.path}
                    className="file-viewer-resolve-item"
                    onClick={() => handleCandidateClick(candidate)}
                  >
                    <span className="file-viewer-resolve-icon">{candidate.isDirectory ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}</span>
                    <span className="file-viewer-resolve-info">
                      <span className="file-viewer-resolve-name">{candidate.name}</span>
                      <span className="file-viewer-resolve-path">{candidate.path}</span>
                    </span>
                    {!candidate.isDirectory && candidate.size > 0 && (
                      <span className="file-viewer-resolve-size">{formatFileSize(candidate.size)}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {directoryPath !== null && !fileData && (
            <div className="file-viewer-resolve-results">
              <div className="file-viewer-resolve-header">
                {directoryEntries.length > 0
                  ? `Directory contents (${directoryEntries.length} item${directoryEntries.length === 1 ? '' : 's'}):`
                  : 'This folder is empty'}
              </div>
              <div className="file-viewer-resolve-list">
                {directoryPath !== '/' && (
                  <button
                    type="button"
                    className="file-viewer-resolve-item"
                    onClick={handleDirectoryUp}
                  >
                    <span className="file-viewer-resolve-icon">{'⬆️'}</span>
                    <span className="file-viewer-resolve-info">
                      <span className="file-viewer-resolve-name">..</span>
                      <span className="file-viewer-resolve-path">
                        {directoryPath.substring(0, directoryPath.lastIndexOf('/')) || '/'}
                      </span>
                    </span>
                  </button>
                )}
                {directoryEntries.map((entry) => (
                  <button
                    key={entry.path}
                    className="file-viewer-resolve-item"
                    onClick={() => handleCandidateClick(entry)}
                  >
                    <span className="file-viewer-resolve-icon">{entry.isDirectory ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}</span>
                    <span className="file-viewer-resolve-info">
                      <span className="file-viewer-resolve-name">{entry.name}</span>
                      <span className="file-viewer-resolve-path">{entry.path}</span>
                    </span>
                    {!entry.isDirectory && entry.size > 0 && (
                      <span className="file-viewer-resolve-size">{formatFileSize(entry.size)}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {fileData && !loading && !error && (
            isImage && imageUrl ? (
              // Show image viewer
              <div className={`file-viewer-image-wrapper zoomable${isSvg ? ' svg-preview' : ''}`}>
                {/* Keep SVG documents in the browser's image-document context.
                    Unlike inline SVG, this does not add scriptable markup to our DOM. */}
                <ZoomableImage
                  src={imageUrl}
                  alt={fileData.filename}
                  className={isSvg ? 'file-viewer-svg' : undefined}
                />
              </div>
            ) : isPdf && pdfUrl ? (
              <PdfJsViewer url={pdfUrl} authToken={authToken || undefined} />
            ) : isStl && stlUrl ? (
              <React.Suspense fallback={<div className="file-viewer-loading">{t('terminal:fileViewerModal.loading3d')}</div>}>
                <StlViewer
                  url={stlUrl}
                  filename={fileData.filename}
                  filePath={binaryPath}
                  onFileSelect={(path) => store.setFileViewerPath(path, undefined, searchRoot)}
                />
              </React.Suspense>
            ) : isFcStd && fcstdUrl ? (
              <React.Suspense fallback={<div className="file-viewer-loading">{t('terminal:fileViewerModal.loadingFcstd')}</div>}>
                <FcStdViewer
                  url={fcstdUrl}
                  filename={fileData.filename}
                  filePath={binaryPath}
                  onFileSelect={(path) => store.setFileViewerPath(path, undefined, searchRoot)}
                />
              </React.Suspense>
            ) : isGcode && gcodeUrl ? (
              <React.Suspense fallback={<div className="file-viewer-loading">{t('terminal:fileViewerModal.loadingGcode')}</div>}>
                <GcodeViewer url={gcodeUrl} filename={fileData.filename} />
              </React.Suspense>
            ) : showDiffView ? (
              // Show side-by-side diff view for Edit tool
              <DiffViewer
                originalContent={effectiveOriginal!}
                modifiedContent={fileData.content}
                filename={fileData.filename}
                filePath={fileData.path || effectivePath}
                language={language}
              />
            ) : showUnifiedDiffView ? (
              // Fallback: show unified diff when side-by-side reconstruction fails
              <pre className="file-viewer-code file-viewer-unified-diff">
                {resolvedUnifiedDiff!.split('\n').map((line, idx) => {
                  let lineClass = 'diff-ctx';
                  if (line.startsWith('+') && !line.startsWith('+++')) lineClass = 'diff-add';
                  else if (line.startsWith('-') && !line.startsWith('---')) lineClass = 'diff-del';
                  else if (line.startsWith('@@')) lineClass = 'diff-hdr';
                  else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) lineClass = 'diff-meta';
                  return (
                    <div key={idx} className={`file-line file-line-${lineClass}`}>
                      <span className="file-line-num">{idx + 1}</span>
                      <code>{line || ' '}</code>
                    </div>
                  );
                })}
              </pre>
            ) : showHighlightView ? (
              // Show file with highlighted lines (for Read tool with offset/limit)
              <pre className="file-viewer-code file-viewer-code-highlighted">
                <VirtualLineList
                  count={codeLines.length}
                  lineHeight={HIGHLIGHT_LINE_HEIGHT}
                  scrollRef={contentRef}
                  renderLine={(idx) => {
                    const lineNum = idx + 1;
                    const range = effectiveHighlightRange;
                    const isHighlighted = range && lineNum >= range.offset && lineNum < range.offset + range.limit;
                    return (
                      <div className={`file-line ${isHighlighted ? 'file-line-highlighted' : ''}`}>
                        <span className="file-line-num">{lineNum}</span>
                        <code
                          className={`language-${language}`}
                          dangerouslySetInnerHTML={{ __html: getHighlightedLine(idx) }}
                        />
                      </div>
                    );
                  }}
                />
              </pre>
            ) : isMarkdown ? (
              <div className="file-viewer-markdown markdown-content" ref={markdownContentRef}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{fileData.content}</ReactMarkdown>
              </div>
            ) : (
              <pre className={`file-viewer-code file-viewer-code-lines language-${language}`}>
                <VirtualLineList
                  count={codeLines.length}
                  lineHeight={CODE_LINE_HEIGHT}
                  scrollRef={contentRef}
                  renderLine={(idx) => (
                    <div className={`file-line ${targetLine === idx + 1 ? 'file-line-highlighted' : ''}`}>
                      <span
                        className={`file-line-num ${targetLine === idx + 1 ? 'file-viewer-line-num-target' : ''}`}
                        data-line={idx + 1}
                      >
                        {idx + 1}
                      </span>
                      <code
                        className={`language-${language}`}
                        dangerouslySetInnerHTML={{ __html: getHighlightedLine(idx) }}
                      />
                    </div>
                  )}
                />
              </pre>
            )
          )}
        </div>
        </div>
      </div>
    </ModalPortal>
  );
}
