import React, { useEffect, useState } from 'react';
import { apiUrl, authFetch } from '../../utils/storage';
import { store } from '../../store';
import { DiffViewer } from '../DiffViewer';
import { Icon } from '../Icon';
import { getLanguageForExtension } from '../FileExplorerPanel/syntaxHighlighting';
import { useModalStackRegistration } from '../../hooks/useModalStack';

export interface SpotlightFileDetail {
  filePath: string;
  projectRoot: string;
  targetLine?: number;
  searchQuery?: string;
}

interface LoadedFile {
  filename: string;
  content: string;
  originalContent: string | null;
  binary: boolean;
}

interface SpotlightFileDetailModalProps {
  detail: SpotlightFileDetail;
  onClose: () => void;
}

export function SpotlightFileDetailModal({ detail, onClose }: SpotlightFileDetailModalProps) {
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useModalStackRegistration('spotlight-file-detail', true, onClose);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setFile(null);

    const load = async () => {
      try {
        const currentResponse = await authFetch(
          apiUrl(`/api/files/read?path=${encodeURIComponent(detail.filePath)}`),
          { signal: controller.signal }
        );
        const current = await currentResponse.json();
        if (!currentResponse.ok) throw new Error(current.error || 'Unable to read file');

        let originalContent: string | null = null;
        if (!current.binary) {
          try {
            const originalResponse = await authFetch(
              apiUrl(`/api/files/git-original?path=${encodeURIComponent(detail.filePath)}`),
              { signal: controller.signal }
            );
            const original = await originalResponse.json();
            if (originalResponse.ok && !original.binary && typeof original.content === 'string') {
              originalContent = original.content;
            }
          } catch {
            // A file outside git (or an untracked file) is still valid content.
          }
        }

        if (!controller.signal.aborted) {
          setFile({
            filename: current.filename || detail.filePath.split('/').pop() || detail.filePath,
            content: typeof current.content === 'string' ? current.content : '',
            originalContent,
            binary: current.binary === true,
          });
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Unable to load file');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void load();
    return () => controller.abort();
  }, [detail.filePath]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  const openInExplorer = () => {
    store.revealFileInExplorer(detail.filePath, detail.projectRoot, detail.targetLine);
    onClose();
  };

  const languagePath = file?.filename || detail.filePath;
  const languageExtension = languagePath.lastIndexOf('.') >= 0
    ? languagePath.slice(languagePath.lastIndexOf('.'))
    : '';
  const language = getLanguageForExtension(languageExtension);
  const hasDiff = file?.originalContent != null && file.originalContent !== file.content;

  return (
    <div className="guake-git-diff-modal-overlay" onClick={onClose}>
      <div className="guake-git-diff-modal" onClick={(event) => event.stopPropagation()}>
        <div className="guake-git-diff-modal-header">
          <div className="guake-git-diff-path spotlight-file-detail-path" title={detail.filePath}>
            {detail.filePath}
            {detail.targetLine ? <span className="spotlight-file-detail-line">:{detail.targetLine}</span> : null}
          </div>
          <button
            type="button"
            className="spotlight-file-detail-explorer"
            onClick={openInExplorer}
            title="Open in File Explorer"
          >
            <Icon name="folder-open" size={14} />
            Open in File Explorer
          </button>
          <button className="guake-git-close" onClick={onClose} title="Close (Esc)">
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="guake-git-diff-content">
          {loading && (
            <div className="guake-git-diff-loading-overlay">
              <div className="diff-image-spinner" />
            </div>
          )}
          {error && <div className="spotlight-file-detail-message">{error}</div>}
          {file?.binary && (
            <div className="spotlight-file-detail-message">
              Binary preview is available in the File Explorer.
            </div>
          )}
          {file && !file.binary && (hasDiff ? (
            <DiffViewer
              originalContent={file.originalContent || ''}
              modifiedContent={file.content}
              filename={file.filename}
              filePath={detail.filePath}
              language={language}
              searchQuery={detail.searchQuery}
              targetLine={detail.targetLine}
            />
          ) : (
            <DiffViewer
              originalContent=""
              modifiedContent={file.content}
              filename={file.filename}
              filePath={detail.filePath}
              language={language}
              initialModifiedOnly
              searchQuery={detail.searchQuery}
              targetLine={detail.targetLine}
              readOnly
            />
          ))}
        </div>
      </div>
    </div>
  );
}
