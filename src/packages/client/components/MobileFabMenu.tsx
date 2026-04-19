import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../store';
import { VoiceAssistant } from './VoiceAssistant';

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
            onClick={() => handleAction(onOpenSpotlight)}
            onTouchEnd={(e) => {
              e.preventDefault();
              handleAction(onOpenSpotlight);
            }}
            title={t('common:floatingButtons.globalSearch')}
          >
            🔍
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
        </div>
      )}
    </>
  );
});
