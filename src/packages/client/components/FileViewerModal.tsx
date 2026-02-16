import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import { DiffViewer } from './DiffViewer';
import { apiUrl, authFetch } from '../utils/storage';
import { useModalClose } from '../hooks';
import { parseFilePathReference } from '../utils/filePaths';
import { ModalPortal } from './shared/ModalPortal';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-docker';

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

interface FileData {
  path: string;
  filename: string;
  extension: string;
  content: string;
  size: number;
  modified: string;
}

// Language mapping for syntax highlighting hints
const EXTENSION_LANGUAGES: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.html': 'html',
  '.xml': 'xml',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.sql': 'sql',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.fish': 'fish',
  '.ps1': 'powershell',
  '.dockerfile': 'dockerfile',
  '.toml': 'toml',
  '.ini': 'ini',
  '.env': 'bash',
  '.gitignore': 'gitignore',
};

const MARKDOWN_EXTENSIONS = ['.md', '.mdx', '.markdown'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg'];
const PDF_EXTENSIONS = ['.pdf'];

export function FileViewerModal({ isOpen, onClose, filePath, action, editData, searchRoot }: FileViewerModalProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedCandidates, setResolvedCandidates] = useState<ResolveResult[]>([]);
  const [directoryEntries, setDirectoryEntries] = useState<ResolveResult[]>([]);
  const [copyRichTextStatus, setCopyRichTextStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [copyHtmlStatus, setCopyHtmlStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [copyMarkdownStatus, setCopyMarkdownStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [copyOriginalStatus, setCopyOriginalStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const markdownContentRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const parsedReference = useMemo(() => parseFilePathReference(filePath), [filePath]);
  const effectivePath = parsedReference.path;
  const targetLine = editData?.targetLine ?? parsedReference.line;
  const effectiveHighlightRange = editData?.highlightRange
    || undefined;

  useEffect(() => {
    if (isOpen && effectivePath) {
      setResolvedCandidates([]);
      setDirectoryEntries([]);
      loadFile();
    } else {
      setFileData(null);
      setError(null);
      setResolvedCandidates([]);
      setDirectoryEntries([]);
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

  const hasEditStrings = !!editData && (!editData.highlightRange) && (!!editData.oldString || !!editData.newString);
  const showDiffView = hasEditStrings && originalContent !== null;
  const showHighlightView = effectiveHighlightRange !== undefined;

  const highlightedLines = useMemo(() => {
    if (!fileData || showDiffView || showHighlightView || MARKDOWN_EXTENSIONS.includes(fileData.extension)) return [];
    const codeLanguage = EXTENSION_LANGUAGES[fileData.extension] || 'text';
    const grammar = Prism.languages[codeLanguage];
    const escapeHtml = (value: string) => value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return fileData.content.split('\n').map((line) => {
      if (!grammar) return escapeHtml(line || ' ');
      return Prism.highlight(line || ' ', grammar, codeLanguage);
    });
  }, [fileData, showDiffView, showHighlightView]);

  // When a specific line is requested, center it in view.
  useEffect(() => {
    if (!isOpen || !fileData || !contentRef.current) return;
    const id = window.setTimeout(() => {
      const scrollToTarget = () => {
        if (!contentRef.current) return;
        // Prefer row highlight in both regular and read-highlight views.
        const targetRow = contentRef.current.querySelector('.file-line-highlighted') as HTMLElement | null;
        if (targetRow) {
          targetRow.scrollIntoView({ block: 'center', behavior: 'auto' });
          return;
        }
        if (targetLine) {
          const targetGutterLine = contentRef.current.querySelector(`.file-viewer-line-num[data-line="${targetLine}"]`) as HTMLElement | null;
          targetGutterLine?.scrollIntoView({ block: 'center', behavior: 'auto' });
        }
      };
      // Ensure DOM + layout are settled after Prism HTML render.
      window.requestAnimationFrame(() => window.requestAnimationFrame(scrollToTarget));
    }, 0);
    return () => window.clearTimeout(id);
  }, [isOpen, fileData, showHighlightView, effectiveHighlightRange?.offset, targetLine]);

  const loadFileByPath = async (filePath: string): Promise<{ ok: boolean; data?: any; error?: string; isDirectory?: boolean }> => {
    const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
    const isPdfFile = PDF_EXTENSIONS.includes(ext);
    const isImageFile = IMAGE_EXTENSIONS.includes(ext);

    const endpoint = (isPdfFile || isImageFile)
      ? `/api/files/info?path=${encodeURIComponent(filePath)}`
      : `/api/files/read?path=${encodeURIComponent(filePath)}`;

    const res = await authFetch(apiUrl(endpoint));
    const data = await res.json();

    if (!res.ok) {
      const isDir = data.error === 'Path is a directory';
      return { ok: false, error: data.error, isDirectory: isDir };
    }

    if (isPdfFile || isImageFile) {
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
      const res = await authFetch(apiUrl(`/api/files/list?path=${encodeURIComponent(dirPath)}`));
      const data = await res.json();
      if (res.ok && data.files?.length > 0) {
        return data.files.slice(0, 20).map((f: any) => ({
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

  const loadFile = async () => {
    setLoading(true);
    setError(null);
    setResolvedCandidates([]);
    setDirectoryEntries([]);

    try {
      // First, try loading the file directly
      const result = await loadFileByPath(effectivePath);

      if (result.ok) {
        setFileData(result.data);
        return;
      }

      // If it's a directory, load its contents
      if (result.isDirectory) {
        const entries = await loadDirectoryContents(effectivePath);
        if (entries.length > 0) {
          setDirectoryEntries(entries);
          return;
        }
        setError(result.error || t('terminal:fileExplorer.failedToLoad'));
        return;
      }

      // File not found (or path not absolute) — try fallback search
      const filename = effectivePath.split('/').pop() || effectivePath;
      const root = searchRoot || (effectivePath.startsWith('/') ? effectivePath.split('/').slice(0, -1).join('/') : '');

      if (root && filename) {
        const candidates = await tryResolveFile(filename, root);

        if (candidates.length === 1 && !candidates[0].isDirectory) {
          // Exactly one match — load it directly
          const resolved = await loadFileByPath(candidates[0].path);
          if (resolved.ok) {
            setFileData(resolved.data);
            return;
          }
        } else if (candidates.length > 0) {
          // Multiple matches — show candidates
          setResolvedCandidates(candidates);
          return;
        }
      }

      // No fallback worked
      setError(result.error || t('terminal:fileExplorer.failedToLoad'));
    } catch (err: any) {
      setError(err.message || t('terminal:fileExplorer.failedToLoad'));
    } finally {
      setLoading(false);
    }
  };

  const handleCandidateClick = async (candidate: ResolveResult) => {
    if (candidate.isDirectory) {
      // Load directory contents
      setLoading(true);
      setResolvedCandidates([]);
      setDirectoryEntries([]);
      setError(null);
      try {
        const entries = await loadDirectoryContents(candidate.path);
        if (entries.length > 0) {
          setDirectoryEntries(entries);
        } else {
          setError('Empty directory');
        }
      } catch {
        setError('Failed to load directory');
      } finally {
        setLoading(false);
      }
      return;
    }
    // Load the file
    setLoading(true);
    setResolvedCandidates([]);
    setDirectoryEntries([]);
    setError(null);
    try {
      const result = await loadFileByPath(candidate.path);
      if (result.ok) {
        setFileData(result.data);
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
      setCopyRichTextStatus('error');
      setTimeout(() => setCopyRichTextStatus('idle'), 2000);
      return;
    }

    try {
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

      setCopyRichTextStatus('copied');
      setTimeout(() => setCopyRichTextStatus('idle'), 2000);
    } catch {
      setCopyRichTextStatus('error');
      setTimeout(() => setCopyRichTextStatus('idle'), 2000);
    }
  }, []);

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

  const handleCopyMarkdown = useCallback(async () => {
    if (!fileData) {
      setCopyMarkdownStatus('error');
      setTimeout(() => setCopyMarkdownStatus('idle'), 2000);
      return;
    }

    try {
      await navigator.clipboard.writeText(fileData.content);
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
      await navigator.clipboard.writeText(fileData.content);
      setCopyOriginalStatus('copied');
      setTimeout(() => setCopyOriginalStatus('idle'), 2000);
    } catch {
      setCopyOriginalStatus('error');
      setTimeout(() => setCopyOriginalStatus('idle'), 2000);
    }
  }, [fileData]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isMarkdown = fileData && MARKDOWN_EXTENSIONS.includes(fileData.extension);
  const isImage = fileData && IMAGE_EXTENSIONS.includes(fileData.extension);
  const isPdf = fileData && PDF_EXTENSIONS.includes(fileData.extension);
  const language = isImage ? 'Image' : isPdf ? 'PDF' : (fileData ? EXTENSION_LANGUAGES[fileData.extension] || 'text' : 'text');
  const imageUrl = isImage ? apiUrl(`/api/files/binary?path=${encodeURIComponent(effectivePath)}`) : null;
  const pdfUrl = isPdf ? apiUrl(`/api/files/binary?path=${encodeURIComponent(effectivePath)}`) : null;

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
            <span className="file-viewer-filename">{fileData?.filename || effectivePath.split('/').pop()}</span>
          </div>
          <div className="file-viewer-header-buttons">
            {isMarkdown && fileData && !showDiffView && (
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
            {(isImage && imageUrl) || (isPdf && pdfUrl) ? (
              <a
                className="file-viewer-copy-html-btn"
                href={`${isImage ? imageUrl : pdfUrl}&download=true`}
                download={fileData?.filename}
                title={isImage ? t('terminal:fileExplorer.downloadImage') : t('terminal:fileExplorer.downloadPdf')}
              >
                {t('common:buttons.download')}
              </a>
            ) : null}
            <button className="file-viewer-close" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="file-viewer-path">
          {fileData?.path || effectivePath}
        </div>

        {fileData && (
          <div className="file-viewer-meta">
            <span>{formatFileSize(fileData.size)}</span>
            <span>•</span>
            <span>{language}</span>
            {fileData.content && !isImage && !isPdf && (
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

          {error && !resolvedCandidates.length && !directoryEntries.length && (
            <div className="file-viewer-error">{error}</div>
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

          {directoryEntries.length > 0 && (
            <div className="file-viewer-resolve-results">
              <div className="file-viewer-resolve-header">
                Directory contents ({directoryEntries.length} items):
              </div>
              <div className="file-viewer-resolve-list">
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
              <div className="file-viewer-image-wrapper">
                <img
                  src={imageUrl}
                  alt={fileData.filename}
                  className="file-viewer-image"
                />
              </div>
            ) : isPdf && pdfUrl ? (
              // Show embedded PDF viewer
              <div className="file-viewer-pdf-embed">
                <iframe
                  src={pdfUrl}
                  title={fileData.filename}
                  className="file-viewer-pdf-iframe"
                />
              </div>
            ) : showDiffView ? (
              // Show side-by-side diff view for Edit tool
              <DiffViewer
                originalContent={originalContent!}
                modifiedContent={fileData.content}
                filename={fileData.filename}
                language={language}
              />
            ) : showHighlightView ? (
              // Show file with highlighted lines (for Read tool with offset/limit)
              <pre className="file-viewer-code file-viewer-code-highlighted">
                {fileData.content.split('\n').map((line, idx) => {
                  const lineNum = idx + 1;
                  const range = effectiveHighlightRange;
                  const isHighlighted = range && lineNum >= range.offset && lineNum < range.offset + range.limit;
                  return (
                    <div key={idx} className={`file-line ${isHighlighted ? 'file-line-highlighted' : ''}`}>
                      <span className="file-line-num">{lineNum}</span>
                      <code className={`language-${language}`}>{line || ' '}</code>
                    </div>
                  );
                })}
              </pre>
            ) : isMarkdown ? (
              <div className="file-viewer-markdown markdown-content" ref={markdownContentRef}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{fileData.content}</ReactMarkdown>
              </div>
            ) : (
              <pre className={`file-viewer-code file-viewer-code-lines language-${language}`}>
                {highlightedLines.map((lineHtml, idx) => (
                  <div
                    key={idx + 1}
                    className={`file-line ${targetLine === idx + 1 ? 'file-line-highlighted' : ''}`}
                  >
                    <span
                      className={`file-line-num ${targetLine === idx + 1 ? 'file-viewer-line-num-target' : ''}`}
                      data-line={idx + 1}
                    >
                      {idx + 1}
                    </span>
                    <code
                      className={`language-${language}`}
                      dangerouslySetInnerHTML={{ __html: lineHtml }}
                    />
                  </div>
                ))}
              </pre>
            )
          )}
        </div>
        </div>
      </div>
    </ModalPortal>
  );
}
