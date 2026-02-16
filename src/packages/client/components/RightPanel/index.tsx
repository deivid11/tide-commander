/**
 * RightPanel - Resizable side panel with tab system
 *
 * A reusable right-side panel that supports:
 * - Drag to resize from left edge
 * - Collapse/expand with smooth animations (300ms)
 * - Tab system: Details | Chat | Logs | Snapshot
 * - Works with all view modes (2D, 3D, Dashboard)
 * - Dark theme with clean typography
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useRightPanelResize } from './useRightPanelResize';
import { TabContent } from './TabContent';
import type { RightPanelTab } from './types';
import {
  RIGHT_PANEL_TABS,
  STORAGE_KEY_PANEL_COLLAPSED,
  STORAGE_KEY_PANEL_TAB,
} from './types';
import type { Agent } from '../../../shared/types';

export interface RightPanelProps {
  /** The currently selected agent */
  agent: Agent | null;
  /** The selected agent's ID */
  agentId: string | null;
  /** Content to render inside the Chat tab (typically ClaudeOutputPanel content) */
  chatContent?: React.ReactNode;
  /** Additional CSS class */
  className?: string;
  /** Called when the panel collapse state changes */
  onCollapseChange?: (collapsed: boolean) => void;
  /** Which tabs to show (defaults to all) */
  visibleTabs?: RightPanelTab[];
  /** Default tab to show */
  defaultTab?: RightPanelTab;
  /** Override: force a specific tab active */
  activeTab?: RightPanelTab;
  /** Override: control collapsed state externally */
  collapsed?: boolean;
}

function getStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_PANEL_COLLAPSED) === 'true';
  } catch { return false; }
}

function getStoredTab(): RightPanelTab {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_PANEL_TAB);
    if (stored === 'details' || stored === 'chat' || stored === 'logs' || stored === 'snapshot') {
      return stored;
    }
  } catch { /* ignore */ }
  return 'chat';
}

export function RightPanel({
  agent,
  agentId,
  chatContent,
  className,
  onCollapseChange,
  visibleTabs,
  defaultTab,
  activeTab: controlledTab,
  collapsed: controlledCollapsed,
}: RightPanelProps) {
  const { t } = useTranslation(['common']);
  const { panelWidth, panelRef, handleResizeStart, isResizing } = useRightPanelResize();

  // Collapse state
  const [internalCollapsed, setInternalCollapsed] = useState(getStoredCollapsed);
  const isCollapsed = controlledCollapsed ?? internalCollapsed;

  // Tab state
  const [internalTab, setInternalTab] = useState<RightPanelTab>(() => defaultTab || getStoredTab());
  const currentTab = controlledTab ?? internalTab;

  // Filter tabs
  const tabs = visibleTabs
    ? RIGHT_PANEL_TABS.filter(tab => visibleTabs.includes(tab.id))
    : RIGHT_PANEL_TABS;

  const handleToggleCollapse = useCallback(() => {
    const next = !isCollapsed;
    setInternalCollapsed(next);
    try { localStorage.setItem(STORAGE_KEY_PANEL_COLLAPSED, String(next)); } catch { /* ignore */ }
    onCollapseChange?.(next);
  }, [isCollapsed, onCollapseChange]);

  const handleTabChange = useCallback((tab: RightPanelTab) => {
    setInternalTab(tab);
    try { localStorage.setItem(STORAGE_KEY_PANEL_TAB, tab); } catch { /* ignore */ }
    // If collapsed, expand when clicking a tab
    if (isCollapsed) {
      setInternalCollapsed(false);
      try { localStorage.setItem(STORAGE_KEY_PANEL_COLLAPSED, 'false'); } catch { /* ignore */ }
      onCollapseChange?.(false);
    }
  }, [isCollapsed, onCollapseChange]);

  // Propagate panel width as CSS custom property on document root
  // so other components (e.g. guake terminal) can adjust their layout
  useEffect(() => {
    if (!isCollapsed) {
      document.documentElement.style.setProperty('--right-panel-width', `${panelWidth}px`);
    } else {
      document.documentElement.style.setProperty('--right-panel-width', '0px');
    }
    return () => {
      document.documentElement.style.removeProperty('--right-panel-width');
    };
  }, [panelWidth, isCollapsed]);

  // Keyboard shortcut: Ctrl+\ to toggle panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '\\' && e.ctrlKey && !e.altKey) {
        e.preventDefault();
        handleToggleCollapse();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleCollapse]);

  // Mobile swipe-to-dismiss: swipe right to close
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    const deltaY = Math.abs(e.changedTouches[0].clientY - touchStartY.current);
    // Swipe right with more horizontal than vertical movement
    if (deltaX > 80 && deltaX > deltaY) {
      handleToggleCollapse();
    }
    touchStartX.current = null;
    touchStartY.current = null;
  }, [handleToggleCollapse]);

  const panelClasses = [
    'right-panel',
    isCollapsed ? 'right-panel--collapsed' : 'right-panel--expanded',
    isResizing ? 'right-panel--resizing' : '',
    className || '',
  ].filter(Boolean).join(' ');

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={`right-panel-backdrop ${!isCollapsed ? 'right-panel-backdrop--visible' : ''}`}
        onClick={handleToggleCollapse}
      />
      <div
        ref={panelRef}
        className={panelClasses}
        style={{
          '--right-panel-width': `${panelWidth}px`,
        } as React.CSSProperties}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Resize handle (left edge) */}
        {!isCollapsed && (
          <div
            className="right-panel__resize-handle"
            onMouseDown={handleResizeStart}
            title={t('rightPanel.dragToResize')}
          />
        )}

        {/* Collapse/expand edge button */}
        <button
          className={`right-panel__collapse-btn ${isCollapsed ? 'right-panel__collapse-btn--collapsed' : ''}`}
          onClick={handleToggleCollapse}
          title={isCollapsed ? t('rightPanel.expandPanel') : t('rightPanel.collapsePanel')}
        >
          <span className="right-panel__collapse-icon">
            {isCollapsed ? '◀' : '▶'}
          </span>
        </button>

        {/* Panel content wrapper - animated */}
        <div className="right-panel__content">
          {/* Mobile header: swipe handle + close button */}
          <div className="right-panel__mobile-header">
            <div className="right-panel__swipe-handle" />
            <button
              className="right-panel__mobile-close"
              onClick={handleToggleCollapse}
              title={t('rightPanel.closePanel')}
            >
              ✕
            </button>
          </div>

          {/* Tab bar */}
          <div className="right-panel__tabs">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`right-panel__tab ${currentTab === tab.id ? 'right-panel__tab--active' : ''}`}
                onClick={() => handleTabChange(tab.id)}
              >
                {t(`rightPanel.tabs.${tab.id}`)}
              </button>
            ))}
          </div>

          {/* Tab content area */}
          <div className="right-panel__body">
            <TabContent
              tab={currentTab}
              agent={agent}
              agentId={agentId}
              chatContent={chatContent}
            />
          </div>
        </div>
      </div>
    </>
  );
}

// Re-export types
export type { RightPanelTab } from './types';
export { RIGHT_PANEL_TABS } from './types';
