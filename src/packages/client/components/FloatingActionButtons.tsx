import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../store';
import { VoiceAssistant } from './VoiceAssistant';
import { Tooltip } from './shared/Tooltip';
import { Icon } from './Icon';

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
          <span className="fab-spawn-icon"><Icon name="grid" size={18} /></span>
        </button>
      </Tooltip>
    </>
  );
});
