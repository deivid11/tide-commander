import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { store } from '../../store';
import type { DrawingArea } from '../../../shared/types';
import { AREA_COLORS } from '../../utils/colors';
import { FolderInput } from '../shared/FolderInput';
import { uploadAreaLogo, deleteAreaLogoApi, getAreaLogoUrl } from '../../api/area-logos';

type LogoPosition = 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const LOGO_POSITIONS: { key: LogoPosition; labelKey: string }[] = [
  { key: 'center', labelKey: 'posCenter' },
  { key: 'top-left', labelKey: 'posTopLeft' },
  { key: 'top-right', labelKey: 'posTopRight' },
  { key: 'bottom-left', labelKey: 'posBottomLeft' },
  { key: 'bottom-right', labelKey: 'posBottomRight' },
];

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
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // --- Logo handlers ---

  const getDefaultLogoSize = useCallback(() => {
    let areaW = 2, areaH = 2;
    if (area.type === 'rectangle' && area.width && area.height) {
      areaW = area.width;
      areaH = area.height;
    } else if (area.type === 'circle' && area.radius) {
      areaW = area.radius * 1.414;
      areaH = area.radius * 1.414;
    }
    const size = Math.min(areaW, areaH) * 0.4;
    return { width: Math.round(size * 10) / 10, height: Math.round(size * 10) / 10 };
  }, [area.type, area.width, area.height, area.radius]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const result = await uploadAreaLogo(area.id, file);
      const defaults = getDefaultLogoSize();
      store.updateArea(area.id, {
        logo: {
          filename: result.filename,
          position: 'center',
          width: defaults.width,
          height: defaults.height,
          keepAspectRatio: true,
          opacity: 0.8,
        },
      });
    } catch (err) {
      console.error('Failed to upload logo:', err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleLogoRemove = async () => {
    try {
      await deleteAreaLogoApi(area.id);
      store.updateArea(area.id, { logo: undefined });
    } catch (err) {
      console.error('Failed to remove logo:', err);
    }
  };

  const handleLogoPositionChange = (position: LogoPosition) => {
    if (!area.logo) return;
    store.updateArea(area.id, { logo: { ...area.logo, position } });
  };

  const handleLogoWidthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!area.logo) return;
    const width = parseFloat(e.target.value) || 0.1;
    if (area.logo.keepAspectRatio && area.logo.width > 0) {
      const ratio = area.logo.height / area.logo.width;
      store.updateArea(area.id, { logo: { ...area.logo, width, height: Math.round(width * ratio * 10) / 10 } });
    } else {
      store.updateArea(area.id, { logo: { ...area.logo, width } });
    }
  };

  const handleLogoHeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!area.logo) return;
    const height = parseFloat(e.target.value) || 0.1;
    if (area.logo.keepAspectRatio && area.logo.height > 0) {
      const ratio = area.logo.width / area.logo.height;
      store.updateArea(area.id, { logo: { ...area.logo, height, width: Math.round(height * ratio * 10) / 10 } });
    } else {
      store.updateArea(area.id, { logo: { ...area.logo, height } });
    }
  };

  const handleAspectRatioToggle = () => {
    if (!area.logo) return;
    store.updateArea(area.id, { logo: { ...area.logo, keepAspectRatio: !area.logo.keepAspectRatio } });
  };

  const handleOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!area.logo) return;
    store.updateArea(area.id, { logo: { ...area.logo, opacity: parseFloat(e.target.value) } });
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

      {/* Logo Configuration */}
      <div className="area-editor-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div className="area-editor-label" style={{ marginBottom: 6 }}>
          {t('config:areas.logo')}
        </div>
        <div className="area-logo-section">
          {area.logo?.filename ? (
            <>
              {/* Logo Preview */}
              <div className="area-logo-preview">
                <img
                  src={getAreaLogoUrl(area.logo.filename)}
                  alt="Logo"
                  className="area-logo-thumbnail"
                />
                <button className="area-logo-remove-btn" onClick={handleLogoRemove}>
                  {t('config:areas.removeLogo')}
                </button>
                <button
                  className="area-logo-replace-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? '...' : '↻'}
                </button>
              </div>

              {/* Position */}
              <div className="area-logo-config-row">
                <span className="area-logo-config-label">{t('config:areas.logoPosition')}</span>
                <div className="area-logo-position-row">
                  {LOGO_POSITIONS.map(({ key, labelKey }) => (
                    <button
                      key={key}
                      className={`area-logo-pos-btn ${area.logo?.position === key ? 'active' : ''}`}
                      onClick={() => handleLogoPositionChange(key)}
                    >
                      {t(`config:areas.${labelKey}`)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Size */}
              <div className="area-logo-config-row">
                <span className="area-logo-config-label">{t('config:areas.logoSize')}</span>
                <div className="area-logo-size-row">
                  <label className="area-logo-size-field">
                    <span>{t('config:areas.logoWidth')}</span>
                    <input
                      type="number"
                      className="area-logo-size-input"
                      value={area.logo.width}
                      onChange={handleLogoWidthChange}
                      min={0.1}
                      step={0.1}
                    />
                  </label>
                  <label className="area-logo-size-field">
                    <span>{t('config:areas.logoHeight')}</span>
                    <input
                      type="number"
                      className="area-logo-size-input"
                      value={area.logo.height}
                      onChange={handleLogoHeightChange}
                      min={0.1}
                      step={0.1}
                    />
                  </label>
                  <label className="area-logo-aspect-label" title={t('config:areas.keepAspectRatio')}>
                    <input
                      type="checkbox"
                      checked={area.logo.keepAspectRatio}
                      onChange={handleAspectRatioToggle}
                    />
                    {t('config:areas.keepAspectRatio')}
                  </label>
                </div>
              </div>

              {/* Opacity */}
              <div className="area-logo-config-row">
                <span className="area-logo-config-label">{t('config:areas.logoOpacity')}</span>
                <div className="area-logo-opacity-row">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={area.logo.opacity ?? 0.8}
                    onChange={handleOpacityChange}
                    className="area-logo-opacity-slider"
                  />
                  <span className="area-logo-opacity-value">
                    {Math.round((area.logo.opacity ?? 0.8) * 100)}%
                  </span>
                </div>
              </div>
            </>
          ) : (
            <button
              className="area-logo-upload-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? '...' : t('config:areas.uploadLogo')}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleLogoUpload}
          />
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
