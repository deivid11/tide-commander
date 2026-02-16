/**
 * SnapshotViewer - View a saved snapshot's conversation and files
 *
 * Shows the snapshot in a read-only terminal view with tabs for:
 * - Conversation: The captured outputs
 * - Files: Browser for all captured files
 */

import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConversationSnapshot, SnapshotFile } from '../../shared/types/snapshot';
import { BUILT_IN_AGENT_CLASSES, type BuiltInAgentClass } from '../../shared/types';
import { OutputLine } from './ClaudeOutputPanel/OutputLine';

export interface SnapshotViewerProps {
  /** The snapshot to view */
  snapshot: ConversationSnapshot;
  /** Whether the snapshot is loading */
  isLoading?: boolean;
  /** Callback to go back to snapshot list */
  onBack: () => void;
  /** Callback to restore files from snapshot */
  onRestore: (filePaths?: string[]) => Promise<void>;
  /** Callback to export the snapshot */
  onExport: () => Promise<void>;
  /** Whether an action is in progress */
  isActionLoading?: boolean;
}

type ViewTab = 'conversation' | 'files';

export function SnapshotViewer({
  snapshot,
  isLoading = false,
  onBack,
  onRestore,
  onExport,
  isActionLoading = false,
}: SnapshotViewerProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [activeTab, setActiveTab] = useState<ViewTab>('conversation');
  const [selectedFile, setSelectedFile] = useState<SnapshotFile | null>(null);
  const [selectedFilePaths, setSelectedFilePaths] = useState<Set<string>>(new Set());

  // Get agent class info
  const classInfo = useMemo(() => {
    if (snapshot.agentClass in BUILT_IN_AGENT_CLASSES) {
      return BUILT_IN_AGENT_CLASSES[snapshot.agentClass as BuiltInAgentClass];
    }
    return { icon: '🤖', color: '#888888', description: 'Custom agent' };
  }, [snapshot.agentClass]);

  // Format timestamp
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Group files by type
  const { createdFiles, modifiedFiles } = useMemo(() => {
    const created: SnapshotFile[] = [];
    const modified: SnapshotFile[] = [];

    for (const file of snapshot.files) {
      if (file.type === 'created') {
        created.push(file);
      } else {
        modified.push(file);
      }
    }

    return { createdFiles: created, modifiedFiles: modified };
  }, [snapshot.files]);

  // Toggle file selection
  const toggleFileSelection = (path: string) => {
    const newSelection = new Set(selectedFilePaths);
    if (newSelection.has(path)) {
      newSelection.delete(path);
    } else {
      newSelection.add(path);
    }
    setSelectedFilePaths(newSelection);
  };

  // Select all files
  const selectAllFiles = () => {
    setSelectedFilePaths(new Set(snapshot.files.map((f) => f.path)));
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedFilePaths(new Set());
  };

  // Restore selected files
  const handleRestoreSelected = async () => {
    if (selectedFilePaths.size > 0) {
      await onRestore(Array.from(selectedFilePaths));
    }
  };

  // Get file extension for syntax highlighting hint
  const getLanguage = (file: SnapshotFile): string => {
    if (file.language) return file.language;
    const ext = file.path.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      rb: 'ruby',
      go: 'go',
      rs: 'rust',
      java: 'java',
      kt: 'kotlin',
      swift: 'swift',
      c: 'c',
      cpp: 'cpp',
      h: 'c',
      hpp: 'cpp',
      css: 'css',
      scss: 'scss',
      less: 'less',
      html: 'html',
      xml: 'xml',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      md: 'markdown',
      sh: 'bash',
      bash: 'bash',
      zsh: 'bash',
      sql: 'sql',
    };
    return langMap[ext] || 'text';
  };

  // Get short file name from path
  const getFileName = (path: string): string => {
    const parts = path.split('/');
    return parts[parts.length - 1] || path;
  };

  // Get directory from path
  const getDirectory = (path: string): string => {
    const parts = path.split('/');
    parts.pop();
    return parts.join('/') || '/';
  };

  if (isLoading) {
    return (
      <div className="snapshot-viewer">
        <div className="snapshot-viewer-loading">
          <div className="snapshot-loading-spinner"></div>
          {t('terminal:snapshot.loadingSnapshots')}
        </div>
      </div>
    );
  }

  return (
    <div className="snapshot-viewer">
      {/* Header */}
      <div className="snapshot-viewer-header">
        <div className="snapshot-viewer-header-left">
          <button className="snapshot-viewer-back" onClick={onBack} title={t('terminal:snapshot.backToSnapshots')}>
            ← {t('common:buttons.back')}
          </button>
          <div className="snapshot-viewer-info">
            <div className="snapshot-viewer-title">
              <span className="snapshot-viewer-icon" style={{ color: classInfo.color }}>
                {classInfo.icon}
              </span>
              {snapshot.title}
            </div>
            <div className="snapshot-viewer-meta">
              <span className="snapshot-viewer-agent">{snapshot.agentName}</span>
              <span className="snapshot-viewer-separator">•</span>
              <span className="snapshot-viewer-date">{formatDate(snapshot.createdAt)}</span>
              {snapshot.cwd && (
                <>
                  <span className="snapshot-viewer-separator">•</span>
                  <span className="snapshot-viewer-cwd" title={snapshot.cwd}>
                    {snapshot.cwd}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="snapshot-viewer-header-right">
          <button
            className="btn btn-secondary"
            onClick={onExport}
            disabled={isActionLoading}
            title={t('terminal:snapshot.exportSnapshot')}
          >
            📤 {t('terminal:snapshot.exportSnapshot')}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onRestore()}
            disabled={isActionLoading}
            title={t('terminal:snapshot.restoreAll')}
          >
            🔄 {t('terminal:snapshot.restoreAll')}
          </button>
        </div>
      </div>

      {/* Description */}
      {snapshot.description && (
        <div className="snapshot-viewer-description">{snapshot.description}</div>
      )}

      {/* Tabs */}
      <div className="snapshot-viewer-tabs">
        <button
          className={`snapshot-viewer-tab ${activeTab === 'conversation' ? 'active' : ''}`}
          onClick={() => setActiveTab('conversation')}
        >
          💬 {t('terminal:snapshot.conversationMessages', { count: snapshot.outputs.length })}
          <span className="snapshot-viewer-tab-count">{snapshot.outputs.length}</span>
        </button>
        <button
          className={`snapshot-viewer-tab ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
        >
          📄 {t('terminal:snapshot.fileChanges')}
          <span className="snapshot-viewer-tab-count">{snapshot.files.length}</span>
        </button>
      </div>

      {/* Tab content */}
      <div className="snapshot-viewer-content">
        {activeTab === 'conversation' && (
          <div className="snapshot-conversation">
            {snapshot.outputs.length === 0 ? (
              <div className="snapshot-conversation-empty">
                {t('terminal:snapshot.noConversation')}
              </div>
            ) : (
              <div className="snapshot-conversation-messages">
                {snapshot.outputs.map((output) => {
                  // Convert snapshot output to ClaudeOutput format for OutputLine component
                  const claudeOutput = {
                    id: output.id,
                    text: output.text,
                    timestamp: output.timestamp,
                    isStreaming: output.isStreaming || false,
                    isUserPrompt: false,
                    isDelegation: false,
                  };
                  return (
                    <OutputLine
                      key={output.id}
                      output={claudeOutput}
                      agentId={null}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'files' && (
          <div className="snapshot-files">
            {/* File toolbar */}
            <div className="snapshot-files-toolbar">
              <div className="snapshot-files-selection">
                <button
                  className="btn btn-sm"
                  onClick={selectAllFiles}
                  disabled={snapshot.files.length === 0}
                >
                  {t('common:buttons.selectAll')}
                </button>
                <button
                  className="btn btn-sm"
                  onClick={clearSelection}
                  disabled={selectedFilePaths.size === 0}
                >
                  {t('common:buttons.clear')}
                </button>
                {selectedFilePaths.size > 0 && (
                  <span className="snapshot-files-selected-count">
                    {selectedFilePaths.size} {t('common:labels.selected')}
                  </span>
                )}
              </div>
              {selectedFilePaths.size > 0 && (
                <button
                  className="btn btn-sm btn-primary"
                  onClick={handleRestoreSelected}
                  disabled={isActionLoading}
                >
                  🔄 {t('terminal:snapshot.restoreSelected')}
                </button>
              )}
            </div>

            {/* File list */}
            <div className="snapshot-files-container">
              {/* File tree */}
              <div className="snapshot-files-list">
                {snapshot.files.length === 0 ? (
                  <div className="snapshot-files-empty">{t('terminal:snapshot.noFileChanges')}</div>
                ) : (
                  <>
                    {createdFiles.length > 0 && (
                      <div className="snapshot-files-group">
                        <div className="snapshot-files-group-header">
                          <span className="snapshot-file-type-badge created">+</span>
                          {t('terminal:snapshot.createdFiles', { count: createdFiles.length })}
                        </div>
                        {createdFiles.map((file) => (
                          <div
                            key={file.path}
                            className={`snapshot-file-row ${selectedFile?.path === file.path ? 'selected' : ''}`}
                            onClick={() => setSelectedFile(file)}
                          >
                            <input
                              type="checkbox"
                              className="snapshot-file-checkbox"
                              checked={selectedFilePaths.has(file.path)}
                              onChange={(e) => {
                                e.stopPropagation();
                                toggleFileSelection(file.path);
                              }}
                            />
                            <span className="snapshot-file-name">{getFileName(file.path)}</span>
                            <span className="snapshot-file-dir" title={file.path}>
                              {getDirectory(file.path)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {modifiedFiles.length > 0 && (
                      <div className="snapshot-files-group">
                        <div className="snapshot-files-group-header">
                          <span className="snapshot-file-type-badge modified">~</span>
                          {t('terminal:snapshot.modifiedFiles', { count: modifiedFiles.length })}
                        </div>
                        {modifiedFiles.map((file) => (
                          <div
                            key={file.path}
                            className={`snapshot-file-row ${selectedFile?.path === file.path ? 'selected' : ''}`}
                            onClick={() => setSelectedFile(file)}
                          >
                            <input
                              type="checkbox"
                              className="snapshot-file-checkbox"
                              checked={selectedFilePaths.has(file.path)}
                              onChange={(e) => {
                                e.stopPropagation();
                                toggleFileSelection(file.path);
                              }}
                            />
                            <span className="snapshot-file-name">{getFileName(file.path)}</span>
                            <span className="snapshot-file-dir" title={file.path}>
                              {getDirectory(file.path)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* File preview */}
              <div className="snapshot-file-preview">
                {selectedFile ? (
                  <>
                    <div className="snapshot-file-preview-header">
                      <span className="snapshot-file-preview-name">{getFileName(selectedFile.path)}</span>
                      <span className="snapshot-file-preview-lang">{getLanguage(selectedFile)}</span>
                    </div>
                    <pre className="snapshot-file-preview-content">
                      <code>{selectedFile.content}</code>
                    </pre>
                  </>
                ) : (
                  <div className="snapshot-file-preview-empty">
                    {t('terminal:snapshot.selectFileToPreview')}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Metadata footer */}
      {snapshot.metadata && (
        <div className="snapshot-viewer-footer">
          {snapshot.metadata.tokensUsed !== undefined && (
            <span className="snapshot-footer-stat">
              🎯 {snapshot.metadata.tokensUsed.toLocaleString()} tokens
            </span>
          )}
          {snapshot.metadata.contextUsed !== undefined && (
            <span className="snapshot-footer-stat">
              📊 {snapshot.metadata.contextUsed}% context
            </span>
          )}
          {snapshot.metadata.duration !== undefined && (
            <span className="snapshot-footer-stat">
              ⏱️ {formatDuration(snapshot.metadata.duration)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Helper to format duration
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
