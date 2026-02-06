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
          // Handle 3D scene
          sceneRef.current?.setDrawingTool(null);
          // Handle 2D scene
          if (typeof window !== 'undefined' && (window as any).__tideScene2D_setDrawingTool) {
            (window as any).__tideScene2D_setDrawingTool(null);
          }
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
        console.log('[useKeyboardShortcuts] Spotlight shortcut matched!', { spotlightShortcut, altKey: e.altKey, code: e.code });
        e.preventDefault();
        spotlightModal.toggle();
        return;
      }

      // Cycle View Mode: 3D → 2D → Dashboard → 3D (Alt+2)
      const toggle2DViewShortcut = shortcuts.find(s => s.id === 'toggle-2d-view');
      if (matchesShortcut(e, toggle2DViewShortcut)) {
        e.preventDefault();
        const currentMode = store.getState().viewMode;
        const nextMode = currentMode === '3d' ? '2d' : currentMode === '2d' ? 'dashboard' : '3d';
        store.setViewMode(nextMode);
        return;
      }

      // Navigate between working agents (Alt+Shift+H / Alt+Shift+L)
      const nextWorkingShortcut = shortcuts.find(s => s.id === 'next-working-agent');
      const prevWorkingShortcut = shortcuts.find(s => s.id === 'prev-working-agent');
      if ((matchesShortcut(e, nextWorkingShortcut) || matchesShortcut(e, prevWorkingShortcut)) && !isInputFocused) {
        const currentState = store.getState();
        if (currentState.terminalOpen) return; // Let terminal handle its own navigation

        const agents = Array.from(currentState.agents.values());
        const workingAgents = agents.filter(a => a.status === 'working');
        if (workingAgents.length === 0) return;

        e.preventDefault();

        const selectedId = currentState.selectedAgentIds.size === 1
          ? Array.from(currentState.selectedAgentIds)[0]
          : null;
        const currentIndex = selectedId ? workingAgents.findIndex(a => a.id === selectedId) : -1;

        let nextIndex: number;
        if (matchesShortcut(e, nextWorkingShortcut)) {
          // Alt+Shift+L → next working agent
          nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % workingAgents.length;
        } else {
          // Alt+Shift+H → previous working agent
          nextIndex = currentIndex === -1 ? workingAgents.length - 1 : (currentIndex - 1 + workingAgents.length) % workingAgents.length;
        }

        store.selectAgent(workingAgents[nextIndex].id);
        sceneRef.current?.refreshSelectionVisuals();
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
