import { useEffect } from 'react';
import { store } from '../store';
import { matchesShortcut } from '../store/shortcuts';
import { SceneManager } from '../scene/SceneManager';
import type { UseModalState, UseModalStateWithId } from './index';

interface UseKeyboardShortcutsOptions {
  sceneRef: React.RefObject<SceneManager | null>;
  spawnModal: UseModalState;
  commanderModal: UseModalState;
  explorerModal: UseModalStateWithId;
  spotlightModal: UseModalState;
  deleteConfirmModal: UseModalState;
  onRequestBuildingDelete: () => void;
}

/**
 * Hook to handle global keyboard shortcuts for the application.
 */
export function useKeyboardShortcuts({
  sceneRef,
  spawnModal,
  commanderModal,
  explorerModal,
  spotlightModal,
  deleteConfirmModal,
  onRequestBuildingDelete,
}: UseKeyboardShortcutsOptions): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const shortcuts = store.getShortcuts();
      const target = e.target as HTMLElement;
      const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      // Escape to deselect or close modal/terminal/drawing mode
      const deselectShortcut = shortcuts.find(s => s.id === 'deselect-all');
      if (matchesShortcut(e, deselectShortcut)) {
        const currentState = store.getState();
        // Exit drawing mode first if active
        if (currentState.activeTool === 'rectangle' || currentState.activeTool === 'circle') {
          sceneRef.current?.setDrawingTool(null);
          return;
        }
        if (spawnModal.isOpen) {
          spawnModal.close();
        } else if (currentState.terminalOpen) {
          store.setTerminalOpen(false);
          // Blur any focused input to prevent it from blocking keyboard shortcuts
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
        } else {
          store.deselectAll();
          sceneRef.current?.refreshSelectionVisuals();
        }
      }

      // Ctrl+Number keys to select agents
      for (let i = 1; i <= 9; i++) {
        const selectShortcut = shortcuts.find(s => s.id === `select-agent-${i}`);
        if (matchesShortcut(e, selectShortcut)) {
          e.preventDefault();
          const currentState = store.getState();
          const index = i - 1;
          const agentIds = Array.from(currentState.agents.keys());
          if (index < agentIds.length) {
            store.selectAgent(agentIds[index]);
            sceneRef.current?.refreshSelectionVisuals();
          }
          return;
        }
      }

      // Spawn new agent
      const spawnShortcut = shortcuts.find(s => s.id === 'spawn-agent');
      if (matchesShortcut(e, spawnShortcut)) {
        e.preventDefault();
        spawnModal.open();
        return;
      }

      // Toggle Commander View (Tab)
      const commanderTabShortcut = shortcuts.find(s => s.id === 'toggle-commander-tab');
      if (matchesShortcut(e, commanderTabShortcut) && !isInputFocused) {
        e.preventDefault();
        commanderModal.toggle();
        return;
      }

      // Toggle Commander View (Ctrl+K)
      const commanderShortcut = shortcuts.find(s => s.id === 'toggle-commander');
      if (matchesShortcut(e, commanderShortcut)) {
        e.preventDefault();
        commanderModal.toggle();
        return;
      }

      // Toggle File Explorer
      const explorerShortcut = shortcuts.find(s => s.id === 'toggle-file-explorer');
      if (matchesShortcut(e, explorerShortcut)) {
        e.preventDefault();
        if (explorerModal.isOpen) {
          explorerModal.close();
        } else {
          const areasWithDirs = Array.from(store.getState().areas.values())
            .filter(a => a.directories && a.directories.length > 0);
          if (areasWithDirs.length > 0) {
            explorerModal.open(areasWithDirs[0].id);
          }
        }
        return;
      }

      // Toggle Spotlight (Alt+P)
      const spotlightShortcut = shortcuts.find(s => s.id === 'toggle-spotlight');
      if (matchesShortcut(e, spotlightShortcut) || (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyP')) {
        e.preventDefault();
        spotlightModal.toggle();
        return;
      }

      // Delete selected agents or buildings
      const deleteShortcut = shortcuts.find(s => s.id === 'delete-selected');
      const deleteBackspaceShortcut = shortcuts.find(s => s.id === 'delete-selected-backspace');
      if ((matchesShortcut(e, deleteShortcut) || matchesShortcut(e, deleteBackspaceShortcut)) && !isInputFocused) {
        const currentState = store.getState();
        if (currentState.selectedAgentIds.size > 0) {
          e.preventDefault();
          deleteConfirmModal.open();
          return;
        }
        if (currentState.selectedBuildingIds.size > 0) {
          e.preventDefault();
          onRequestBuildingDelete();
          return;
        }
        return;
      }
    };

    // Use capture phase to ensure global shortcuts work regardless of which element has focus
    // This is necessary because the canvas doesn't naturally receive keyboard events
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [sceneRef, spawnModal, commanderModal, explorerModal, spotlightModal, deleteConfirmModal, onRequestBuildingDelete]);
}
