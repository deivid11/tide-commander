/**
 * Store - Main Entry Point
 *
 * Composes all domain-specific store modules into a unified store.
 * The store follows a functional composition pattern where each domain
 * module provides actions that operate on shared state.
 */

import type { ClientMessage } from '../../shared/types';
import { STORAGE_KEYS, getStorage, setStorage, getStorageString, setStorageString } from '../utils/storage';
import { closeAllModalsExcept } from '../hooks';

// Import types
import type { StoreState, Listener, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';

// Import domain actions
import { createAgentActions, type AgentActions } from './agents';
import { createOutputActions, type OutputActions } from './outputs';
import { createSupervisorActions, type SupervisorActions } from './supervisor';
import { createAreaActions, type AreaActions } from './areas';
import { createBuildingActions, type BuildingActions } from './buildings';
import { createPermissionActions, type PermissionActions } from './permissions';
import { createDelegationActions, type DelegationActions } from './delegation';
import { createSkillActions, type SkillActions } from './skills';
import { createExecTaskActions, type ExecTaskActions } from './execTasks';
import { createSecretActions, type SecretActions } from './secrets';
import { createDatabaseActions, type DatabaseActions } from './database';
import { createSnapshotActions, type SnapshotActions } from './snapshots';

// Import shortcuts
import { ShortcutConfig, DEFAULT_SHORTCUTS } from './shortcuts';

// Import mouse controls
import {
  MouseControlConfig,
  MouseControlsState,
  CameraSensitivityConfig,
  TrackpadConfig,
  DEFAULT_MOUSE_CONTROLS,
  DEFAULT_CAMERA_SENSITIVITY,
  DEFAULT_TRACKPAD_CONFIG,
} from './mouseControls';

// Re-export types
export type {
  StoreState,
  Activity,
  ClaudeOutput,
  ToolExecution,
  FileChange,
  LastPrompt,
  Settings,
  SupervisorState,
  Listener,
  AgentTaskProgress,
} from './types';

export { DEFAULT_SETTINGS } from './types';

// Re-export shortcuts
export type { ShortcutConfig } from './shortcuts';
export { DEFAULT_SHORTCUTS, matchesShortcut, formatShortcut } from './shortcuts';

// Re-export mouse controls
export type { MouseControlConfig, MouseControlsState, CameraSensitivityConfig, TrackpadConfig } from './mouseControls';
export {
  DEFAULT_MOUSE_CONTROLS,
  DEFAULT_CAMERA_SENSITIVITY,
  DEFAULT_TRACKPAD_CONFIG,
  formatMouseBinding,
  findConflictingMouseBindings,
  BUTTON_NAMES,
  ACTION_NAMES,
} from './mouseControls';

// Re-export selectors (React hooks)
export {
  useStore,
  useAgents,
  useAgentsArray,
  useAgent,
  useSelectedAgentIds,
  useSelectedAgents,
  useBossAgents,
  useSubordinateAgents,
  useAgentOutputs,
  useLastPrompt,
  useLastPrompts,
  useActivities,
  useIsConnected,
  useAreas,
  useActiveTool,
  useSelectedAreaId,
  useBuildings,
  useSelectedBuildingIds,
  useBuildingLogs,
  useSupervisor,
  useSupervisorEnabled,
  useAgentSupervisorHistory,
  usePermissionRequests,
  useDelegationHistory,
  usePendingDelegation,
  useLastDelegationReceived,
  useSettings,
  useHideCost,
  useCustomAgentNames,
  useShortcuts,
  useTerminalOpen,
  useMobileView,
  useFileViewerPath,
  useFileViewerEditData,
  useExplorerFolderPath,
  useContextModalAgentId,
  useToolExecutions,
  useFileChanges,
  useSkills,
  useSkillsArray,
  useSkill,
  useAgentSkills,
  useCustomAgentClasses,
  useCustomAgentClassesArray,
  useCustomAgentClass,
  useReconnectCount,
  useGlobalUsage,
  useRefreshingUsage,
  useMouseControls,
  useCameraSensitivity,
  useTrackpadConfig,
  useAgentTaskProgress,
  useExecTasks,
  useAllExecTasks,
  useSecrets,
  useSecretsArray,
  useSecret,
  useDatabaseState,
  useQueryResults,
  useQueryHistory,
  useExecutingQuery,
  useDockerContainersList,
  useDockerComposeProjectsList,
  useSnapshots,
  useCurrentSnapshot,
  useSnapshotsLoading,
  useSnapshotsError,
} from './selectors';

// ============================================================================
// Store Class
// ============================================================================

class Store
  implements
    AgentActions,
    OutputActions,
    SupervisorActions,
    AreaActions,
    BuildingActions,
    PermissionActions,
    DelegationActions,
    SkillActions,
    ExecTaskActions,
    SecretActions,
    SnapshotActions
{
  private state: StoreState;
  private listeners = new Set<Listener>();
  private sendMessage: ((msg: ClientMessage) => void) | null = null;

  // Domain actions
  private agentActions: AgentActions;
  private outputActions: OutputActions;
  private supervisorActions: SupervisorActions;
  private areaActions: AreaActions;
  private buildingActions: BuildingActions;
  private permissionActions: PermissionActions;
  private delegationActions: DelegationActions;
  private skillActions: SkillActions;
  private execTaskActions: ExecTaskActions;
  private secretActions: SecretActions;
  private databaseActions: DatabaseActions;
  private snapshotActions: SnapshotActions;

  constructor() {
    // Initialize state
    this.state = {
      agents: new Map(),
      selectedAgentIds: new Set(),
      lastSelectedAgentId: null,
      activities: [],
      isConnected: false,
      areas: new Map(),
      activeTool: null,
      selectedAreaId: null,
      buildings: new Map(),
      selectedBuildingIds: new Set(),
      buildingLogs: new Map(),
      streamingBuildingLogs: new Map(),
      streamingBuildingIds: new Set(),
      bossStreamingLogs: new Map(),
      agentOutputs: new Map(),
      lastPrompts: new Map(),
      toolExecutions: [],
      fileChanges: [],
      terminalOpen: false,
      terminalResizing: false,
      mobileView: this.loadMobileView(),
      settings: this.loadSettings(),
      shortcuts: this.loadShortcuts(),
      mouseControls: this.loadMouseControls(),
      fileViewerPath: null,
      fileViewerEditData: null,
      explorerFolderPath: null,
      contextModalAgentId: null,
      supervisor: {
        enabled: true,
        autoReportOnComplete: false,
        lastReport: null,
        narratives: new Map(),
        lastReportTime: null,
        nextReportTime: null,
        agentHistories: new Map(),
        loadingHistoryForAgent: null,
        historyFetchedForAgents: new Set(),
        generatingReport: false,
        globalUsage: null,
        refreshingUsage: false,
      },
      permissionRequests: new Map(),
      delegationHistories: new Map(),
      pendingDelegation: null,
      lastDelegationReceived: new Map(),
      agentTaskProgress: new Map(),
      skills: new Map(),
      customAgentClasses: new Map(),
      reconnectCount: 0,
      execTasks: new Map(),
      secrets: new Map(),
      databaseState: new Map(),
      dockerContainersList: [],
      dockerComposeProjectsList: [],
      snapshots: new Map(),
      currentSnapshot: null,
      snapshotsLoading: false,
      snapshotsError: null,
      lastSelectionViaSwipe: false,
      lastSelectionViaDirectClick: false,
    };

    // Helper functions for domain modules
    const getState = () => this.state;
    const setState = (updater: (state: StoreState) => void) => {
      updater(this.state);
    };
    const notify = () => this.notify();
    const getSendMessage = () => this.sendMessage;
    const getListenerCount = () => this.listeners.size;

    // Create domain actions
    this.agentActions = createAgentActions(getState, setState, notify, getSendMessage);
    this.outputActions = createOutputActions(getState, setState, notify, getListenerCount);
    this.supervisorActions = createSupervisorActions(getState, setState, notify, getSendMessage);
    this.areaActions = createAreaActions(getState, setState, notify, getSendMessage);
    this.buildingActions = createBuildingActions(getState, setState, notify, getSendMessage);
    this.permissionActions = createPermissionActions(getState, setState, notify, getSendMessage);
    this.delegationActions = createDelegationActions(getState, setState, notify, getSendMessage);
    this.skillActions = createSkillActions(getState, setState, notify, getSendMessage);
    this.execTaskActions = createExecTaskActions(getState, setState, notify);
    this.secretActions = createSecretActions(getState, setState, notify, getSendMessage);
    this.databaseActions = createDatabaseActions(getState, setState, notify, getSendMessage);
    this.snapshotActions = createSnapshotActions(getState, setState, notify);
  }

  private loadSettings(): Settings {
    const stored = getStorage<typeof DEFAULT_SETTINGS | null>(STORAGE_KEYS.SETTINGS, null);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...stored };
    }
    return { ...DEFAULT_SETTINGS };
  }

  private loadShortcuts(): ShortcutConfig[] {
    const stored = getStorage<ShortcutConfig[] | null>(STORAGE_KEYS.SHORTCUTS, null);
    if (stored) {
      const mergedShortcuts = DEFAULT_SHORTCUTS.map((defaultShortcut) => {
        const saved = stored.find((s) => s.id === defaultShortcut.id);
        return saved ? { ...defaultShortcut, ...saved } : defaultShortcut;
      });
      return mergedShortcuts;
    }
    return [...DEFAULT_SHORTCUTS];
  }

  private loadMouseControls(): MouseControlsState {
    const stored = getStorage<MouseControlsState | null>(STORAGE_KEYS.MOUSE_CONTROLS, null);
    if (stored) {
      // Merge with defaults to handle new controls added in updates
      const mergedBindings = DEFAULT_MOUSE_CONTROLS.map((defaultBinding) => {
        const saved = stored.bindings?.find((b) => b.id === defaultBinding.id);
        return saved ? { ...defaultBinding, ...saved } : defaultBinding;
      });
      return {
        bindings: mergedBindings,
        sensitivity: { ...DEFAULT_CAMERA_SENSITIVITY, ...stored.sensitivity },
        trackpad: {
          ...DEFAULT_TRACKPAD_CONFIG,
          ...stored.trackpad,
          sensitivity: {
            ...DEFAULT_TRACKPAD_CONFIG.sensitivity,
            ...stored.trackpad?.sensitivity,
          },
        },
      };
    }
    return {
      bindings: [...DEFAULT_MOUSE_CONTROLS],
      sensitivity: { ...DEFAULT_CAMERA_SENSITIVITY },
      trackpad: { ...DEFAULT_TRACKPAD_CONFIG },
    };
  }

  private loadMobileView(): 'terminal' | '3d' {
    const stored = getStorageString(STORAGE_KEYS.MOBILE_VIEW, '');
    if (stored === 'terminal' || stored === '3d') {
      return stored;
    }
    // Default to '3d' (battlefield/game mode) on mobile devices
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768 && 'ontouchstart' in window;
    return isMobile ? '3d' : 'terminal';
  }

  // ============================================================================
  // Core Store Methods
  // ============================================================================

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  getState(): StoreState {
    return this.state;
  }

  setSendMessage(fn: (msg: ClientMessage) => void): void {
    this.sendMessage = fn;
  }

  setConnected(isConnected: boolean): void {
    this.state.isConnected = isConnected;
    this.notify();
  }

  /**
   * Called when WebSocket reconnects after a disconnect
   * Increments reconnectCount so components can refresh their data
   */
  triggerReconnect(): void {
    this.state.reconnectCount++;
    this.notify();
  }

  // ============================================================================
  // Terminal State
  // ============================================================================

  toggleTerminal(agentId?: string): void {
    if (agentId && !this.state.selectedAgentIds.has(agentId)) {
      this.state.selectedAgentIds.clear();
      this.state.selectedAgentIds.add(agentId);
    }
    this.state.terminalOpen = !this.state.terminalOpen;
    this.notify();
  }

  setTerminalOpen(open: boolean): void {
    console.log('[Store] setTerminalOpen called with:', open, 'current:', this.state.terminalOpen);
    if (!open && this.state.terminalOpen) {
      // Log stack trace when closing terminal to find the culprit
      console.trace('[Store] Closing terminal - stack trace:');
    }
    this.state.terminalOpen = open;
    // When opening terminal, ensure we can actually render the terminal panel.
    // ClaudeOutputPanel returns null when no agent is selected.
    if (open) {
      this.state.mobileView = 'terminal';
      // Don't auto-select an agent when viewing a snapshot — let ClaudeOutputPanel
      // use the virtual snapshotAgent from currentSnapshot instead
      if (this.state.selectedAgentIds.size === 0 && this.state.agents.size > 0 && !this.state.currentSnapshot) {
        const firstAgentId = Array.from(this.state.agents.keys())[0];
        console.log('[Store] Auto-selecting first agent for terminal open:', firstAgentId);
        this.state.selectedAgentIds = new Set([firstAgentId]);
      }
    }
    this.notify();
    console.log('[Store] After notify, terminalOpen:', this.state.terminalOpen);
  }

  setMobileView(view: 'terminal' | '3d'): void {
    console.log('[Store] setMobileView called:', view, 'previous:', this.state.mobileView);
    this.state.mobileView = view;
    // Persist mobile view preference to localStorage
    setStorageString(STORAGE_KEYS.MOBILE_VIEW, view);
    // When switching to terminal view on mobile, ensure an agent is selected
    // Otherwise the terminal component returns null
    if (view === 'terminal' && this.state.selectedAgentIds.size === 0 && this.state.agents.size > 0 && !this.state.currentSnapshot) {
      const firstAgentId = Array.from(this.state.agents.keys())[0];
      console.log('[Store] Auto-selecting first agent for terminal view:', firstAgentId);
      this.state.selectedAgentIds = new Set([firstAgentId]);
      this.state.terminalOpen = true;
    }
    this.notify();
  }

  /**
   * Open terminal on mobile, closing all other modals first.
   * This ensures the terminal is visible and not obscured by other panels.
   */
  openTerminalOnMobile(agentId: string): void {
    console.log('[Store] openTerminalOnMobile called for agent:', agentId);
    // Close all modals except terminal itself
    closeAllModalsExcept('terminal');
    // Select the agent
    this.state.selectedAgentIds.clear();
    this.state.selectedAgentIds.add(agentId);
    // Open terminal
    this.state.terminalOpen = true;
    // Switch to terminal view
    this.state.mobileView = 'terminal';
    this.notify();
  }

  setTerminalResizing(resizing: boolean): void {
    this.state.terminalResizing = resizing;
    this.notify();
  }

  /**
   * Mark that the last agent selection was via swipe gesture.
   * This prevents autofocus on mobile to avoid unwanted keyboard popup.
   */
  setLastSelectionViaSwipe(value: boolean): void {
    this.state.lastSelectionViaSwipe = value;
    // Don't notify - this is an internal flag that doesn't need to trigger re-renders
  }

  /**
   * Consume and clear the swipe selection flag.
   * Returns true if the flag was set, then clears it.
   */
  consumeSwipeSelectionFlag(): boolean {
    const wasSwipe = this.state.lastSelectionViaSwipe;
    this.state.lastSelectionViaSwipe = false;
    return wasSwipe;
  }

  /**
   * Mark that the last agent selection was via direct click on agent bar.
   * This prevents autofocus to avoid unwanted keyboard popup.
   */
  setLastSelectionViaDirectClick(value: boolean): void {
    this.state.lastSelectionViaDirectClick = value;
    // Don't notify - this is an internal flag that doesn't need to trigger re-renders
  }

  /**
   * Consume and clear the direct click selection flag.
   * Returns true if the flag was set, then clears it.
   */
  consumeDirectClickSelectionFlag(): boolean {
    const wasDirectClick = this.state.lastSelectionViaDirectClick;
    this.state.lastSelectionViaDirectClick = false;
    return wasDirectClick;
  }

  // ============================================================================
  // File Viewer
  // ============================================================================

  setFileViewerPath(
    path: string | null,
    editData?: { oldString?: string; newString?: string; highlightRange?: { offset: number; limit: number } }
  ): void {
    this.state.fileViewerPath = path;
    this.state.fileViewerEditData = editData || null;
    this.notify();
  }

  clearFileViewerPath(): void {
    this.state.fileViewerPath = null;
    this.state.fileViewerEditData = null;
    this.notify();
  }

  // ============================================================================
  // File Explorer
  // ============================================================================

  setExplorerFolderPath(path: string | null): void {
    this.state.explorerFolderPath = path;
    this.notify();
  }

  openFileExplorer(path: string): void {
    this.state.explorerFolderPath = path;
    this.notify();
  }

  closeFileExplorer(): void {
    this.state.explorerFolderPath = null;
    this.notify();
  }

  // ============================================================================
  // Context Modal
  // ============================================================================

  setContextModalAgentId(agentId: string | null): void {
    this.state.contextModalAgentId = agentId;
    this.notify();
  }

  closeContextModal(): void {
    this.state.contextModalAgentId = null;
    this.notify();
  }

  // ============================================================================
  // Settings
  // ============================================================================

  updateSettings(updates: Partial<Settings>): void {
    this.state.settings = { ...this.state.settings, ...updates };
    setStorage(STORAGE_KEYS.SETTINGS, this.state.settings);
    this.notify();
  }

  getSettings(): Settings {
    return this.state.settings;
  }

  // ============================================================================
  // Keyboard Shortcuts
  // ============================================================================

  getShortcuts(): ShortcutConfig[] {
    return this.state.shortcuts;
  }

  getShortcut(id: string): ShortcutConfig | undefined {
    return this.state.shortcuts.find((s) => s.id === id);
  }

  updateShortcut(id: string, updates: Partial<ShortcutConfig>): void {
    const index = this.state.shortcuts.findIndex((s) => s.id === id);
    if (index !== -1) {
      this.state.shortcuts = [
        ...this.state.shortcuts.slice(0, index),
        { ...this.state.shortcuts[index], ...updates },
        ...this.state.shortcuts.slice(index + 1),
      ];
      this.saveShortcuts();
      this.notify();
    }
  }

  resetShortcuts(): void {
    this.state.shortcuts = [...DEFAULT_SHORTCUTS];
    this.saveShortcuts();
    this.notify();
  }

  private saveShortcuts(): void {
    setStorage(STORAGE_KEYS.SHORTCUTS, this.state.shortcuts);
  }

  // ============================================================================
  // Mouse Controls
  // ============================================================================

  getMouseControls(): MouseControlsState {
    return this.state.mouseControls;
  }

  getMouseBinding(id: string): MouseControlConfig | undefined {
    return this.state.mouseControls.bindings.find((b) => b.id === id);
  }

  updateMouseBinding(id: string, updates: Partial<MouseControlConfig>): void {
    const index = this.state.mouseControls.bindings.findIndex((b) => b.id === id);
    if (index !== -1) {
      this.state.mouseControls.bindings = [
        ...this.state.mouseControls.bindings.slice(0, index),
        { ...this.state.mouseControls.bindings[index], ...updates },
        ...this.state.mouseControls.bindings.slice(index + 1),
      ];
      this.saveMouseControls();
      this.notify();
    }
  }

  updateCameraSensitivity(updates: Partial<CameraSensitivityConfig>): void {
    this.state.mouseControls.sensitivity = {
      ...this.state.mouseControls.sensitivity,
      ...updates,
    };
    this.saveMouseControls();
    this.notify();
  }

  resetMouseControls(): void {
    this.state.mouseControls = {
      bindings: [...DEFAULT_MOUSE_CONTROLS],
      sensitivity: { ...DEFAULT_CAMERA_SENSITIVITY },
      trackpad: { ...DEFAULT_TRACKPAD_CONFIG },
    };
    this.saveMouseControls();
    this.notify();
  }

  // Trackpad-specific methods
  getTrackpadConfig(): TrackpadConfig {
    return this.state.mouseControls.trackpad;
  }

  updateTrackpadConfig(updates: Partial<TrackpadConfig>): void {
    this.state.mouseControls.trackpad = {
      ...this.state.mouseControls.trackpad,
      ...updates,
      sensitivity: {
        ...this.state.mouseControls.trackpad.sensitivity,
        ...(updates.sensitivity || {}),
      },
    };
    this.saveMouseControls();
    this.notify();
  }

  private saveMouseControls(): void {
    setStorage(STORAGE_KEYS.MOUSE_CONTROLS, this.state.mouseControls);
  }

  // ============================================================================
  // Status Polling (disabled - WebSocket handles this)
  // ============================================================================

  private statusPollInterval: number | null = null;

  startStatusPolling(): void {
    // Disabled: WebSocket already syncs status on connect and broadcasts updates
  }

  stopStatusPolling(): void {
    if (this.statusPollInterval) {
      clearInterval(this.statusPollInterval);
      this.statusPollInterval = null;
    }
  }

  // ============================================================================
  // Agent Actions (delegated)
  // ============================================================================

  setAgents(...args: Parameters<AgentActions['setAgents']>) { return this.agentActions.setAgents(...args); }
  addAgent(...args: Parameters<AgentActions['addAgent']>) { return this.agentActions.addAgent(...args); }
  updateAgent(...args: Parameters<AgentActions['updateAgent']>) { return this.agentActions.updateAgent(...args); }
  updateAgentContextStats(...args: Parameters<AgentActions['updateAgentContextStats']>) { return this.agentActions.updateAgentContextStats(...args); }
  removeAgent(...args: Parameters<AgentActions['removeAgent']>) { return this.agentActions.removeAgent(...args); }
  selectAgent(...args: Parameters<AgentActions['selectAgent']>) { return this.agentActions.selectAgent(...args); }
  addToSelection(...args: Parameters<AgentActions['addToSelection']>) { return this.agentActions.addToSelection(...args); }
  selectMultiple(...args: Parameters<AgentActions['selectMultiple']>) { return this.agentActions.selectMultiple(...args); }
  deselectAll(...args: Parameters<AgentActions['deselectAll']>) { return this.agentActions.deselectAll(...args); }
  spawnAgent(...args: Parameters<AgentActions['spawnAgent']>) { return this.agentActions.spawnAgent(...args); }
  createDirectoryAndSpawn(...args: Parameters<AgentActions['createDirectoryAndSpawn']>) { return this.agentActions.createDirectoryAndSpawn(...args); }
  sendCommand(...args: Parameters<AgentActions['sendCommand']>) { return this.agentActions.sendCommand(...args); }
  refreshAgentContext(...args: Parameters<AgentActions['refreshAgentContext']>) { return this.agentActions.refreshAgentContext(...args); }
  moveAgent(...args: Parameters<AgentActions['moveAgent']>) { return this.agentActions.moveAgent(...args); }
  killAgent(...args: Parameters<AgentActions['killAgent']>) { return this.agentActions.killAgent(...args); }
  stopAgent(...args: Parameters<AgentActions['stopAgent']>) { return this.agentActions.stopAgent(...args); }
  clearContext(...args: Parameters<AgentActions['clearContext']>) { return this.agentActions.clearContext(...args); }
  collapseContext(...args: Parameters<AgentActions['collapseContext']>) { return this.agentActions.collapseContext(...args); }
  removeAgentFromServer(...args: Parameters<AgentActions['removeAgentFromServer']>) { return this.agentActions.removeAgentFromServer(...args); }
  renameAgent(...args: Parameters<AgentActions['renameAgent']>) { return this.agentActions.renameAgent(...args); }
  updateAgentProperties(...args: Parameters<AgentActions['updateAgentProperties']>) { return this.agentActions.updateAgentProperties(...args); }
  getTotalTokens() { return this.agentActions.getTotalTokens(); }
  getSelectedAgents() { return this.agentActions.getSelectedAgents(); }
  addActivity(...args: Parameters<AgentActions['addActivity']>) { return this.agentActions.addActivity(...args); }
  addToolExecution(...args: Parameters<AgentActions['addToolExecution']>) { return this.agentActions.addToolExecution(...args); }
  addFileChange(...args: Parameters<AgentActions['addFileChange']>) { return this.agentActions.addFileChange(...args); }
  loadToolHistory() { return this.agentActions.loadToolHistory(); }

  // ============================================================================
  // Output Actions (delegated)
  // ============================================================================

  addOutput(...args: Parameters<OutputActions['addOutput']>) { return this.outputActions.addOutput(...args); }
  clearOutputs(...args: Parameters<OutputActions['clearOutputs']>) { return this.outputActions.clearOutputs(...args); }
  getOutputs(...args: Parameters<OutputActions['getOutputs']>) { return this.outputActions.getOutputs(...args); }
  addUserPromptToOutput(...args: Parameters<OutputActions['addUserPromptToOutput']>) { return this.outputActions.addUserPromptToOutput(...args); }
  getLastPrompt(...args: Parameters<OutputActions['getLastPrompt']>) { return this.outputActions.getLastPrompt(...args); }
  setLastPrompt(...args: Parameters<OutputActions['setLastPrompt']>) { return this.outputActions.setLastPrompt(...args); }
  preserveOutputs() { return this.outputActions.preserveOutputs(); }
  mergeOutputsWithHistory(...args: Parameters<OutputActions['mergeOutputsWithHistory']>) { return this.outputActions.mergeOutputsWithHistory(...args); }

  // ============================================================================
  // Supervisor Actions (delegated)
  // ============================================================================

  setSupervisorReport(...args: Parameters<SupervisorActions['setSupervisorReport']>) { return this.supervisorActions.setSupervisorReport(...args); }
  addNarrative(...args: Parameters<SupervisorActions['addNarrative']>) { return this.supervisorActions.addNarrative(...args); }
  getNarratives(...args: Parameters<SupervisorActions['getNarratives']>) { return this.supervisorActions.getNarratives(...args); }
  setSupervisorStatus(...args: Parameters<SupervisorActions['setSupervisorStatus']>) { return this.supervisorActions.setSupervisorStatus(...args); }
  setSupervisorConfig(...args: Parameters<SupervisorActions['setSupervisorConfig']>) { return this.supervisorActions.setSupervisorConfig(...args); }
  requestSupervisorReport() { return this.supervisorActions.requestSupervisorReport(); }
  requestAgentSupervisorHistory(...args: Parameters<SupervisorActions['requestAgentSupervisorHistory']>) { return this.supervisorActions.requestAgentSupervisorHistory(...args); }
  setAgentSupervisorHistory(...args: Parameters<SupervisorActions['setAgentSupervisorHistory']>) { return this.supervisorActions.setAgentSupervisorHistory(...args); }
  getAgentSupervisorHistory(...args: Parameters<SupervisorActions['getAgentSupervisorHistory']>) { return this.supervisorActions.getAgentSupervisorHistory(...args); }
  addAgentAnalysis(...args: Parameters<SupervisorActions['addAgentAnalysis']>) { return this.supervisorActions.addAgentAnalysis(...args); }
  isLoadingHistoryForAgent(...args: Parameters<SupervisorActions['isLoadingHistoryForAgent']>) { return this.supervisorActions.isLoadingHistoryForAgent(...args); }
  hasHistoryBeenFetched(...args: Parameters<SupervisorActions['hasHistoryBeenFetched']>) { return this.supervisorActions.hasHistoryBeenFetched(...args); }
  setGlobalUsage(...args: Parameters<SupervisorActions['setGlobalUsage']>) { return this.supervisorActions.setGlobalUsage(...args); }
  requestGlobalUsage() { return this.supervisorActions.requestGlobalUsage(); }
  getGlobalUsage() { return this.supervisorActions.getGlobalUsage(); }

  // ============================================================================
  // Area Actions (delegated)
  // ============================================================================

  setActiveTool(...args: Parameters<AreaActions['setActiveTool']>) { return this.areaActions.setActiveTool(...args); }
  selectArea(...args: Parameters<AreaActions['selectArea']>) { return this.areaActions.selectArea(...args); }
  addArea(...args: Parameters<AreaActions['addArea']>) { return this.areaActions.addArea(...args); }
  updateArea(...args: Parameters<AreaActions['updateArea']>) { return this.areaActions.updateArea(...args); }
  deleteArea(...args: Parameters<AreaActions['deleteArea']>) { return this.areaActions.deleteArea(...args); }
  assignAgentToArea(...args: Parameters<AreaActions['assignAgentToArea']>) { return this.areaActions.assignAgentToArea(...args); }
  unassignAgentFromArea(...args: Parameters<AreaActions['unassignAgentFromArea']>) { return this.areaActions.unassignAgentFromArea(...args); }
  addDirectoryToArea(...args: Parameters<AreaActions['addDirectoryToArea']>) { return this.areaActions.addDirectoryToArea(...args); }
  removeDirectoryFromArea(...args: Parameters<AreaActions['removeDirectoryFromArea']>) { return this.areaActions.removeDirectoryFromArea(...args); }
  getAreaDirectories(...args: Parameters<AreaActions['getAreaDirectories']>) { return this.areaActions.getAreaDirectories(...args); }
  isPositionInArea(...args: Parameters<AreaActions['isPositionInArea']>) { return this.areaActions.isPositionInArea(...args); }
  getAreaForAgent(...args: Parameters<AreaActions['getAreaForAgent']>) { return this.areaActions.getAreaForAgent(...args); }
  setAreasFromServer(...args: Parameters<AreaActions['setAreasFromServer']>) { return this.areaActions.setAreasFromServer(...args); }
  getAreasInZOrder(...args: Parameters<AreaActions['getAreasInZOrder']>) { return this.areaActions.getAreasInZOrder(...args); }
  getNextZIndex(...args: Parameters<AreaActions['getNextZIndex']>) { return this.areaActions.getNextZIndex(...args); }
  bringAreaToFront(...args: Parameters<AreaActions['bringAreaToFront']>) { return this.areaActions.bringAreaToFront(...args); }
  sendAreaToBack(...args: Parameters<AreaActions['sendAreaToBack']>) { return this.areaActions.sendAreaToBack(...args); }
  setAreaZIndex(...args: Parameters<AreaActions['setAreaZIndex']>) { return this.areaActions.setAreaZIndex(...args); }
  // Archive management
  archiveArea(...args: Parameters<AreaActions['archiveArea']>) { return this.areaActions.archiveArea(...args); }
  restoreArchivedArea(...args: Parameters<AreaActions['restoreArchivedArea']>) { return this.areaActions.restoreArchivedArea(...args); }
  getArchivedAreas(...args: Parameters<AreaActions['getArchivedAreas']>) { return this.areaActions.getArchivedAreas(...args); }
  getVisibleAreas(...args: Parameters<AreaActions['getVisibleAreas']>) { return this.areaActions.getVisibleAreas(...args); }
  isAgentInArchivedArea(...args: Parameters<AreaActions['isAgentInArchivedArea']>) { return this.areaActions.isAgentInArchivedArea(...args); }

  // ============================================================================
  // Building Actions (delegated)
  // ============================================================================

  selectBuilding(...args: Parameters<BuildingActions['selectBuilding']>) { return this.buildingActions.selectBuilding(...args); }
  selectMultipleBuildings(...args: Parameters<BuildingActions['selectMultipleBuildings']>) { return this.buildingActions.selectMultipleBuildings(...args); }
  toggleBuildingSelection(...args: Parameters<BuildingActions['toggleBuildingSelection']>) { return this.buildingActions.toggleBuildingSelection(...args); }
  isBuildingSelected(...args: Parameters<BuildingActions['isBuildingSelected']>) { return this.buildingActions.isBuildingSelected(...args); }
  getSelectedBuildingIds() { return this.buildingActions.getSelectedBuildingIds(); }
  deleteSelectedBuildings() { return this.buildingActions.deleteSelectedBuildings(); }
  addBuilding(...args: Parameters<BuildingActions['addBuilding']>) { return this.buildingActions.addBuilding(...args); }
  updateBuilding(...args: Parameters<BuildingActions['updateBuilding']>) { return this.buildingActions.updateBuilding(...args); }
  deleteBuilding(...args: Parameters<BuildingActions['deleteBuilding']>) { return this.buildingActions.deleteBuilding(...args); }
  moveBuilding(...args: Parameters<BuildingActions['moveBuilding']>) { return this.buildingActions.moveBuilding(...args); }
  updateBuildingPosition(...args: Parameters<BuildingActions['updateBuildingPosition']>) { return this.buildingActions.updateBuildingPosition(...args); }
  createBuilding(...args: Parameters<BuildingActions['createBuilding']>) { return this.buildingActions.createBuilding(...args); }
  sendBuildingCommand(...args: Parameters<BuildingActions['sendBuildingCommand']>) { return this.buildingActions.sendBuildingCommand(...args); }
  addBuildingLogs(...args: Parameters<BuildingActions['addBuildingLogs']>) { return this.buildingActions.addBuildingLogs(...args); }
  getBuildingLogs(...args: Parameters<BuildingActions['getBuildingLogs']>) { return this.buildingActions.getBuildingLogs(...args); }
  clearBuildingLogs(...args: Parameters<BuildingActions['clearBuildingLogs']>) { return this.buildingActions.clearBuildingLogs(...args); }
  setBuildingsFromServer(...args: Parameters<BuildingActions['setBuildingsFromServer']>) { return this.buildingActions.setBuildingsFromServer(...args); }
  updateBuildingFromServer(...args: Parameters<BuildingActions['updateBuildingFromServer']>) { return this.buildingActions.updateBuildingFromServer(...args); }
  removeBuildingFromServer(...args: Parameters<BuildingActions['removeBuildingFromServer']>) { return this.buildingActions.removeBuildingFromServer(...args); }
  // Streaming log methods
  startLogStreaming(...args: Parameters<BuildingActions['startLogStreaming']>) { return this.buildingActions.startLogStreaming(...args); }
  stopLogStreaming(...args: Parameters<BuildingActions['stopLogStreaming']>) { return this.buildingActions.stopLogStreaming(...args); }
  appendStreamingLogChunk(...args: Parameters<BuildingActions['appendStreamingLogChunk']>) { return this.buildingActions.appendStreamingLogChunk(...args); }
  setStreamingStatus(...args: Parameters<BuildingActions['setStreamingStatus']>) { return this.buildingActions.setStreamingStatus(...args); }
  getStreamingLogs(...args: Parameters<BuildingActions['getStreamingLogs']>) { return this.buildingActions.getStreamingLogs(...args); }
  clearStreamingLogs(...args: Parameters<BuildingActions['clearStreamingLogs']>) { return this.buildingActions.clearStreamingLogs(...args); }
  isLogStreaming(...args: Parameters<BuildingActions['isLogStreaming']>) { return this.buildingActions.isLogStreaming(...args); }
  // Boss building methods
  sendBossBuildingCommand(...args: Parameters<BuildingActions['sendBossBuildingCommand']>) { return this.buildingActions.sendBossBuildingCommand(...args); }
  assignBuildingsToBoSS(...args: Parameters<BuildingActions['assignBuildingsToBoSS']>) { return this.buildingActions.assignBuildingsToBoSS(...args); }
  startBossLogStreaming(...args: Parameters<BuildingActions['startBossLogStreaming']>) { return this.buildingActions.startBossLogStreaming(...args); }
  stopBossLogStreaming(...args: Parameters<BuildingActions['stopBossLogStreaming']>) { return this.buildingActions.stopBossLogStreaming(...args); }
  appendBossStreamingLogChunk(...args: Parameters<BuildingActions['appendBossStreamingLogChunk']>) { return this.buildingActions.appendBossStreamingLogChunk(...args); }
  getBossStreamingLogs(...args: Parameters<BuildingActions['getBossStreamingLogs']>) { return this.buildingActions.getBossStreamingLogs(...args); }
  clearBossStreamingLogs(...args: Parameters<BuildingActions['clearBossStreamingLogs']>) { return this.buildingActions.clearBossStreamingLogs(...args); }
  // Docker container discovery methods
  requestDockerContainersList() { return this.buildingActions.requestDockerContainersList(); }
  setDockerContainersList(...args: Parameters<BuildingActions['setDockerContainersList']>) { return this.buildingActions.setDockerContainersList(...args); }
  getDockerContainersList() { return this.buildingActions.getDockerContainersList(); }
  getDockerComposeProjectsList() { return this.buildingActions.getDockerComposeProjectsList(); }

  // ============================================================================
  // Permission Actions (delegated)
  // ============================================================================

  addPermissionRequest(...args: Parameters<PermissionActions['addPermissionRequest']>) { return this.permissionActions.addPermissionRequest(...args); }
  resolvePermissionRequest(...args: Parameters<PermissionActions['resolvePermissionRequest']>) { return this.permissionActions.resolvePermissionRequest(...args); }
  respondToPermissionRequest(...args: Parameters<PermissionActions['respondToPermissionRequest']>) { return this.permissionActions.respondToPermissionRequest(...args); }
  getPendingPermissionsForAgent(...args: Parameters<PermissionActions['getPendingPermissionsForAgent']>) { return this.permissionActions.getPendingPermissionsForAgent(...args); }
  clearAllPermissions(...args: Parameters<PermissionActions['clearAllPermissions']>) { return this.permissionActions.clearAllPermissions(...args); }

  // ============================================================================
  // Delegation Actions (delegated)
  // ============================================================================

  spawnBossAgent(...args: Parameters<DelegationActions['spawnBossAgent']>) { return this.delegationActions.spawnBossAgent(...args); }
  assignSubordinates(...args: Parameters<DelegationActions['assignSubordinates']>) { return this.delegationActions.assignSubordinates(...args); }
  removeSubordinate(...args: Parameters<DelegationActions['removeSubordinate']>) { return this.delegationActions.removeSubordinate(...args); }
  sendBossCommand(...args: Parameters<DelegationActions['sendBossCommand']>) { return this.delegationActions.sendBossCommand(...args); }
  requestDelegationHistory(...args: Parameters<DelegationActions['requestDelegationHistory']>) { return this.delegationActions.requestDelegationHistory(...args); }
  handleDelegationDecision(...args: Parameters<DelegationActions['handleDelegationDecision']>) { return this.delegationActions.handleDelegationDecision(...args); }
  setDelegationHistory(...args: Parameters<DelegationActions['setDelegationHistory']>) { return this.delegationActions.setDelegationHistory(...args); }
  getDelegationHistory(...args: Parameters<DelegationActions['getDelegationHistory']>) { return this.delegationActions.getDelegationHistory(...args); }
  getLastDelegationReceived(...args: Parameters<DelegationActions['getLastDelegationReceived']>) { return this.delegationActions.getLastDelegationReceived(...args); }
  clearLastDelegationReceived(...args: Parameters<DelegationActions['clearLastDelegationReceived']>) { return this.delegationActions.clearLastDelegationReceived(...args); }
  updateBossSubordinates(...args: Parameters<DelegationActions['updateBossSubordinates']>) { return this.delegationActions.updateBossSubordinates(...args); }
  getSubordinates(...args: Parameters<DelegationActions['getSubordinates']>) { return this.delegationActions.getSubordinates(...args); }
  isBossAgent(...args: Parameters<DelegationActions['isBossAgent']>) { return this.delegationActions.isBossAgent(...args); }
  getBossForAgent(...args: Parameters<DelegationActions['getBossForAgent']>) { return this.delegationActions.getBossForAgent(...args); }
  getAvailableSubordinates() { return this.delegationActions.getAvailableSubordinates(); }
  handleAgentTaskStarted(...args: Parameters<DelegationActions['handleAgentTaskStarted']>) { return this.delegationActions.handleAgentTaskStarted(...args); }
  handleAgentTaskOutput(...args: Parameters<DelegationActions['handleAgentTaskOutput']>) { return this.delegationActions.handleAgentTaskOutput(...args); }
  handleAgentTaskCompleted(...args: Parameters<DelegationActions['handleAgentTaskCompleted']>) { return this.delegationActions.handleAgentTaskCompleted(...args); }
  getAgentTaskProgress(...args: Parameters<DelegationActions['getAgentTaskProgress']>) { return this.delegationActions.getAgentTaskProgress(...args); }
  clearAgentTaskProgress(...args: Parameters<DelegationActions['clearAgentTaskProgress']>) { return this.delegationActions.clearAgentTaskProgress(...args); }
  clearAllSubordinatesContext(...args: Parameters<DelegationActions['clearAllSubordinatesContext']>) { return this.delegationActions.clearAllSubordinatesContext(...args); }

  // ============================================================================
  // Skill Actions (delegated)
  // ============================================================================

  setSkillsFromServer(...args: Parameters<SkillActions['setSkillsFromServer']>) { return this.skillActions.setSkillsFromServer(...args); }
  addSkillFromServer(...args: Parameters<SkillActions['addSkillFromServer']>) { return this.skillActions.addSkillFromServer(...args); }
  updateSkillFromServer(...args: Parameters<SkillActions['updateSkillFromServer']>) { return this.skillActions.updateSkillFromServer(...args); }
  removeSkillFromServer(...args: Parameters<SkillActions['removeSkillFromServer']>) { return this.skillActions.removeSkillFromServer(...args); }
  getSkill(...args: Parameters<SkillActions['getSkill']>) { return this.skillActions.getSkill(...args); }
  getAllSkills() { return this.skillActions.getAllSkills(); }
  getSkillsForAgent(...args: Parameters<SkillActions['getSkillsForAgent']>) { return this.skillActions.getSkillsForAgent(...args); }
  createSkill(...args: Parameters<SkillActions['createSkill']>) { return this.skillActions.createSkill(...args); }
  updateSkill(...args: Parameters<SkillActions['updateSkill']>) { return this.skillActions.updateSkill(...args); }
  deleteSkill(...args: Parameters<SkillActions['deleteSkill']>) { return this.skillActions.deleteSkill(...args); }
  assignSkillToAgent(...args: Parameters<SkillActions['assignSkillToAgent']>) { return this.skillActions.assignSkillToAgent(...args); }
  unassignSkillFromAgent(...args: Parameters<SkillActions['unassignSkillFromAgent']>) { return this.skillActions.unassignSkillFromAgent(...args); }
  requestAgentSkills(...args: Parameters<SkillActions['requestAgentSkills']>) { return this.skillActions.requestAgentSkills(...args); }

  // Custom Agent Classes
  setCustomAgentClassesFromServer(...args: Parameters<SkillActions['setCustomAgentClassesFromServer']>) { return this.skillActions.setCustomAgentClassesFromServer(...args); }
  addCustomAgentClassFromServer(...args: Parameters<SkillActions['addCustomAgentClassFromServer']>) { return this.skillActions.addCustomAgentClassFromServer(...args); }
  updateCustomAgentClassFromServer(...args: Parameters<SkillActions['updateCustomAgentClassFromServer']>) { return this.skillActions.updateCustomAgentClassFromServer(...args); }
  removeCustomAgentClassFromServer(...args: Parameters<SkillActions['removeCustomAgentClassFromServer']>) { return this.skillActions.removeCustomAgentClassFromServer(...args); }
  getCustomAgentClass(...args: Parameters<SkillActions['getCustomAgentClass']>) { return this.skillActions.getCustomAgentClass(...args); }
  getAllCustomAgentClasses() { return this.skillActions.getAllCustomAgentClasses(); }
  createCustomAgentClass(...args: Parameters<SkillActions['createCustomAgentClass']>) { return this.skillActions.createCustomAgentClass(...args); }
  updateCustomAgentClass(...args: Parameters<SkillActions['updateCustomAgentClass']>) { return this.skillActions.updateCustomAgentClass(...args); }
  deleteCustomAgentClass(...args: Parameters<SkillActions['deleteCustomAgentClass']>) { return this.skillActions.deleteCustomAgentClass(...args); }

  // ============================================================================
  // Exec Task Actions (delegated)
  // ============================================================================

  handleExecTaskStarted(...args: Parameters<ExecTaskActions['handleExecTaskStarted']>) { return this.execTaskActions.handleExecTaskStarted(...args); }
  handleExecTaskOutput(...args: Parameters<ExecTaskActions['handleExecTaskOutput']>) { return this.execTaskActions.handleExecTaskOutput(...args); }
  handleExecTaskCompleted(...args: Parameters<ExecTaskActions['handleExecTaskCompleted']>) { return this.execTaskActions.handleExecTaskCompleted(...args); }
  stopExecTask(...args: Parameters<ExecTaskActions['stopExecTask']>) { return this.execTaskActions.stopExecTask(...args); }
  getExecTasks(...args: Parameters<ExecTaskActions['getExecTasks']>) { return this.execTaskActions.getExecTasks(...args); }
  getAllExecTasks() { return this.execTaskActions.getAllExecTasks(); }
  getExecTask(...args: Parameters<ExecTaskActions['getExecTask']>) { return this.execTaskActions.getExecTask(...args); }
  clearCompletedExecTasks(...args: Parameters<ExecTaskActions['clearCompletedExecTasks']>) { return this.execTaskActions.clearCompletedExecTasks(...args); }
  clearAllExecTasks(...args: Parameters<ExecTaskActions['clearAllExecTasks']>) { return this.execTaskActions.clearAllExecTasks(...args); }

  // ============================================================================
  // Secret Actions (delegated)
  // ============================================================================

  setSecretsFromServer(...args: Parameters<SecretActions['setSecretsFromServer']>) { return this.secretActions.setSecretsFromServer(...args); }
  addSecretFromServer(...args: Parameters<SecretActions['addSecretFromServer']>) { return this.secretActions.addSecretFromServer(...args); }
  updateSecretFromServer(...args: Parameters<SecretActions['updateSecretFromServer']>) { return this.secretActions.updateSecretFromServer(...args); }
  removeSecretFromServer(...args: Parameters<SecretActions['removeSecretFromServer']>) { return this.secretActions.removeSecretFromServer(...args); }
  getSecret(...args: Parameters<SecretActions['getSecret']>) { return this.secretActions.getSecret(...args); }
  getSecretByKey(...args: Parameters<SecretActions['getSecretByKey']>) { return this.secretActions.getSecretByKey(...args); }
  getAllSecrets() { return this.secretActions.getAllSecrets(); }
  createSecret(...args: Parameters<SecretActions['createSecret']>) { return this.secretActions.createSecret(...args); }
  updateSecret(...args: Parameters<SecretActions['updateSecret']>) { return this.secretActions.updateSecret(...args); }
  deleteSecret(...args: Parameters<SecretActions['deleteSecret']>) { return this.secretActions.deleteSecret(...args); }

  // ============================================================================
  // Database Actions (delegated)
  // ============================================================================

  testDatabaseConnection(...args: Parameters<DatabaseActions['testDatabaseConnection']>) { return this.databaseActions.testDatabaseConnection(...args); }
  setConnectionStatus(...args: Parameters<DatabaseActions['setConnectionStatus']>) { return this.databaseActions.setConnectionStatus(...args); }
  listDatabases(...args: Parameters<DatabaseActions['listDatabases']>) { return this.databaseActions.listDatabases(...args); }
  setDatabases(...args: Parameters<DatabaseActions['setDatabases']>) { return this.databaseActions.setDatabases(...args); }
  listTables(...args: Parameters<DatabaseActions['listTables']>) { return this.databaseActions.listTables(...args); }
  setTables(...args: Parameters<DatabaseActions['setTables']>) { return this.databaseActions.setTables(...args); }
  getTableSchema(...args: Parameters<DatabaseActions['getTableSchema']>) { return this.databaseActions.getTableSchema(...args); }
  setTableSchema(...args: Parameters<DatabaseActions['setTableSchema']>) { return this.databaseActions.setTableSchema(...args); }
  executeQuery(...args: Parameters<DatabaseActions['executeQuery']>) { return this.databaseActions.executeQuery(...args); }
  setQueryResult(...args: Parameters<DatabaseActions['setQueryResult']>) { return this.databaseActions.setQueryResult(...args); }
  setExecutingQuery(...args: Parameters<DatabaseActions['setExecutingQuery']>) { return this.databaseActions.setExecutingQuery(...args); }
  requestQueryHistory(...args: Parameters<DatabaseActions['requestQueryHistory']>) { return this.databaseActions.requestQueryHistory(...args); }
  setQueryHistory(...args: Parameters<DatabaseActions['setQueryHistory']>) { return this.databaseActions.setQueryHistory(...args); }
  toggleQueryFavorite(...args: Parameters<DatabaseActions['toggleQueryFavorite']>) { return this.databaseActions.toggleQueryFavorite(...args); }
  deleteQueryFromHistory(...args: Parameters<DatabaseActions['deleteQueryFromHistory']>) { return this.databaseActions.deleteQueryFromHistory(...args); }
  clearQueryHistory(...args: Parameters<DatabaseActions['clearQueryHistory']>) { return this.databaseActions.clearQueryHistory(...args); }
  setActiveConnection(...args: Parameters<DatabaseActions['setActiveConnection']>) { return this.databaseActions.setActiveConnection(...args); }
  setActiveDatabase(...args: Parameters<DatabaseActions['setActiveDatabase']>) { return this.databaseActions.setActiveDatabase(...args); }
  getDatabaseState(...args: Parameters<DatabaseActions['getDatabaseState']>) { return this.databaseActions.getDatabaseState(...args); }
  clearDatabaseState(...args: Parameters<DatabaseActions['clearDatabaseState']>) { return this.databaseActions.clearDatabaseState(...args); }

  // ============================================================================
  // Snapshot Actions (delegated)
  // ============================================================================

  fetchSnapshots(...args: Parameters<SnapshotActions['fetchSnapshots']>) { return this.snapshotActions.fetchSnapshots(...args); }
  setSnapshots(...args: Parameters<SnapshotActions['setSnapshots']>) { return this.snapshotActions.setSnapshots(...args); }
  createSnapshot(...args: Parameters<SnapshotActions['createSnapshot']>) { return this.snapshotActions.createSnapshot(...args); }
  loadSnapshot(...args: Parameters<SnapshotActions['loadSnapshot']>) { return this.snapshotActions.loadSnapshot(...args); }
  setCurrentSnapshot(...args: Parameters<SnapshotActions['setCurrentSnapshot']>) { return this.snapshotActions.setCurrentSnapshot(...args); }
  deleteSnapshot(...args: Parameters<SnapshotActions['deleteSnapshot']>) { return this.snapshotActions.deleteSnapshot(...args); }
  restoreFiles(...args: Parameters<SnapshotActions['restoreFiles']>) { return this.snapshotActions.restoreFiles(...args); }
  setLoading(...args: Parameters<SnapshotActions['setLoading']>) { return this.snapshotActions.setLoading(...args); }
  setError(...args: Parameters<SnapshotActions['setError']>) { return this.snapshotActions.setError(...args); }
  clearError(...args: Parameters<SnapshotActions['clearError']>) { return this.snapshotActions.clearError(...args); }
  reset(...args: Parameters<SnapshotActions['reset']>) { return this.snapshotActions.reset(...args); }
}

// Extend Window interface for HMR persistence
declare global {
  interface Window {
    __tideStore?: Store;
    __tideStoreVersion?: number;
  }
}

// Increment this when Store class has breaking changes that require fresh instance
const STORE_VERSION = 1;

// Singleton store instance - persisted on window for HMR
function getOrCreateStore(): Store {
  if (typeof window !== 'undefined') {
    // Check if store exists and is the correct version
    if (window.__tideStore && window.__tideStoreVersion === STORE_VERSION) {
      return window.__tideStore;
    }
    // Create new store (first load or version mismatch)
    window.__tideStore = new Store();
    window.__tideStoreVersion = STORE_VERSION;
    return window.__tideStore;
  }
  return new Store();
}

export const store = getOrCreateStore();
