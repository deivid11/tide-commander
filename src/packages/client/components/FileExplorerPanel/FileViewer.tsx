/**
 * FileViewer - File content viewer
 *
 * Markdown and PlantUML files open in a rendered preview by default with an
 * Edit button that swaps in the embedded CodeMirror editor.
 * Other text files always open directly in the editor.
 * Images, PDFs, and binary files have their own dedicated viewers.
 */

import React, { memo, useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { FileViewerProps, FileData } from './types';
import { formatFileSize } from './fileUtils';
import { highlightElement, getLanguageForExtension, ensureLanguageLoaded } from './syntaxHighlighting';
import { apiUrl, authFetch } from '../../utils/storage';
import { copyRichContentToClipboard, copyTextToClipboard, inlineStylesForRichCopy } from '../../utils/clipboard';
import { revealInFileExplorer } from '../../api/files';
import { useSettings } from '../../store';
import { useLessNavigation } from '../../hooks/useLessNavigation';
import { SearchBar } from './SearchBar';
import { KeybindingsHelp } from './KeybindingsHelp';
import { Icon } from '../Icon';

const LazyEmbeddedEditor = lazy(() => import('./EmbeddedEditor').then(m => ({ default: m.EmbeddedEditor })));

const MARKDOWN_EXTENSIONS = ['.md', '.mdx', '.markdown'];
const MARKDOWN_RENDER_STORAGE_KEY = 'file-viewer-markdown-render';
const PLANTUML_EXTENSIONS = ['.puml', '.plantuml', '.iuml', '.pu'];
const PLANTUML_RENDER_STORAGE_KEY = 'file-viewer-plantuml-render';
const PLANTUML_RENDER_ENDPOINT = 'https://kroki.io/plantuml/svg';

function isMarkdownFile(extension: string): boolean {
  return MARKDOWN_EXTENSIONS.includes(extension.toLowerCase());
}

function isPlantUmlFile(extension: string): boolean {
  return PLANTUML_EXTENSIONS.includes(extension.toLowerCase());
}

function useMarkdownRenderPreference(): [boolean, () => void] {
  const [renderMarkdown, setRenderMarkdown] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(MARKDOWN_RENDER_STORAGE_KEY);
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
        // ignore
      }
      return newValue;
    });
  }, []);

  return [renderMarkdown, toggleRender];
}

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
        // ignore
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
  const [revealStatus, setRevealStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [copyAllStatus, setCopyAllStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const language = file.fileType === 'text' ? getLanguageForExtension(file.extension) : file.extension.slice(1).toUpperCase();

  // Copy-all / download are only meaningful for text files (images/PDF/binary
  // expose their own Download button and carry no textual content).
  const canCopyOrDownloadText = file.fileType === 'text' && file.content != null;

  const settings = useSettings();

  const handleCopyAll = async () => {
    try {
      await copyTextToClipboard(file.content);
      setCopyAllStatus('copied');
      setTimeout(() => setCopyAllStatus('idle'), 2000);
    } catch {
      setCopyAllStatus('error');
      setTimeout(() => setCopyAllStatus('idle'), 2000);
    }
  };

  const handleDownloadTextFile = () => {
    const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

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

  const handleRevealInFileExplorer = async () => {
    if (!file.path) return;

    try {
      await revealInFileExplorer(file.path);
      setRevealStatus('success');
      setTimeout(() => setRevealStatus('idle'), 2000);
    } catch (err) {
      console.error('Error opening file explorer:', err);
      setRevealStatus('error');
      setTimeout(() => setRevealStatus('idle'), 2000);
    }
  };

  const openInFileExplorerLabel = t('terminal:fileExplorer.openInFileExplorer');

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
        {canCopyOrDownloadText && (
          <>
            <button
              className={`file-viewer-copy-html-btn ${copyAllStatus}`}
              onClick={handleCopyAll}
              title={t('terminal:fileExplorer.copyAllTitle')}
            >
              {copyAllStatus === 'copied'
                ? t('terminal:fileExplorer.copied')
                : copyAllStatus === 'error'
                  ? t('terminal:fileExplorer.copyError')
                  : t('terminal:fileExplorer.copyAll')}
            </button>
            <button
              className="file-viewer-download-btn"
              onClick={handleDownloadTextFile}
              title={t('terminal:fileExplorer.downloadFileTitle')}
            >
              {t('common:buttons.download')}
            </button>
          </>
        )}
        <button
          className={`file-viewer-reveal-explorer-btn ${revealStatus}`}
          onClick={handleRevealInFileExplorer}
          disabled={!file.path}
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
            <Icon name="target" size={14} />
          </button>
        )}
        {rightContent}
      </div>
    </div>
  );
}

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

  const navigation = useLessNavigation({
    containerRef: contentRef as React.RefObject<HTMLDivElement>,
    isEnabled: true,
    content: file.content,
  });

  useEffect(() => {
    if (!renderMarkdown && codeRef.current) {
      const lang = getLanguageForExtension(file.extension);
      ensureLanguageLoaded(lang).then(() => {
        if (codeRef.current) {
          highlightElement(codeRef.current);
        }
      });
    }
  }, [file, renderMarkdown]);

  const handleCopyRichText = useCallback(async () => {
    if (!markdownContentRef.current) {
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
    } catch {
      setCopyRichTextStatus('error');
      setTimeout(() => setCopyRichTextStatus('idle'), 2000);
    }
  }, []);

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
        <div className="file-viewer-scroll-indicator" title={`Line ${navigation.currentLine}/${navigation.totalLines}`}>
          {navigation.scrollPercentage === 100 ? 'END' : navigation.scrollPercentage === 0 ? 'TOP' : `${navigation.scrollPercentage}%`}
        </div>
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
      {navigation.helpActive && <KeybindingsHelp onClose={navigation.toggleHelp} />}
    </>
  );
}

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
        <div className="file-viewer-scroll-indicator" title={`Line ${navigation.currentLine}/${navigation.totalLines}`}>
          {navigation.scrollPercentage === 100 ? 'END' : navigation.scrollPercentage === 0 ? 'TOP' : `${navigation.scrollPercentage}%`}
        </div>
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
      {navigation.helpActive && <KeybindingsHelp onClose={navigation.toggleHelp} />}
    </>
  );
}

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

  const getIcon = () => {
    const ext = file.extension.toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) return <Icon name="dashboard" size={48} />;
    if (['.docx', '.doc'].includes(ext)) return <Icon name="edit" size={48} />;
    if (['.pptx', '.ppt'].includes(ext)) return <Icon name="film" size={48} />;
    if (['.zip', '.tar', '.gz', '.rar', '.7z'].includes(ext)) return <Icon name="file-zip" size={48} />;
    if (['.mp3', '.wav', '.flac', '.ogg'].includes(ext)) return <Icon name="music-note" size={48} />;
    if (['.mp4', '.avi', '.mov', '.mkv', '.webm'].includes(ext)) return <Icon name="film" size={48} />;
    if (['.exe', '.dmg', '.app', '.msi'].includes(ext)) return <Icon name="gear" size={48} />;
    if (['.apk', '.aab', '.ipa'].includes(ext)) return <Icon name="mobile" size={48} />;
    if (['.jar', '.war', '.ear'].includes(ext)) return <Icon name="coffee" size={48} />;
    if (['.iso', '.img'].includes(ext)) return <Icon name="disc" size={48} />;
    if (['.so', '.dll', '.dylib'].includes(ext)) return <Icon name="wrench" size={48} />;
    return <Icon name="folder" size={48} />;
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

function FileViewerComponent({ file, loading, error, onRevealInTree, onFileEdited }: FileViewerProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [renderMarkdown, toggleRenderMarkdown] = useMarkdownRenderPreference();
  const [renderPlantUml, toggleRenderPlantUml] = usePlantUmlRenderPreference();
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    setEditMode(false);
  }, [file?.path]);

  const handleSave = useCallback(async (newContent: string) => {
    if (!file) return;
    const resp = await authFetch(apiUrl('/api/files/write'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: file.path, content: newContent }),
    });
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({ error: 'Save failed' }));
      throw new Error(errData.error || 'Save failed');
    }
  }, [file]);

  const toggleEdit = useCallback(() => {
    setEditMode((prev) => {
      if (prev && file) onFileEdited?.(file.path);
      return !prev;
    });
  }, [file, onFileEdited]);

  const handlePlainEditorClose = useCallback(() => {
    if (file) onFileEdited?.(file.path);
  }, [file, onFileEdited]);

  if (loading) {
    return <div className="file-viewer-placeholder">{t('common:status.loading')}</div>;
  }

  if (error) {
    return <div className="file-viewer-placeholder error">{error}</div>;
  }

  if (!file) {
    return (
      <div className="file-viewer-placeholder">
        <div className="placeholder-icon"><Icon name="folder-open" size={32} /></div>
        <div className="placeholder-text">{t('terminal:fileExplorer.selectFileToView')}</div>
      </div>
    );
  }

  const fileType = file.fileType || 'text';
  const isMarkdown = fileType === 'text' && isMarkdownFile(file.extension);
  const isPlantUml = fileType === 'text' && isPlantUmlFile(file.extension);
  const hasRenderablePreview = isMarkdown || isPlantUml;

  if (hasRenderablePreview && editMode && file.content != null) {
    return (
      <div className="file-viewer-content">
        <FileViewerHeader file={file} onRevealInTree={onRevealInTree} editMode onToggleEdit={toggleEdit} />
        <Suspense fallback={<div className="file-viewer-placeholder">{t('common:status.loading')}</div>}>
          <LazyEmbeddedEditor
            key={file.path}
            content={file.content}
            extension={file.extension}
            onSave={handleSave}
            onCancel={toggleEdit}
          />
        </Suspense>
      </div>
    );
  }

  if (fileType === 'text' && !hasRenderablePreview && file.content != null) {
    return (
      <div className="file-viewer-content">
        <FileViewerHeader file={file} onRevealInTree={onRevealInTree} />
        <Suspense fallback={<div className="file-viewer-placeholder">{t('common:status.loading')}</div>}>
          <LazyEmbeddedEditor
            key={file.path}
            content={file.content}
            extension={file.extension}
            onSave={handleSave}
            onCancel={handlePlainEditorClose}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="file-viewer-content">
      {isMarkdown && (
        <MarkdownFileViewer
          file={file}
          onRevealInTree={onRevealInTree}
          renderMarkdown={renderMarkdown}
          onToggleRender={toggleRenderMarkdown}
          editMode={editMode}
          onToggleEdit={toggleEdit}
        />
      )}
      {isPlantUml && !isMarkdown && (
        <PlantUmlFileViewer
          file={file}
          onRevealInTree={onRevealInTree}
          renderPlantUml={renderPlantUml}
          onToggleRender={toggleRenderPlantUml}
          editMode={editMode}
          onToggleEdit={toggleEdit}
        />
      )}
      {fileType === 'image' && <ImageFileViewer file={file} onRevealInTree={onRevealInTree} />}
      {fileType === 'pdf' && <PdfFileViewer file={file} onRevealInTree={onRevealInTree} />}
      {fileType === 'binary' && <BinaryFileViewer file={file} onRevealInTree={onRevealInTree} />}
    </div>
  );
}

export const FileViewer = memo(FileViewerComponent, (prev, next) => {
  if (prev.loading !== next.loading) return false;
  if (prev.error !== next.error) return false;

  if (prev.file === null && next.file === null) return true;
  if (prev.file === null || next.file === null) return false;

  return (
    prev.file.path === next.file.path &&
    prev.file.content === next.file.content &&
    prev.file.modified === next.file.modified
  );
});

FileViewer.displayName = 'FileViewer';
