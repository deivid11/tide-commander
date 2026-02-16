import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation(['config', 'common']);
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
        <span className="area-editor-title">{t('config:areas.editArea')}</span>
        <button className="area-editor-close" onClick={onClose}>&times;</button>
      </div>
      <div className="area-editor-row">
        <div className="area-editor-label">{t('common:labels.name')}</div>
        <input
          type="text"
          className="area-editor-input"
          value={name}
          onChange={handleNameChange}
          placeholder={t('config:areas.areaName')}
        />
      </div>
      <div className="area-editor-row">
        <div className="area-editor-label">{t('config:areas.color')}</div>
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
        <div className="area-editor-label">{t('config:areas.layer')}</div>
        <div className="area-layer-buttons">
          <button
            className="area-layer-btn"
            onClick={handleBringToFront}
            title={t('config:areas.bringToFront')}
          >
            ↑ {t('config:areas.front')}
          </button>
          <button
            className="area-layer-btn"
            onClick={handleSendToBack}
            title={t('config:areas.sendToBack')}
          >
            ↓ {t('config:areas.back')}
          </button>
        </div>
      </div>

      {/* Folders Configuration */}
      <div className="area-editor-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div className="area-editor-label" style={{ marginBottom: 6 }}>
          {t('config:areas.folders', { count: area.directories.length })}
        </div>
        <div className="area-folders-list">
          {area.directories.map((dir) => (
            <div key={dir} className="area-folder-item" title={dir}>
              <span
                className="area-folder-icon clickable"
                onClick={() => onOpenFolder?.(area.id)}
                title={t('config:areas.openFolder')}
              >
                📁
              </span>
              <span className="area-folder-path">{dir.split('/').pop() || dir}</span>
              <button
                className="area-folder-remove"
                onClick={(e) => handleRemoveFolder(dir, e)}
                title={t('config:areas.removeFolder')}
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
                placeholder={t('config:areas.folderPlaceholder')}
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
              {t('config:areas.addFolder')}
            </button>
          )}
        </div>
      </div>

      {area.assignedAgentIds.length > 0 && (
        <div className="area-editor-row">
          <div className="area-editor-label">{t('config:areas.assignedAgents', { count: area.assignedAgentIds.length })}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {t('config:areas.rightClickUnassign')}
          </div>
        </div>
      )}
    </div>
  );
}
