/**
 * GitFileHistoryModal - Per-file git history viewer
 *
 * Opens from the file-explorer "Show Git History" context menu action.
 * Lists the commits that touched a file on the left, and renders the
 * commit's diff for that file on the right via the in-house DiffViewer.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalPortal } from './shared/ModalPortal';
import { DiffViewer } from './DiffViewer';
import { Icon } from './Icon';
import {
  fetchFileGitHistory,
  fetchCommitFileDiff,
  type GitFileHistoryCommit,
  type GitCommitFileDiffResponse,
} from '../api/git-history';
import '../styles/components/git-file-history-modal.scss';

export interface GitFileHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string;
  cwd: string;
}

const HISTORY_LIMIT = 100;

function formatRelativeDate(iso: string): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const diffMs = Date.now() - ts;
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMon = Math.round(diffDay / 30);
  if (diffMon < 12) return `${diffMon}mo ago`;
  const diffYr = Math.round(diffMon / 12);
  return `${diffYr}y ago`;
}

function basename(path: string): string {
  if (!path) return '';
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export function GitFileHistoryModal({ isOpen, onClose, filePath, cwd }: GitFileHistoryModalProps) {
  const { t } = useTranslation(['terminal', 'common']);

  const [commits, setCommits] = useState<GitFileHistoryCommit[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [diff, setDiff] = useState<GitCommitFileDiffResponse | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  // Reset state when the modal opens for a (possibly different) file
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setCommits([]);
    setSelectedSha(null);
    setDiff(null);
    setDiffError(null);
    setHistoryError(null);
    setLoadingHistory(true);

    (async () => {
      try {
        const data = await fetchFileGitHistory({ path: filePath, cwd, limit: HISTORY_LIMIT });
        if (cancelled) return;
        setCommits(data.commits);
        if (data.commits.length > 0) {
          setSelectedSha(data.commits[0].sha);
        }
      } catch (err) {
        if (cancelled) return;
        setHistoryError(err instanceof Error ? err.message : t('terminal:fileGitHistory.error'));
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, filePath, cwd, t]);

  // Load diff whenever the selected commit changes
  useEffect(() => {
    if (!isOpen || !selectedSha) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setLoadingDiff(true);
    setDiffError(null);
    setDiff(null);

    (async () => {
      try {
        const data = await fetchCommitFileDiff({ path: filePath, cwd, sha: selectedSha });
        if (cancelled) return;
        setDiff(data);
      } catch (err) {
        if (cancelled) return;
        setDiffError(err instanceof Error ? err.message : t('terminal:fileGitHistory.error'));
      } finally {
        if (!cancelled) setLoadingDiff(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedSha, filePath, cwd, t]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [onClose]);

  const filename = useMemo(() => basename(filePath), [filePath]);

  const renderDiffArea = () => {
    if (loadingDiff) {
      return (
        <div className="git-file-history-loading">
          <div className="spinner" />
          <p>{t('terminal:fileGitHistory.loading')}</p>
        </div>
      );
    }
    if (diffError) {
      return (
        <div className="git-file-history-empty">
          <Icon name="warn" size={20} />
          <p>{diffError}</p>
        </div>
      );
    }
    if (!diff) {
      return (
        <div className="git-file-history-empty">
          <p>{t('terminal:fileGitHistory.selectCommit')}</p>
        </div>
      );
    }
    if (diff.binary) {
      return (
        <div className="git-file-history-empty">
          <Icon name="file" size={20} />
          <p>{t('terminal:fileGitHistory.binaryFile')}</p>
        </div>
      );
    }
    return (
      <DiffViewer
        originalContent={diff.originalContent}
        modifiedContent={diff.modifiedContent}
        filename={diff.filename || filename}
        language={diff.language}
      />
    );
  };

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div className={`modal-overlay visible`} onClick={onClose}>
        <div
          className="git-file-history-modal"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleKeyDown}
          tabIndex={-1}
        >
          <div className="modal-header">
            <div className="git-file-history-title">
              <h2>{t('terminal:fileGitHistory.title')}</h2>
              <span className="git-file-history-filepath" title={filePath}>{filename}</span>
            </div>
            <button className="modal-close" onClick={onClose} aria-label="Close">
              <Icon name="close" size={16} />
            </button>
          </div>

          <div className="git-file-history-body">
            <aside className="git-file-history-commit-list" aria-label={t('terminal:fileGitHistory.title')}>
              {loadingHistory ? (
                <div className="git-file-history-loading">
                  <div className="spinner" />
                  <p>{t('terminal:fileGitHistory.loading')}</p>
                </div>
              ) : historyError ? (
                <div className="git-file-history-empty">
                  <Icon name="warn" size={18} />
                  <p>{historyError}</p>
                </div>
              ) : commits.length === 0 ? (
                <div className="git-file-history-empty">
                  <p>{t('terminal:fileGitHistory.empty')}</p>
                </div>
              ) : (
                <ul className="git-file-history-commits" role="listbox">
                  {commits.map((commit) => {
                    const isSelected = commit.sha === selectedSha;
                    return (
                      <li
                        key={commit.sha}
                        className={`git-file-history-commit ${isSelected ? 'selected' : ''}`}
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => setSelectedSha(commit.sha)}
                      >
                        <div className="git-file-history-commit-row">
                          <span className="git-file-history-sha">{commit.shortSha}</span>
                          <span className="git-file-history-date" title={commit.date}>
                            {formatRelativeDate(commit.date)}
                          </span>
                        </div>
                        <div className="git-file-history-subject" title={commit.subject}>
                          {commit.subject}
                        </div>
                        <div className="git-file-history-author" title={commit.email}>
                          {commit.author}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </aside>

            <section className="git-file-history-diff" aria-live="polite">
              {renderDiffArea()}
            </section>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
