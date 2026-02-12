/**
 * FileViewer - File content viewer with syntax highlighting
 *
 * Displays file content with Prism.js syntax highlighting.
 * Supports text files, images, PDFs, and binary downloads.
 * Markdown files can be rendered or viewed as source code.
 */

import React, { useEffect, useRef, memo, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { FileViewerProps, FileData } from './types';
import { formatFileSize } from './fileUtils';
import { highlightElement, getLanguageForExtension } from './syntaxHighlighting';
import { apiUrl, authFetch } from '../../utils/storage';
import { useStore } from '../../store';
import { useLessNavigation, type SearchMatch } from '../../hooks/useLessNavigation';
import { SearchBar } from './SearchBar';
import { KeybindingsHelp } from './KeybindingsHelp';

// ============================================================================
// CONSTANTS
// ============================================================================

const MARKDOWN_EXTENSIONS = ['.md', '.mdx', '.markdown'];
const MARKDOWN_RENDER_STORAGE_KEY = 'file-viewer-markdown-render';
const PLANTUML_EXTENSIONS = ['.puml', '.plantuml', '.iuml', '.pu'];
const PLANTUML_RENDER_STORAGE_KEY = 'file-viewer-plantuml-render';
const PLANTUML_RENDER_ENDPOINT = 'https://kroki.io/plantuml/svg';

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/**
 * Header component for file viewer
 */
function FileViewerHeader({
  file,
  rightContent,
  onRevealInTree,
}: {
  file: FileData;
  rightContent?: React.ReactNode;
  onRevealInTree?: (path: string) => void;
}) {
  const [openEditorStatus, setOpenEditorStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const language = file.fileType === 'text' ? getLanguageForExtension(file.extension) : file.extension.slice(1).toUpperCase();

  const { settings } = useStore();

  const handleOpenInEditor = async () => {
    setOpenEditorStatus('loading');
    try {
      const response = await authFetch(apiUrl('/api/files/open-in-editor'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: file.path,
          ...(settings.externalEditorCommand && { editorCommand: settings.externalEditorCommand }),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Failed to open in editor:', errorData);
        setOpenEditorStatus('error');
        setTimeout(() => setOpenEditorStatus('idle'), 2000);
        return;
      }

      setOpenEditorStatus('success');
      setTimeout(() => setOpenEditorStatus('idle'), 2000);
    } catch (err) {
      console.error('Error opening file in editor:', err);
      setOpenEditorStatus('error');
      setTimeout(() => setOpenEditorStatus('idle'), 2000);
    }
  };

  return (
    <div className="file-viewer-header">
      <div className="file-viewer-header-left">
        <span className="file-viewer-filename">{file.filename}</span>
        <span className="file-viewer-meta">
          {formatFileSize(file.size)} • {language}
          {file.content && ` • ${file.content.split('\n').length} lines`}
        </span>
      </div>
      <div className="file-viewer-header-right">
        <button
          className={`file-viewer-open-editor-btn ${openEditorStatus}`}
          onClick={handleOpenInEditor}
          disabled={openEditorStatus === 'loading'}
          title={openEditorStatus === 'error' ? 'Failed to open in editor' : openEditorStatus === 'success' ? 'Opening in editor...' : 'Open in default editor'}
        >
          {openEditorStatus === 'success' ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 11-1.06-1.06l7.25-7.25a.75.75 0 011.06 0z" />
            </svg>
          ) : openEditorStatus === 'error' ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1.5 1h6v1.5h-5v11h11v-5H15v6.5H0V1h1.5zm8 0H15v5.5h-1.5V3.56L7.28 9.78l-1.06-1.06L12.44 2.5H9.5V1z" />
            </svg>
          )}
        </button>
        {onRevealInTree && (
          <button
            className="file-viewer-locate-btn"
            onClick={() => onRevealInTree(file.path)}
            title="Locate in file tree"
          >
            ◎
          </button>
        )}
        {rightContent}
      </div>
    </div>
  );
}

/**
 * Hook to manage markdown render preference (persisted to localStorage)
 */
function useMarkdownRenderPreference(): [boolean, () => void] {
  const [renderMarkdown, setRenderMarkdown] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(MARKDOWN_RENDER_STORAGE_KEY);
      // Default to true (render markdown) if not set
      return stored === null ? true : stored === 'true';
    } catch {
      return true;
    }
  });

  const toggleRender = useCallback(() => {
    setRenderMarkdown((prev) => {
      const newValue = !prev;
      try {
        localStorage.setItem(MARKDOWN_RENDER_STORAGE_KEY, String(newValue));
      } catch {
        // Ignore localStorage errors
      }
      return newValue;
    });
  }, []);

  return [renderMarkdown, toggleRender];
}

/**
 * Check if file is a markdown file
 */
function isMarkdownFile(extension: string): boolean {
  return MARKDOWN_EXTENSIONS.includes(extension.toLowerCase());
}

/**
 * Check if file is a PlantUML file
 */
function isPlantUmlFile(extension: string): boolean {
  return PLANTUML_EXTENSIONS.includes(extension.toLowerCase());
}

/**
 * Hook to manage PlantUML render preference (persisted to localStorage)
 */
function usePlantUmlRenderPreference(): [boolean, () => void] {
  const [renderPlantUml, setRenderPlantUml] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(PLANTUML_RENDER_STORAGE_KEY);
      return stored === null ? true : stored === 'true';
    } catch {
      return true;
    }
  });

  const toggleRender = useCallback(() => {
    setRenderPlantUml((prev) => {
      const newValue = !prev;
      try {
        localStorage.setItem(PLANTUML_RENDER_STORAGE_KEY, String(newValue));
      } catch {
        // Ignore localStorage errors
      }
      return newValue;
    });
  }, []);

  return [renderPlantUml, toggleRender];
}

function toSvgDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:image/svg+xml;base64,${window.btoa(binary)}`;
}

/**
 * Text file viewer with syntax highlighting and line numbers
 * Supports vim/less-style keyboard navigation via useLessNavigation hook
 */
function TextFileViewer({ file, onRevealInTree, scrollToLine }: { file: FileData; onRevealInTree?: (path: string) => void; scrollToLine?: number }) {
  const codeRef = useRef<HTMLElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Setup less-style keyboard navigation with search
  const navigation = useLessNavigation({
    containerRef: contentRef as React.RefObject<HTMLDivElement>,
    isEnabled: true,
    content: file.content,
  });

  useEffect(() => {
    if (codeRef.current) {
      highlightElement(codeRef.current);
    }
  }, [file]);

  // Apply search highlights when matches change
  useEffect(() => {
    if (!codeRef.current) return;

    const codeElement = codeRef.current;
    const preElement = codeElement.parentElement;
    if (!preElement) return;

    // Clear previous highlights by removing mark elements
    const existingMarks = preElement.querySelectorAll('mark');
    existingMarks.forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        while (mark.firstChild) {
          parent.insertBefore(mark.firstChild, mark);
        }
        parent.removeChild(mark);
      }
    });

    // If no matches, return
    if (navigation.searchMatches.length === 0) return;

    const matches = navigation.searchMatches;
    const currentIndex = navigation.currentMatchIndex;

    // Get the full text content of the code element
    const fullText = codeElement.textContent || '';

    // Walk through text nodes and apply highlights
    const walker = document.createTreeWalker(
      codeElement,
      NodeFilter.SHOW_TEXT,
      null
    );

    let currentOffset = 0;
    let textNode: Node | null;
    const nodesToProcess: Array<{ node: Text; startOffset: number; endOffset: number }> = [];

    // First pass: collect text nodes and their character ranges
    while ((textNode = walker.nextNode())) {
      const text = textNode.textContent || '';
      const endOffset = currentOffset + text.length;
      nodesToProcess.push({
        node: textNode as Text,
        startOffset: currentOffset,
        endOffset,
      });
      currentOffset = endOffset;
    }

    // Second pass: apply highlights to matching text
    nodesToProcess.forEach(({ node, startOffset, endOffset }) => {
      const fragment = document.createDocumentFragment();
      const text = node.textContent || '';
      let lastIndex = 0;

      // Find all matches within this node's range
      matches.forEach((match, idx) => {
        const matchStart = match.charIndex;
        const matchEnd = matchStart + match.length;

        // Check if match overlaps with this node
        if (matchEnd > startOffset && matchStart < endOffset) {
          const nodeStart = Math.max(0, matchStart - startOffset);
          const nodeEnd = Math.min(text.length, matchEnd - startOffset);

          // Add text before match
          if (nodeStart > lastIndex) {
            fragment.appendChild(
              document.createTextNode(text.substring(lastIndex, nodeStart))
            );
          }

          // Add highlighted match
          const mark = document.createElement('mark');
          mark.textContent = text.substring(nodeStart, nodeEnd);
          mark.className = idx === currentIndex ? 'search-match current' : 'search-match';
          fragment.appendChild(mark);

          lastIndex = nodeEnd;
        }
      });

      // Add remaining text
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
      }

      // Replace node if we created highlights
      if (lastIndex > 0) {
        node.parentNode?.replaceChild(fragment, node);
      }
    });
  }, [navigation.searchMatches, navigation.currentMatchIndex]);

  // Scroll to target line
  useEffect(() => {
    if (!scrollToLine || !wrapperRef.current || !codeRef.current) return;

    // Wait for rendering
    requestAnimationFrame(() => {
      const pre = codeRef.current?.parentElement;
      if (!pre) return;
      const lineHeight = parseFloat(getComputedStyle(pre).lineHeight) || 19.5;
      const targetTop = (scrollToLine - 1) * lineHeight;
      wrapperRef.current?.scrollTo({ top: Math.max(0, targetTop - 100), behavior: 'smooth' });
    });
  }, [scrollToLine, file]);

  const language = getLanguageForExtension(file.extension);
  const lineCount = file.content.split('\n').length;

  return (
    <>
      <FileViewerHeader file={file} onRevealInTree={onRevealInTree} />
      <div className="file-viewer-content-wrapper" ref={contentRef}>
        <div className="file-viewer-code-with-lines" ref={wrapperRef}>
          <div className="file-viewer-line-gutter" aria-hidden="true">
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i + 1} className={`file-viewer-line-num${scrollToLine === i + 1 ? ' highlighted' : ''}`}>{i + 1}</div>
            ))}
          </div>
          <pre className="file-viewer-pre">
            <code ref={codeRef} className={`language-${language}`}>
              {file.content}
            </code>
          </pre>
        </div>
        {/* Scroll position indicator with line:column */}
        <div className="file-viewer-scroll-indicator" title={`Line ${navigation.currentLine} of ${navigation.totalLines} (${navigation.scrollPercentage}%)`}>
          <span className="indicator-position">{navigation.currentLine}</span>
          <span className="indicator-separator">:</span>
          <span className="indicator-percentage">{navigation.scrollPercentage === 100 ? 'END' : navigation.scrollPercentage === 0 ? 'TOP' : `${navigation.scrollPercentage}%`}</span>
        </div>
        {/* Search bar */}
        {navigation.searchActive && (
          <SearchBar
            query={navigation.searchQuery}
            onQueryChange={navigation.setSearchQuery}
            matchCount={navigation.searchMatches.length}
            currentIndex={navigation.currentMatchIndex}
            onNext={navigation.nextMatch}
            onPrev={navigation.prevMatch}
            onClose={navigation.clearSearch}
          />
        )}
      </div>
      {/* Keybindings help overlay */}
      {navigation.helpActive && <KeybindingsHelp onClose={navigation.toggleHelp} />}
    </>
  );
}

/**
 * Markdown file viewer with render toggle
 * Supports vim/less-style keyboard navigation via useLessNavigation hook
 */
function MarkdownFileViewer({
  file,
  onRevealInTree,
  renderMarkdown,
  onToggleRender,
}: {
  file: FileData;
  onRevealInTree?: (path: string) => void;
  renderMarkdown: boolean;
  onToggleRender: () => void;
}) {
  const codeRef = useRef<HTMLElement>(null);
  const markdownContentRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [copyRichTextStatus, setCopyRichTextStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [copyHtmlStatus, setCopyHtmlStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  // Setup less-style keyboard navigation
  const navigation = useLessNavigation({
    containerRef: contentRef as React.RefObject<HTMLDivElement>,
    isEnabled: true,
    content: file.content,
  });

  useEffect(() => {
    // Apply syntax highlighting when showing source code
    if (!renderMarkdown && codeRef.current) {
      highlightElement(codeRef.current);
    }
  }, [file, renderMarkdown]);

  // Copy as rich text (for pasting into Word, Docs with formatting)
  const handleCopyRichText = useCallback(async () => {
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

  // Copy as HTML tags (for pasting into Google Docs source, HTML editors)
  const handleCopyHtml = useCallback(async () => {
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

  const headerButtons = (
    <div className="file-viewer-header-buttons">
      {renderMarkdown && (
        <>
          <button
            className={`file-viewer-copy-html-btn ${copyRichTextStatus}`}
            onClick={handleCopyRichText}
            title="Copy as rich text (paste into Word, Docs, etc.)"
          >
            {copyRichTextStatus === 'copied' ? '✓ Copied' : copyRichTextStatus === 'error' ? '✗ Error' : 'Copy Rich Text'}
          </button>
          <button
            className={`file-viewer-copy-html-btn ${copyHtmlStatus}`}
            onClick={handleCopyHtml}
            title="Copy as HTML tags (for Google Docs, HTML editors)"
          >
            {copyHtmlStatus === 'copied' ? '✓ Copied' : copyHtmlStatus === 'error' ? '✗ Error' : 'Copy HTML'}
          </button>
        </>
      )}
      <button
        className={`file-viewer-render-toggle ${renderMarkdown ? 'active' : ''}`}
        onClick={onToggleRender}
        title={renderMarkdown ? 'Show source code' : 'Render markdown'}
      >
        {renderMarkdown ? '</>' : 'Aa'}
      </button>
    </div>
  );

  return (
    <>
      <FileViewerHeader file={file} onRevealInTree={onRevealInTree} rightContent={headerButtons} />
      <div className="file-viewer-content-wrapper" ref={contentRef}>
        {renderMarkdown ? (
          <div className="file-viewer-markdown-wrapper">
            <div className="markdown-content" ref={markdownContentRef}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{file.content}</ReactMarkdown>
            </div>
          </div>
        ) : (
          <div className="file-viewer-code-wrapper">
            <pre className="file-viewer-pre">
              <code ref={codeRef} className="language-markdown">
                {file.content}
              </code>
            </pre>
          </div>
        )}
        {/* Scroll position indicator */}
        <div className="file-viewer-scroll-indicator" title={`Line ${navigation.currentLine}/${navigation.totalLines}`}>
          {navigation.scrollPercentage === 100 ? 'END' : navigation.scrollPercentage === 0 ? 'TOP' : `${navigation.scrollPercentage}%`}
        </div>
        {/* Search bar */}
        {navigation.searchActive && (
          <SearchBar
            query={navigation.searchQuery}
            onQueryChange={navigation.setSearchQuery}
            matchCount={navigation.searchMatches.length}
            currentIndex={navigation.currentMatchIndex}
            onNext={navigation.nextMatch}
            onPrev={navigation.prevMatch}
            onClose={navigation.clearSearch}
          />
        )}
      </div>
      {/* Keybindings help overlay */}
      {navigation.helpActive && <KeybindingsHelp onClose={navigation.toggleHelp} />}
    </>
  );
}

/**
 * PlantUML file viewer with diagram render toggle
 * Supports vim/less-style keyboard navigation via useLessNavigation hook
 */
function PlantUmlFileViewer({
  file,
  onRevealInTree,
  renderPlantUml,
  onToggleRender,
}: {
  file: FileData;
  onRevealInTree?: (path: string) => void;
  renderPlantUml: boolean;
  onToggleRender: () => void;
}) {
  const codeRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [diagramDataUrl, setDiagramDataUrl] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  // Setup less-style keyboard navigation
  const navigation = useLessNavigation({
    containerRef: contentRef as React.RefObject<HTMLDivElement>,
    isEnabled: true,
    content: file.content,
  });

  useEffect(() => {
    if (!renderPlantUml && codeRef.current) {
      highlightElement(codeRef.current);
    }
  }, [file, renderPlantUml]);

  useEffect(() => {
    if (!renderPlantUml) return;

    if (!file.content.trim()) {
      setDiagramDataUrl(null);
      setRenderError('Diagram is empty');
      return;
    }

    const controller = new AbortController();
    setIsRendering(true);
    setRenderError(null);

    const renderDiagram = async () => {
      try {
        const res = await fetch(PLANTUML_RENDER_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Accept': 'image/svg+xml',
          },
          body: file.content,
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`Render failed (${res.status})`);
        }

        const svg = await res.text();
        if (!svg.includes('<svg')) {
          throw new Error('Invalid SVG output');
        }

        setDiagramDataUrl(toSvgDataUrl(svg));
      } catch (err) {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : 'Failed to render diagram';
        setRenderError(message);
        setDiagramDataUrl(null);
      } finally {
        if (!controller.signal.aborted) {
          setIsRendering(false);
        }
      }
    };

    renderDiagram();
    return () => controller.abort();
  }, [file.path, file.content, renderPlantUml]);

  const headerButtons = (
    <div className="file-viewer-header-buttons">
      <button
        className={`file-viewer-render-toggle ${renderPlantUml ? 'active' : ''}`}
        onClick={onToggleRender}
        title={renderPlantUml ? 'Show source code' : 'Render PlantUML diagram'}
      >
        {renderPlantUml ? '</>' : 'Diagram'}
      </button>
    </div>
  );

  return (
    <>
      <FileViewerHeader file={file} onRevealInTree={onRevealInTree} rightContent={headerButtons} />
      <div className="file-viewer-content-wrapper" ref={contentRef}>
        {renderPlantUml ? (
          <div className="file-viewer-diagram-wrapper">
            {isRendering && <div className="file-viewer-placeholder">Rendering diagram...</div>}
            {!isRendering && diagramDataUrl && (
              <img
                src={diagramDataUrl}
                alt={file.filename}
                className="file-viewer-diagram-image"
              />
            )}
            {!isRendering && renderError && (
              <div className="file-viewer-diagram-error">
                <div>Could not render diagram: {renderError}</div>
                <button className="file-viewer-render-toggle" onClick={onToggleRender}>
                  Show source
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="file-viewer-code-wrapper">
            <pre className="file-viewer-pre">
              <code ref={codeRef} className="language-plaintext">
                {file.content}
              </code>
            </pre>
          </div>
        )}
        {/* Scroll position indicator */}
        <div className="file-viewer-scroll-indicator" title={`Line ${navigation.currentLine}/${navigation.totalLines}`}>
          {navigation.scrollPercentage === 100 ? 'END' : navigation.scrollPercentage === 0 ? 'TOP' : `${navigation.scrollPercentage}%`}
        </div>
        {/* Search bar */}
        {navigation.searchActive && (
          <SearchBar
            query={navigation.searchQuery}
            onQueryChange={navigation.setSearchQuery}
            matchCount={navigation.searchMatches.length}
            currentIndex={navigation.currentMatchIndex}
            onNext={navigation.nextMatch}
            onPrev={navigation.prevMatch}
            onClose={navigation.clearSearch}
          />
        )}
      </div>
      {/* Keybindings help overlay */}
      {navigation.helpActive && <KeybindingsHelp onClose={navigation.toggleHelp} />}
    </>
  );
}

/**
 * Image file viewer
 */
function ImageFileViewer({ file, onRevealInTree }: { file: FileData; onRevealInTree?: (path: string) => void }) {
  const handleDownload = () => {
    if (file.dataUrl) {
      const link = document.createElement('a');
      link.href = file.dataUrl;
      link.download = file.filename;
      link.click();
    }
  };

  return (
    <>
      <FileViewerHeader
        file={file}
        onRevealInTree={onRevealInTree}
        rightContent={
          <button className="file-viewer-download-btn" onClick={handleDownload} title="Download">
            ⬇️ Download
          </button>
        }
      />
      <div className="file-viewer-image-wrapper">
        {file.dataUrl ? (
          <img
            src={file.dataUrl}
            alt={file.filename}
            className="file-viewer-image"
          />
        ) : (
          <div className="file-viewer-placeholder">Failed to load image</div>
        )}
      </div>
    </>
  );
}

/**
 * PDF file viewer
 */
function PdfFileViewer({ file, onRevealInTree }: { file: FileData; onRevealInTree?: (path: string) => void }) {
  const handleDownload = () => {
    if (file.dataUrl) {
      const link = document.createElement('a');
      link.href = file.dataUrl;
      link.download = file.filename;
      link.click();
    }
  };

  return (
    <>
      <FileViewerHeader
        file={file}
        onRevealInTree={onRevealInTree}
        rightContent={
          <button className="file-viewer-download-btn" onClick={handleDownload} title="Download">
            ⬇️ Download
          </button>
        }
      />
      <div className="file-viewer-pdf-wrapper">
        {file.dataUrl ? (
          <iframe
            src={file.dataUrl}
            title={file.filename}
            className="file-viewer-pdf"
          />
        ) : (
          <div className="file-viewer-placeholder">Failed to load PDF</div>
        )}
      </div>
    </>
  );
}

/**
 * Binary file viewer (download only)
 */
function BinaryFileViewer({ file, onRevealInTree }: { file: FileData; onRevealInTree?: (path: string) => void }) {
  const handleDownload = () => {
    if (file.dataUrl) {
      const link = document.createElement('a');
      link.href = file.dataUrl;
      link.download = file.filename;
      link.click();
    }
  };

  // Get icon based on extension
  const getIcon = () => {
    const ext = file.extension.toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) return '📊';
    if (['.docx', '.doc'].includes(ext)) return '📝';
    if (['.pptx', '.ppt'].includes(ext)) return '📽️';
    if (['.zip', '.tar', '.gz', '.rar', '.7z'].includes(ext)) return '🗜️';
    if (['.mp3', '.wav', '.flac', '.ogg'].includes(ext)) return '🎵';
    if (['.mp4', '.avi', '.mov', '.mkv', '.webm'].includes(ext)) return '🎬';
    if (['.exe', '.dmg', '.app', '.msi'].includes(ext)) return '⚙️';
    if (['.apk', '.aab', '.ipa'].includes(ext)) return '📱';
    if (['.jar', '.war', '.ear'].includes(ext)) return '☕';
    if (['.iso', '.img'].includes(ext)) return '💿';
    if (['.so', '.dll', '.dylib'].includes(ext)) return '🔧';
    return '📁';
  };

  return (
    <>
      <FileViewerHeader file={file} onRevealInTree={onRevealInTree} />
      <div className="file-viewer-binary">
        <div className="file-viewer-binary-icon">{getIcon()}</div>
        <div className="file-viewer-binary-name">{file.filename}</div>
        <div className="file-viewer-binary-size">{formatFileSize(file.size)}</div>
        <div className="file-viewer-binary-message">
          This file type cannot be previewed
        </div>
        <button className="file-viewer-download-btn large" onClick={handleDownload}>
          ⬇️ Download File
        </button>
      </div>
    </>
  );
}

// ============================================================================
// FILE VIEWER COMPONENT
// ============================================================================

function FileViewerComponent({ file, loading, error, onRevealInTree, scrollToLine }: FileViewerProps) {
  // Global markdown render preference (persisted to localStorage)
  const [renderMarkdown, toggleRenderMarkdown] = useMarkdownRenderPreference();
  const [renderPlantUml, toggleRenderPlantUml] = usePlantUmlRenderPreference();

  // Loading state
  if (loading) {
    return <div className="file-viewer-placeholder">Loading...</div>;
  }

  // Error state
  if (error) {
    return <div className="file-viewer-placeholder error">{error}</div>;
  }

  // Empty state
  if (!file) {
    return (
      <div className="file-viewer-placeholder">
        <div className="placeholder-icon">📂</div>
        <div className="placeholder-text">Select a file to view</div>
      </div>
    );
  }

  // Render based on file type
  const fileType = file.fileType || 'text';
  const isMarkdown = fileType === 'text' && isMarkdownFile(file.extension);
  const isPlantUml = fileType === 'text' && isPlantUmlFile(file.extension);

  return (
    <div className="file-viewer-content">
      {fileType === 'text' && isMarkdown && (
        <MarkdownFileViewer
          file={file}
          onRevealInTree={onRevealInTree}
          renderMarkdown={renderMarkdown}
          onToggleRender={toggleRenderMarkdown}
        />
      )}
      {fileType === 'text' && isPlantUml && !isMarkdown && (
        <PlantUmlFileViewer
          file={file}
          onRevealInTree={onRevealInTree}
          renderPlantUml={renderPlantUml}
          onToggleRender={toggleRenderPlantUml}
        />
      )}
      {fileType === 'text' && !isMarkdown && !isPlantUml && <TextFileViewer file={file} onRevealInTree={onRevealInTree} scrollToLine={scrollToLine} />}
      {fileType === 'image' && <ImageFileViewer file={file} onRevealInTree={onRevealInTree} />}
      {fileType === 'pdf' && <PdfFileViewer file={file} onRevealInTree={onRevealInTree} />}
      {fileType === 'binary' && <BinaryFileViewer file={file} onRevealInTree={onRevealInTree} />}
    </div>
  );
}

/**
 * Memoized FileViewer component
 * Prevents unnecessary re-renders when file hasn't changed
 */
export const FileViewer = memo(FileViewerComponent, (prev, next) => {
  // Re-render only if file, loading, error, or scrollToLine changed
  if (prev.loading !== next.loading) return false;
  if (prev.error !== next.error) return false;
  if (prev.scrollToLine !== next.scrollToLine) return false;

  // Deep compare file object
  if (prev.file === null && next.file === null) return true;
  if (prev.file === null || next.file === null) return false;

  return (
    prev.file.path === next.file.path &&
    prev.file.content === next.file.content &&
    prev.file.modified === next.file.modified
  );
});

FileViewer.displayName = 'FileViewer';
