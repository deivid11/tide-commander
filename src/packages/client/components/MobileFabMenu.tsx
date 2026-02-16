import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../store';
import { VoiceAssistant } from './VoiceAssistant';

interface MobileFabMenuProps {
  isOpen: boolean;
  onToggle: () => void;
  onShowTerminal: () => void;
  onOpenSidebar: () => void;
  onOpenToolbox: () => void;
  onOpenCommander: () => void;
  onOpenSupervisor: () => void;
  onOpenControls: () => void;
  onOpenSkills: () => void;
  onOpenSnapshots: () => void;
  onTakeSnapshot: () => void;
  canTakeSnapshot: boolean; // Whether there's an active agent with outputs to snapshot
  mobileView: '3d' | 'terminal';
}

export function MobileFabMenu({
  isOpen,
  onToggle,
  onShowTerminal,
  onOpenSidebar,
  onOpenToolbox,
  onOpenCommander,
  onOpenSupervisor,
  onOpenControls,
  onOpenSkills,
  onOpenSnapshots,
  onTakeSnapshot,
  canTakeSnapshot,
  mobileView,
}: MobileFabMenuProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const settings = useSettings();

  const handleAction = (action: () => void) => {
    action();
    onToggle(); // Close menu after action
  };

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
          {isOpen ? '✕' : '☰'}
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
            💬
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
            📋
          </button>
          {/* Take Snapshot - prominent action when available */}
          {canTakeSnapshot && (
            <button
              className="mobile-fab-option mobile-fab-option--highlight"
              onClick={() => handleAction(onTakeSnapshot)}
              onTouchEnd={(e) => {
                e.preventDefault();
                handleAction(onTakeSnapshot);
              }}
              title={t('terminal:mobileFab.takeSnapshot')}
            >
              ⭐
            </button>
          )}
          <button
            className="mobile-fab-option"
            onClick={() => handleAction(onOpenToolbox)}
            onTouchEnd={(e) => {
              e.preventDefault();
              handleAction(onOpenToolbox);
            }}
            title={t('common:floatingButtons.settingsAndTools')}
          >
            ⚙️
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
            📊
          </button>
          <button
            className="mobile-fab-option"
            onClick={() => handleAction(onOpenSupervisor)}
            onTouchEnd={(e) => {
              e.preventDefault();
              handleAction(onOpenSupervisor);
            }}
            title={t('common:floatingButtons.supervisorOverview')}
          >
            🎖️
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
            ⌨️
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
            ⭐
          </button>
          <button
            className="mobile-fab-option"
            onClick={() => handleAction(onOpenSnapshots)}
            onTouchEnd={(e) => {
              e.preventDefault();
              handleAction(onOpenSnapshots);
            }}
            title={t('common:floatingButtons.viewSnapshots')}
          >
            📸
          </button>
        </div>
      )}
    </>
  );
}
