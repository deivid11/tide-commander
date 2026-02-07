import React, { memo } from 'react';
import { useSettings } from '../store';
import { VoiceAssistant } from './VoiceAssistant';
import type { DocumentPiPState } from '../hooks/useDocumentPiP';

interface FloatingActionButtonsProps {
  onOpenToolbox: () => void;
  onOpenCommander: () => void;
  onOpenSupervisor: () => void;
  onOpenControls: () => void;
  onOpenSkills: () => void;
  onOpenSnapshots: () => void;
  isGeneratingReport: boolean;
  pip: DocumentPiPState;
}

export const FloatingActionButtons = memo(function FloatingActionButtons({
  onOpenToolbox,
  onOpenCommander,
  onOpenSupervisor,
  onOpenControls,
  onOpenSkills,
  onOpenSnapshots,
  isGeneratingReport,
  pip,
}: FloatingActionButtonsProps) {
  const settings = useSettings();

  return (
    <>
      {/* Voice Assistant button (experimental) */}
      {settings.experimentalVoiceAssistant && <VoiceAssistant />}

      {/* Floating settings button */}
      <button
        className="floating-settings-btn"
        onClick={onOpenToolbox}
        title="Settings & Tools"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>

      {/* Commander View button */}
      <button
        className="commander-toggle-btn"
        onClick={onOpenCommander}
        title="Commander View (⌘K)"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      </button>

      {/* Snapshots button */}
      <button
        className="snapshots-toggle-btn"
        onClick={onOpenSnapshots}
        title="View Snapshots"
      >
        📸
      </button>

      {/* Supervisor Overview button */}
      <button
        className={`supervisor-toggle-btn ${isGeneratingReport ? 'generating' : ''}`}
        onClick={onOpenSupervisor}
        title={isGeneratingReport ? 'Generating report...' : 'Supervisor Overview'}
      >
        🎖️
        {isGeneratingReport && <span className="supervisor-generating-indicator" />}
      </button>

      {/* Controls button (Keyboard & Mouse) */}
      <button
        className="shortcuts-toggle-btn"
        onClick={onOpenControls}
        title="Controls (Keyboard & Mouse)"
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

      {/* Skills Panel button */}
      <button
        className="skills-toggle-btn"
        onClick={onOpenSkills}
        title="Manage Skills"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      </button>

      {/* Picture-in-Picture button */}
      <button
        className={`pip-toggle-btn ${pip.isOpen ? 'active' : ''}`}
        onClick={() => pip.isSupported && pip.toggle({ width: 320, height: 400 })}
        title={!pip.isSupported ? 'PiP not supported in this browser' : pip.isOpen ? 'Close Agents in PiP Mode' : 'Open Agents in PiP Mode'}
        disabled={!pip.isSupported}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <rect x="12" y="9" width="8" height="6" rx="1" />
        </svg>
      </button>
    </>
  );
});
