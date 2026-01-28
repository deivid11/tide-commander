import React from 'react';
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
  mobileView,
}: MobileFabMenuProps) {
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
          title={isOpen ? 'Close menu' : 'Open menu'}
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
            title="Show Terminal"
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
            title="Open sidebar"
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
            title="Settings & Tools"
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
            title="Commander View"
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
            title="Supervisor Overview"
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
            title="Controls"
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
            title="Manage Skills"
          >
            ⭐
          </button>
        </div>
      )}
    </>
  );
}
