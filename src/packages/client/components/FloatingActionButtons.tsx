import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../store';
import { VoiceAssistant } from './VoiceAssistant';
import { Tooltip } from './shared/Tooltip';

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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </Tooltip>

      {/* Global Search button (Spotlight) */}
      <Tooltip content={t('common:floatingButtons.globalSearch')} position="right">
        <button
          className="search-toggle-btn"
          onClick={onOpenSpotlight}
          aria-label={t('common:floatingButtons.globalSearch')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      </Tooltip>

      {/* Commander View button */}
      <Tooltip content={t('common:floatingButtons.commanderView')} position="right">
        <button
          className="commander-toggle-btn"
          onClick={onOpenCommander}
          aria-label={t('common:floatingButtons.commanderView')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
          </svg>
        </button>
      </Tooltip>

      {/* Controls button (Keyboard & Mouse) */}
      <Tooltip content={t('common:floatingButtons.controls')} position="right">
        <button
          className="shortcuts-toggle-btn"
          onClick={onOpenControls}
          aria-label={t('common:floatingButtons.controls')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="4" y1="21" x2="4" y2="14" />
            <line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" />
            <line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" />
            <line x1="9" y1="8" x2="15" y2="8" />
            <line x1="17" y1="16" x2="23" y2="16" />
          </svg>
        </button>
      </Tooltip>

      {/* Skills Panel button */}
      <Tooltip content={t('common:floatingButtons.manageSkills')} position="right">
        <button
          className="skills-toggle-btn"
          onClick={onOpenSkills}
          aria-label={t('common:floatingButtons.manageSkills')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </button>
      </Tooltip>

      {/* New Agent button */}
      <Tooltip content={t('common:agentBar.spawnNewAgent')} position="right">
        <button
          className="fab-spawn-btn fab-spawn-agent-btn"
          onClick={onSpawnAgent}
          aria-label={t('common:agentBar.spawnNewAgent')}
        >
          <span className="fab-spawn-icon">+</span>
        </button>
      </Tooltip>

      {/* New Boss button */}
      <Tooltip content={t('common:agentBar.spawnBoss')} position="right">
        <button
          className="fab-spawn-btn fab-spawn-boss-btn"
          onClick={onSpawnBoss}
          aria-label={t('common:agentBar.spawnBoss')}
        >
          <span className="fab-spawn-icon">👑</span>
        </button>
      </Tooltip>

      {/* New Building button */}
      <Tooltip content={t('common:agentBar.addNewBuilding')} position="right">
        <button
          className="fab-spawn-btn fab-spawn-building-btn"
          onClick={onNewBuilding}
          aria-label={t('common:agentBar.addNewBuilding')}
        >
          <span className="fab-spawn-icon">🏢</span>
        </button>
      </Tooltip>

      {/* New Area button */}
      <Tooltip content={t('common:agentBar.drawNewArea')} position="right">
        <button
          className="fab-spawn-btn fab-spawn-area-btn"
          onClick={onNewArea}
          aria-label={t('common:agentBar.drawNewArea')}
        >
          <span className="fab-spawn-icon">🔲</span>
        </button>
      </Tooltip>
    </>
  );
});
