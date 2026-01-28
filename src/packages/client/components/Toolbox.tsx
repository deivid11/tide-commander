import React, { useState, useEffect } from 'react';
import { useStore, store, useSecretsArray } from '../store';
import type { DrawingArea, DrawingTool, Building, Secret } from '../../shared/types';
import { BUILDING_TYPES, BUILDING_STYLES, type BuildingStyle } from '../../shared/types';
import { AREA_COLORS, BUILDING_STATUS_COLORS } from '../utils/colors';
import { STORAGE_KEYS, getStorageString, setStorageString, apiUrl } from '../utils/storage';
import { reconnect } from '../websocket';
import { useAppUpdate } from '../hooks/useAppUpdate';
import { themes, getTheme, applyTheme, getSavedTheme, type ThemeId } from '../utils/themes';

// Time mode options
export type TimeMode = 'auto' | 'day' | 'night' | 'dawn' | 'dusk';

// Floor style options
export type FloorStyle = 'none' | 'concrete' | 'galactic' | 'metal' | 'hex' | 'circuit' | 'pokemon-stadium';

// Terrain options
export interface TerrainConfig {
  showTrees: boolean;
  showBushes: boolean;
  showHouse: boolean;
  showLamps: boolean;
  showGrass: boolean;
  showClouds: boolean;
  fogDensity: number; // 0 = none, 1 = normal, 2 = heavy
  floorStyle: FloorStyle;
  brightness: number; // 0.2 = dark, 1 = normal, 2 = bright
  skyColor: string | null; // null = auto (based on time), or hex color like '#4a90d9'
}

// Color mode type for agent models
export type ColorMode = 'normal' | 'bw' | 'sepia' | 'cool' | 'warm' | 'neon';

// Agent model style config
export interface ModelStyleConfig {
  saturation: number;      // 0 = grayscale, 1 = normal, 2 = vivid
  roughness: number;       // -1 = use original, 0-1 = override
  metalness: number;       // -1 = use original, 0-1 = override
  emissiveBoost: number;   // 0 = normal, positive = add glow
  envMapIntensity: number; // -1 = use original, 0-2 = override
  wireframe: boolean;      // true = wireframe rendering mode
  colorMode: ColorMode;    // color grading preset
}

// Animation type for status
export type AnimationType = 'static' | 'idle' | 'walk' | 'sprint' | 'jump' | 'fall' | 'crouch' | 'sit' | 'die' | 'emote-yes' | 'emote-no';

// Animation config for different agent statuses
export interface AnimationConfig {
  idleAnimation: AnimationType;
  workingAnimation: AnimationType;
}

export interface SceneConfig {
  characterScale: number;
  indicatorScale: number;
  gridVisible: boolean;
  timeMode: TimeMode;
  terrain: TerrainConfig;
  modelStyle: ModelStyleConfig;
  animations: AnimationConfig;
  fpsLimit: number; // 0 = unlimited, otherwise max FPS (e.g., 30, 60)
}

interface ToolboxProps {
  onConfigChange: (config: SceneConfig) => void;
  onToolChange: (tool: DrawingTool) => void;
  config: SceneConfig;
  isOpen: boolean;
  onClose: () => void;
  onOpenBuildingModal?: (buildingId?: string) => void;
  onOpenAreaExplorer?: (areaId: string) => void;
}

export function Toolbox({ onConfigChange, onToolChange, config, isOpen, onClose, onOpenBuildingModal, onOpenAreaExplorer }: ToolboxProps) {
  const state = useStore();
  const areasArray = Array.from(state.areas.values());
  const buildingsArray = Array.from(state.buildings.values());

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

        {/* Scrollable content area */}
        <div className="toolbox-content">
          {/* Areas Section (includes Drawing Tools) */}
          <div className="toolbox-section toolbox-section-collapsible">
            <CollapsibleSection
              title={`Areas (${areasArray.length})`}
              storageKey="areas"
              defaultOpen={true}
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
              defaultOpen={true}
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
          <ConfigSection config={config} onChange={onConfigChange} />
        </div>
      </aside>
    </>
  );
}

interface AreaItemProps {
  area: DrawingArea;
  isSelected: boolean;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}

function AreaItem({ area, isSelected, onClick, onDelete }: AreaItemProps) {
  const agentCount = area.assignedAgentIds.length;
  const typeLabel = area.type === 'rectangle' ? 'Rect' : 'Circle';

  return (
    <div className={`area-item ${isSelected ? 'selected' : ''}`} onClick={onClick}>
      <div className="area-color-dot" style={{ backgroundColor: area.color }} />
      <div className="area-info">
        <div className="area-name">{area.name}</div>
        <div className="area-meta">
          {typeLabel} {agentCount > 0 && `• ${agentCount} agent${agentCount > 1 ? 's' : ''}`}
        </div>
      </div>
      <button className="area-delete-btn" onClick={onDelete} title="Delete area">
        &times;
      </button>
    </div>
  );
}

// Use BUILDING_STATUS_COLORS from utils/colors.ts

interface BuildingItemProps {
  building: Building;
  isSelected: boolean;
  onClick: () => void;
  onEdit: () => void;
}

function BuildingItem({ building, isSelected, onClick, onEdit }: BuildingItemProps) {
  const typeInfo = BUILDING_TYPES[building.type];

  // Get auto-detected ports from PM2 status polling
  const displayPorts = building.pm2Status?.ports || [];

  const handlePortClick = (e: React.MouseEvent, port: number) => {
    e.stopPropagation();
    window.open(`http://localhost:${port}`, '_blank');
  };

  return (
    <div className={`building-item ${isSelected ? 'selected' : ''}`} onClick={onClick}>
      <div
        className="building-status-dot"
        style={{ backgroundColor: BUILDING_STATUS_COLORS[building.status] }}
        title={building.status}
      />
      <div className="building-icon">{typeInfo.icon}</div>
      <div className="building-info">
        <div className="building-name">{building.name}</div>
        <div className="building-meta">
          {building.type}
          {displayPorts.length > 0 && (
            <span className="building-ports">
              {displayPorts.map(port => (
                <a
                  key={port}
                  href={`http://localhost:${port}`}
                  className="building-port-link"
                  onClick={(e) => handlePortClick(e, port)}
                  title={`Open :${port}`}
                >
                  :{port}
                </a>
              ))}
            </span>
          )}
        </div>
      </div>
      <button
        className="building-edit-btn"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        title="Edit building"
      >
        ⚙
      </button>
    </div>
  );
}

interface BuildingEditorProps {
  building: Building;
  onClose: () => void;
  onOpenModal: () => void;
}

function BuildingEditor({ building, onClose, onOpenModal }: BuildingEditorProps) {
  const { buildingLogs } = useStore();
  const logs = store.getBuildingLogs(building.id);
  const typeInfo = BUILDING_TYPES[building.type];
  const styleInfo = BUILDING_STYLES[building.style || 'server-rack'];

  const handleCommand = (cmd: 'start' | 'stop' | 'restart' | 'healthCheck' | 'logs') => {
    store.sendBuildingCommand(building.id, cmd);
  };

  const openUrl = (url: string) => {
    window.open(url, '_blank');
  };

  return (
    <div className="building-editor">
      <div className="building-editor-header">
        <div className="building-editor-title-row">
          <span className="building-editor-icon">{typeInfo.icon}</span>
          <span className="building-editor-title">{building.name}</span>
          <span
            className="building-editor-status"
            style={{ backgroundColor: BUILDING_STATUS_COLORS[building.status] }}
          >
            {building.status}
          </span>
        </div>
        <button className="building-editor-close" onClick={onClose}>&times;</button>
      </div>

      {/* Quick Info */}
      <div className="building-editor-section">
        <div className="building-editor-info-grid">
          <div className="building-editor-info-item">
            <span className="building-editor-info-label">Type</span>
            <span className="building-editor-info-value">{building.type}</span>
          </div>
          <div className="building-editor-info-item">
            <span className="building-editor-info-label">Style</span>
            <span className="building-editor-info-value">{styleInfo.label}</span>
          </div>
          {building.cwd && (
            <div className="building-editor-info-item building-editor-info-wide">
              <span className="building-editor-info-label">Directory</span>
              <span className="building-editor-info-value building-editor-cwd" title={building.cwd}>
                {building.cwd.split('/').pop() || building.cwd}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      {building.type === 'server' && (
        <div className="building-editor-section">
          <div className="building-editor-section-title">Actions</div>
          <div className="building-editor-actions">
            <button
              className="building-editor-action-btn start"
              onClick={() => handleCommand('start')}
              disabled={!building.commands?.start || building.status === 'running'}
              title={building.commands?.start || 'No start command'}
            >
              ▶ Start
            </button>
            <button
              className="building-editor-action-btn stop"
              onClick={() => handleCommand('stop')}
              disabled={!building.commands?.stop || building.status === 'stopped'}
              title={building.commands?.stop || 'No stop command'}
            >
              ■ Stop
            </button>
            <button
              className="building-editor-action-btn restart"
              onClick={() => handleCommand('restart')}
              disabled={!building.commands?.restart}
              title={building.commands?.restart || 'No restart command'}
            >
              ⟳ Restart
            </button>
            <button
              className="building-editor-action-btn health"
              onClick={() => handleCommand('healthCheck')}
              disabled={!building.commands?.healthCheck}
              title={building.commands?.healthCheck || 'No health check'}
            >
              ♥ Health
            </button>
          </div>
        </div>
      )}

      {/* URLs/Links */}
      {building.urls && building.urls.length > 0 && (
        <div className="building-editor-section">
          <div className="building-editor-section-title">Links</div>
          <div className="building-editor-links">
            {building.urls.map((url, idx) => (
              <button
                key={idx}
                className="building-editor-link"
                onClick={() => openUrl(url.url)}
                title={url.url}
              >
                🔗 {url.label || url.url}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recent Logs */}
      {logs.length > 0 && (
        <div className="building-editor-section">
          <div className="building-editor-section-title">
            Recent Logs
            <button
              className="building-editor-clear-logs"
              onClick={() => store.clearBuildingLogs(building.id)}
              title="Clear logs"
            >
              Clear
            </button>
          </div>
          <div className="building-editor-logs">
            {logs.slice(-5).map((log, idx) => (
              <div key={idx} className="building-editor-log-entry">{log}</div>
            ))}
          </div>
        </div>
      )}

      {/* Edit Button */}
      <div className="building-editor-footer">
        <button className="building-editor-edit-btn" onClick={onOpenModal}>
          ⚙ Full Settings
        </button>
      </div>
    </div>
  );
}

interface AreaEditorProps {
  area: DrawingArea;
  onClose: () => void;
  onOpenFolder?: (areaId: string) => void;
}

function AreaEditor({ area, onClose, onOpenFolder }: AreaEditorProps) {
  const [name, setName] = useState(area.name);
  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [newFolderPath, setNewFolderPath] = useState('');

  useEffect(() => {
    setName(area.name);
  }, [area.id, area.name]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setName(newName);
    store.updateArea(area.id, { name: newName });
  };

  const handleColorSelect = (color: string) => {
    store.updateArea(area.id, { color });
  };

  const handleAddFolder = () => {
    if (newFolderPath.trim()) {
      store.addDirectoryToArea(area.id, newFolderPath.trim());
      setNewFolderPath('');
      setIsAddingFolder(false);
    }
  };

  const handleRemoveFolder = (dirPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    store.removeDirectoryFromArea(area.id, dirPath);
  };

  return (
    <div className="area-editor">
      <div className="area-editor-header">
        <span className="area-editor-title">Edit Area</span>
        <button className="area-editor-close" onClick={onClose}>&times;</button>
      </div>
      <div className="area-editor-row">
        <div className="area-editor-label">Name</div>
        <input
          type="text"
          className="area-editor-input"
          value={name}
          onChange={handleNameChange}
          placeholder="Area name"
        />
      </div>
      <div className="area-editor-row">
        <div className="area-editor-label">Color</div>
        <div className="color-picker-row">
          {AREA_COLORS.map((color) => (
            <div
              key={color}
              className={`color-swatch ${area.color === color ? 'selected' : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => handleColorSelect(color)}
            />
          ))}
        </div>
      </div>

      {/* Folders Configuration */}
      <div className="area-editor-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div className="area-editor-label" style={{ marginBottom: 6 }}>
          Folders ({area.directories.length})
        </div>
        <div className="area-folders-list">
          {area.directories.map((dir) => (
            <div key={dir} className="area-folder-item" title={dir}>
              <span
                className="area-folder-icon clickable"
                onClick={() => onOpenFolder?.(area.id)}
                title="Open folder in explorer"
              >
                📁
              </span>
              <span className="area-folder-path">{dir.split('/').pop() || dir}</span>
              <button
                className="area-folder-remove"
                onClick={(e) => handleRemoveFolder(dir, e)}
                title="Remove folder"
              >
                ×
              </button>
            </div>
          ))}
          {isAddingFolder ? (
            <div className="area-add-folder-inline">
              <input
                type="text"
                className="area-add-folder-input"
                placeholder="/path/to/folder"
                value={newFolderPath}
                onChange={(e) => setNewFolderPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddFolder();
                  if (e.key === 'Escape') {
                    setIsAddingFolder(false);
                    setNewFolderPath('');
                  }
                }}
                autoFocus
              />
              <button className="area-add-folder-confirm" onClick={handleAddFolder}>
                +
              </button>
            </div>
          ) : (
            <button
              className="area-add-folder-btn"
              onClick={() => setIsAddingFolder(true)}
            >
              + Add Folder
            </button>
          )}
        </div>
      </div>

      {area.assignedAgentIds.length > 0 && (
        <div className="area-editor-row">
          <div className="area-editor-label">Assigned Agents ({area.assignedAgentIds.length})</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Right-click to unassign
          </div>
        </div>
      )}
    </div>
  );
}

interface ConfigSectionProps {
  config: SceneConfig;
  onChange: (config: SceneConfig) => void;
}

const TIME_MODE_OPTIONS: { value: TimeMode; label: string; icon: string }[] = [
  { value: 'auto', label: 'Auto', icon: '🕐' },
  { value: 'dawn', label: 'Dawn', icon: '🌅' },
  { value: 'day', label: 'Day', icon: '☀️' },
  { value: 'dusk', label: 'Dusk', icon: '🌇' },
  { value: 'night', label: 'Night', icon: '🌙' },
];

const FLOOR_STYLE_OPTIONS: { value: FloorStyle; label: string; icon: string }[] = [
  { value: 'none', label: 'Grass', icon: '🌱' },
  { value: 'concrete', label: 'Concrete', icon: '🏗️' },
  { value: 'galactic', label: 'Galactic', icon: '🌌' },
  { value: 'metal', label: 'Metal', icon: '⚙️' },
  { value: 'hex', label: 'Hex', icon: '⬡' },
  { value: 'circuit', label: 'Circuit', icon: '🔌' },
  { value: 'pokemon-stadium', label: 'Pokemon', icon: '🔴' },
];

const ANIMATION_OPTIONS: { value: AnimationType; label: string; icon: string }[] = [
  { value: 'static', label: 'Static', icon: '🧍' },
  { value: 'idle', label: 'Idle', icon: '🚶' },
  { value: 'walk', label: 'Walk', icon: '🚶‍♂️' },
  { value: 'sprint', label: 'Sprint', icon: '🏃' },
  { value: 'jump', label: 'Jump', icon: '⬆️' },
  { value: 'fall', label: 'Fall', icon: '⬇️' },
  { value: 'crouch', label: 'Crouch', icon: '🧎' },
  { value: 'sit', label: 'Sit', icon: '🪑' },
  { value: 'die', label: 'Die', icon: '💀' },
  { value: 'emote-yes', label: 'Yes', icon: '👍' },
  { value: 'emote-no', label: 'No', icon: '👎' },
];

// Color mode options for agent models
const COLOR_MODE_OPTIONS: { value: ColorMode; label: string; icon: string }[] = [
  { value: 'normal', label: 'Normal', icon: '🎨' },
  { value: 'bw', label: 'B&W', icon: '⬛' },
  { value: 'sepia', label: 'Sepia', icon: '🟤' },
  { value: 'cool', label: 'Cool', icon: '❄️' },
  { value: 'warm', label: 'Warm', icon: '🔥' },
  { value: 'neon', label: 'Neon', icon: '💜' },
];

// Terrain toggle options for icon-only display
const TERRAIN_OPTIONS: { key: keyof TerrainConfig; icon: string; label: string }[] = [
  { key: 'showTrees', icon: '🌳', label: 'Trees' },
  { key: 'showBushes', icon: '🌿', label: 'Bushes' },
  { key: 'showHouse', icon: '🏠', label: 'House' },
  { key: 'showLamps', icon: '💡', label: 'Lamps' },
  { key: 'showGrass', icon: '🟩', label: 'Grass' },
  { key: 'showClouds', icon: '☁️', label: 'Clouds' },
];

// Sky color presets
const SKY_COLOR_OPTIONS: { value: string | null; label: string; color: string }[] = [
  { value: null, label: 'Auto', color: 'linear-gradient(135deg, #4a90d9 0%, #0a1a2a 100%)' },
  { value: '#4a90d9', label: 'Day Blue', color: '#4a90d9' },
  { value: '#0a1a2a', label: 'Night', color: '#0a1a2a' },
  { value: '#ff6b35', label: 'Sunset', color: '#ff6b35' },
  { value: '#1a0a2e', label: 'Purple', color: '#1a0a2e' },
  { value: '#2d5a27', label: 'Matrix', color: '#2d5a27' },
  { value: '#8b0000', label: 'Blood', color: '#8b0000' },
  { value: '#000000', label: 'Void', color: '#000000' },
];

// Compact toggle switch for config rows
function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="config-toggle">
      <input
        type="checkbox"
        className="config-toggle-input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="config-toggle-track">
        <span className="config-toggle-thumb" />
      </span>
    </label>
  );
}

// Compact chip selector for options
function ChipSelector<T extends string>({
  options,
  value,
  onChange,
  iconOnly = false,
}: {
  options: { value: T; label: string; icon: string }[];
  value: T;
  onChange: (value: T) => void;
  iconOnly?: boolean;
}) {
  return (
    <div className="chip-selector">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`chip ${value === opt.value ? 'active' : ''}`}
          onClick={() => onChange(opt.value)}
          title={opt.label}
        >
          <span className="chip-icon">{opt.icon}</span>
          {!iconOnly && <span className="chip-label">{opt.label}</span>}
        </button>
      ))}
    </div>
  );
}

// Storage key prefix for collapsible sections
const TOOLBOX_COLLAPSE_KEY = 'tide-toolbox-collapse';

// Helper to get/set collapse state from localStorage
function getCollapseState(key: string, defaultValue: boolean): boolean {
  try {
    const stored = localStorage.getItem(`${TOOLBOX_COLLAPSE_KEY}-${key}`);
    if (stored !== null) {
      return stored === 'true';
    }
  } catch {
    // localStorage not available
  }
  return defaultValue;
}

function setCollapseState(key: string, isOpen: boolean): void {
  try {
    localStorage.setItem(`${TOOLBOX_COLLAPSE_KEY}-${key}`, String(isOpen));
  } catch {
    // localStorage not available
  }
}

// Collapsible section component with localStorage persistence
function CollapsibleSection({
  title,
  storageKey,
  defaultOpen = true,
  children,
  headerExtra,
}: {
  title: string;
  storageKey?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  headerExtra?: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(() =>
    storageKey ? getCollapseState(storageKey, defaultOpen) : defaultOpen
  );

  const handleToggle = () => {
    const newState = !isOpen;
    setIsOpen(newState);
    if (storageKey) {
      setCollapseState(storageKey, newState);
    }
  };

  return (
    <div className={`collapsible-section ${isOpen ? 'open' : 'collapsed'}`}>
      <button className="collapsible-header" onClick={handleToggle}>
        <span className="collapsible-title">{title}</span>
        <span className="collapsible-header-right">
          {headerExtra}
          <span className="collapsible-arrow">{isOpen ? '▼' : '▶'}</span>
        </span>
      </button>
      {isOpen && <div className="collapsible-content">{children}</div>}
    </div>
  );
}

// Theme selector component
function ThemeSelector() {
  const [currentTheme, setCurrentTheme] = useState<ThemeId>(() => getSavedTheme());

  const handleThemeChange = (themeId: ThemeId) => {
    setCurrentTheme(themeId);
    const theme = getTheme(themeId);
    applyTheme(theme);
  };

  return (
    <div className="theme-selector">
      <div className="theme-selector-grid">
        {themes.map((theme) => (
          <button
            key={theme.id}
            className={`theme-option ${currentTheme === theme.id ? 'active' : ''}`}
            onClick={() => handleThemeChange(theme.id)}
            title={theme.description}
          >
            <div className="theme-preview">
              <div
                className="theme-preview-bg"
                style={{ backgroundColor: theme.colors.bgPrimary }}
              >
                <div
                  className="theme-preview-accent"
                  style={{ backgroundColor: theme.colors.accentBlue }}
                />
                <div
                  className="theme-preview-claude"
                  style={{ backgroundColor: theme.colors.accentClaude }}
                />
              </div>
            </div>
            <span className="theme-name">{theme.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ConfigSection({ config, onChange }: ConfigSectionProps) {
  const state = useStore();
  const [historyLimit, setHistoryLimit] = useState(state.settings.historyLimit);
  const [backendUrl, setBackendUrl] = useState(() => getStorageString(STORAGE_KEYS.BACKEND_URL, ''));
  const [backendUrlDirty, setBackendUrlDirty] = useState(false);

  const handleBackendUrlChange = (value: string) => {
    setBackendUrl(value);
    setBackendUrlDirty(true);
  };

  const handleBackendUrlSave = () => {
    setStorageString(STORAGE_KEYS.BACKEND_URL, backendUrl);
    setBackendUrlDirty(false);
    reconnect();
  };

  const updateTerrain = (updates: Partial<TerrainConfig>) => {
    onChange({ ...config, terrain: { ...config.terrain, ...updates } });
  };

  const updateModelStyle = (updates: Partial<ModelStyleConfig>) => {
    onChange({ ...config, modelStyle: { ...config.modelStyle, ...updates } });
  };

  const updateAnimations = (updates: Partial<AnimationConfig>) => {
    onChange({ ...config, animations: { ...config.animations, ...updates } });
  };

  const handleHistoryLimitChange = (value: number) => {
    setHistoryLimit(value);
    store.updateSettings({ historyLimit: value });
  };

  const toggleTerrain = (key: keyof TerrainConfig) => {
    const currentValue = config.terrain[key];
    if (typeof currentValue === 'boolean') {
      updateTerrain({ [key]: !currentValue });
    }
  };

  return (
    <div className="config-section">
      {/* General Settings */}
      <CollapsibleSection title="General" storageKey="general" defaultOpen={true}>
        <div className="config-row">
          <span className="config-label">History</span>
          <input
            type="number"
            className="config-input config-input-sm"
            value={historyLimit}
            onChange={(e) => handleHistoryLimitChange(parseInt(e.target.value) || 100)}
            min={50}
            max={2000}
            step={50}
          />
        </div>
        <div className="config-row">
          <span className="config-label">Hide Costs</span>
          <Toggle
            checked={state.settings.hideCost}
            onChange={(checked) => store.updateSettings({ hideCost: checked })}
          />
        </div>
        <div className="config-row">
          <span className="config-label">Grid</span>
          <Toggle
            checked={config.gridVisible}
            onChange={(checked) => onChange({ ...config, gridVisible: checked })}
          />
        </div>
        <div className="config-row">
          <span className="config-label">Show FPS</span>
          <Toggle
            checked={state.settings.showFPS}
            onChange={(checked) => store.updateSettings({ showFPS: checked })}
          />
        </div>
        <div className="config-row">
          <span className="config-label">FPS Limit</span>
          <input
            type="range"
            className="config-slider"
            min="0"
            max="120"
            step="10"
            value={config.fpsLimit}
            onChange={(e) => onChange({ ...config, fpsLimit: parseInt(e.target.value) })}
          />
          <span className="config-value">{config.fpsLimit === 0 ? '∞' : config.fpsLimit}</span>
        </div>
        <div className="config-row">
          <span className="config-label" title="Experimental: Reduce FPS when idle to save power">Power Saving ⚡</span>
          <Toggle
            checked={state.settings.powerSaving}
            onChange={(checked) => store.updateSettings({ powerSaving: checked })}
          />
        </div>
      </CollapsibleSection>

      {/* Appearance Settings */}
      <CollapsibleSection title="Appearance" storageKey="appearance" defaultOpen={false}>
        <ThemeSelector />
      </CollapsibleSection>

      {/* Connection Settings */}
      <CollapsibleSection title="Connection" storageKey="connection" defaultOpen={false}>
        <div className="config-row config-row-stacked">
          <span className="config-label">Backend URL</span>
          <div className="config-input-group">
            <input
              type="text"
              className="config-input config-input-full"
              value={backendUrl}
              onChange={(e) => handleBackendUrlChange(e.target.value)}
              placeholder="http://127.0.0.1:5174"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && backendUrlDirty) {
                  handleBackendUrlSave();
                }
              }}
            />
            {backendUrlDirty && (
              <button
                className="config-btn config-btn-sm"
                onClick={handleBackendUrlSave}
                title="Save and reconnect"
              >
                Apply
              </button>
            )}
          </div>
          <span className="config-hint">Leave empty for auto-detect</span>
        </div>
        <div className="config-row">
          <span className="config-label">Manual</span>
          <button
            className="config-btn"
            onClick={() => reconnect()}
            title="Force reconnect to server"
          >
            Reconnect
          </button>
        </div>
      </CollapsibleSection>

      {/* Scene Settings */}
      <CollapsibleSection title="Scene" storageKey="scene" defaultOpen={false}>
        <div className="config-row">
          <span className="config-label">Char Size</span>
          <input
            type="range"
            className="config-slider"
            min="0.3"
            max="3.0"
            step="0.1"
            value={config.characterScale}
            onChange={(e) => onChange({ ...config, characterScale: parseFloat(e.target.value) })}
          />
          <span className="config-value">{config.characterScale.toFixed(1)}x</span>
        </div>
        <div className="config-row">
          <span className="config-label">Indicator</span>
          <input
            type="range"
            className="config-slider"
            min="0.3"
            max="2.0"
            step="0.1"
            value={config.indicatorScale}
            onChange={(e) => onChange({ ...config, indicatorScale: parseFloat(e.target.value) })}
          />
          <span className="config-value">{config.indicatorScale.toFixed(1)}x</span>
        </div>
        <div className="config-group">
          <span className="config-label">Time</span>
          <ChipSelector
            options={TIME_MODE_OPTIONS}
            value={config.timeMode}
            onChange={(mode) => onChange({ ...config, timeMode: mode })}
            iconOnly
          />
        </div>
      </CollapsibleSection>

      {/* Terrain Settings */}
      <CollapsibleSection title="Terrain" storageKey="terrain" defaultOpen={false}>
        <div className="terrain-icons">
          {TERRAIN_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              className={`terrain-icon-btn ${config.terrain[opt.key] ? 'active' : ''}`}
              onClick={() => toggleTerrain(opt.key)}
              title={opt.label}
            >
              {opt.icon}
            </button>
          ))}
        </div>
        <div className="config-row">
          <span className="config-label">Fog</span>
          <input
            type="range"
            className="config-slider"
            min="0"
            max="2"
            step="0.1"
            value={config.terrain.fogDensity}
            onChange={(e) => updateTerrain({ fogDensity: parseFloat(e.target.value) })}
          />
          <span className="config-value">
            {config.terrain.fogDensity === 0 ? 'Off' : config.terrain.fogDensity <= 1 ? 'Low' : 'Hi'}
          </span>
        </div>
        <div className="config-row">
          <span className="config-label">Brightness</span>
          <input
            type="range"
            className="config-slider"
            min="0.2"
            max="2"
            step="0.1"
            value={config.terrain.brightness}
            onChange={(e) => updateTerrain({ brightness: parseFloat(e.target.value) })}
          />
          <span className="config-value">
            {config.terrain.brightness <= 0.5 ? 'Dark' : config.terrain.brightness <= 1.2 ? 'Normal' : 'Bright'}
          </span>
        </div>
        <div className="config-group">
          <span className="config-label">Floor</span>
          <ChipSelector
            options={FLOOR_STYLE_OPTIONS}
            value={config.terrain.floorStyle}
            onChange={(style) => updateTerrain({ floorStyle: style })}
            iconOnly
          />
        </div>
        <div className="config-group">
          <span className="config-label">Sky</span>
          <div className="sky-color-selector">
            {SKY_COLOR_OPTIONS.map((opt) => (
              <button
                key={opt.value ?? 'auto'}
                className={`sky-color-btn ${config.terrain.skyColor === opt.value ? 'active' : ''}`}
                onClick={() => updateTerrain({ skyColor: opt.value })}
                title={opt.label}
                style={{ background: opt.color }}
              />
            ))}
          </div>
        </div>
      </CollapsibleSection>

      {/* Agent Model Style Settings */}
      <CollapsibleSection title="Agent Model Style" storageKey="modelStyle" defaultOpen={false}>
        <div className="config-row">
          <span className="config-label">Saturation</span>
          <input
            type="range"
            className="config-slider"
            min="0"
            max="2"
            step="0.1"
            value={config.modelStyle.saturation}
            onChange={(e) => updateModelStyle({ saturation: parseFloat(e.target.value) })}
          />
          <span className="config-value">
            {config.modelStyle.saturation <= 0.3 ? 'Gray' : config.modelStyle.saturation <= 1.2 ? 'Normal' : 'Vivid'}
          </span>
        </div>
        <div className="config-row">
          <span className="config-label">Roughness</span>
          <input
            type="range"
            className="config-slider"
            min="-1"
            max="1"
            step="0.1"
            value={config.modelStyle.roughness}
            onChange={(e) => updateModelStyle({ roughness: parseFloat(e.target.value) })}
          />
          <span className="config-value">
            {config.modelStyle.roughness < 0 ? 'Auto' : config.modelStyle.roughness <= 0.3 ? 'Glossy' : config.modelStyle.roughness <= 0.7 ? 'Normal' : 'Matte'}
          </span>
        </div>
        <div className="config-row">
          <span className="config-label">Metalness</span>
          <input
            type="range"
            className="config-slider"
            min="-1"
            max="1"
            step="0.1"
            value={config.modelStyle.metalness}
            onChange={(e) => updateModelStyle({ metalness: parseFloat(e.target.value) })}
          />
          <span className="config-value">
            {config.modelStyle.metalness < 0 ? 'Auto' : config.modelStyle.metalness <= 0.3 ? 'Plastic' : config.modelStyle.metalness <= 0.7 ? 'Mixed' : 'Metal'}
          </span>
        </div>
        <div className="config-row">
          <span className="config-label">Glow</span>
          <input
            type="range"
            className="config-slider"
            min="0"
            max="1"
            step="0.05"
            value={config.modelStyle.emissiveBoost}
            onChange={(e) => updateModelStyle({ emissiveBoost: parseFloat(e.target.value) })}
          />
          <span className="config-value">
            {config.modelStyle.emissiveBoost <= 0.1 ? 'Off' : config.modelStyle.emissiveBoost <= 0.4 ? 'Low' : config.modelStyle.emissiveBoost <= 0.7 ? 'Med' : 'High'}
          </span>
        </div>
        <div className="config-row">
          <span className="config-label">Reflections</span>
          <input
            type="range"
            className="config-slider"
            min="-1"
            max="2"
            step="0.1"
            value={config.modelStyle.envMapIntensity}
            onChange={(e) => updateModelStyle({ envMapIntensity: parseFloat(e.target.value) })}
          />
          <span className="config-value">
            {config.modelStyle.envMapIntensity < 0 ? 'Auto' : config.modelStyle.envMapIntensity <= 0.3 ? 'Low' : config.modelStyle.envMapIntensity <= 1 ? 'Normal' : 'High'}
          </span>
        </div>
        <div className="config-row">
          <span className="config-label">Wireframe</span>
          <Toggle
            checked={config.modelStyle.wireframe}
            onChange={(checked) => updateModelStyle({ wireframe: checked })}
          />
        </div>
        <div className="config-group">
          <span className="config-label">Color Mode</span>
          <ChipSelector
            options={COLOR_MODE_OPTIONS}
            value={config.modelStyle.colorMode}
            onChange={(mode) => updateModelStyle({ colorMode: mode })}
            iconOnly
          />
        </div>
      </CollapsibleSection>

      {/* Animations Settings */}
      <CollapsibleSection title="Animations" storageKey="animations" defaultOpen={false}>
        <div className="config-group">
          <span className="config-label">Idle</span>
          <ChipSelector
            options={ANIMATION_OPTIONS}
            value={config.animations.idleAnimation}
            onChange={(anim) => updateAnimations({ idleAnimation: anim })}
            iconOnly
          />
        </div>
        <div className="config-group">
          <span className="config-label">Working</span>
          <ChipSelector
            options={ANIMATION_OPTIONS}
            value={config.animations.workingAnimation}
            onChange={(anim) => updateAnimations({ workingAnimation: anim })}
            iconOnly
          />
        </div>
      </CollapsibleSection>

      {/* Secrets Section */}
      <CollapsibleSection title="Secrets" storageKey="secrets" defaultOpen={false}>
        <SecretsSection />
      </CollapsibleSection>

      {/* Data Export/Import Section */}
      <CollapsibleSection title="Data" storageKey="data" defaultOpen={false}>
        <DataSection />
      </CollapsibleSection>

      {/* About Section */}
      <CollapsibleSection title="About" storageKey="about" defaultOpen={false}>
        <AboutSection />
      </CollapsibleSection>
    </div>
  );
}

// Secrets Section - Manage secrets for placeholder replacement
function SecretsSection() {
  const secrets = useSecretsArray();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', key: '', value: '', description: '' });

  const handleAdd = () => {
    setIsAdding(true);
    setEditingId(null);
    setFormData({ name: '', key: '', value: '', description: '' });
  };

  const handleEdit = (secret: Secret) => {
    setEditingId(secret.id);
    setIsAdding(false);
    setFormData({
      name: secret.name,
      key: secret.key,
      value: secret.value,
      description: secret.description || '',
    });
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData({ name: '', key: '', value: '', description: '' });
  };

  const handleSave = () => {
    if (!formData.name.trim() || !formData.key.trim()) return;

    if (editingId) {
      store.updateSecret(editingId, {
        name: formData.name.trim(),
        key: formData.key.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
        value: formData.value,
        description: formData.description.trim() || undefined,
      });
    } else {
      store.createSecret({
        name: formData.name.trim(),
        key: formData.key.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
        value: formData.value,
        description: formData.description.trim() || undefined,
      });
    }
    handleCancel();
  };

  const handleDelete = (id: string) => {
    if (confirm('Delete this secret?')) {
      store.deleteSecret(id);
      if (editingId === id) handleCancel();
    }
  };

  const copyPlaceholder = (key: string) => {
    navigator.clipboard.writeText(`{{${key}}}`);
  };

  return (
    <div className="secrets-section">
      <div className="secrets-description">
        Store secrets that can be referenced in prompts using <code>{`{{KEY}}`}</code> placeholders.
      </div>

      {/* Secrets List */}
      <div className="secrets-list">
        {secrets.length === 0 && !isAdding ? (
          <div className="secrets-empty">No secrets configured</div>
        ) : (
          secrets.map((secret) => (
            <div
              key={secret.id}
              className={`secret-item ${editingId === secret.id ? 'editing' : ''}`}
            >
              <div className="secret-item-header">
                <div className="secret-item-info">
                  <span className="secret-item-name">{secret.name}</span>
                  <code
                    className="secret-item-key"
                    onClick={() => copyPlaceholder(secret.key)}
                    title="Click to copy placeholder"
                  >
                    {`{{${secret.key}}}`}
                  </code>
                </div>
                <div className="secret-item-actions">
                  <button
                    className="secret-item-btn edit"
                    onClick={() => handleEdit(secret)}
                    title="Edit"
                  >
                    ✎
                  </button>
                  <button
                    className="secret-item-btn delete"
                    onClick={() => handleDelete(secret.id)}
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              </div>
              {secret.description && (
                <div className="secret-item-description">{secret.description}</div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add/Edit Form */}
      {(isAdding || editingId) && (
        <div className="secret-form">
          <div className="secret-form-row">
            <label className="secret-form-label">Name</label>
            <input
              type="text"
              className="secret-form-input"
              placeholder="My API Key"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              autoFocus
            />
          </div>
          <div className="secret-form-row">
            <label className="secret-form-label">Key</label>
            <input
              type="text"
              className="secret-form-input"
              placeholder="MY_API_KEY"
              value={formData.key}
              onChange={(e) => setFormData({ ...formData, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })}
            />
            <span className="secret-form-hint">Used as {`{{${formData.key || 'KEY'}}}`}</span>
          </div>
          <div className="secret-form-row">
            <label className="secret-form-label">Value</label>
            <input
              type="password"
              className="secret-form-input"
              placeholder="secret value..."
              value={formData.value}
              onChange={(e) => setFormData({ ...formData, value: e.target.value })}
            />
          </div>
          <div className="secret-form-row">
            <label className="secret-form-label">Description</label>
            <input
              type="text"
              className="secret-form-input"
              placeholder="Optional description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>
          <div className="secret-form-actions">
            <button className="secret-form-btn cancel" onClick={handleCancel}>
              Cancel
            </button>
            <button
              className="secret-form-btn save"
              onClick={handleSave}
              disabled={!formData.name.trim() || !formData.key.trim()}
            >
              {editingId ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* Add Button */}
      {!isAdding && !editingId && (
        <button className="secrets-add-btn" onClick={handleAdd}>
          + Add Secret
        </button>
      )}
    </div>
  );
}

// Config category for export/import
interface ConfigCategory {
  id: string;
  name: string;
  description: string;
  fileCount?: number;
}

function DataSection() {
  const [categories, setCategories] = useState<ConfigCategory[]>([]);
  const [selectedExport, setSelectedExport] = useState<Set<string>>(new Set());
  const [selectedImport, setSelectedImport] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<{ version: string; exportedAt: string; categories: ConfigCategory[] } | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Fetch available categories on mount
  useEffect(() => {
    fetch(apiUrl('/api/config/categories'))
      .then(res => res.json())
      .then((cats: ConfigCategory[]) => {
        setCategories(cats);
        setSelectedExport(new Set(cats.map(c => c.id)));
      })
      .catch(err => console.error('Failed to fetch config categories:', err));
  }, []);

  const toggleExportCategory = (id: string) => {
    setSelectedExport(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleImportCategory = (id: string) => {
    setSelectedImport(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllExport = () => setSelectedExport(new Set(categories.map(c => c.id)));
  const selectNoneExport = () => setSelectedExport(new Set());

  const selectAllImport = () => {
    if (importPreview) {
      setSelectedImport(new Set(importPreview.categories.map(c => c.id)));
    }
  };
  const selectNoneImport = () => setSelectedImport(new Set());

  const handleExport = async () => {
    if (selectedExport.size === 0) return;

    setIsExporting(true);
    setMessage(null);

    try {
      const categoriesParam = Array.from(selectedExport).join(',');
      const response = await fetch(apiUrl(`/api/config/export?categories=${categoriesParam}`));

      if (!response.ok) {
        throw new Error('Export failed');
      }

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const contentDisposition = response.headers.get('Content-Disposition');
      const filename = contentDisposition?.match(/filename="(.+)"/)?.[1] || 'tide-commander-config.zip';
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setMessage({ type: 'success', text: 'Config exported successfully!' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Export failed' });
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFile(file);
    setMessage(null);
    setImportPreview(null);
    setSelectedImport(new Set());

    try {
      const response = await fetch(apiUrl('/api/config/preview'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: await file.arrayBuffer(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to preview config file');
      }

      const preview = await response.json();
      setImportPreview(preview);
      setSelectedImport(new Set(preview.categories.map((c: ConfigCategory) => c.id)));
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to read config file' });
      setImportFile(null);
    }
  };

  const handleImport = async () => {
    if (!importFile || selectedImport.size === 0) return;

    setIsImporting(true);
    setMessage(null);

    try {
      const categoriesParam = Array.from(selectedImport).join(',');
      const response = await fetch(apiUrl(`/api/config/import?categories=${categoriesParam}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: await importFile.arrayBuffer(),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Import failed');
      }

      setMessage({ type: 'success', text: result.message || 'Config imported successfully!' });
      setImportFile(null);
      setImportPreview(null);
      setSelectedImport(new Set());
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Import failed' });
    } finally {
      setIsImporting(false);
    }
  };

  const cancelImport = () => {
    setImportFile(null);
    setImportPreview(null);
    setSelectedImport(new Set());
    setMessage(null);
  };

  return (
    <div className="data-section">
      {message && (
        <div className={`data-message data-message-${message.type}`}>
          {message.text}
        </div>
      )}

      {/* Export Section */}
      <div className="data-subsection">
        <div className="data-subsection-header">
          <span className="data-subsection-title">Export</span>
          <div className="data-select-controls">
            <button className="data-select-btn" onClick={selectAllExport}>All</button>
            <button className="data-select-btn" onClick={selectNoneExport}>None</button>
          </div>
        </div>
        <div className="data-category-list">
          {categories.map(cat => (
            <label key={cat.id} className="data-category-item">
              <input
                type="checkbox"
                checked={selectedExport.has(cat.id)}
                onChange={() => toggleExportCategory(cat.id)}
              />
              <span className="data-category-name">{cat.name}</span>
            </label>
          ))}
        </div>
        <button
          className="data-action-btn export"
          onClick={handleExport}
          disabled={isExporting || selectedExport.size === 0}
        >
          {isExporting ? 'Exporting...' : `Export (${selectedExport.size})`}
        </button>
      </div>

      {/* Import Section */}
      <div className="data-subsection">
        <div className="data-subsection-header">
          <span className="data-subsection-title">Import</span>
        </div>

        {!importFile ? (
          <label className="data-file-input">
            <input
              type="file"
              accept=".zip"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            <span className="data-file-input-label">Select config ZIP file...</span>
          </label>
        ) : importPreview ? (
          <>
            <div className="data-import-info">
              <div className="data-import-file">{importFile.name}</div>
              <div className="data-import-date">
                Exported: {new Date(importPreview.exportedAt).toLocaleDateString()}
              </div>
            </div>
            <div className="data-subsection-header">
              <span className="data-subsection-subtitle">Select what to import:</span>
              <div className="data-select-controls">
                <button className="data-select-btn" onClick={selectAllImport}>All</button>
                <button className="data-select-btn" onClick={selectNoneImport}>None</button>
              </div>
            </div>
            <div className="data-category-list">
              {importPreview.categories.map(cat => (
                <label key={cat.id} className="data-category-item">
                  <input
                    type="checkbox"
                    checked={selectedImport.has(cat.id)}
                    onChange={() => toggleImportCategory(cat.id)}
                  />
                  <span className="data-category-name">{cat.name}</span>
                  {cat.fileCount && (
                    <span className="data-category-count">({cat.fileCount} files)</span>
                  )}
                </label>
              ))}
            </div>
            <div className="data-import-actions">
              <button className="data-action-btn cancel" onClick={cancelImport}>
                Cancel
              </button>
              <button
                className="data-action-btn import"
                onClick={handleImport}
                disabled={isImporting || selectedImport.size === 0}
              >
                {isImporting ? 'Importing...' : `Import (${selectedImport.size})`}
              </button>
            </div>
          </>
        ) : (
          <div className="data-loading">Reading file...</div>
        )}
      </div>
    </div>
  );
}

function AboutSection() {
  const {
    updateAvailable,
    updateInfo,
    recentReleases,
    isChecking,
    error,
    currentVersion,
    isAndroid,
    checkForUpdate,
    downloadAndInstall,
    openReleasePage,
  } = useAppUpdate();

  const formatSize = (bytes: number | null): string => {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <div className="about-section">
      <div className="about-logo">
        <span className="about-logo-icon">🌊</span>
        <span className="about-logo-text">Tide Commander</span>
      </div>

      <div className="about-version">
        <span className="about-version-label">Version</span>
        <span className="about-version-value">{currentVersion}</span>
      </div>

      {/* Update Section */}
      <div className="about-update">
        {updateAvailable && updateInfo ? (
          <div className="about-update-available">
            <div className="about-update-header">
              <span className="about-update-badge">Update Available</span>
              <span className="about-update-version">{updateInfo.version}</span>
            </div>
            {updateInfo.apkSize && (
              <div className="about-update-size">Size: {formatSize(updateInfo.apkSize)}</div>
            )}
            {error && <div className="about-update-error">{error}</div>}
            <div className="about-update-actions">
              <button className="about-update-btn changelog" onClick={openReleasePage}>
                Changelog
              </button>
              {isAndroid && updateInfo.apkUrl ? (
                <button className="about-update-btn download" onClick={downloadAndInstall}>
                  Download APK
                </button>
              ) : (
                <button className="about-update-btn download" onClick={openReleasePage}>
                  View Release
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="about-update-check">
            <span className="about-update-status">
              {isChecking ? 'Checking for updates...' : 'You are up to date'}
            </span>
            <button
              className="about-update-btn check"
              onClick={() => checkForUpdate(true)}
              disabled={isChecking}
            >
              {isChecking ? '...' : 'Check'}
            </button>
          </div>
        )}

        {/* Recent Releases */}
        {recentReleases.length > 0 && (
          <div className="about-releases">
            <div className="about-releases-title">Recent Releases</div>
            <div className="about-releases-list">
              {recentReleases.map((release) => (
                <a
                  key={release.version}
                  href={release.releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`about-release-item ${release.version === `v${currentVersion}` || release.version === currentVersion ? 'current' : ''}`}
                >
                  <span className="about-release-version">{release.version}</span>
                  <span className="about-release-date">{formatDate(release.publishedAt)}</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="about-description">
        Visual multi-agent orchestration for Claude Code
      </div>

      <div className="about-principles">
        <div className="about-principles-title">Core Principles</div>
        <ul className="about-principles-list">
          <li>Visual-first agent management</li>
          <li>Real-time collaboration & delegation</li>
          <li>Spatial organization with areas & buildings</li>
          <li>Transparent agent communication</li>
        </ul>
      </div>

      <div className="about-links">
        <a
          href="https://github.com/deivid11/tide-commander"
          target="_blank"
          rel="noopener noreferrer"
          className="about-link"
        >
          <span className="about-link-icon">📦</span>
          <span>GitHub Repository</span>
        </a>
      </div>

      <div className="about-credits">
        <div className="about-credits-title">Special Thanks</div>
        <div className="about-credit-item">
          <a
            href="https://kenney.nl"
            target="_blank"
            rel="noopener noreferrer"
            className="about-credit-link"
          >
            Kenney.nl
          </a>
          <span className="about-credit-desc">for the agent character models</span>
        </div>
        <div className="about-credit-item">
          <a
            href="https://claude.ai/code"
            target="_blank"
            rel="noopener noreferrer"
            className="about-credit-link"
          >
            Claude Code
          </a>
          <span className="about-credit-desc">by Anthropic, the AI backbone</span>
        </div>
      </div>
    </div>
  );
}

