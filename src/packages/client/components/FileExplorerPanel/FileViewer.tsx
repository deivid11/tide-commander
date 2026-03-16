/**
 * FileViewer - File content viewer with syntax highlighting
 *
 * Displays file content with CodeMirror 6 (read-only) for text files.
 * Supports text files, images, PDFs, and binary downloads.
 * Markdown files can be rendered or viewed as source code.
 */

import React, { useEffect, useRef, memo, useState, useCallback, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { FileViewerProps, FileData } from './types';
import { formatFileSize } from './fileUtils';
import { highlightElement, getLanguageForExtension, ensureLanguageLoaded } from './syntaxHighlighting';
import { apiUrl, authFetch } from '../../utils/storage';
import { copyRichContentToClipboard, copyTextToClipboard } from '../../utils/clipboard';
import { useStore } from '../../store';
import { useLessNavigation } from '../../hooks/useLessNavigation';
import { SearchBar } from './SearchBar';
import { KeybindingsHelp } from './KeybindingsHelp';

// CodeMirror imports for read-only viewer
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language';
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { oneDark } from '@codemirror/theme-one-dark';
import { getLanguageExtension } from './cm-languages';

// Lazy-load the editor to avoid loading CodeMirror until needed
const LazyEmbeddedEditor = lazy(() => import('./EmbeddedEditor').then(m => ({ default: m.EmbeddedEditor })));

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
  editMode,
  onToggleEdit,
}: {
  file: FileData;
  rightContent?: React.ReactNode;
  onRevealInTree?: (path: string) => void;
  editMode?: boolean;
  onToggleEdit?: () => void;
}) {
  const { t } = useTranslation(['terminal', 'common']);
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
        {onToggleEdit && file.fileType === 'text' && (
          <button
            className={`file-viewer-edit-btn${editMode ? ' active' : ''}`}
            onClick={onToggleEdit}
            title={editMode ? t('terminal:fileExplorer.exitEdit') : t('terminal:fileExplorer.editFile')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25a1.75 1.75 0 01.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 00-.354 0L3.463 11.1a.25.25 0 00-.064.108l-.558 1.953 1.953-.558a.25.25 0 00.108-.064l8.61-8.61a.25.25 0 000-.354l-1.086-1.086z" />
            </svg>
          </button>
        )}
        <button
          className={`file-viewer-open-editor-btn ${openEditorStatus}`}
          onClick={handleOpenInEditor}
          disabled={openEditorStatus === 'loading'}
          title={openEditorStatus === 'error' ? t('terminal:fileExplorer.failedToOpenEditor') : openEditorStatus === 'success' ? t('terminal:fileExplorer.openingInEditor') : t('terminal:fileExplorer.openInEditor')}
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
            title={t('terminal:fileExplorer.locateInTree')}
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
 * Text file viewer using CodeMirror 6 in read-only mode.
 * Uses CM's built-in search (Ctrl+F / Cmd+F) instead of a custom search bar.
 */
function TextFileViewer({ file, onRevealInTree, scrollToLine, onSearchStateChange: _onSearchStateChange, editMode, onToggleEdit }: { file: FileData; onRevealInTree?: (path: string) => void; scrollToLine?: number; onSearchStateChange?: (isSearchActive: boolean) => void; editMode?: boolean; onToggleEdit?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Create / recreate the read-only CodeMirror instance when file changes
  useEffect(() => {
    if (!containerRef.current) return;

    const langExt = getLanguageExtension(file.extension);

    const extensions: import('@codemirror/state').Extension[] = [
      EditorState.readOnly.of(true),
      lineNumbers(),
      highlightActiveLineGutter(),
      foldGutter(),
      drawSelection(),
      bracketMatching(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      oneDark,
      search({ top: true }),
      keymap.of([
        ...defaultKeymap,
        ...searchKeymap,
        ...foldKeymap,
      ]),
    ];

    if (langExt) {
      extensions.push(langExt);
    }

    const state = EditorState.create({
      doc: file.content,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [file.path, file.content, file.extension]);

  // Scroll to target line when scrollToLine changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !scrollToLine) return;

    requestAnimationFrame(() => {
      const line = view.state.doc.line(Math.min(scrollToLine, view.state.doc.lines));
      view.dispatch({
        effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
      });
    });
  }, [scrollToLine]);

  // Handle Ctrl+F on the wrapper since read-only CM may not always have focus
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      e.stopPropagation();
      const view = viewRef.current;
      if (view) {
        view.focus();
        openSearchPanel(view);
        // Ensure the search input gets focus after the panel renders
        requestAnimationFrame(() => {
          const input = view.dom.querySelector<HTMLInputElement>('.cm-search input[main-field]');
          if (input) input.focus();
        });
      }
    }
  }, []);

  return (
    <>
      <FileViewerHeader file={file} onRevealInTree={onRevealInTree} editMode={editMode} onToggleEdit={onToggleEdit} />
      <div
        className="file-viewer-content-wrapper file-viewer-cm-readonly"
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      />
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
  editMode,
  onToggleEdit,
}: {
  file: FileData;
  onRevealInTree?: (path: string) => void;
  renderMarkdown: boolean;
  onToggleRender: () => void;
  editMode?: boolean;
  onToggleEdit?: () => void;
}) {
  const codeRef = useRef<HTMLElement>(null);
  const markdownContentRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation(['terminal', 'common']);
  const [copyRichTextStatus, setCopyRichTextStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [copyHtmlStatus, setCopyHtmlStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [copyMarkdownStatus, setCopyMarkdownStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [copyOriginalStatus, setCopyOriginalStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  // Setup less-style keyboard navigation
  const navigation = useLessNavigation({
    containerRef: contentRef as React.RefObject<HTMLDivElement>,
    isEnabled: true,
    content: file.content,
  });

  useEffect(() => {
    // Apply syntax highlighting when showing source code
    if (!renderMarkdown && codeRef.current) {
      const lang = getLanguageForExtension(file.extension);
      ensureLanguageLoaded(lang).then(() => {
        if (codeRef.current) {
          highlightElement(codeRef.current);
        }
      });
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
      await copyRichContentToClipboard(html, plainText);

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
      await copyTextToClipboard(html);
      setCopyHtmlStatus('copied');
      setTimeout(() => setCopyHtmlStatus('idle'), 2000);
    } catch {
      setCopyHtmlStatus('error');
      setTimeout(() => setCopyHtmlStatus('idle'), 2000);
    }
  }, []);

  // Copy as markdown source
  const handleCopyMarkdown = useCallback(async () => {
    try {
      await copyTextToClipboard(file.content);
      setCopyMarkdownStatus('copied');
      setTimeout(() => setCopyMarkdownStatus('idle'), 2000);
    } catch {
      setCopyMarkdownStatus('error');
      setTimeout(() => setCopyMarkdownStatus('idle'), 2000);
    }
  }, [file.content]);

  // Copy original file content (plain text)
  const handleCopyOriginal = useCallback(async () => {
    try {
      await copyTextToClipboard(file.content);
      setCopyOriginalStatus('copied');
      setTimeout(() => setCopyOriginalStatus('idle'), 2000);
    } catch {
      setCopyOriginalStatus('error');
      setTimeout(() => setCopyOriginalStatus('idle'), 2000);
    }
  }, [file.content]);

  const headerButtons = (
    <div className="file-viewer-header-buttons">
      {renderMarkdown && (
        <>
          <button
            className={`file-viewer-copy-html-btn ${copyRichTextStatus}`}
            onClick={handleCopyRichText}
            title={t('terminal:fileExplorer.copyRichTextTitle')}
          >
            {copyRichTextStatus === 'copied' ? t('terminal:fileExplorer.copied') : copyRichTextStatus === 'error' ? t('terminal:fileExplorer.copyError') : t('terminal:fileExplorer.copyRichText')}
          </button>
          <button
            className={`file-viewer-copy-html-btn ${copyHtmlStatus}`}
            onClick={handleCopyHtml}
            title={t('terminal:fileExplorer.copyHtmlTitle')}
          >
            {copyHtmlStatus === 'copied' ? t('terminal:fileExplorer.copied') : copyHtmlStatus === 'error' ? t('terminal:fileExplorer.copyError') : t('terminal:fileExplorer.copyHtml')}
          </button>
          <button
            className={`file-viewer-copy-html-btn ${copyMarkdownStatus}`}
            onClick={handleCopyMarkdown}
            title={t('terminal:fileExplorer.copyMarkdownTitle')}
          >
            {copyMarkdownStatus === 'copied' ? t('terminal:fileExplorer.copied') : copyMarkdownStatus === 'error' ? t('terminal:fileExplorer.copyError') : t('terminal:fileExplorer.copyMarkdown')}
          </button>
          <button
            className={`file-viewer-copy-html-btn ${copyOriginalStatus}`}
            onClick={handleCopyOriginal}
            title={t('terminal:fileExplorer.copyOriginalTitle')}
          >
            {copyOriginalStatus === 'copied' ? t('terminal:fileExplorer.copied') : copyOriginalStatus === 'error' ? t('terminal:fileExplorer.copyError') : t('terminal:fileExplorer.copyOriginal')}
          </button>
        </>
      )}
      <button
        className={`file-viewer-render-toggle ${renderMarkdown ? 'active' : ''}`}
        onClick={onToggleRender}
        title={renderMarkdown ? t('terminal:fileExplorer.showSource') : t('terminal:fileExplorer.renderMarkdown')}
      >
        {renderMarkdown ? '</>' : 'Aa'}
      </button>
    </div>
  );

  return (
    <>
      <FileViewerHeader file={file} onRevealInTree={onRevealInTree} rightContent={headerButtons} editMode={editMode} onToggleEdit={onToggleEdit} />
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
  editMode,
  onToggleEdit,
}: {
  file: FileData;
  onRevealInTree?: (path: string) => void;
  renderPlantUml: boolean;
  onToggleRender: () => void;
  editMode?: boolean;
  onToggleEdit?: () => void;
}) {
  const { t } = useTranslation(['terminal']);
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
      const lang = getLanguageForExtension(file.extension);
      ensureLanguageLoaded(lang).then(() => {
        if (codeRef.current) {
          highlightElement(codeRef.current);
        }
      });
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
        title={renderPlantUml ? t('terminal:fileExplorer.showSource') : t('terminal:fileExplorer.renderDiagram')}
      >
        {renderPlantUml ? '</>' : t('terminal:fileExplorer.diagram')}
      </button>
    </div>
  );

  return (
    <>
      <FileViewerHeader file={file} onRevealInTree={onRevealInTree} rightContent={headerButtons} editMode={editMode} onToggleEdit={onToggleEdit} />
      <div className="file-viewer-content-wrapper" ref={contentRef}>
        {renderPlantUml ? (
          <div className="file-viewer-diagram-wrapper">
            {isRendering && <div className="file-viewer-placeholder">{t('terminal:fileExplorer.renderingDiagram')}</div>}
            {!isRendering && diagramDataUrl && (
              <img
                src={diagramDataUrl}
                alt={file.filename}
                className="file-viewer-diagram-image"
              />
            )}
            {!isRendering && renderError && (
              <div className="file-viewer-diagram-error">
                <div>{t('terminal:fileExplorer.couldNotRender')}: {renderError}</div>
                <button className="file-viewer-render-toggle" onClick={onToggleRender}>
                  {t('terminal:fileExplorer.showSource')}
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
  const { t } = useTranslation(['common', 'terminal']);
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
          <button className="file-viewer-download-btn" onClick={handleDownload} title={t('common:buttons.download')}>
            {t('common:buttons.download')}
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
          <div className="file-viewer-placeholder">{t('terminal:fileExplorer.failedToLoadImage')}</div>
        )}
      </div>
    </>
  );
}

/**
 * PDF file viewer
 */
function PdfFileViewer({ file, onRevealInTree }: { file: FileData; onRevealInTree?: (path: string) => void }) {
  const { t } = useTranslation(['common', 'terminal']);
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
          <button className="file-viewer-download-btn" onClick={handleDownload} title={t('common:buttons.download')}>
            {t('common:buttons.download')}
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
          <div className="file-viewer-placeholder">{t('terminal:fileExplorer.failedToLoadPdf')}</div>
        )}
      </div>
    </>
  );
}

/**
 * Binary file viewer (download only)
 */
function BinaryFileViewer({ file, onRevealInTree }: { file: FileData; onRevealInTree?: (path: string) => void }) {
  const { t } = useTranslation(['terminal', 'common']);
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
          {t('terminal:fileExplorer.cannotPreview')}
        </div>
        <button className="file-viewer-download-btn large" onClick={handleDownload}>
          {t('terminal:fileExplorer.downloadFile')}
        </button>
      </div>
    </>
  );
}

// ============================================================================
// FILE VIEWER COMPONENT
// ============================================================================

function FileViewerComponent({ file, loading, error, onRevealInTree, scrollToLine, onSearchStateChange, onFileEdited }: FileViewerProps) {
  const { t } = useTranslation(['terminal', 'common']);
  // Global markdown render preference (persisted to localStorage)
  const [renderMarkdown, toggleRenderMarkdown] = useMarkdownRenderPreference();
  const [renderPlantUml, toggleRenderPlantUml] = usePlantUmlRenderPreference();
  const [editMode, setEditMode] = useState(false);
  useEffect(() => { setEditMode(false); }, [file?.path]);
  const handleSave = useCallback(async (newContent: string) => { if (!file) return; const resp = await authFetch(apiUrl('/api/files/write'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: file.path, content: newContent }) }); if (!resp.ok) { const errData = await resp.json().catch(() => ({ error: 'Save failed' })); throw new Error(errData.error || 'Save failed'); } }, [file]);
  const toggleEdit = useCallback(() => { setEditMode(prev => { if (prev && file) { onFileEdited?.(file.path); } return !prev; }); }, [file, onFileEdited]);

  // Loading state
  if (loading) {
    return <div className="file-viewer-placeholder">{t('common:status.loading')}</div>;
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
        <div className="placeholder-text">{t('terminal:fileExplorer.selectFileToView')}</div>
      </div>
    );
  }

  // Render based on file type
  const fileType = file.fileType || 'text';
  const isMarkdown = fileType === 'text' && isMarkdownFile(file.extension);
  const isPlantUml = fileType === 'text' && isPlantUmlFile(file.extension);

  // Edit mode — show embedded editor for text files
  if (editMode && fileType === 'text' && file.content != null) {
    return (
      <div className="file-viewer-content">
        <FileViewerHeader file={file} onRevealInTree={onRevealInTree} editMode onToggleEdit={toggleEdit} />
        <Suspense fallback={<div className="file-viewer-placeholder">{t('common:status.loading')}</div>}>
          <LazyEmbeddedEditor
            content={file.content}
            extension={file.extension}
            onSave={handleSave}
            onCancel={toggleEdit}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="file-viewer-content">
      {fileType === 'text' && isMarkdown && (
        <MarkdownFileViewer
          file={file}
          onRevealInTree={onRevealInTree}
          renderMarkdown={renderMarkdown}
          onToggleRender={toggleRenderMarkdown}
          editMode={editMode}
          onToggleEdit={toggleEdit}
        />
      )}
      {fileType === 'text' && isPlantUml && !isMarkdown && (
        <PlantUmlFileViewer
          file={file}
          onRevealInTree={onRevealInTree}
          renderPlantUml={renderPlantUml}
          onToggleRender={toggleRenderPlantUml}
          editMode={editMode}
          onToggleEdit={toggleEdit}
        />
      )}
      {fileType === 'text' && !isMarkdown && !isPlantUml && <TextFileViewer file={file} onRevealInTree={onRevealInTree} scrollToLine={scrollToLine} onSearchStateChange={onSearchStateChange} editMode={editMode} onToggleEdit={toggleEdit} />}
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
