import React, { Profiler, useEffect } from 'react';
import { store, useStore } from '../store';
import { SpawnModal } from './SpawnModal';
import { BossSpawnModal } from './BossSpawnModal';
import { SubordinateAssignmentModal } from './SubordinateAssignmentModal';
import { Toolbox, type SceneConfig } from './toolbox';
import { BuildingConfigModal } from './BuildingConfigModal';
import { CommanderView } from './CommanderView';
import { SupervisorPanel } from './SupervisorPanel';
import { FileExplorerPanel } from './FileExplorerPanel';
import { Spotlight } from './Spotlight';
import { ControlsModal } from './ControlsModal';
import { SkillsPanel } from './SkillsPanel';
import { AgentEditModal } from './AgentEditModal';
import { ContextMenu, type ContextMenuAction } from './ContextMenu';
import { SnapshotManager } from './SnapshotManager';
import { RestoreArchivedAreaModal } from './RestoreArchivedAreaModal';
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
  snapshotsModal: UseModalState;
  restoreArchivedModal: UseModalState<{ x: number; z: number } | null>;
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

  // Building delete confirmation
  pendingBuildingDelete: string | 'selected' | null;
  onCancelBuildingDelete: () => void;
  onConfirmBuildingDelete: () => void;

  // Navigation modal
  showBackNavModal: boolean;
  onCloseBackNavModal: () => void;
  onLeave: () => void;

  // Building logs modals (for Spotlight)
  onOpenPM2LogsModal: (buildingId: string) => void;
  onOpenBossLogsModal: (buildingId: string) => void;
  onOpenDatabasePanel: (buildingId: string) => void;

  // Scene sync callback for restore
  onSyncScene?: () => void;
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
  snapshotsModal,
  restoreArchivedModal,
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
  pendingBuildingDelete,
  onCancelBuildingDelete,
  onConfirmBuildingDelete,
  showBackNavModal,
  onCloseBackNavModal,
  onLeave,
  onOpenPM2LogsModal,
  onOpenBossLogsModal,
  onOpenDatabasePanel,
  onSyncScene,
}: AppModalsProps) {
  const state = useStore();
  // Get snapshot state from store
  const snapshots = Array.from(state.snapshots.values());
  const snapshotsLoading = state.snapshotsLoading;
  const _currentSnapshot = state.currentSnapshot;

  // Fetch snapshots when modal opens
  useEffect(() => {
    if (snapshotsModal.isOpen) {
      store.fetchSnapshots();
    }
  }, [snapshotsModal.isOpen]);

  const isSelectedBuildingsDelete = pendingBuildingDelete === 'selected';
  const pendingBuilding = pendingBuildingDelete && pendingBuildingDelete !== 'selected'
    ? state.buildings.get(pendingBuildingDelete)
    : null;
  const selectedBuildingCount = state.selectedBuildingIds.size;

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

      {/* Delete Agent Confirmation Modal */}
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

      {/* Delete Building Confirmation Modal */}
      {(pendingBuilding || isSelectedBuildingsDelete) && (
        <div
          className="modal-overlay visible"
          onClick={onCancelBuildingDelete}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancelBuildingDelete();
            if (e.key === 'Enter') onConfirmBuildingDelete();
          }}
        >
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">Delete Building{isSelectedBuildingsDelete && selectedBuildingCount > 1 ? 's' : ''}</div>
            <div className="modal-body confirm-modal-body">
              {isSelectedBuildingsDelete ? (
                <p>Delete {selectedBuildingCount} selected building{selectedBuildingCount > 1 ? 's' : ''}?</p>
              ) : (
                <p>Delete <strong>{pendingBuilding?.name}</strong>?</p>
              )}
              <p className="confirm-modal-note">This will permanently remove the building{isSelectedBuildingsDelete && selectedBuildingCount > 1 ? 's' : ''} and {isSelectedBuildingsDelete && selectedBuildingCount > 1 ? 'their' : 'its'} configuration.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={onCancelBuildingDelete}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={onConfirmBuildingDelete} autoFocus>
                Delete
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
        isOpen={explorerModal.isOpen || explorerFolderPath !== null || state.explorerAreaId !== null}
        areaId={explorerModal.id || state.explorerAreaId || null}
        folderPath={explorerFolderPath}
        onChangeArea={(newAreaId) => explorerModal.open(newAreaId)}
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
        onOpenPM2LogsModal={onOpenPM2LogsModal}
        onOpenBossLogsModal={onOpenBossLogsModal}
        onOpenDatabasePanel={onOpenDatabasePanel}
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

      {/* Restore Archived Area Modal */}
      <RestoreArchivedAreaModal
        isOpen={restoreArchivedModal.isOpen}
        restorePosition={restoreArchivedModal.data ?? null}
        onClose={restoreArchivedModal.close}
        onRestored={onSyncScene}
      />

      {/* Snapshots Manager */}
      {snapshotsModal.isOpen && (
        <div className="modal-overlay visible" onClick={snapshotsModal.close}>
          <div className="modal snapshot-manager-modal" onClick={(e) => e.stopPropagation()}>
            <SnapshotManager
              snapshots={snapshots}
              isLoading={snapshotsLoading}
              onViewSnapshot={async (snapshotId) => {
                // Load snapshot details and display in guake terminal
                await store.loadSnapshot(snapshotId);
                // Clear agent selection so snapshot view takes priority
                // (ClaudeOutputPanel uses snapshotAgent when no agent is selected)
                state.selectedAgentIds.clear();
                // Open terminal (handles mobile view switching)
                store.setTerminalOpen(true);
                // Close the snapshot manager modal after loading
                snapshotsModal.close();
              }}
              onDeleteSnapshot={async (snapshotId) => {
                await store.deleteSnapshot(snapshotId);
                await store.fetchSnapshots();
              }}
              onRestoreSnapshot={async (snapshotId) => {
                await store.restoreFiles(snapshotId);
              }}
              onExportSnapshot={async (snapshotId) => {
                // Load snapshot to view it
                await store.loadSnapshot(snapshotId);
                snapshotsModal.close();
              }}
              onClose={snapshotsModal.close}
            />
          </div>
        </div>
      )}


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
