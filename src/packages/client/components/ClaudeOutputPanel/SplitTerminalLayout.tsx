/**
 * SplitTerminalLayout - Renders one or more AgentTerminalPane instances side by side.
 *
 * When splitPaneAgentIds is empty, renders only the primary pane (current activeAgent).
 * When populated, renders multiple panes in a horizontal flex layout.
 * Supports drag-and-drop from the AgentOverviewPanel to add panes.
 */

import React, { useState, useCallback, useMemo, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useAgent,
  useAgents,
  useSplitPaneAgentIds,
  useSplitOrientation,
  store,
} from '../../store';
import { AgentTerminalPane, type AgentTerminalPaneHandle } from './AgentTerminalPane';
import type { ViewMode } from './types';
import type { Agent } from '../../../shared/types';

// ─── Types ──────────────────────────────────────────────────────────────────

interface SplitTerminalLayoutProps {
  /** The primary/active agent ID (used when no split panes active) */
  activeAgentId: string;
  /** The primary agent object */
  activeAgent: Agent;
  /** Ref for the primary pane */
  paneRef: React.RefObject<AgentTerminalPaneHandle | null>;
  /** View mode (simple/chat/advanced) */
  viewMode: ViewMode;
  /** Whether the terminal is open */
  isOpen: boolean;
  /** Whether viewing a snapshot */
  isSnapshotView: boolean;
  /** Snapshot data */
  currentSnapshot: {
    agentId: string;
    outputs: Array<{ text: string; timestamp: number; isStreaming?: boolean; isUserPrompt?: boolean }>;
  } | null;
  /** Modal callbacks from parent */
  onImageClick: (url: string, name: string) => void;
  onFileClick: (path: string, editData?: { oldString?: string; newString?: string; operation?: string; unifiedDiff?: string; highlightRange?: { offset: number; limit: number }; targetLine?: number }) => void;
  onBashClick: (command: string, output: string) => void;
  onViewMarkdown: (content: string) => void;
  /** Keyboard handler from parent */
  keyboard: {
    handleInputFocus: () => void;
    handleInputBlur: () => void;
    keyboardScrollLockRef: React.MutableRefObject<boolean>;
    cleanup: () => void;
  };
  /** Snapshot save callback */
  onSaveSnapshot?: () => void;
  /** Mobile swipe close props */
  canSwipeClose?: boolean;
  onSwipeCloseOffsetChange?: (offset: number) => void;
  onSwipeClose?: () => void;
  /** Whether any modal is open */
  hasModalOpen?: boolean;
}

// ─── Split Pane Header ──────────────────────────────────────────────────────

const SplitPaneHeader = memo(function SplitPaneHeader({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}) {
  const agent = useAgent(agentId);
  const { t } = useTranslation('terminal');

  return (
    <div className="split-pane-header">
      <span className="split-pane-agent-name" title={agent?.name || agentId}>
        {agent?.name || agentId}
      </span>
      <button
        type="button"
        className="split-pane-close"
        onClick={onClose}
        title={t('overview.close', { defaultValue: 'Close pane' })}
      >
        ✕
      </button>
    </div>
  );
});

// ─── Main Component ─────────────────────────────────────────────────────────

export const SplitTerminalLayout = memo(function SplitTerminalLayout(props: SplitTerminalLayoutProps) {
  const {
    activeAgentId,
    activeAgent,
    paneRef,
    viewMode,
    isOpen,
    isSnapshotView,
    currentSnapshot,
    onImageClick,
    onFileClick,
    onBashClick,
    onViewMarkdown,
    keyboard,
    onSaveSnapshot,
    canSwipeClose,
    onSwipeCloseOffsetChange,
    onSwipeClose,
    hasModalOpen,
  } = props;

  const splitPaneAgentIds = useSplitPaneAgentIds();
  const splitOrientation = useSplitOrientation();
  const agents = useAgents();
  const [dragOver, setDragOver] = useState(false);
  const { t } = useTranslation('terminal');

  const handleRemoveSplit = useCallback((agentId: string) => {
    store.removeSplitPane(agentId);
  }, []);

  // DnD handlers for the drop zone
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-agent-id')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only handle if leaving the container (not entering a child)
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const agentId = e.dataTransfer.getData('application/x-agent-id');
    if (agentId) {
      store.addSplitPane(agentId);
    }
  }, []);

  // Filter out invalid agent IDs (agents that no longer exist)
  const validSplitIds = useMemo(
    () => splitPaneAgentIds.filter(id => agents.has(id)),
    [splitPaneAgentIds, agents]
  );

  const isSplitMode = validSplitIds.length > 0;
  const isHorizontal = splitOrientation === 'horizontal';
  const dividerClass = isHorizontal ? 'horizontal' : 'vertical';

  const handleToggleOrientation = useCallback(() => {
    store.toggleSplitOrientation();
  }, []);

  // No split panes - render single pane as before
  if (!isSplitMode) {
    return (
      <div
        className={`split-terminal-layout single ${dragOver ? 'drop-zone-active' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <AgentTerminalPane
          ref={paneRef}
          agentId={activeAgentId}
          agent={activeAgent}
          viewMode={viewMode}
          isOpen={isOpen}
          isSnapshotView={isSnapshotView}
          currentSnapshot={currentSnapshot}
          onImageClick={onImageClick}
          onFileClick={onFileClick}
          onBashClick={onBashClick}
          onViewMarkdown={onViewMarkdown}
          keyboard={keyboard}
          onSaveSnapshot={onSaveSnapshot}
          canSwipeClose={canSwipeClose}
          onSwipeCloseOffsetChange={onSwipeCloseOffsetChange}
          onSwipeClose={onSwipeClose}
          hasModalOpen={hasModalOpen}
        />
      </div>
    );
  }

  // Split mode - render multiple panes
  return (
    <div
      className={`split-terminal-layout multi ${isHorizontal ? 'orientation-horizontal' : 'orientation-vertical'} ${dragOver ? 'drop-zone-active' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="split-toolbar">
        <button
          type="button"
          className="split-orientation-toggle"
          onClick={handleToggleOrientation}
          title={isHorizontal
            ? t('split.switchVertical', { defaultValue: 'Switch to vertical split' })
            : t('split.switchHorizontal', { defaultValue: 'Switch to horizontal split' })
          }
        >
          <span className={`split-orientation-icon ${isHorizontal ? 'horizontal' : 'vertical'}`}>
            {isHorizontal ? '⬜⬜' : '⬜\n⬜'}
          </span>
        </button>
      </div>
      <div className={`split-panes-container ${isHorizontal ? 'horizontal' : 'vertical'}`}>
        {validSplitIds.map((agentId, index) => {
          const agent = agents.get(agentId);
          if (!agent) return null;
          const isPrimary = agentId === activeAgentId;
          return (
            <React.Fragment key={agentId}>
              {index > 0 && <div className={`guake-split-divider ${dividerClass}`} />}
              <div className="split-terminal-pane">
                <SplitPaneHeader
                  agentId={agentId}
                  onClose={() => handleRemoveSplit(agentId)}
                />
                <AgentTerminalPane
                  ref={isPrimary ? paneRef : undefined}
                  agentId={agentId}
                  agent={agent}
                  viewMode={viewMode}
                  isOpen={isOpen}
                  isSnapshotView={false}
                  currentSnapshot={null}
                  onImageClick={onImageClick}
                  onFileClick={onFileClick}
                  onBashClick={onBashClick}
                  onViewMarkdown={onViewMarkdown}
                  keyboard={keyboard}
                  hasModalOpen={hasModalOpen}
                />
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
});
