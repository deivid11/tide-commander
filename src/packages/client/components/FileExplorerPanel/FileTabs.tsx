/**
 * FileTabs - Tab bar for open files
 *
 * Shows open files as tabs with close buttons.
 * Supports middle-click to close and click to switch.
 */

import React, { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileTabsProps, FileTab } from './types';
import { getFileIcon } from './fileUtils';

// ============================================================================
// SINGLE TAB COMPONENT
// ============================================================================

interface TabItemProps {
  tab: FileTab;
  isActive: boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

const TabItem = memo(function TabItem({
  tab,
  isActive,
  onSelect,
  onClose,
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

  return (
    <div
      className={`file-tab ${isActive ? 'active' : ''}`}
      onClick={handleClick}
      onMouseDown={handleMiddleClick}
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

function FileTabsComponent({
  tabs,
  activeTabPath,
  onSelectTab,
  onCloseTab,
}: FileTabsProps) {
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
          />
        ))}
      </div>
    </div>
  );
}

export const FileTabs = memo(FileTabsComponent, (prev, next) => {
  if (prev.activeTabPath !== next.activeTabPath) return false;
  if (prev.tabs.length !== next.tabs.length) return false;

  for (let i = 0; i < prev.tabs.length; i++) {
    if (prev.tabs[i].path !== next.tabs[i].path) return false;
  }

  return true;
});

FileTabs.displayName = 'FileTabs';
