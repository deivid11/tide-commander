import React, { useState, useEffect } from 'react';
import { store } from '../../store';
import type { DrawingArea } from '../../../shared/types';
import { AREA_COLORS } from '../../utils/colors';
import { FolderInput } from '../shared/FolderInput';

interface AreaEditorProps {
  area: DrawingArea;
  onClose: () => void;
  onOpenFolder?: (areaId: string) => void;
}

export function AreaEditor({ area, onClose, onOpenFolder }: AreaEditorProps) {
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

  const handleBringToFront = () => {
    store.bringAreaToFront(area.id);
  };

  const handleSendToBack = () => {
    store.sendAreaToBack(area.id);
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

      {/* Z-Index Controls */}
      <div className="area-editor-row">
        <div className="area-editor-label">Layer</div>
        <div className="area-layer-buttons">
          <button
            className="area-layer-btn"
            onClick={handleBringToFront}
            title="Bring to front (place on top of other areas)"
          >
            ↑ Front
          </button>
          <button
            className="area-layer-btn"
            onClick={handleSendToBack}
            title="Send to back (place behind other areas)"
          >
            ↓ Back
          </button>
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
              <FolderInput
                value={newFolderPath}
                onChange={setNewFolderPath}
                onSubmit={handleAddFolder}
                placeholder="/path/to/folder"
                className="area-add-folder-input"
                directoriesOnly={true}
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
