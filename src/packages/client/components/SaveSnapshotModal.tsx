/**
 * SaveSnapshotModal - Modal for saving a conversation snapshot
 *
 * Opens when user clicks the star button in terminal header.
 * Allows setting title, description, and shows preview of files to capture.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Agent } from '../../shared/types';
import type { TrackedFiles, CreateSnapshotRequest } from '../../shared/types/snapshot';

export interface SaveSnapshotModalProps {
  /** Whether modal is visible */
  isOpen: boolean;
  /** Callback to close modal */
  onClose: () => void;
  /** Agent being snapshotted */
  agent: Agent;
  /** Number of outputs in the conversation */
  outputCount: number;
  /** Tracked files that will be included */
  trackedFiles?: TrackedFiles;
  /** Callback when snapshot is saved */
  onSave: (request: CreateSnapshotRequest) => Promise<void>;
  /** Whether save is in progress */
  isSaving?: boolean;
  /** Error message if save failed */
  error?: string;
}

export function SaveSnapshotModal({
  isOpen,
  onClose,
  agent,
  outputCount,
  trackedFiles,
  onSave,
  isSaving = false,
  error,
}: SaveSnapshotModalProps) {
  const { t } = useTranslation(['terminal', 'common']);

  // Generate default title with agent name and timestamp
  const generateDefaultTitle = useCallback(() => {
    const date = new Date();
    const dateStr = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${agent.name} - ${dateStr}`;
  }, [agent.name]);

  const [title, setTitle] = useState(generateDefaultTitle());
  const [description, setDescription] = useState('');

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setTitle(generateDefaultTitle());
      setDescription('');
    }
  }, [isOpen, generateDefaultTitle]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    await onSave({
      agentId: agent.id,
      title: title.trim(),
      description: description.trim() || undefined,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  const files = trackedFiles?.files || [];
  const createdFiles = files.filter((f) => f.type === 'created');
  const modifiedFiles = files.filter((f) => f.type === 'modified');

  return (
    <div className="modal-overlay visible" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="modal snapshot-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="snapshot-modal-icon">⭐</span>
          {t('terminal:snapshot.save')}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {/* Title input */}
            <div className="snapshot-field">
              <label className="snapshot-label">
                {t('common:labels.title')} <span className="snapshot-required">*</span>
              </label>
              <input
                type="text"
                className="snapshot-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('terminal:snapshot.enterTitle')}
                autoFocus
                disabled={isSaving}
              />
            </div>

            {/* Description input */}
            <div className="snapshot-field">
              <label className="snapshot-label">
                {t('common:labels.description')} <span className="snapshot-optional">{t('common:labels.optional')}</span>
              </label>
              <textarea
                className="snapshot-textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('terminal:snapshot.whatWasAccomplished')}
                rows={3}
                disabled={isSaving}
              />
            </div>

            {/* Preview section */}
            <div className="snapshot-preview">
              <div className="snapshot-preview-header">{t('terminal:snapshot.whatWillBeCaptured')}</div>

              <div className="snapshot-preview-stats">
                <div className="snapshot-stat">
                  <span className="snapshot-stat-icon">💬</span>
                  <span className="snapshot-stat-value">{outputCount}</span>
                  <span className="snapshot-stat-label">{t('terminal:snapshot.messages')}</span>
                </div>
                <div className="snapshot-stat">
                  <span className="snapshot-stat-icon">📄</span>
                  <span className="snapshot-stat-value">{files.length}</span>
                  <span className="snapshot-stat-label">{t('terminal:snapshot.files')}</span>
                </div>
              </div>

              {/* File preview */}
              {files.length > 0 && (
                <div className="snapshot-files-preview">
                  {createdFiles.length > 0 && (
                    <div className="snapshot-file-group">
                      <div className="snapshot-file-group-label">
                        <span className="snapshot-file-type created">+</span>
                        {t('terminal:snapshot.createdFiles', { count: createdFiles.length })}
                      </div>
                      <div className="snapshot-file-list">
                        {createdFiles.slice(0, 5).map((file) => (
                          <div key={file.path} className="snapshot-file-item">
                            <span className="snapshot-file-path" title={file.path}>
                              {getFileName(file.path)}
                            </span>
                            {file.size !== undefined && (
                              <span className="snapshot-file-size">{formatFileSize(file.size)}</span>
                            )}
                          </div>
                        ))}
                        {createdFiles.length > 5 && (
                          <div className="snapshot-file-more">
                            {t('terminal:snapshot.more', { count: createdFiles.length - 5 })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {modifiedFiles.length > 0 && (
                    <div className="snapshot-file-group">
                      <div className="snapshot-file-group-label">
                        <span className="snapshot-file-type modified">~</span>
                        {t('terminal:snapshot.modifiedFiles', { count: modifiedFiles.length })}
                      </div>
                      <div className="snapshot-file-list">
                        {modifiedFiles.slice(0, 5).map((file) => (
                          <div key={file.path} className="snapshot-file-item">
                            <span className="snapshot-file-path" title={file.path}>
                              {getFileName(file.path)}
                            </span>
                            {file.size !== undefined && (
                              <span className="snapshot-file-size">{formatFileSize(file.size)}</span>
                            )}
                          </div>
                        ))}
                        {modifiedFiles.length > 5 && (
                          <div className="snapshot-file-more">
                            {t('terminal:snapshot.more', { count: modifiedFiles.length - 5 })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {files.length === 0 && (
                <div className="snapshot-no-files">
                  {t('terminal:snapshot.noFilesChanged')}
                </div>
              )}
            </div>

            {/* Error message */}
            {error && <div className="snapshot-error">{error}</div>}
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isSaving}
            >
              {t('common:buttons.cancel')}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!title.trim() || isSaving}
            >
              {isSaving ? t('terminal:snapshot.saving') : `⭐ ${t('terminal:snapshot.save')}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Helper functions
function getFileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
