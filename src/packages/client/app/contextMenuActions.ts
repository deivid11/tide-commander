import { store } from '../store';
import { SceneManager } from '../scene/SceneManager';
import type { ContextMenuAction } from '../components/ContextMenu';
import type { ToastType } from '../components/Toast';
import type { Agent, DrawingArea as Area, Building } from '../../shared/types';

export interface ContextMenuTarget {
  type: 'ground' | 'agent' | 'area' | 'building';
  id?: string;
}

export interface ContextMenuCallbacks {
  showToast: (type: ToastType, title: string, message: string) => void;
  openSpawnModal: () => void;
  openBossSpawnModal: () => void;
  openToolboxModal: () => void;
  openCommanderModal: () => void;
  openExplorerModal: (areaId: string) => void;
  openBuildingModal: (buildingId: string | null) => void;
  openAgentEditModal: (agentId: string) => void;
  requestBuildingDelete: (buildingId: string) => void;
  setSpawnPosition: (pos: { x: number; z: number }) => void;
  sceneRef: React.RefObject<SceneManager | null>;
}

/**
 * Build context menu actions based on what was clicked
 */
export function buildContextMenuActions(
  worldPos: { x: number; z: number },
  target: ContextMenuTarget,
  agents: Map<string, Agent>,
  areas: Map<string, Area>,
  buildings: Map<string, Building>,
  callbacks: ContextMenuCallbacks
): ContextMenuAction[] {
  const actions: ContextMenuAction[] = [];

  // Agent-specific actions
  if (target.type === 'agent' && target.id) {
    const agent = agents.get(target.id);
    if (agent) {
      actions.push({
        id: 'select-agent',
        label: `Select ${agent.name}`,
        icon: '👆',
        onClick: () => {
          store.selectAgent(target.id!);
          callbacks.sceneRef.current?.refreshSelectionVisuals();
        },
      });
      actions.push({
        id: 'focus-agent',
        label: 'Focus Camera',
        icon: '🎯',
        onClick: () => {
          callbacks.sceneRef.current?.focusAgent(target.id!);
        },
      });
      actions.push({
        id: 'open-terminal',
        label: 'Open Terminal',
        icon: '💬',
        onClick: () => {
          store.selectAgent(target.id!);
          store.setTerminalOpen(true);
        },
      });
      actions.push({
        id: 'edit-agent',
        label: 'Edit Agent',
        icon: '✏️',
        onClick: () => {
          callbacks.openAgentEditModal(target.id!);
        },
      });
      actions.push({ id: 'divider-agent', label: '', divider: true, onClick: () => {} });
      actions.push({
        id: 'delete-agent',
        label: `Remove ${agent.name}`,
        icon: '🗑️',
        danger: true,
        onClick: () => {
          store.removeAgentFromServer(target.id!);
          callbacks.sceneRef.current?.removeAgent(target.id!);
          callbacks.showToast('info', 'Agent Removed', `${agent.name} removed from view`);
        },
      });
      return actions;
    }
  }

  // Area-specific actions
  if (target.type === 'area' && target.id) {
    const area = areas.get(target.id);
    if (area) {
      actions.push({
        id: 'select-area',
        label: `Select "${area.name}"`,
        icon: '📐',
        onClick: () => {
          store.selectArea(target.id!);
          callbacks.openToolboxModal();
        },
      });
      if (area.directories && area.directories.length > 0) {
        actions.push({
          id: 'open-explorer',
          label: 'Open File Explorer',
          icon: '📁',
          onClick: () => {
            callbacks.openExplorerModal(target.id!);
          },
        });
      }
      actions.push({ id: 'divider-area-layer', label: '', divider: true, onClick: () => {} });
      actions.push({
        id: 'bring-to-front',
        label: 'Bring to Front',
        icon: '⬆️',
        onClick: () => {
          store.bringAreaToFront(target.id!);
          callbacks.sceneRef.current?.syncAreas();
        },
      });
      actions.push({
        id: 'send-to-back',
        label: 'Send to Back',
        icon: '⬇️',
        onClick: () => {
          store.sendAreaToBack(target.id!);
          callbacks.sceneRef.current?.syncAreas();
        },
      });
      actions.push({ id: 'divider-area', label: '', divider: true, onClick: () => {} });
      actions.push({
        id: 'delete-area',
        label: `Delete "${area.name}"`,
        icon: '🗑️',
        danger: true,
        onClick: () => {
          store.deleteArea(target.id!);
          callbacks.sceneRef.current?.syncAreas();
          callbacks.showToast('info', 'Area Deleted', `"${area.name}" has been deleted`);
        },
      });
      return actions;
    }
  }

  // Building-specific actions
  if (target.type === 'building' && target.id) {
    const building = buildings.get(target.id);
    if (building) {
      actions.push({
        id: 'select-building',
        label: `Select "${building.name}"`,
        icon: '🏢',
        onClick: () => {
          store.selectBuilding(target.id!);
          callbacks.openToolboxModal();
        },
      });
      actions.push({
        id: 'edit-building',
        label: 'Edit Building',
        icon: '✏️',
        onClick: () => {
          callbacks.openBuildingModal(target.id!);
        },
      });
      actions.push({
        id: 'clone-building',
        label: 'Clone Building',
        icon: '📋',
        onClick: () => {
          // Clone the building with offset position
          const cloneData = {
            name: `${building.name} (Copy)`,
            type: building.type,
            style: building.style,
            color: building.color,
            scale: building.scale,
            position: {
              x: building.position.x + 2,
              z: building.position.z + 2,
            },
            cwd: building.cwd,
            folderPath: building.folderPath,
            commands: building.commands,
            pm2: building.pm2,
            urls: building.urls,
          };
          store.createBuilding(cloneData);
          callbacks.showToast('success', 'Building Cloned', `Created "${cloneData.name}"`);
        },
      });
      if (building.type === 'folder' && building.folderPath) {
        actions.push({
          id: 'open-folder',
          label: 'Open Folder',
          icon: '📁',
          onClick: () => {
            store.openFileExplorer(building.folderPath!);
          },
        });
      }
      actions.push({ id: 'divider-building', label: '', divider: true, onClick: () => {} });
      actions.push({
        id: 'delete-building',
        label: `Delete "${building.name}"`,
        icon: '🗑️',
        danger: true,
        onClick: () => {
          callbacks.requestBuildingDelete(target.id!);
        },
      });
      return actions;
    }
  }

  // Ground actions (default) - spawn, draw, etc.
  actions.push({
    id: 'spawn-agent',
    label: 'Spawn Agent Here',
    icon: '🤖',
    shortcut: 'N',
    onClick: () => {
      callbacks.setSpawnPosition(worldPos);
      callbacks.openSpawnModal();
    },
  });
  actions.push({
    id: 'spawn-boss',
    label: 'Spawn Boss Here',
    icon: '👑',
    onClick: () => {
      callbacks.setSpawnPosition(worldPos);
      callbacks.openBossSpawnModal();
    },
  });
  actions.push({ id: 'divider-1', label: '', divider: true, onClick: () => {} });
  actions.push({
    id: 'draw-area',
    label: 'Draw Area',
    icon: '📐',
    onClick: () => {
      callbacks.sceneRef.current?.setDrawingTool('rectangle');
    },
  });
  actions.push({
    id: 'new-building',
    label: 'Place Building',
    icon: '🏢',
    onClick: () => {
      callbacks.openBuildingModal(null);
    },
  });
  actions.push({ id: 'divider-2', label: '', divider: true, onClick: () => {} });
  actions.push({
    id: 'open-settings',
    label: 'Settings',
    icon: '⚙️',
    onClick: () => {
      callbacks.openToolboxModal();
    },
  });
  actions.push({
    id: 'open-commander',
    label: 'Commander View',
    icon: '📊',
    shortcut: '⌘K',
    onClick: () => {
      callbacks.openCommanderModal();
    },
  });

  return actions;
}
