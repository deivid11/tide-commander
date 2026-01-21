import React, { useState, useEffect } from 'react';
import { useStore, store } from '../store';
import type { DrawingArea, DrawingTool, Building } from '../../shared/types';
import { BUILDING_TYPES, BUILDING_STYLES, type BuildingStyle } from '../../shared/types';
import { AREA_COLORS, BUILDING_STATUS_COLORS } from '../utils/colors';

// Time mode options
export type TimeMode = 'auto' | 'day' | 'night' | 'dawn' | 'dusk';

// Floor style options
export type FloorStyle = 'none' | 'concrete' | 'galactic' | 'metal' | 'hex' | 'circuit';

// Terrain options
export interface TerrainConfig {
  showTrees: boolean;
  showBushes: boolean;
  showHouse: boolean;
  showLamps: boolean;
  showGrass: boolean;
  fogDensity: number; // 0 = none, 1 = normal, 2 = heavy
  floorStyle: FloorStyle;
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
}

export function Toolbox({ onConfigChange, onToolChange, config, isOpen, onClose, onOpenBuildingModal }: ToolboxProps) {
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
          {/* Drawing Tools */}
          <div className="toolbox-section">
            <div className="toolbox-section-header">Drawing Tools</div>
            <div className="tool-buttons">
              <button
                className={`tool-btn ${state.activeTool === 'select' ? 'active' : ''}`}
                onClick={() => handleToolSelect('select')}
                title="Select"
              >
                <span>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
                  </svg>
                </span>
                <span className="tool-btn-label">Select</span>
              </button>
              <button
                className={`tool-btn ${state.activeTool === 'rectangle' ? 'active' : ''}`}
                onClick={() => handleToolSelect('rectangle')}
                title="Rectangle"
              >
                <span>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                  </svg>
                </span>
                <span className="tool-btn-label">Rect</span>
              </button>
              <button
                className={`tool-btn ${state.activeTool === 'circle' ? 'active' : ''}`}
                onClick={() => handleToolSelect('circle')}
                title="Circle"
              >
                <span>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="9" />
                  </svg>
                </span>
                <span className="tool-btn-label">Circle</span>
              </button>
            </div>
          </div>

          {/* Areas List */}
          <div className="toolbox-section" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
            <div className="toolbox-section-header" style={{ padding: '12px 12px 10px' }}>
              Areas ({areasArray.length})
            </div>
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
          </div>

          {/* Area Editor */}
          {state.selectedAreaId && (
            <AreaEditor
              area={state.areas.get(state.selectedAreaId)!}
              onClose={() => store.selectArea(null)}
            />
          )}

          {/* Buildings Section */}
          <div className="toolbox-section buildings-section">
            <div className="toolbox-section-header">
              Buildings ({buildingsArray.length})
              <button
                className="add-building-btn"
                onClick={() => onOpenBuildingModal?.()}
                title="Add Building"
              >
                +
              </button>
            </div>
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
        <div className="building-meta">{building.type}</div>
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
}

function AreaEditor({ area, onClose }: AreaEditorProps) {
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
              <span className="area-folder-icon">📁</span>
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
  { value: 'hex', label: 'Hexagon', icon: '⬡' },
  { value: 'circuit', label: 'Circuit', icon: '🔌' },
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

function TimeModePicker({ value, onChange }: { value: TimeMode; onChange: (mode: TimeMode) => void }) {
  const currentIndex = TIME_MODE_OPTIONS.findIndex(opt => opt.value === value);

  const handlePrev = () => {
    const newIndex = currentIndex > 0 ? currentIndex - 1 : TIME_MODE_OPTIONS.length - 1;
    onChange(TIME_MODE_OPTIONS[newIndex].value);
  };

  const handleNext = () => {
    const newIndex = currentIndex < TIME_MODE_OPTIONS.length - 1 ? currentIndex + 1 : 0;
    onChange(TIME_MODE_OPTIONS[newIndex].value);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY > 0) {
      handleNext();
    } else {
      handlePrev();
    }
  };

  const current = TIME_MODE_OPTIONS[currentIndex];
  const prev = TIME_MODE_OPTIONS[currentIndex > 0 ? currentIndex - 1 : TIME_MODE_OPTIONS.length - 1];
  const next = TIME_MODE_OPTIONS[currentIndex < TIME_MODE_OPTIONS.length - 1 ? currentIndex + 1 : 0];

  return (
    <div className="time-picker" onWheel={handleWheel}>
      <button className="time-picker-arrow up" onClick={handlePrev}>▲</button>
      <div className="time-picker-items">
        <div className="time-picker-item faded">{prev.icon}</div>
        <div className="time-picker-item current">
          <span className="time-picker-icon">{current.icon}</span>
          <span className="time-picker-label">{current.label}</span>
        </div>
        <div className="time-picker-item faded">{next.icon}</div>
      </div>
      <button className="time-picker-arrow down" onClick={handleNext}>▼</button>
    </div>
  );
}

function FloorStylePicker({ value, onChange }: { value: FloorStyle; onChange: (style: FloorStyle) => void }) {
  const currentIndex = FLOOR_STYLE_OPTIONS.findIndex(opt => opt.value === value);

  const handlePrev = () => {
    const newIndex = currentIndex > 0 ? currentIndex - 1 : FLOOR_STYLE_OPTIONS.length - 1;
    onChange(FLOOR_STYLE_OPTIONS[newIndex].value);
  };

  const handleNext = () => {
    const newIndex = currentIndex < FLOOR_STYLE_OPTIONS.length - 1 ? currentIndex + 1 : 0;
    onChange(FLOOR_STYLE_OPTIONS[newIndex].value);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY > 0) {
      handleNext();
    } else {
      handlePrev();
    }
  };

  const current = FLOOR_STYLE_OPTIONS[currentIndex];
  const prev = FLOOR_STYLE_OPTIONS[currentIndex > 0 ? currentIndex - 1 : FLOOR_STYLE_OPTIONS.length - 1];
  const next = FLOOR_STYLE_OPTIONS[currentIndex < FLOOR_STYLE_OPTIONS.length - 1 ? currentIndex + 1 : 0];

  return (
    <div className="time-picker" onWheel={handleWheel}>
      <button className="time-picker-arrow up" onClick={handlePrev}>▲</button>
      <div className="time-picker-items">
        <div className="time-picker-item faded">{prev.icon}</div>
        <div className="time-picker-item current">
          <span className="time-picker-icon">{current.icon}</span>
          <span className="time-picker-label">{current.label}</span>
        </div>
        <div className="time-picker-item faded">{next.icon}</div>
      </div>
      <button className="time-picker-arrow down" onClick={handleNext}>▼</button>
    </div>
  );
}

function AnimationPicker({ value, onChange }: { value: AnimationType; onChange: (anim: AnimationType) => void }) {
  const currentIndex = ANIMATION_OPTIONS.findIndex(opt => opt.value === value);

  const handlePrev = () => {
    const newIndex = currentIndex > 0 ? currentIndex - 1 : ANIMATION_OPTIONS.length - 1;
    onChange(ANIMATION_OPTIONS[newIndex].value);
  };

  const handleNext = () => {
    const newIndex = currentIndex < ANIMATION_OPTIONS.length - 1 ? currentIndex + 1 : 0;
    onChange(ANIMATION_OPTIONS[newIndex].value);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY > 0) {
      handleNext();
    } else {
      handlePrev();
    }
  };

  const current = ANIMATION_OPTIONS[currentIndex];
  const prev = ANIMATION_OPTIONS[currentIndex > 0 ? currentIndex - 1 : ANIMATION_OPTIONS.length - 1];
  const next = ANIMATION_OPTIONS[currentIndex < ANIMATION_OPTIONS.length - 1 ? currentIndex + 1 : 0];

  return (
    <div className="time-picker" onWheel={handleWheel}>
      <button className="time-picker-arrow up" onClick={handlePrev}>▲</button>
      <div className="time-picker-items">
        <div className="time-picker-item faded">{prev.icon}</div>
        <div className="time-picker-item current">
          <span className="time-picker-icon">{current.icon}</span>
          <span className="time-picker-label">{current.label}</span>
        </div>
        <div className="time-picker-item faded">{next.icon}</div>
      </div>
      <button className="time-picker-arrow down" onClick={handleNext}>▼</button>
    </div>
  );
}

function ConfigSection({ config, onChange }: ConfigSectionProps) {
  const state = useStore();
  const [historyLimit, setHistoryLimit] = useState(state.settings.historyLimit);

  const updateTerrain = (updates: Partial<TerrainConfig>) => {
    onChange({ ...config, terrain: { ...config.terrain, ...updates } });
  };

  const updateAnimations = (updates: Partial<AnimationConfig>) => {
    onChange({ ...config, animations: { ...config.animations, ...updates } });
  };

  const handleHistoryLimitChange = (value: number) => {
    setHistoryLimit(value);
    store.updateSettings({ historyLimit: value });
  };

  return (
    <div className="config-section">
      <div className="toolbox-section-header">Settings</div>

      {/* History Limit */}
      <div className="config-row">
        <span className="config-label">History Limit</span>
        <input
          type="number"
          className="config-input"
          value={historyLimit}
          onChange={(e) => handleHistoryLimitChange(parseInt(e.target.value) || 100)}
          min={50}
          max={2000}
          step={50}
        />
        <span className="config-value">msgs</span>
      </div>
      <div className="config-row">
        <span className="config-label">Hide Costs</span>
        <input
          type="checkbox"
          checked={state.settings.hideCost}
          onChange={(e) => store.updateSettings({ hideCost: e.target.checked })}
        />
      </div>
      <div className="config-row">
        <span className="config-label">Character Size</span>
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
        <span className="config-label">Indicator Size</span>
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
      <div className="config-row">
        <span className="config-label">Show Grid</span>
        <input
          type="checkbox"
          checked={config.gridVisible}
          onChange={(e) => onChange({ ...config, gridVisible: e.target.checked })}
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
      <div className="config-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
        <span className="config-label">Time of Day</span>
        <TimeModePicker
          value={config.timeMode}
          onChange={(mode) => onChange({ ...config, timeMode: mode })}
        />
      </div>

      <div className="toolbox-section-header" style={{ marginTop: 10 }}>Terrain</div>
      <div className="terrain-toggles">
        <label className="terrain-toggle">
          <input
            type="checkbox"
            checked={config.terrain.showTrees}
            onChange={(e) => updateTerrain({ showTrees: e.target.checked })}
          />
          <span>🌳 Trees</span>
        </label>
        <label className="terrain-toggle">
          <input
            type="checkbox"
            checked={config.terrain.showBushes}
            onChange={(e) => updateTerrain({ showBushes: e.target.checked })}
          />
          <span>🌿 Bushes</span>
        </label>
        <label className="terrain-toggle">
          <input
            type="checkbox"
            checked={config.terrain.showHouse}
            onChange={(e) => updateTerrain({ showHouse: e.target.checked })}
          />
          <span>🏠 House</span>
        </label>
        <label className="terrain-toggle">
          <input
            type="checkbox"
            checked={config.terrain.showLamps}
            onChange={(e) => updateTerrain({ showLamps: e.target.checked })}
          />
          <span>💡 Lamps</span>
        </label>
        <label className="terrain-toggle">
          <input
            type="checkbox"
            checked={config.terrain.showGrass}
            onChange={(e) => updateTerrain({ showGrass: e.target.checked })}
          />
          <span>🟩 Grass</span>
        </label>
      </div>
      <div className="config-row" style={{ marginTop: 6 }}>
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
          {config.terrain.fogDensity === 0 ? 'Off' : config.terrain.fogDensity <= 1 ? 'Light' : 'Heavy'}
        </span>
      </div>

      <div className="config-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4, marginTop: 8 }}>
        <span className="config-label">Floor Style</span>
        <FloorStylePicker
          value={config.terrain.floorStyle}
          onChange={(style) => updateTerrain({ floorStyle: style })}
        />
      </div>

      <div className="toolbox-section-header" style={{ marginTop: 10 }}>Animations</div>
      <div className="config-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
        <span className="config-label">Idle Status</span>
        <AnimationPicker
          value={config.animations.idleAnimation}
          onChange={(anim) => updateAnimations({ idleAnimation: anim })}
        />
      </div>
      <div className="config-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4, marginTop: 8 }}>
        <span className="config-label">Working Status</span>
        <AnimationPicker
          value={config.animations.workingAnimation}
          onChange={(anim) => updateAnimations({ workingAnimation: anim })}
        />
      </div>
    </div>
  );
}

