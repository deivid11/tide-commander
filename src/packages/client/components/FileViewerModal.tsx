import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import { DiffViewer } from './DiffViewer';
import { apiUrl, authFetch } from '../utils/storage';
import { useModalClose } from '../hooks';
import { parseFilePathReference } from '../utils/filePaths';
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

export function FileViewerModal({ isOpen, onClose, filePath, action, editData }: FileViewerModalProps) {
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyRichTextStatus, setCopyRichTextStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [copyHtmlStatus, setCopyHtmlStatus] = useState<'idle' | 'copied' | 'error'>('idle');
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
      loadFile();
    } else {
      setFileData(null);
      setError(null);
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

  const loadFile = async () => {
    setLoading(true);
    setError(null);

    try {
      const ext = effectivePath.substring(effectivePath.lastIndexOf('.')).toLowerCase();
      const isPdfFile = PDF_EXTENSIONS.includes(ext);
      const isImageFile = IMAGE_EXTENSIONS.includes(ext);

      // For binary-rendered media, only fetch metadata (content is loaded via binary endpoint)
      const endpoint = (isPdfFile || isImageFile)
        ? `/api/files/info?path=${encodeURIComponent(effectivePath)}`
        : `/api/files/read?path=${encodeURIComponent(effectivePath)}`;

      const res = await authFetch(apiUrl(endpoint));
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to load file');
        return;
      }

      // Info endpoint doesn't return content - set empty string for media files
      if (isPdfFile || isImageFile) {
        data.content = '';
      }

      setFileData(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load file');
    } finally {
      setLoading(false);
    }
  };

  const { handleMouseDown: handleOverlayMouseDown, handleClick: handleOverlayClick } = useModalClose(onClose);

  const getActionLabel = () => {
    switch (action) {
      case 'created': return 'Created';
      case 'modified': return 'Modified';
      case 'deleted': return 'Deleted';
      case 'read': return 'Read';
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
                  title="Copy as rich text (paste into Word, Docs, etc.)"
                >
                  {copyRichTextStatus === 'copied' ? '✓ Copied' : copyRichTextStatus === 'error' ? '✗ Error' : 'Copy Rich Text'}
                </button>
                <button
                  className={`file-viewer-copy-html-btn ${copyHtmlStatus}`}
                  onClick={handleCopyAsHtml}
                  title="Copy as HTML tags (for Google Docs, HTML editors)"
                >
                  {copyHtmlStatus === 'copied' ? '✓ Copied' : copyHtmlStatus === 'error' ? '✗ Error' : 'Copy HTML'}
                </button>
              </>
            )}
            {(isImage && imageUrl) || (isPdf && pdfUrl) ? (
              <a
                className="file-viewer-copy-html-btn"
                href={`${isImage ? imageUrl : pdfUrl}&download=true`}
                download={fileData?.filename}
                title={isImage ? 'Download image' : 'Download PDF'}
              >
                Download
              </a>
            ) : null}
            <button className="file-viewer-close" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="file-viewer-path">
          {effectivePath}
        </div>

        {fileData && (
          <div className="file-viewer-meta">
            <span>{formatFileSize(fileData.size)}</span>
            <span>•</span>
            <span>{language}</span>
            {fileData.content && !isImage && !isPdf && (
              <>
                <span>•</span>
                <span>{fileData.content.split('\n').length} lines</span>
              </>
            )}
          </div>
        )}

        <div className="file-viewer-content" ref={contentRef}>
          {loading && (
            <div className="file-viewer-loading">Loading file...</div>
          )}

          {error && (
            <div className="file-viewer-error">{error}</div>
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
  );
}
