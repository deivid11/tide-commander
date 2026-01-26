import React, { Profiler } from 'react';
import { store, useStore } from '../store';
import { SpawnModal } from './SpawnModal';
import { BossSpawnModal } from './BossSpawnModal';
import { SubordinateAssignmentModal } from './SubordinateAssignmentModal';
import { Toolbox, type SceneConfig } from './Toolbox';
import { BuildingConfigModal } from './BuildingConfigModal';
import { CommanderView } from './CommanderView';
import { SupervisorPanel } from './SupervisorPanel';
import { FileExplorerPanel } from './FileExplorerPanel';
import { Spotlight } from './Spotlight';
import { ControlsModal } from './ControlsModal';
import { SkillsPanel } from './SkillsPanel';
import { AgentEditModal } from './AgentEditModal';
import { ContextMenu, type ContextMenuAction } from './ContextMenu';
import { profileRender } from '../utils/profiling';
import type { UseModalState, UseModalStateWithId, UseContextMenu } from '../hooks';

interface AppModalsProps {
  // Modal states
  spawnModal: UseModalState;
  bossSpawnModal: UseModalState;
  subordinateModal: UseModalState<string>;
  toolboxModal: UseModalState;
  commanderModal: UseModalState;
  deleteConfirmModal: UseModalState;
  supervisorModal: UseModalState;
  spotlightModal: UseModalState;
  controlsModal: UseModalState;
  skillsModal: UseModalState;
  buildingModal: UseModalState<string | null>;
  agentEditModal: UseModalState<string>;
  explorerModal: UseModalStateWithId;
  contextMenu: UseContextMenu;

  // Modal data
  spawnPosition: { x: number; z: number } | null;
  explorerFolderPath: string | null;
  contextMenuActions: ContextMenuAction[];

  // Config
  sceneConfig: SceneConfig;

  // Callbacks
  onConfigChange: (config: SceneConfig) => void;
  onToolChange: (tool: 'rectangle' | 'circle' | 'select' | null) => void;
  onOpenAreaExplorer: (areaId: string) => void;
  onDeleteSelectedAgents: () => void;

  // Navigation modal
  showBackNavModal: boolean;
  onCloseBackNavModal: () => void;
  onLeave: () => void;
}

export function AppModals({
  spawnModal,
  bossSpawnModal,
  subordinateModal,
  toolboxModal,
  commanderModal,
  deleteConfirmModal,
  supervisorModal,
  spotlightModal,
  controlsModal,
  skillsModal,
  buildingModal,
  agentEditModal,
  explorerModal,
  contextMenu,
  spawnPosition,
  explorerFolderPath,
  contextMenuActions,
  sceneConfig,
  onConfigChange,
  onToolChange,
  onOpenAreaExplorer,
  onDeleteSelectedAgents,
  showBackNavModal,
  onCloseBackNavModal,
  onLeave,
}: AppModalsProps) {
  const state = useStore();

  return (
    <>
      {/* Toolbox sidebar overlay */}
      <Toolbox
        config={sceneConfig}
        onConfigChange={onConfigChange}
        onToolChange={onToolChange}
        isOpen={toolboxModal.isOpen}
        onClose={toolboxModal.close}
        onOpenBuildingModal={(buildingId) => buildingModal.open(buildingId || null)}
        onOpenAreaExplorer={onOpenAreaExplorer}
      />

      {/* Building Config Modal */}
      <BuildingConfigModal
        isOpen={buildingModal.isOpen}
        onClose={buildingModal.close}
        buildingId={buildingModal.data}
      />

      <SpawnModal
        isOpen={spawnModal.isOpen}
        onClose={spawnModal.close}
        onSpawnStart={() => {}}
        onSpawnEnd={() => {}}
        spawnPosition={spawnPosition}
      />

      <BossSpawnModal
        isOpen={bossSpawnModal.isOpen}
        onClose={bossSpawnModal.close}
        onSpawnStart={() => {}}
        onSpawnEnd={() => {}}
        spawnPosition={spawnPosition}
      />

      <SubordinateAssignmentModal
        isOpen={subordinateModal.isOpen}
        bossId={subordinateModal.data || ''}
        onClose={subordinateModal.close}
      />

      {/* Agent Edit Modal */}
      {agentEditModal.isOpen && agentEditModal.data && (() => {
        const agent = state.agents.get(agentEditModal.data);
        if (!agent) return null;
        return (
          <AgentEditModal
            agent={agent}
            isOpen={agentEditModal.isOpen}
            onClose={agentEditModal.close}
          />
        );
      })()}

      {/* Delete Confirmation Modal */}
      {deleteConfirmModal.isOpen && (
        <div
          className="modal-overlay visible"
          onClick={deleteConfirmModal.close}
          onKeyDown={(e) => {
            if (e.key === 'Escape') deleteConfirmModal.close();
            if (e.key === 'Enter') onDeleteSelectedAgents();
          }}
        >
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">Remove Agents</div>
            <div className="modal-body confirm-modal-body">
              <p>Remove {state.selectedAgentIds.size} selected agent{state.selectedAgentIds.size > 1 ? 's' : ''} from the battlefield?</p>
              <p className="confirm-modal-note">Claude Code sessions will continue running in the background.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={deleteConfirmModal.close}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={onDeleteSelectedAgents} autoFocus>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Back Navigation Confirmation Modal - highest z-index */}
      {showBackNavModal && (
        <div
          className="modal-overlay navigation-confirm-overlay visible"
          onClick={onCloseBackNavModal}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCloseBackNavModal();
          }}
        >
          <div className="modal confirm-modal navigation-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">Leave Tide Commander?</div>
            <div className="modal-body confirm-modal-body">
              <p>Are you sure you want to leave this page?</p>
              <p className="confirm-modal-note">Active Claude Code sessions will continue running in the background.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={onCloseBackNavModal} autoFocus>
                Stay
              </button>
              <button className="btn btn-danger" onClick={onLeave}>
                Leave
              </button>
            </div>
          </div>
        </div>
      )}

      <Profiler id="CommanderView" onRender={profileRender}>
        <CommanderView
          isOpen={commanderModal.isOpen}
          onClose={commanderModal.close}
        />
      </Profiler>

      {/* Supervisor Panel */}
      <SupervisorPanel
        isOpen={supervisorModal.isOpen}
        onClose={supervisorModal.close}
      />

      {/* File Explorer Panel (right side) */}
      <FileExplorerPanel
        isOpen={explorerModal.isOpen || explorerFolderPath !== null}
        areaId={explorerModal.id}
        folderPath={explorerFolderPath}
        onClose={() => {
          explorerModal.close();
          store.closeFileExplorer();
        }}
      />

      {/* Spotlight / Global Search */}
      <Spotlight
        isOpen={spotlightModal.isOpen}
        onClose={spotlightModal.close}
        onOpenSpawnModal={() => spawnModal.open()}
        onOpenCommanderView={() => commanderModal.open()}
        onOpenToolbox={() => toolboxModal.open()}
        onOpenSupervisor={() => supervisorModal.open()}
        onOpenFileExplorer={(areaId) => explorerModal.open(areaId)}
      />

      {/* Controls Modal (Keyboard & Mouse) */}
      <ControlsModal
        isOpen={controlsModal.isOpen}
        onClose={controlsModal.close}
      />

      {/* Skills Panel */}
      <SkillsPanel
        isOpen={skillsModal.isOpen}
        onClose={skillsModal.close}
      />

      {/* Right-click Context Menu */}
      <ContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.screenPosition}
        worldPosition={contextMenu.worldPosition}
        actions={contextMenuActions}
        onClose={contextMenu.close}
      />
    </>
  );
}
