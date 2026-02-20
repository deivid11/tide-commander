/**
 * BranchWidget - IntelliJ-style branch selector
 *
 * Clickable branch indicator that opens a dropdown with:
 * - Search/filter for branches
 * - Quick actions: Pull, Push, New Branch
 * - Local branches list (click to checkout)
 * - Remote branches list (collapsible)
 */

import React, { memo, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { GitStatus, GitBranch } from './types';
import { useGitBranches } from './useGitBranches';
import { ContextMenu } from '../ContextMenu';
import type { ContextMenuAction } from '../ContextMenu';

interface BranchWidgetProps {
  currentFolder: string | null;
  gitStatus: GitStatus | null;
  onBranchChanged: () => void;
  onMerge?: (branch: string) => void;
  onCompare?: (branch: string) => void;
  onPullConflicts?: (conflicts: string[]) => void;
}

export const BranchWidget = memo(function BranchWidget({
  currentFolder,
  gitStatus,
  onBranchChanged,
  onMerge,
  onCompare,
  onPullConflicts,
}: BranchWidgetProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [showRemotes, setShowRemotes] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ isOpen: boolean; position: { x: number; y: number }; branch: string } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const newBranchRef = useRef<HTMLInputElement>(null);

  const {
    branches,
    loading,
    operationInProgress,
    loadBranches,
    checkoutBranch,
    createBranch,
    pullFromRemote,
    pushToRemote,
  } = useGitBranches();

  // Load branches when dropdown opens
  useEffect(() => {
    if (showDropdown && currentFolder) {
      loadBranches(currentFolder);
      // Focus search after a tick
      setTimeout(() => searchRef.current?.focus(), 50);
    }
    if (!showDropdown) {
      setSearchFilter('');
      setShowNewBranch(false);
      setNewBranchName('');
      setStatusMessage(null);
    }
  }, [showDropdown, currentFolder, loadBranches]);

  // Auto-clear status messages
  useEffect(() => {
    if (statusMessage) {
      const timeout = statusMessage.type === 'error' ? 8000 : 3000;
      const timer = setTimeout(() => setStatusMessage(null), timeout);
      return () => clearTimeout(timer);
    }
  }, [statusMessage]);

  // Focus new branch input when shown
  useEffect(() => {
    if (showNewBranch) {
      setTimeout(() => newBranchRef.current?.focus(), 50);
    }
  }, [showNewBranch]);

  // Click outside handler
  useEffect(() => {
    if (!showDropdown) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        !target.closest('.branch-widget-selector') &&
        !target.closest('.branch-widget-dropdown')
      ) {
        setShowDropdown(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setShowDropdown(false);
      }
    };
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [showDropdown]);

  const handleCheckout = useCallback(async (branch: GitBranch) => {
    if (!currentFolder || operationInProgress) return;
    if (branch.isCurrent) return;
    const result = await checkoutBranch(currentFolder, branch.name);
    if (result.success) {
      setStatusMessage({ type: 'success', text: t('terminal:fileExplorer.switchedToBranch', { branch: result.branch || branch.name }) });
      onBranchChanged();
      loadBranches(currentFolder);
    } else {
      setStatusMessage({ type: 'error', text: result.error || t('terminal:fileExplorer.checkoutFailed') });
    }
  }, [currentFolder, operationInProgress, checkoutBranch, onBranchChanged, loadBranches]);

  const handleCreateBranch = useCallback(async () => {
    if (!currentFolder || !newBranchName.trim() || operationInProgress) return;
    const result = await createBranch(currentFolder, newBranchName.trim());
    if (result.success) {
      setStatusMessage({ type: 'success', text: t('terminal:fileExplorer.createdBranch', { branch: result.branch }) });
      setShowNewBranch(false);
      setNewBranchName('');
      onBranchChanged();
      loadBranches(currentFolder);
    } else {
      setStatusMessage({ type: 'error', text: result.error || t('terminal:fileExplorer.createBranchFailed') });
    }
  }, [currentFolder, newBranchName, operationInProgress, createBranch, onBranchChanged, loadBranches]);

  const handlePull = useCallback(async () => {
    if (!currentFolder || operationInProgress) return;
    const result = await pullFromRemote(currentFolder);
    if (result.success) {
      setStatusMessage({ type: 'success', text: t('terminal:fileExplorer.pullComplete') });
      onBranchChanged();
      loadBranches(currentFolder);
    } else if (result.conflicts && result.conflicts.length > 0) {
      setStatusMessage({ type: 'error', text: `Pull conflicts: ${result.conflicts.length} file(s)` });
      onPullConflicts?.(result.conflicts);
      setShowDropdown(false);
    } else {
      setStatusMessage({ type: 'error', text: result.error || t('terminal:fileExplorer.pullFailed') });
    }
  }, [currentFolder, operationInProgress, pullFromRemote, onBranchChanged, loadBranches, onPullConflicts]);

  const handlePush = useCallback(async () => {
    if (!currentFolder || operationInProgress) return;
    const result = await pushToRemote(currentFolder);
    if (result.success) {
      setStatusMessage({ type: 'success', text: t('terminal:fileExplorer.pushComplete') });
    } else {
      setStatusMessage({ type: 'error', text: result.error || t('terminal:fileExplorer.pushFailed') });
    }
  }, [currentFolder, operationInProgress, pushToRemote]);

  const branchName = gitStatus?.branch || 'unknown';
  const isDisabled = !!operationInProgress;

  const handleBranchContextMenu = useCallback((e: React.MouseEvent, branch: GitBranch) => {
    if (branch.isCurrent) return; // No context menu for current branch
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      branch: branch.name,
    });
  }, []);

  const contextMenuActions = useMemo((): ContextMenuAction[] => {
    if (!contextMenu) return [];
    const mergeDisabled = !!operationInProgress || gitStatus?.mergeInProgress;
    return [
      {
        id: 'compare',
        label: t('terminal:fileExplorer.showDiffWith', { branch: contextMenu.branch }),
        icon: '⇄',
        disabled: !!operationInProgress,
        onClick: () => {
          onCompare?.(contextMenu!.branch);
          setShowDropdown(false);
        },
      },
      {
        id: 'merge',
        label: t('terminal:fileExplorer.mergeInto', { source: contextMenu.branch, target: branchName }),
        icon: '⤵',
        disabled: !!mergeDisabled,
        onClick: () => {
          if (onMerge) {
            onMerge(contextMenu.branch);
          }
          setShowDropdown(false);
        },
      },
      { id: 'divider-1', label: '', divider: true, onClick: () => {} },
      {
        id: 'checkout',
        label: t('terminal:fileExplorer.checkoutBranch', { branch: contextMenu.branch }),
        icon: '⎇',
        disabled: !!operationInProgress,
        onClick: () => {
          const branch = branches.find(b => b.name === contextMenu!.branch);
          if (branch) handleCheckout(branch);
        },
      },
    ];
  }, [contextMenu, operationInProgress, gitStatus?.mergeInProgress, branchName, onMerge, onCompare, branches, handleCheckout]);

  // Filter branches
  const localBranches = useMemo(() => {
    const local = branches.filter(b => !b.isRemote);
    if (!searchFilter) return local;
    const q = searchFilter.toLowerCase();
    return local.filter(b => b.name.toLowerCase().includes(q));
  }, [branches, searchFilter]);

  const remoteBranches = useMemo(() => {
    const remote = branches.filter(b => b.isRemote);
    if (!searchFilter) return remote;
    const q = searchFilter.toLowerCase();
    return remote.filter(b => b.name.toLowerCase().includes(q));
  }, [branches, searchFilter]);

  return (
    <div className="branch-widget" style={{ position: 'relative' }}>
      {/* Branch Indicator */}
      <div
        className="branch-widget-selector"
        onClick={(e) => {
          e.stopPropagation();
          setShowDropdown(!showDropdown);
        }}
        title={`Branch: ${branchName}`}
      >
        <svg className="branch-widget-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1 0v1.836A2.25 2.25 0 0 0 5.75 9.5h1.378a2.251 2.251 0 1 0 0-1H5.75a1.25 1.25 0 0 1-1.25-1.25V5.372Zm7.75 4.878a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3-8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z" />
        </svg>
        <span className="branch-widget-name">{branchName}</span>
        <span className="branch-widget-arrow">&#x25BC;</span>
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div className="branch-widget-dropdown" ref={dropdownRef}>
          {/* Search */}
          <div className="branch-widget-search">
            <input
              ref={searchRef}
              type="text"
              className="branch-widget-search-input"
              placeholder={t('terminal:fileExplorer.searchBranches')}
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>

          {/* Status Message */}
          {statusMessage && (
            <div className={`branch-widget-status ${statusMessage.type}`}>
              {statusMessage.text}
            </div>
          )}

          {/* Quick Actions */}
          <div className="branch-widget-section-header">{t('terminal:fileExplorer.actions')}</div>
          <div className="branch-widget-actions">
            <div
              className={`branch-widget-action-item ${isDisabled ? 'disabled' : ''}`}
              onClick={handlePull}
            >
              <span className="branch-widget-action-icon">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 12l-4-4h2.5V3h3v5H12L8 12z" />
                </svg>
              </span>
              <span className="branch-widget-action-label">
                {operationInProgress === 'pull' ? t('terminal:fileExplorer.pulling') : t('terminal:fileExplorer.pull')}
              </span>
            </div>
            <div
              className={`branch-widget-action-item ${isDisabled ? 'disabled' : ''}`}
              onClick={handlePush}
            >
              <span className="branch-widget-action-icon">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 4l4 4h-2.5v5h-3V8H4l4-4z" />
                </svg>
              </span>
              <span className="branch-widget-action-label">
                {operationInProgress === 'push' ? t('terminal:fileExplorer.pushing') : t('terminal:fileExplorer.push')}
              </span>
            </div>
            <div
              className={`branch-widget-action-item ${isDisabled ? 'disabled' : ''}`}
              onClick={() => {
                if (!isDisabled) setShowNewBranch(!showNewBranch);
              }}
            >
              <span className="branch-widget-action-icon">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 2v5H3v2h5v5h2V9h5V7H10V2H8z" />
                </svg>
              </span>
              <span className="branch-widget-action-label">{t('terminal:fileExplorer.newBranch')}</span>
            </div>
          </div>

          {/* New Branch Input */}
          {showNewBranch && (
            <div className="branch-widget-new-branch">
              <input
                ref={newBranchRef}
                type="text"
                className="branch-widget-new-branch-input"
                placeholder={t('terminal:fileExplorer.branchNamePlaceholder')}
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') handleCreateBranch();
                  if (e.key === 'Escape') {
                    setShowNewBranch(false);
                    setNewBranchName('');
                  }
                }}
              />
              <button
                className="branch-widget-new-branch-confirm"
                onClick={handleCreateBranch}
                disabled={!newBranchName.trim() || isDisabled}
              >
                {operationInProgress === 'create' ? '...' : t('common:buttons.create')}
              </button>
            </div>
          )}

          {/* Local Branches */}
          <div className="branch-widget-section-header">
            {t('terminal:fileExplorer.localBranches')}
            {loading && <span className="branch-widget-loading-hint"> {t('terminal:fileExplorer.loading')}</span>}
          </div>
          <div className="branch-widget-branch-list">
            {localBranches.length === 0 && !loading && (
              <div className="branch-widget-empty">{t('terminal:fileExplorer.noBranchesFound')}</div>
            )}
            {localBranches.map((branch) => (
              <div
                key={branch.name}
                className={`branch-widget-branch-item ${branch.isCurrent ? 'current' : ''} ${isDisabled ? 'disabled' : ''}`}
                onClick={() => handleCheckout(branch)}
                onContextMenu={(e) => handleBranchContextMenu(e, branch)}
                title={branch.lastMessage || branch.name}
              >
                <span className="branch-widget-branch-name">
                  {branch.isCurrent && <span className="branch-widget-current-marker">*</span>}
                  {branch.name}
                </span>
                {branch.lastCommit && (
                  <span className="branch-widget-branch-commit">{branch.lastCommit}</span>
                )}
              </div>
            ))}
          </div>

          {/* Remote Branches */}
          {remoteBranches.length > 0 && (
            <>
              <div
                className="branch-widget-section-header clickable"
                onClick={() => setShowRemotes(!showRemotes)}
              >
                <span className="branch-widget-section-toggle">{showRemotes ? '\u25BE' : '\u25B8'}</span>
                {t('terminal:fileExplorer.remoteBranches', { count: remoteBranches.length })}
              </div>
              {showRemotes && (
                <div className="branch-widget-branch-list">
                  {remoteBranches.map((branch) => (
                    <div
                      key={branch.name}
                      className={`branch-widget-branch-item remote ${isDisabled ? 'disabled' : ''}`}
                      onClick={() => handleCheckout(branch)}
                      onContextMenu={(e) => handleBranchContextMenu(e, branch)}
                      title={branch.lastMessage || branch.name}
                    >
                      <span className="branch-widget-branch-name">{branch.name}</span>
                      {branch.lastCommit && (
                        <span className="branch-widget-branch-commit">{branch.lastCommit}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Branch Context Menu */}
      {contextMenu && (
        <ContextMenu
          isOpen={contextMenu.isOpen}
          position={contextMenu.position}
          worldPosition={{ x: 0, z: 0 }}
          actions={contextMenuActions}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
});
