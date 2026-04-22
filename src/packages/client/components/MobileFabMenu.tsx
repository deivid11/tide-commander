import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../store';
import { VoiceAssistant } from './VoiceAssistant';
import { Icon } from './Icon';

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
        </div>
      )}
    </>
  );
});
