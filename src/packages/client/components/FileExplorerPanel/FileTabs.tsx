/**
 * FileTabs - Tab bar for open files
 *
 * Shows open files as tabs with close buttons.
 * Supports middle-click to close, click to switch, and right-click context menu.
 */

import React, { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileTabsProps, FileTab } from './types';
import { getFileIcon } from './fileUtils';
import { ContextMenu, type ContextMenuAction } from '../ContextMenu';
import { Icon } from '../Icon';

// ============================================================================
// SINGLE TAB COMPONENT
// ============================================================================

interface TabItemProps {
  tab: FileTab;
  isActive: boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onContextMenu: (event: React.MouseEvent, tab: FileTab) => void;
}

const TabItem = memo(function TabItem({
  tab,
  isActive,
  onSelect,
  onClose,
  onContextMenu,
}: TabItemProps) {
  const { t } = useTranslation(['terminal']);
  // Create a fake TreeNode for the icon helper
  const iconNode = {
    name: tab.filename,
    path: tab.path,
    isDirectory: false,
    size: 0,
    extension: tab.extension,
  };

  const handleClick = useCallback(() => {
    onSelect(tab.path);
  }, [onSelect, tab.path]);

  const handleMiddleClick = useCallback((e: React.MouseEvent) => {
    // Middle mouse button
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      onClose(tab.path);
    }
  }, [onClose, tab.path]);

  const handleCloseClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClose(tab.path);
  }, [onClose, tab.path]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e, tab);
  }, [onContextMenu, tab]);

  return (
    <div
      className={`file-tab ${isActive ? 'active' : ''}`}
      onClick={handleClick}
      onMouseDown={handleMiddleClick}
      onContextMenu={handleContextMenu}
      title={tab.path}
    >
      <img className="file-tab-icon" src={getFileIcon(iconNode)} alt="file" />
      <span className="file-tab-name">{tab.filename}</span>
      <button
        className="file-tab-close"
        onClick={handleCloseClick}
        title={t('terminal:fileExplorer.closeMiddleClick')}
      >
        ×
      </button>
    </div>
  );
});

// ============================================================================
// FILE TABS COMPONENT
// ============================================================================

interface TabContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
  tab: FileTab;
}

// On-disk tabs are real files we can fetch git history for. Untitled/in-memory
// buffers don't have an absolute path so they can't be resolved by the backend.
function isRealFileTab(tab: FileTab): boolean {
  return typeof tab.path === 'string' && tab.path.startsWith('/');
}

function FileTabsComponent({
  tabs,
  activeTabPath,
  onSelectTab,
  onCloseTab,
  onShowGitHistory,
}: FileTabsProps) {
  const { t } = useTranslation(['terminal']);
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null);

  const handleTabContextMenu = useCallback((event: React.MouseEvent, tab: FileTab) => {
    setContextMenu({
      isOpen: true,
      position: { x: event.clientX, y: event.clientY },
      tab,
    });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const contextActions = useMemo((): ContextMenuAction[] => {
    if (!contextMenu) return [];
    const tab = contextMenu.tab;
    const canShowHistory = !!onShowGitHistory && isRealFileTab(tab);

    return [
      {
        id: 'git-history',
        label: t('terminal:fileExplorer.showGitHistory') ?? 'Show Git History',
        icon: <Icon name="git-commit" size={14} />,
        disabled: !canShowHistory,
        onClick: () => {
          if (canShowHistory) onShowGitHistory!(tab.path);
        },
      },
    ];
  }, [contextMenu, onShowGitHistory, t]);

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className="file-tabs-bar">
      <div className="file-tabs-container">
        {tabs.map((tab) => (
          <TabItem
            key={tab.path}
            tab={tab}
            isActive={activeTabPath === tab.path}
            onSelect={onSelectTab}
            onClose={onCloseTab}
            onContextMenu={handleTabContextMenu}
          />
        ))}
      </div>

      {contextMenu && (
        <ContextMenu
          isOpen={contextMenu.isOpen}
          position={contextMenu.position}
          worldPosition={{ x: 0, z: 0 }}
          actions={contextActions}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}

export const FileTabs = memo(FileTabsComponent, (prev, next) => {
  if (prev.activeTabPath !== next.activeTabPath) return false;
  if (prev.tabs.length !== next.tabs.length) return false;
  if (prev.onShowGitHistory !== next.onShowGitHistory) return false;

  for (let i = 0; i < prev.tabs.length; i++) {
    if (prev.tabs[i].path !== next.tabs[i].path) return false;
  }

  return true;
});

FileTabs.displayName = 'FileTabs';
