import React, { useEffect, useState, useRef } from 'react';
import { useStore, store } from '../../store';
import type { DrawingTool } from '../../../shared/types';
import type { ToolboxProps } from './types';
import { CollapsibleSection } from './CollapsibleSection';
import { AreaItem } from './AreaItem';
import { BuildingItem } from './BuildingItem';
import { BuildingEditor } from './BuildingEditor';
import { AreaEditor } from './AreaEditor';
import { ConfigSection } from './ConfigSection';

export function Toolbox({ onConfigChange, onToolChange, config, isOpen, onClose, onOpenBuildingModal, onOpenAreaExplorer }: ToolboxProps) {
  const state = useStore();
  const areasArray = Array.from(state.areas.values());
  const buildingsArray = Array.from(state.buildings.values());
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Areas are loaded from server via WebSocket on connection

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Autofocus search input when sidebar opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      // Small delay to ensure the sidebar animation has started
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleToolSelect = (tool: DrawingTool) => {
    const newTool = state.activeTool === tool ? null : tool;
    onToolChange(newTool);
  };

  const handleAreaClick = (areaId: string) => {
    store.selectArea(state.selectedAreaId === areaId ? null : areaId);
    onToolChange('select');
  };

  const handleDeleteArea = (e: React.MouseEvent, areaId: string) => {
    e.stopPropagation();
    store.deleteArea(areaId);
  };

  return (
    <>
      {/* Backdrop */}
      <div className="toolbox-backdrop" onClick={onClose} />

      <aside className="toolbox">
        {/* Header with close button */}
        <div className="toolbox-header">
          <span>Tools & Settings</span>
          <button className="toolbox-close-btn" onClick={onClose} title="Close">
            &times;
          </button>
        </div>

        {/* Search bar */}
        <div className="toolbox-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search settings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="toolbox-search-input"
          />
          {searchQuery && (
            <button className="toolbox-search-clear" onClick={() => setSearchQuery('')}>
              &times;
            </button>
          )}
        </div>

        {/* Scrollable content area */}
        <div className="toolbox-content">
          {/* Areas Section (includes Drawing Tools) */}
          <div className="toolbox-section toolbox-section-collapsible">
            <CollapsibleSection
              title={`Areas (${areasArray.length})`}
              storageKey="areas"
            >
              {/* Drawing Tools */}
              <div className="tool-buttons">
                <button
                  className={`tool-btn ${state.activeTool === 'select' ? 'active' : ''}`}
                  onClick={() => handleToolSelect('select')}
                  title="Select"
                >
                  <span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
                    </svg>
                  </span>
                </button>
                <button
                  className={`tool-btn ${state.activeTool === 'rectangle' ? 'active' : ''}`}
                  onClick={() => handleToolSelect('rectangle')}
                  title="Rectangle"
                >
                  <span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                    </svg>
                  </span>
                </button>
                <button
                  className={`tool-btn ${state.activeTool === 'circle' ? 'active' : ''}`}
                  onClick={() => handleToolSelect('circle')}
                  title="Circle"
                >
                  <span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="9" />
                    </svg>
                  </span>
                </button>
              </div>

              {/* Areas List */}
              <div className="areas-list">
                {areasArray.length === 0 ? (
                  <div className="areas-empty">
                    Draw on the battlefield to create areas
                  </div>
                ) : (
                  areasArray.map((area) => (
                    <AreaItem
                      key={area.id}
                      area={area}
                      isSelected={state.selectedAreaId === area.id}
                      onClick={() => handleAreaClick(area.id)}
                      onDelete={(e) => handleDeleteArea(e, area.id)}
                    />
                  ))
                )}
              </div>
            </CollapsibleSection>
          </div>

          {/* Area Editor */}
          {state.selectedAreaId && (
            <AreaEditor
              area={state.areas.get(state.selectedAreaId)!}
              onClose={() => store.selectArea(null)}
              onOpenFolder={onOpenAreaExplorer}
            />
          )}

          {/* Buildings Section */}
          <div className="toolbox-section toolbox-section-collapsible">
            <CollapsibleSection
              title={`Buildings (${buildingsArray.length})`}
              storageKey="buildings"
              headerExtra={
                <button
                  className="add-building-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenBuildingModal?.();
                  }}
                  title="Add Building"
                >
                  +
                </button>
              }
            >
              <div className="buildings-list">
                {buildingsArray.length === 0 ? (
                  <div className="buildings-empty">
                    Click + to add a building
                  </div>
                ) : (
                  buildingsArray.map((building) => (
                    <BuildingItem
                      key={building.id}
                      building={building}
                      isSelected={state.selectedBuildingIds.has(building.id)}
                      onClick={() => {
                        store.selectBuilding(
                          state.selectedBuildingIds.has(building.id) ? null : building.id
                        );
                      }}
                      onEdit={() => onOpenBuildingModal?.(building.id)}
                    />
                  ))
                )}
              </div>
            </CollapsibleSection>
          </div>

          {/* Building Editor - show for single selection */}
          {state.selectedBuildingIds.size === 1 && (() => {
            const selectedId = Array.from(state.selectedBuildingIds)[0];
            const building = state.buildings.get(selectedId);
            return building ? (
              <BuildingEditor
                building={building}
                onClose={() => store.selectBuilding(null)}
                onOpenModal={() => onOpenBuildingModal?.(selectedId)}
              />
            ) : null;
          })()}

          {/* Config Section */}
          <ConfigSection config={config} onChange={onConfigChange} searchQuery={searchQuery} />
        </div>
      </aside>
    </>
  );
}
