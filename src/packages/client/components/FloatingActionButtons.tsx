import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../store';
import { VoiceAssistant } from './VoiceAssistant';
import { Tooltip } from './shared/Tooltip';
import { Icon, type IconName } from './Icon';
import { useViewMode } from '../hooks/useViewMode';
import { VIEW_MODES } from '../types/viewModes';
import type { ViewMode } from '../types/viewModes';

const VIEW_MODE_ICONS: Record<ViewMode, IconName> = {
  '3d': 'cube',
  '2d': 'grid',
  'flat': 'sparkle',
  'dashboard': 'dashboard',
};

interface FloatingActionButtonsProps {
  onOpenToolbox: () => void;
  onOpenSpotlight: () => void;
  onOpenCommander: () => void;
  onOpenControls: () => void;
  onOpenSkills: () => void;
  onSpawnAgent: () => void;
  onSpawnBoss: () => void;
  onNewBuilding: () => void;
  onNewArea: () => void;
}

export const FloatingActionButtons = memo(function FloatingActionButtons({
  onOpenToolbox,
  onOpenSpotlight,
  onOpenCommander,
  onOpenControls,
  onOpenSkills,
  onSpawnAgent,
  onSpawnBoss,
  onNewBuilding,
  onNewArea,
}: FloatingActionButtonsProps) {
  const { t } = useTranslation(['common', 'terminal']);
  const settings = useSettings();
  const [viewMode, setViewMode] = useViewMode();
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);

  const handleSelectViewMode = useCallback((mode: ViewMode) => {
    setViewMenuOpen(false);
    if (mode === viewMode) return;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tide:viewmode-switch-pressed', { detail: { mode } }));
    }
    if (mode === '3d') {
      requestAnimationFrame(() => setViewMode(mode));
      return;
    }
    setViewMode(mode);
  }, [viewMode, setViewMode]);

  useEffect(() => {
    if (!viewMenuOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (!viewMenuRef.current) return;
      if (!viewMenuRef.current.contains(e.target as Node)) {
        setViewMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewMenuOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [viewMenuOpen]);

  return (
    <>
      {/* Voice Assistant button (experimental) */}
      {settings.experimentalVoiceAssistant && <VoiceAssistant />}

      {/* Floating settings button */}
      <Tooltip content={t('common:floatingButtons.settingsAndTools')} position="right">
        <button
          className="floating-settings-btn"
          onClick={onOpenToolbox}
          aria-label={t('common:floatingButtons.settingsAndTools')}
        >
          <Icon name="gear" size={18} />
        </button>
      </Tooltip>

      {/* Global Search button (Spotlight) */}
      <Tooltip content={t('common:floatingButtons.globalSearch')} position="right">
        <button
          className="search-toggle-btn"
          onClick={onOpenSpotlight}
          aria-label={t('common:floatingButtons.globalSearch')}
        >
          <Icon name="search" size={18} />
        </button>
      </Tooltip>

      {/* Commander View button */}
      <Tooltip content={t('common:floatingButtons.commanderView')} position="right">
        <button
          className="commander-toggle-btn"
          onClick={onOpenCommander}
          aria-label={t('common:floatingButtons.commanderView')}
        >
          <Icon name="grid" size={20} />
        </button>
      </Tooltip>

      {/* Controls button (Keyboard & Mouse) */}
      <Tooltip content={t('common:floatingButtons.controls')} position="right">
        <button
          className="shortcuts-toggle-btn"
          onClick={onOpenControls}
          aria-label={t('common:floatingButtons.controls')}
        >
          <Icon name="keyboard" size={18} />
        </button>
      </Tooltip>

      {/* Skills Panel button */}
      <Tooltip content={t('common:floatingButtons.manageSkills')} position="right">
        <button
          className="skills-toggle-btn"
          onClick={onOpenSkills}
          aria-label={t('common:floatingButtons.manageSkills')}
        >
          <Icon name="star" size={18} weight="fill" />
        </button>
      </Tooltip>

      {/* New Agent button */}
      <Tooltip content={t('common:agentBar.spawnNewAgent')} position="right">
        <button
          className="fab-spawn-btn fab-spawn-agent-btn"
          onClick={onSpawnAgent}
          aria-label={t('common:agentBar.spawnNewAgent')}
        >
          <span className="fab-spawn-icon"><Icon name="plus" size={18} /></span>
        </button>
      </Tooltip>

      {/* New Boss button */}
      <Tooltip content={t('common:agentBar.spawnBoss')} position="right">
        <button
          className="fab-spawn-btn fab-spawn-boss-btn"
          onClick={onSpawnBoss}
          aria-label={t('common:agentBar.spawnBoss')}
        >
          <span className="fab-spawn-icon"><Icon name="crown" size={18} /></span>
        </button>
      </Tooltip>

      {/* New Building button */}
      <Tooltip content={t('common:agentBar.addNewBuilding')} position="right">
        <button
          className="fab-spawn-btn fab-spawn-building-btn"
          onClick={onNewBuilding}
          aria-label={t('common:agentBar.addNewBuilding')}
        >
          <span className="fab-spawn-icon"><Icon name="buildings" size={18} /></span>
        </button>
      </Tooltip>

      {/* New Area button */}
      <Tooltip content={t('common:agentBar.drawNewArea')} position="right">
        <button
          className="fab-spawn-btn fab-spawn-area-btn"
          onClick={onNewArea}
          aria-label={t('common:agentBar.drawNewArea')}
        >
          <span className="fab-spawn-icon"><Icon name="class-architect" size={18} /></span>
        </button>
      </Tooltip>

      {/* View Mode selector (FAB + popover menu) */}
      <div className="fab-viewmode-wrapper" ref={viewMenuRef}>
        <Tooltip content={t('common:floatingButtons.viewMode', { defaultValue: 'View mode' })} position="right">
          <button
            className={`fab-spawn-btn fab-spawn-viewmode-btn${viewMenuOpen ? ' is-open' : ''}`}
            onClick={() => setViewMenuOpen(v => !v)}
            aria-haspopup="menu"
            aria-expanded={viewMenuOpen}
            aria-label={t('common:floatingButtons.viewMode', { defaultValue: 'View mode' })}
          >
            <span className="fab-spawn-icon"><Icon name="frame" size={18} /></span>
          </button>
        </Tooltip>
        {viewMenuOpen && (
          <div className="fab-viewmode-menu" role="menu">
            {VIEW_MODES.map(mode => (
              <button
                key={mode}
                role="menuitemradio"
                aria-checked={mode === viewMode}
                className={`fab-viewmode-menu__item${mode === viewMode ? ' is-active' : ''}`}
                onClick={() => handleSelectViewMode(mode)}
              >
                <span className="fab-viewmode-menu__icon"><Icon name={VIEW_MODE_ICONS[mode]} size={16} /></span>
                <span className="fab-viewmode-menu__label">{t(`common:viewMode.labels.${mode}`)}</span>
                <span className="fab-viewmode-menu__desc">{t(`common:viewMode.descriptions.${mode}`)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
});
