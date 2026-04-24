import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../store';
import { useViewMode } from '../hooks/useViewMode';
import { VIEW_MODE_LABELS, VIEW_MODES, type ViewMode } from '../types/viewModes';
import { VoiceAssistant } from './VoiceAssistant';
import { Icon, type IconName } from './Icon';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

const VIEW_MODE_ICONS: Record<ViewMode, IconName> = {
  '3d': 'cube',
  '2d': 'grid',
  'flat': 'sparkle',
  'dashboard': 'dashboard',
};

interface MobileFabMenuProps {
  isOpen: boolean;
  onToggle: () => void;
  onShowTerminal: () => void;
  onOpenSidebar: () => void;
  onOpenToolbox: () => void;
  onOpenSpotlight: () => void;
  onOpenCommander: () => void;
  onOpenControls: () => void;
  onOpenSkills: () => void;
  onSpawnAgent: () => void;
  onSpawnBoss: () => void;
  onNewBuilding: () => void;
  onNewArea: () => void;
  onOrganizeAll: () => void;
  canOrganize: boolean;
  isOrganizing: boolean;
  mobileView: '3d' | 'terminal';
}

export const MobileFabMenu = memo(function MobileFabMenu({
  isOpen,
  onToggle,
  onShowTerminal,
  onOpenSidebar,
  onOpenToolbox,
  onOpenSpotlight,
  onOpenCommander,
  onOpenControls,
  onOpenSkills,
  onSpawnAgent,
  onSpawnBoss,
  onNewBuilding,
  onNewArea,
  onOrganizeAll,
  canOrganize,
  isOrganizing,
  mobileView,
}: MobileFabMenuProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const settings = useSettings();
  const [viewMode, setViewMode] = useViewMode();

  const handleAction = (action: () => void) => {
    action();
    onToggle(); // Close menu after action
  };

  const handleCycleViewMode = () => {
    const currentIndex = VIEW_MODES.indexOf(viewMode);
    const nextMode = VIEW_MODES[(currentIndex + 1) % VIEW_MODES.length];
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tide:viewmode-switch-pressed', { detail: { mode: nextMode } }));
    }
    if (nextMode === '3d') {
      requestAnimationFrame(() => setViewMode(nextMode));
      return;
    }
    setViewMode(nextMode);
  };

  const nextViewMode = VIEW_MODES[(VIEW_MODES.indexOf(viewMode) + 1) % VIEW_MODES.length];

  return (
    <>
      {/* Voice Assistant button - shown separately from FAB menu when enabled */}
      {settings.experimentalVoiceAssistant && (
        <VoiceAssistant className="mobile-voice-assistant" />
      )}

      {/* Mobile FAB toggle - hamburger button (hidden when in terminal view on mobile) */}
      {mobileView !== 'terminal' && (
        <button
          className={`mobile-fab-toggle ${isOpen ? 'open' : ''}`}
          onClick={onToggle}
          onTouchStart={(e) => e.stopPropagation()}
          title={isOpen ? t('terminal:mobileFab.closeMenu') : t('terminal:mobileFab.openMenu')}
        >
          <Icon name={isOpen ? 'close' : 'list'} size={18} />
        </button>
      )}

      {/* Mobile FAB menu - expandable options (hidden when in terminal view on mobile) */}
      {mobileView === '3d' && (
        <div className={`mobile-fab-menu ${isOpen ? 'open' : ''}`}>
          <button
            className="mobile-fab-option"
            onClick={() => handleAction(onShowTerminal)}
            onTouchEnd={(e) => {
              e.preventDefault();
              handleAction(onShowTerminal);
            }}
            title={t('terminal:mobileFab.showTerminal')}
          >
            <Icon name="chat" size={18} />
          </button>
          <button
            className="mobile-fab-option"
            onClick={() => handleAction(onOpenSidebar)}
            onTouchEnd={(e) => {
              e.preventDefault();
              handleAction(onOpenSidebar);
            }}
            title={t('terminal:header.openSidebar')}
          >
            <Icon name="clipboard" size={18} />
          </button>
          <button
            className="mobile-fab-option"
            onClick={() => handleAction(onOpenToolbox)}
            onTouchEnd={(e) => {
              e.preventDefault();
              handleAction(onOpenToolbox);
            }}
            title={t('common:floatingButtons.settingsAndTools')}
          >
            <Icon name="gear" size={18} />
          </button>
          <button
            className="mobile-fab-option"
            onClick={() => handleAction(onOpenSpotlight)}
            onTouchEnd={(e) => {
              e.preventDefault();
              handleAction(onOpenSpotlight);
            }}
            title={t('common:floatingButtons.globalSearch')}
          >
            <Icon name="search" size={18} />
          </button>
          <button
            className="mobile-fab-option"
            onClick={() => handleAction(onOpenCommander)}
            onTouchEnd={(e) => {
              e.preventDefault();
              handleAction(onOpenCommander);
            }}
            title={t('common:floatingButtons.commanderView')}
          >
            <Icon name="dashboard" size={18} />
          </button>
          <button
            className="mobile-fab-option"
            onClick={() => handleAction(onOpenControls)}
            onTouchEnd={(e) => {
              e.preventDefault();
              handleAction(onOpenControls);
            }}
            title={t('common:floatingButtons.controls')}
          >
            <Icon name="keyboard" size={18} />
          </button>
          <button
            className="mobile-fab-option"
            onClick={() => handleAction(onOpenSkills)}
            onTouchEnd={(e) => {
              e.preventDefault();
              handleAction(onOpenSkills);
            }}
            title={t('common:floatingButtons.manageSkills')}
          >
            <Icon name="star" size={18} />
          </button>
          <button
            className="mobile-fab-option mobile-fab-option--spawn-agent"
            onClick={() => handleAction(onSpawnAgent)}
            onTouchEnd={(e) => {
              e.preventDefault();
              handleAction(onSpawnAgent);
            }}
            title={t('common:agentBar.spawnNewAgent')}
          >
            <Icon name="plus" size={18} />
          </button>
          <button
            className="mobile-fab-option mobile-fab-option--spawn-boss"
            onClick={() => handleAction(onSpawnBoss)}
            onTouchEnd={(e) => {
              e.preventDefault();
              handleAction(onSpawnBoss);
            }}
            title={t('common:agentBar.spawnBoss')}
          >
            <Icon name="crown" size={18} />
          </button>
          <button
            className="mobile-fab-option mobile-fab-option--new-building"
            onClick={() => handleAction(onNewBuilding)}
            onTouchEnd={(e) => {
              e.preventDefault();
              handleAction(onNewBuilding);
            }}
            title={t('common:agentBar.addNewBuilding')}
          >
            <Icon name="buildings" size={18} />
          </button>
          <button
            className="mobile-fab-option mobile-fab-option--new-area"
            onClick={() => handleAction(onNewArea)}
            onTouchEnd={(e) => {
              e.preventDefault();
              handleAction(onNewArea);
            }}
            title={t('common:agentBar.drawNewArea')}
          >
            <Icon name="class-architect" size={18} />
          </button>
          <button
            className="mobile-fab-option mobile-fab-option--view-mode"
            onClick={() => handleAction(handleCycleViewMode)}
            onTouchEnd={(e) => {
              e.preventDefault();
              handleAction(handleCycleViewMode);
            }}
            title={t('common:floatingButtons.viewMode', { defaultValue: 'View mode' }) + `: ${VIEW_MODE_LABELS[viewMode]} -> ${VIEW_MODE_LABELS[nextViewMode]}`}
          >
            <Icon name={VIEW_MODE_ICONS[viewMode]} size={18} />
          </button>
          <div
            className="mobile-fab-workspace-option"
            title={t('common:agentBar.workspaces', { defaultValue: 'Workspaces' })}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            <WorkspaceSwitcher />
          </div>
          {canOrganize && (
            <button
              className="mobile-fab-option mobile-fab-option--organize"
              disabled={isOrganizing}
              onClick={() => handleAction(onOrganizeAll)}
              onTouchEnd={(e) => {
                e.preventDefault();
                handleAction(onOrganizeAll);
              }}
              title="Auto-organize all agents in their areas"
            >
              <Icon name={isOrganizing ? 'hourglass' : 'sparkle'} size={18} />
            </button>
          )}
        </div>
      )}
    </>
  );
});
