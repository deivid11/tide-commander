import type {
  Agent,
  AgentAnalysis,
  AgentClass,
  ClientMessage,
  DrawingArea,
  DrawingTool,
  ActivityNarrative,
  SupervisorReport,
  SupervisorConfig,
  AgentSupervisorHistory,
  AgentSupervisorHistoryEntry,
  Building,
  BuildingType,
  BuildingStatus,
  PermissionMode,
  PermissionRequest,
  DelegationDecision,
} from '../../shared/types';
import { ShortcutConfig, DEFAULT_SHORTCUTS } from './shortcuts';
import { perf } from '../utils/profiling';
export type { ShortcutConfig } from './shortcuts';
export { DEFAULT_SHORTCUTS, matchesShortcut, formatShortcut } from './shortcuts';

// Activity type
export interface Activity {
  agentId: string;
  agentName: string;
  message: string;
  timestamp: number;
}

// Claude output entry
export interface ClaudeOutput {
  text: string;
  isStreaming: boolean;
  timestamp: number;
  isUserPrompt?: boolean; // True if this is a user-sent command
}

// Tool execution entry
export interface ToolExecution {
  agentId: string;
  agentName: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  timestamp: number;
}

// File change entry
export interface FileChange {
  agentId: string;
  agentName: string;
  action: 'created' | 'modified' | 'deleted' | 'read';
  filePath: string;
  timestamp: number;
}

// Last prompt entry
export interface LastPrompt {
  text: string;
  timestamp: number;
}

// Settings
export interface Settings {
  historyLimit: number;
  hideCost: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  historyLimit: 500,
  hideCost: true,
};

// localStorage keys
const SHORTCUTS_STORAGE_KEY = 'tide-commander-shortcuts';

// Supervisor state
export interface SupervisorState {
  enabled: boolean;
  lastReport: SupervisorReport | null;
  narratives: Map<string, ActivityNarrative[]>;
  lastReportTime: number | null;
  nextReportTime: number | null;
  // History per agent - loaded on demand when agent is selected
  agentHistories: Map<string, AgentSupervisorHistoryEntry[]>;
  // Track which agent's history is currently being loaded
  loadingHistoryForAgent: string | null;
  // Track which agents have had their full history fetched from the server
  historyFetchedForAgents: Set<string>;
  // Track if a report is being generated
  generatingReport: boolean;
}

// Store state
export interface StoreState {
  agents: Map<string, Agent>;
  selectedAgentIds: Set<string>;
  activities: Activity[];
  isConnected: boolean;
  // Drawing areas
  areas: Map<string, DrawingArea>;
  activeTool: DrawingTool;
  selectedAreaId: string | null;
  // Buildings
  buildings: Map<string, Building>;
  selectedBuildingIds: Set<string>;
  buildingLogs: Map<string, string[]>; // Building ID -> logs
  // Claude outputs per agent
  agentOutputs: Map<string, ClaudeOutput[]>;
  // Last prompt per agent
  lastPrompts: Map<string, LastPrompt>;
  // Tool execution history
  toolExecutions: ToolExecution[];
  // File changes history
  fileChanges: FileChange[];
  // Terminal open state
  terminalOpen: boolean;
  // Settings
  settings: Settings;
  // Keyboard shortcuts
  shortcuts: ShortcutConfig[];
  // File viewer path (to open files from other components)
  fileViewerPath: string | null;
  // Supervisor state
  supervisor: SupervisorState;
  // Permission requests (interactive permission mode)
  permissionRequests: Map<string, PermissionRequest>;
  // Boss delegation history (per boss agent)
  delegationHistories: Map<string, DelegationDecision[]>;
  // Pending delegation (when boss is deciding)
  pendingDelegation: { bossId: string; command: string } | null;
  // Track last delegation received per subordinate agent (agentId -> delegation info)
  lastDelegationReceived: Map<string, { bossName: string; taskCommand: string; timestamp: number }>;
}

// Store actions
type Listener = () => void;

// localStorage keys
const SETTINGS_STORAGE_KEY = 'tide-commander-settings';

class Store {
  private state: StoreState = {
    agents: new Map(),
    selectedAgentIds: new Set(),
    activities: [],
    isConnected: false,
    // Drawing areas
    areas: new Map(),
    activeTool: null,
    selectedAreaId: null,
    // Buildings
    buildings: new Map(),
    selectedBuildingIds: new Set(),
    buildingLogs: new Map(),
    // Claude outputs
    agentOutputs: new Map(),
    // Last prompts
    lastPrompts: new Map(),
    // Tool and file histories
    toolExecutions: [],
    fileChanges: [],
    // Terminal state
    terminalOpen: false,
    // Settings - load from localStorage or use defaults
    settings: (() => {
      try {
        const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (stored) {
          return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
        }
      } catch (e) {
        console.error('Failed to load settings:', e);
      }
      return { ...DEFAULT_SETTINGS };
    })(),
    // Keyboard shortcuts - load from localStorage or use defaults
    shortcuts: (() => {
      try {
        const stored = localStorage.getItem(SHORTCUTS_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as ShortcutConfig[];
          // Merge with defaults to handle new shortcuts added in updates
          const mergedShortcuts = DEFAULT_SHORTCUTS.map(defaultShortcut => {
            const saved = parsed.find(s => s.id === defaultShortcut.id);
            return saved ? { ...defaultShortcut, ...saved } : defaultShortcut;
          });
          return mergedShortcuts;
        }
      } catch (e) {
        console.error('Failed to load shortcuts:', e);
      }
      return [...DEFAULT_SHORTCUTS];
    })(),
    // File viewer path
    fileViewerPath: null,
    // Supervisor state
    supervisor: {
      enabled: true,
      lastReport: null,
      narratives: new Map(),
      lastReportTime: null,
      nextReportTime: null,
      agentHistories: new Map(),
      loadingHistoryForAgent: null,
      historyFetchedForAgents: new Set(),
      generatingReport: false,
    },
    // Permission requests
    permissionRequests: new Map(),
    // Boss delegation
    delegationHistories: new Map(),
    pendingDelegation: null,
    lastDelegationReceived: new Map(),
  };

  private listeners = new Set<Listener>();
  private sendMessage: ((msg: ClientMessage) => void) | null = null;

  // Subscribe to state changes
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Notify all listeners
  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  // Get current state
  getState(): StoreState {
    return this.state;
  }

  // Set WebSocket send function
  setSendMessage(fn: (msg: ClientMessage) => void): void {
    this.sendMessage = fn;
  }

  // Connection state
  setConnected(isConnected: boolean): void {
    this.state.isConnected = isConnected;
    this.notify();
  }

  // Agent management
  setAgents(agentList: Agent[]): void {
    perf.start('store:setAgents');
    // Create a new Map to ensure React detects the change
    const newAgents = new Map<string, Agent>();
    for (const agent of agentList) {
      newAgents.set(agent.id, agent);
    }
    this.state.agents = newAgents;
    this.notify();
    perf.end('store:setAgents');
  }

  addAgent(agent: Agent): void {
    // Create a new Map to ensure React detects the change
    const newAgents = new Map(this.state.agents);
    newAgents.set(agent.id, agent);
    this.state.agents = newAgents;
    this.notify();
  }

  updateAgent(agent: Agent): void {
    // Create a new Map to ensure React detects the change
    const newAgents = new Map(this.state.agents);
    newAgents.set(agent.id, agent);
    this.state.agents = newAgents;
    this.notify();
  }

  removeAgent(agentId: string): void {
    // Create a new Map to ensure React detects the change
    const newAgents = new Map(this.state.agents);
    newAgents.delete(agentId);
    this.state.agents = newAgents;
    this.state.selectedAgentIds.delete(agentId);
    this.notify();
  }

  // Selection management
  selectAgent(agentId: string | null): void {
    this.state.selectedAgentIds.clear();
    if (agentId) {
      this.state.selectedAgentIds.add(agentId);
    }
    this.notify();
  }

  addToSelection(agentId: string): void {
    if (this.state.selectedAgentIds.has(agentId)) {
      this.state.selectedAgentIds.delete(agentId);
    } else {
      this.state.selectedAgentIds.add(agentId);
    }
    this.notify();
  }

  selectMultiple(agentIds: string[]): void {
    this.state.selectedAgentIds.clear();
    for (const id of agentIds) {
      this.state.selectedAgentIds.add(id);
    }
    this.notify();
  }

  deselectAll(): void {
    this.state.selectedAgentIds.clear();
    this.notify();
  }

  // Terminal state
  toggleTerminal(agentId?: string): void {
    // If an agentId is provided, make sure it's selected first
    if (agentId && !this.state.selectedAgentIds.has(agentId)) {
      this.state.selectedAgentIds.clear();
      this.state.selectedAgentIds.add(agentId);
    }
    this.state.terminalOpen = !this.state.terminalOpen;
    this.notify();
  }

  setTerminalOpen(open: boolean): void {
    this.state.terminalOpen = open;
    this.notify();
  }

  // File viewer
  setFileViewerPath(path: string | null): void {
    this.state.fileViewerPath = path;
    this.notify();
  }

  clearFileViewerPath(): void {
    this.state.fileViewerPath = null;
    this.notify();
  }

  // ===== Supervisor =====

  setSupervisorReport(report: SupervisorReport): void {
    this.state.supervisor.lastReport = report;
    this.state.supervisor.lastReportTime = report.timestamp;

    // Also update agent histories with the new report data
    const newHistories = new Map(this.state.supervisor.agentHistories);
    for (const analysis of report.agentSummaries) {
      const agentHistory = newHistories.get(analysis.agentId) || [];
      // Create a new history entry from the report
      const newEntry: AgentSupervisorHistoryEntry = {
        id: `${report.id}-${analysis.agentId}`,
        timestamp: report.timestamp,
        reportId: report.id,
        analysis,
      };
      // Add to beginning (most recent first), avoid duplicates
      if (!agentHistory.some(e => e.reportId === report.id)) {
        const updatedHistory = [newEntry, ...agentHistory];
        // Keep max 50 entries
        if (updatedHistory.length > 50) {
          updatedHistory.pop();
        }
        newHistories.set(analysis.agentId, updatedHistory);
      }
    }
    this.state.supervisor.agentHistories = newHistories;
    this.state.supervisor.generatingReport = false;

    this.notify();
  }

  addNarrative(agentId: string, narrative: ActivityNarrative): void {
    const agentNarratives = this.state.supervisor.narratives.get(agentId) || [];
    agentNarratives.unshift(narrative);
    if (agentNarratives.length > 50) {
      agentNarratives.pop();
    }
    // Create new Map to trigger React updates
    const newNarratives = new Map(this.state.supervisor.narratives);
    newNarratives.set(agentId, agentNarratives);
    this.state.supervisor.narratives = newNarratives;
    this.notify();
  }

  getNarratives(agentId: string): ActivityNarrative[] {
    return this.state.supervisor.narratives.get(agentId) || [];
  }

  setSupervisorStatus(status: {
    enabled: boolean;
    lastReportTime: number | null;
    nextReportTime: number | null;
  }): void {
    this.state.supervisor.enabled = status.enabled;
    this.state.supervisor.lastReportTime = status.lastReportTime;
    this.state.supervisor.nextReportTime = status.nextReportTime;
    this.notify();
  }

  setSupervisorConfig(config: Partial<SupervisorConfig>): void {
    this.sendMessage?.({
      type: 'set_supervisor_config',
      payload: config,
    });
  }

  requestSupervisorReport(): void {
    this.state.supervisor.generatingReport = true;
    this.notify();
    this.sendMessage?.({
      type: 'request_supervisor_report',
      payload: {},
    });
  }

  // Request supervisor history for a specific agent
  requestAgentSupervisorHistory(agentId: string): void {
    this.state.supervisor.loadingHistoryForAgent = agentId;
    this.notify();
    this.sendMessage?.({
      type: 'request_agent_supervisor_history',
      payload: { agentId },
    });
  }

  // Set supervisor history for an agent (called when receiving from server)
  setAgentSupervisorHistory(history: AgentSupervisorHistory): void {
    const newHistories = new Map(this.state.supervisor.agentHistories);
    newHistories.set(history.agentId, history.entries);
    this.state.supervisor.agentHistories = newHistories;
    // Mark this agent's history as fully fetched
    this.state.supervisor.historyFetchedForAgents.add(history.agentId);
    if (this.state.supervisor.loadingHistoryForAgent === history.agentId) {
      this.state.supervisor.loadingHistoryForAgent = null;
    }
    this.notify();
  }

  // Get supervisor history for an agent (from local cache)
  getAgentSupervisorHistory(agentId: string): AgentSupervisorHistoryEntry[] {
    return this.state.supervisor.agentHistories.get(agentId) || [];
  }

  // Add a single agent analysis to history (from real-time event)
  addAgentAnalysis(agentId: string, analysis: AgentAnalysis): void {
    const newHistories = new Map(this.state.supervisor.agentHistories);
    const agentHistory = newHistories.get(agentId) || [];

    // Create a new history entry from the analysis
    const newEntry: AgentSupervisorHistoryEntry = {
      id: `single-${Date.now()}-${agentId}`,
      timestamp: Date.now(),
      reportId: `single-${Date.now()}`,
      analysis,
    };

    // Add to beginning (most recent first), avoid duplicates within 5 seconds
    const recentDuplicate = agentHistory.some(
      e => Math.abs(e.timestamp - newEntry.timestamp) < 5000 &&
           e.analysis.statusDescription === analysis.statusDescription
    );

    if (!recentDuplicate) {
      const updatedHistory = [newEntry, ...agentHistory];
      // Keep max 50 entries
      if (updatedHistory.length > 50) {
        updatedHistory.pop();
      }
      newHistories.set(agentId, updatedHistory);
      this.state.supervisor.agentHistories = newHistories;
      this.notify();
    }
  }

  // Check if history is being loaded for an agent
  isLoadingHistoryForAgent(agentId: string): boolean {
    return this.state.supervisor.loadingHistoryForAgent === agentId;
  }

  // Check if full history has been fetched for an agent
  hasHistoryBeenFetched(agentId: string): boolean {
    return this.state.supervisor.historyFetchedForAgents.has(agentId);
  }

  // Settings
  updateSettings(updates: Partial<Settings>): void {
    this.state.settings = { ...this.state.settings, ...updates };
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.state.settings));
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
    this.notify();
  }

  getSettings(): Settings {
    return this.state.settings;
  }

  // ===== Keyboard Shortcuts =====

  getShortcuts(): ShortcutConfig[] {
    return this.state.shortcuts;
  }

  getShortcut(id: string): ShortcutConfig | undefined {
    return this.state.shortcuts.find(s => s.id === id);
  }

  updateShortcut(id: string, updates: Partial<ShortcutConfig>): void {
    const index = this.state.shortcuts.findIndex(s => s.id === id);
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
    try {
      localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(this.state.shortcuts));
    } catch (e) {
      console.error('Failed to save shortcuts:', e);
    }
  }

  // Activity feed
  addActivity(activity: Activity): void {
    this.state.activities.unshift(activity);
    if (this.state.activities.length > 100) {
      this.state.activities.pop();
    }
    this.notify();
  }

  // Tool execution tracking
  addToolExecution(agentId: string, toolName: string, toolInput?: Record<string, unknown>): void {
    const agent = this.state.agents.get(agentId);
    this.state.toolExecutions.unshift({
      agentId,
      agentName: agent?.name || 'Unknown',
      toolName,
      toolInput,
      timestamp: Date.now(),
    });
    // Keep last 200 tool executions
    if (this.state.toolExecutions.length > 200) {
      this.state.toolExecutions.pop();
    }
    this.notify();
  }

  // File change tracking
  addFileChange(agentId: string, action: 'created' | 'modified' | 'deleted' | 'read', filePath: string): void {
    const agent = this.state.agents.get(agentId);
    this.state.fileChanges.unshift({
      agentId,
      agentName: agent?.name || 'Unknown',
      action,
      filePath,
      timestamp: Date.now(),
    });
    // Keep last 200 file changes
    if (this.state.fileChanges.length > 200) {
      this.state.fileChanges.pop();
    }
    this.notify();
  }

  // Load tool history from server (for page refresh)
  async loadToolHistory(): Promise<void> {
    try {
      const res = await fetch('/api/agents/tool-history?limit=100');
      const data = await res.json();

      if (data.toolExecutions) {
        this.state.toolExecutions = data.toolExecutions;
      }
      if (data.fileChanges) {
        this.state.fileChanges = data.fileChanges;
      }
      this.notify();
    } catch (err) {
      console.error('[Store] Failed to load tool history:', err);
    }
  }

  // Claude output management
  addOutput(agentId: string, output: ClaudeOutput): void {
    perf.start('store:addOutput');
    let outputs = this.state.agentOutputs.get(agentId);
    if (!outputs) {
      outputs = [];
      this.state.agentOutputs.set(agentId, outputs);
    }
    outputs.push(output);
    // Keep last 200 outputs per agent
    if (outputs.length > 200) {
      outputs.shift();
    }
    this.notify();
    perf.end('store:addOutput');
  }

  clearOutputs(agentId: string): void {
    this.state.agentOutputs.delete(agentId);
    this.notify();
  }

  getOutputs(agentId: string): ClaudeOutput[] {
    return this.state.agentOutputs.get(agentId) || [];
  }

  // Actions that send to server
  spawnAgent(
    name: string,
    agentClass: AgentClass,
    cwd: string,
    position?: { x: number; z: number },
    sessionId?: string,
    useChrome?: boolean,
    permissionMode?: PermissionMode
  ): void {
    console.log('[Store] spawnAgent called with:', {
      name,
      agentClass,
      cwd,
      position,
      sessionId,
      useChrome,
      permissionMode
    });

    const pos3d = position ? { x: position.x, y: 0, z: position.z } : undefined;
    const message = {
      type: 'spawn_agent' as const,
      payload: { name, class: agentClass, cwd, position: pos3d, sessionId, useChrome, permissionMode },
    };

    console.log('[Store] Sending WebSocket message:', message);

    if (!this.sendMessage) {
      console.error('[Store] sendMessage is not defined! WebSocket may not be connected');
      return;
    }

    this.sendMessage(message);
    console.log('[Store] Message sent to WebSocket');
  }

  createDirectoryAndSpawn(path: string, name: string, agentClass: AgentClass): void {
    this.sendMessage?.({
      type: 'create_directory',
      payload: { path, name, class: agentClass },
    });
  }

  sendCommand(agentId: string, command: string): void {
    // Track last prompt
    this.state.lastPrompts.set(agentId, {
      text: command,
      timestamp: Date.now(),
    });
    this.notify();

    // Note: User prompt is added to output when the server confirms execution starts
    // This way queued commands only appear when they're actually consumed

    this.sendMessage?.({
      type: 'send_command',
      payload: { agentId, command },
    });
  }

  // Called when server confirms a command started executing
  addUserPromptToOutput(agentId: string, command: string): void {
    this.addOutput(agentId, {
      text: command,
      isStreaming: false,
      timestamp: Date.now(),
      isUserPrompt: true,
    });
  }

  getLastPrompt(agentId: string): LastPrompt | undefined {
    return this.state.lastPrompts.get(agentId);
  }

  setLastPrompt(agentId: string, text: string): void {
    this.state.lastPrompts.set(agentId, {
      text,
      timestamp: Date.now(),
    });
    this.notify();
  }

  moveAgent(agentId: string, position: { x: number; y: number; z: number }): void {
    // Update local state with new Map to trigger React updates
    const agent = this.state.agents.get(agentId);
    if (agent) {
      const updatedAgent = { ...agent, position };
      const newAgents = new Map(this.state.agents);
      newAgents.set(agentId, updatedAgent);
      this.state.agents = newAgents;
      this.notify();
    }

    // Send to server
    this.sendMessage?.({
      type: 'move_agent',
      payload: { agentId, position },
    });
  }

  killAgent(agentId: string): void {
    this.sendMessage?.({
      type: 'kill_agent',
      payload: { agentId },
    });
  }

  // Stop current operation (but keep agent alive)
  stopAgent(agentId: string): void {
    this.sendMessage?.({
      type: 'stop_agent',
      payload: { agentId },
    });
  }

  // Clear agent context (force new session on next command)
  clearContext(agentId: string): void {
    this.sendMessage?.({
      type: 'clear_context',
      payload: { agentId },
    });
    // Also clear local outputs
    this.clearOutputs(agentId);
  }

  // Collapse context (compact the session to save tokens)
  collapseContext(agentId: string): void {
    this.sendMessage?.({
      type: 'collapse_context',
      payload: { agentId },
    });
  }

  // Remove agent from UI and persistence (keeps Claude session running)
  removeAgentFromServer(agentId: string): void {
    this.sendMessage?.({
      type: 'remove_agent',
      payload: { agentId },
    });
  }

  // Rename agent
  renameAgent(agentId: string, name: string): void {
    // Update local state immediately for responsive UI
    const agent = this.state.agents.get(agentId);
    if (agent) {
      const updatedAgent = { ...agent, name };
      const newAgents = new Map(this.state.agents);
      newAgents.set(agentId, updatedAgent);
      this.state.agents = newAgents;
      this.notify();
    }

    // Send to server
    this.sendMessage?.({
      type: 'rename_agent',
      payload: { agentId, name },
    });
  }

  // Computed values
  getTotalTokens(): number {
    let total = 0;
    for (const agent of this.state.agents.values()) {
      total += agent.tokensUsed;
    }
    return total;
  }

  getSelectedAgents(): Agent[] {
    const agents: Agent[] = [];
    for (const id of this.state.selectedAgentIds) {
      const agent = this.state.agents.get(id);
      if (agent) agents.push(agent);
    }
    return agents;
  }

  // ===== Drawing Areas =====

  // Set active drawing tool
  setActiveTool(tool: DrawingTool): void {
    this.state.activeTool = tool;
    if (tool !== 'select') {
      this.state.selectedAreaId = null;
    }
    this.notify();
  }

  // Select area for editing
  selectArea(areaId: string | null): void {
    this.state.selectedAreaId = areaId;
    this.notify();
  }

  // Add new area
  addArea(area: DrawingArea): void {
    this.state.areas.set(area.id, area);
    this.syncAreasToServer();
    this.notify();
  }

  // Update existing area
  updateArea(areaId: string, updates: Partial<DrawingArea>): void {
    const area = this.state.areas.get(areaId);
    if (area) {
      Object.assign(area, updates);
      this.syncAreasToServer();
      this.notify();
    }
  }

  // Delete area
  deleteArea(areaId: string): void {
    this.state.areas.delete(areaId);
    if (this.state.selectedAreaId === areaId) {
      this.state.selectedAreaId = null;
    }
    this.syncAreasToServer();
    this.notify();
  }

  // Assign agent to area
  assignAgentToArea(agentId: string, areaId: string): void {
    const area = this.state.areas.get(areaId);
    if (area && !area.assignedAgentIds.includes(agentId)) {
      // Remove from any other area first
      for (const otherArea of this.state.areas.values()) {
        const idx = otherArea.assignedAgentIds.indexOf(agentId);
        if (idx !== -1) {
          otherArea.assignedAgentIds.splice(idx, 1);
        }
      }
      area.assignedAgentIds.push(agentId);
      this.syncAreasToServer();
      this.notify();
    }
  }

  // Unassign agent from area
  unassignAgentFromArea(agentId: string, areaId: string): void {
    const area = this.state.areas.get(areaId);
    if (area) {
      const idx = area.assignedAgentIds.indexOf(agentId);
      if (idx !== -1) {
        area.assignedAgentIds.splice(idx, 1);
        this.syncAreasToServer();
        this.notify();
      }
    }
  }

  // Add directory to area
  addDirectoryToArea(areaId: string, directoryPath: string): void {
    const area = this.state.areas.get(areaId);
    if (area && !area.directories.includes(directoryPath)) {
      area.directories.push(directoryPath);
      this.syncAreasToServer();
      this.notify();
    }
  }

  // Remove directory from area
  removeDirectoryFromArea(areaId: string, directoryPath: string): void {
    const area = this.state.areas.get(areaId);
    if (area) {
      const idx = area.directories.indexOf(directoryPath);
      if (idx !== -1) {
        area.directories.splice(idx, 1);
        this.syncAreasToServer();
        this.notify();
      }
    }
  }

  // Get all directories for an area
  getAreaDirectories(areaId: string): string[] {
    const area = this.state.areas.get(areaId);
    return area?.directories || [];
  }

  // Check if a position is inside an area
  isPositionInArea(pos: { x: number; z: number }, area: DrawingArea): boolean {
    if (area.type === 'rectangle' && area.width && area.height) {
      const halfW = area.width / 2;
      const halfH = area.height / 2;
      return (
        pos.x >= area.center.x - halfW &&
        pos.x <= area.center.x + halfW &&
        pos.z >= area.center.z - halfH &&
        pos.z <= area.center.z + halfH
      );
    } else if (area.type === 'circle' && area.radius) {
      const dx = pos.x - area.center.x;
      const dz = pos.z - area.center.z;
      return dx * dx + dz * dz <= area.radius * area.radius;
    }
    return false;
  }

  // Get area for an agent (checks actual position, not just assignment)
  getAreaForAgent(agentId: string): DrawingArea | null {
    const agent = this.state.agents.get(agentId);
    if (!agent) return null;

    // Check each area to see if agent is inside its bounds
    for (const area of this.state.areas.values()) {
      if (this.isPositionInArea({ x: agent.position.x, z: agent.position.z }, area)) {
        return area;
      }
    }
    return null;
  }

  // Sync areas to server via WebSocket
  private syncAreasToServer(): void {
    const areasArray = Array.from(this.state.areas.values());
    this.sendMessage?.({
      type: 'sync_areas',
      payload: areasArray,
    });
  }

  // Set areas from server (called when receiving areas_update message)
  setAreasFromServer(areasArray: DrawingArea[]): void {
    // Create new Map to ensure React detects the change
    const newAreas = new Map<string, DrawingArea>();
    for (const area of areasArray) {
      // Migration: ensure directories array exists for old areas
      if (!area.directories) {
        area.directories = [];
      }
      newAreas.set(area.id, area);
    }
    this.state.areas = newAreas;
    this.notify();
  }

  // ===== Buildings =====

  // Select building (single selection, clears previous)
  selectBuilding(buildingId: string | null): void {
    this.state.selectedBuildingIds.clear();
    if (buildingId) {
      this.state.selectedBuildingIds.add(buildingId);
    }
    this.notify();
  }

  // Select multiple buildings (for drag selection)
  selectMultipleBuildings(buildingIds: string[]): void {
    this.state.selectedBuildingIds.clear();
    for (const id of buildingIds) {
      this.state.selectedBuildingIds.add(id);
    }
    this.notify();
  }

  // Toggle building selection (with shift key)
  toggleBuildingSelection(buildingId: string): void {
    if (this.state.selectedBuildingIds.has(buildingId)) {
      this.state.selectedBuildingIds.delete(buildingId);
    } else {
      this.state.selectedBuildingIds.add(buildingId);
    }
    this.notify();
  }

  // Check if building is selected
  isBuildingSelected(buildingId: string): boolean {
    return this.state.selectedBuildingIds.has(buildingId);
  }

  // Get all selected building IDs
  getSelectedBuildingIds(): string[] {
    return Array.from(this.state.selectedBuildingIds);
  }

  // Delete selected buildings
  deleteSelectedBuildings(): void {
    for (const buildingId of this.state.selectedBuildingIds) {
      this.state.buildings.delete(buildingId);
    }
    this.state.selectedBuildingIds.clear();
    this.syncBuildingsToServer();
    this.notify();
  }

  // Add new building
  addBuilding(building: Building): void {
    const newBuildings = new Map(this.state.buildings);
    newBuildings.set(building.id, building);
    this.state.buildings = newBuildings;
    this.syncBuildingsToServer();
    this.notify();
  }

  // Update existing building
  updateBuilding(buildingId: string, updates: Partial<Building>): void {
    const building = this.state.buildings.get(buildingId);
    if (building) {
      const newBuildings = new Map(this.state.buildings);
      newBuildings.set(buildingId, { ...building, ...updates });
      this.state.buildings = newBuildings;
      this.syncBuildingsToServer();
      this.notify();
    }
  }

  // Delete building
  deleteBuilding(buildingId: string): void {
    const newBuildings = new Map(this.state.buildings);
    newBuildings.delete(buildingId);
    this.state.buildings = newBuildings;
    this.state.selectedBuildingIds.delete(buildingId);
    this.syncBuildingsToServer();
    this.notify();
  }

  // Move building
  moveBuilding(buildingId: string, position: { x: number; z: number }): void {
    const building = this.state.buildings.get(buildingId);
    if (building) {
      const newBuildings = new Map(this.state.buildings);
      newBuildings.set(buildingId, { ...building, position });
      this.state.buildings = newBuildings;
      this.syncBuildingsToServer();
      this.notify();
    }
  }

  // Alias for moveBuilding (used by drag handlers)
  updateBuildingPosition(buildingId: string, position: { x: number; z: number }): void {
    this.moveBuilding(buildingId, position);
  }

  // Create a new building (generates ID and timestamps)
  createBuilding(data: Omit<Building, 'id' | 'createdAt' | 'status'>): void {
    const building: Building = {
      ...data,
      id: `building_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      status: 'stopped',
      createdAt: Date.now(),
    };
    this.addBuilding(building);
  }

  // Send building command (start/stop/restart/logs)
  sendBuildingCommand(buildingId: string, command: 'start' | 'stop' | 'restart' | 'healthCheck' | 'logs'): void {
    this.sendMessage?.({
      type: 'building_command',
      payload: { buildingId, command },
    });
  }

  // Add logs for a building
  addBuildingLogs(buildingId: string, logs: string): void {
    const existingLogs = this.state.buildingLogs.get(buildingId) || [];
    const newLogs = [...existingLogs, logs];
    // Keep last 500 log entries
    if (newLogs.length > 500) {
      newLogs.splice(0, newLogs.length - 500);
    }
    const newBuildingLogs = new Map(this.state.buildingLogs);
    newBuildingLogs.set(buildingId, newLogs);
    this.state.buildingLogs = newBuildingLogs;
    this.notify();
  }

  // Get logs for a building
  getBuildingLogs(buildingId: string): string[] {
    return this.state.buildingLogs.get(buildingId) || [];
  }

  // Clear logs for a building
  clearBuildingLogs(buildingId: string): void {
    const newBuildingLogs = new Map(this.state.buildingLogs);
    newBuildingLogs.delete(buildingId);
    this.state.buildingLogs = newBuildingLogs;
    this.notify();
  }

  // Sync buildings to server via WebSocket
  private syncBuildingsToServer(): void {
    const buildingsArray = Array.from(this.state.buildings.values());
    this.sendMessage?.({
      type: 'sync_buildings',
      payload: buildingsArray,
    });
  }

  // Set buildings from server (called when receiving buildings_update message)
  setBuildingsFromServer(buildingsArray: Building[]): void {
    const newBuildings = new Map<string, Building>();
    for (const building of buildingsArray) {
      newBuildings.set(building.id, building);
    }
    this.state.buildings = newBuildings;
    this.notify();
  }

  // Update a single building from server
  updateBuildingFromServer(building: Building): void {
    const newBuildings = new Map(this.state.buildings);
    newBuildings.set(building.id, building);
    this.state.buildings = newBuildings;
    this.notify();
  }

  // Remove building from server update
  removeBuildingFromServer(buildingId: string): void {
    const newBuildings = new Map(this.state.buildings);
    newBuildings.delete(buildingId);
    this.state.buildings = newBuildings;
    this.state.selectedBuildingIds.delete(buildingId);
    this.notify();
  }

  // ===== Status Polling =====
  // NOTE: HTTP polling is disabled - WebSocket handles all status updates now
  // The sync happens on WebSocket connect (server-side) and on agent events
  private statusPollInterval: number | null = null;

  // Start polling agent status (disabled - WebSocket handles this)
  startStatusPolling(): void {
    // Disabled: WebSocket already syncs status on connect and broadcasts updates
    // Keeping method for potential manual refresh needs
  }

  stopStatusPolling(): void {
    if (this.statusPollInterval) {
      clearInterval(this.statusPollInterval);
      this.statusPollInterval = null;
    }
  }

  private async pollAgentStatus(): Promise<void> {
    try {
      const res = await fetch('/api/agents/status');
      if (!res.ok) return;

      const statuses = await res.json() as Array<{
        id: string;
        status: Agent['status'];
        currentTask?: string;
        currentTool?: string;
        isProcessRunning: boolean;
        sessionActivity?: {
          isActive: boolean;
          lastMessageType: string | null;
          secondsSinceLastActivity: number;
        } | null;
      }>;

      let changed = false;
      const newAgents = new Map(this.state.agents);

      for (const statusInfo of statuses) {
        const agent = newAgents.get(statusInfo.id);
        if (!agent) continue;

        // Check if status is out of sync
        if (agent.status !== statusInfo.status) {
          const activityInfo = statusInfo.sessionActivity
            ? `session: ${statusInfo.sessionActivity.lastMessageType}, ${statusInfo.sessionActivity.secondsSinceLastActivity}s ago`
            : 'no session';
          console.log(`[Store] Status poll correction: ${agent.name} was '${agent.status}', now '${statusInfo.status}' (process: ${statusInfo.isProcessRunning}, ${activityInfo})`);
          newAgents.set(statusInfo.id, {
            ...agent,
            status: statusInfo.status,
            currentTask: statusInfo.currentTask,
            currentTool: statusInfo.currentTool,
          });
          changed = true;
        }
      }

      if (changed) {
        this.state.agents = newAgents;
        this.notify();
      }
    } catch (err) {
      // Silently fail - this is just a fallback
    }
  }

  // ============================================================================
  // Permission Requests
  // ============================================================================

  addPermissionRequest(request: PermissionRequest): void {
    const newRequests = new Map(this.state.permissionRequests);
    newRequests.set(request.id, request);
    this.state.permissionRequests = newRequests;
    this.notify();
  }

  resolvePermissionRequest(requestId: string, approved: boolean): void {
    const newRequests = new Map(this.state.permissionRequests);
    const request = newRequests.get(requestId);
    if (request) {
      newRequests.set(requestId, {
        ...request,
        status: approved ? 'approved' : 'denied',
      });
      // Remove after a short delay to show the result
      setTimeout(() => {
        const currentRequests = new Map(this.state.permissionRequests);
        currentRequests.delete(requestId);
        this.state.permissionRequests = currentRequests;
        this.notify();
      }, 2000);
    }
    this.state.permissionRequests = newRequests;
    this.notify();
  }

  respondToPermissionRequest(requestId: string, approved: boolean, reason?: string, remember?: boolean): void {
    this.sendMessage?.({
      type: 'permission_response',
      payload: { requestId, approved, reason, remember },
    });
  }

  getPendingPermissionsForAgent(agentId: string): PermissionRequest[] {
    return Array.from(this.state.permissionRequests.values())
      .filter((r) => r.agentId === agentId && r.status === 'pending');
  }

  // ============================================================================
  // Boss Agent Methods
  // ============================================================================

  /**
   * Spawn a boss agent
   */
  spawnBossAgent(
    name: string,
    cwd: string,
    position?: { x: number; z: number },
    subordinateIds?: string[],
    useChrome?: boolean,
    permissionMode?: PermissionMode
  ): void {
    const pos3d = position ? { x: position.x, y: 0, z: position.z } : undefined;
    this.sendMessage?.({
      type: 'spawn_boss_agent',
      payload: { name, cwd, position: pos3d, subordinateIds, useChrome, permissionMode },
    });
  }

  /**
   * Assign subordinates to a boss
   */
  assignSubordinates(bossId: string, subordinateIds: string[]): void {
    this.sendMessage?.({
      type: 'assign_subordinates',
      payload: { bossId, subordinateIds },
    });
  }

  /**
   * Remove a subordinate from a boss
   */
  removeSubordinate(bossId: string, subordinateId: string): void {
    this.sendMessage?.({
      type: 'remove_subordinate',
      payload: { bossId, subordinateId },
    });
  }

  /**
   * Send command to boss for delegation
   */
  sendBossCommand(bossId: string, command: string): void {
    this.state.pendingDelegation = { bossId, command };
    this.notify();

    this.sendMessage?.({
      type: 'send_boss_command',
      payload: { bossId, command },
    });
  }

  /**
   * Request delegation history for a boss
   */
  requestDelegationHistory(bossId: string): void {
    this.sendMessage?.({
      type: 'request_delegation_history',
      payload: { bossId },
    });
  }

  /**
   * Handle delegation decision from server
   */
  handleDelegationDecision(decision: DelegationDecision): void {
    // Add to history
    const newHistories = new Map(this.state.delegationHistories);
    const bossHistory = newHistories.get(decision.bossId) || [];

    // Update or add decision
    const existingIdx = bossHistory.findIndex(d => d.id === decision.id);
    if (existingIdx !== -1) {
      bossHistory[existingIdx] = decision;
    } else {
      bossHistory.unshift(decision);
      // Keep last 100 decisions
      if (bossHistory.length > 100) {
        bossHistory.pop();
      }
    }
    newHistories.set(decision.bossId, bossHistory);
    this.state.delegationHistories = newHistories;

    // Track that the subordinate received a delegated task
    if (decision.status === 'sent' && decision.selectedAgentId) {
      const boss = this.state.agents.get(decision.bossId);
      const newReceived = new Map(this.state.lastDelegationReceived);
      newReceived.set(decision.selectedAgentId, {
        bossName: boss?.name || 'Boss',
        taskCommand: decision.userCommand,
        timestamp: Date.now(),
      });
      this.state.lastDelegationReceived = newReceived;
    }

    // Clear pending if this is the result
    if (
      this.state.pendingDelegation?.bossId === decision.bossId &&
      decision.status !== 'pending'
    ) {
      this.state.pendingDelegation = null;
    }

    this.notify();
  }

  /**
   * Set full delegation history from server
   */
  setDelegationHistory(bossId: string, decisions: DelegationDecision[]): void {
    const newHistories = new Map(this.state.delegationHistories);
    newHistories.set(bossId, decisions);
    this.state.delegationHistories = newHistories;
    this.notify();
  }

  /**
   * Get delegation history for a boss
   */
  getDelegationHistory(bossId: string): DelegationDecision[] {
    return this.state.delegationHistories.get(bossId) || [];
  }

  /**
   * Get last delegation received by an agent (if any)
   */
  getLastDelegationReceived(agentId: string): { bossName: string; taskCommand: string; timestamp: number } | null {
    return this.state.lastDelegationReceived.get(agentId) || null;
  }

  /**
   * Clear last delegation for an agent (call when agent completes the task)
   */
  clearLastDelegationReceived(agentId: string): void {
    if (this.state.lastDelegationReceived.has(agentId)) {
      const newReceived = new Map(this.state.lastDelegationReceived);
      newReceived.delete(agentId);
      this.state.lastDelegationReceived = newReceived;
      this.notify();
    }
  }

  /**
   * Update boss subordinates from server event
   */
  updateBossSubordinates(bossId: string, subordinateIds: string[]): void {
    const boss = this.state.agents.get(bossId);
    if (boss) {
      const updatedBoss = { ...boss, subordinateIds };
      const newAgents = new Map(this.state.agents);
      newAgents.set(bossId, updatedBoss);
      this.state.agents = newAgents;
      this.notify();
    }
  }

  /**
   * Get subordinates for a boss agent
   */
  getSubordinates(bossId: string): Agent[] {
    const boss = this.state.agents.get(bossId);
    if (!boss || boss.class !== 'boss' || !boss.subordinateIds) return [];

    return boss.subordinateIds
      .map(id => this.state.agents.get(id))
      .filter((agent): agent is Agent => agent !== undefined);
  }

  /**
   * Check if an agent is a boss
   */
  isBossAgent(agentId: string): boolean {
    const agent = this.state.agents.get(agentId);
    return agent?.class === 'boss';
  }

  /**
   * Get the boss for an agent (if any)
   */
  getBossForAgent(agentId: string): Agent | null {
    const agent = this.state.agents.get(agentId);
    if (!agent?.bossId) return null;
    return this.state.agents.get(agent.bossId) || null;
  }

  /**
   * Get all non-boss agents (potential subordinates)
   */
  getAvailableSubordinates(): Agent[] {
    return Array.from(this.state.agents.values())
      .filter(agent => agent.class !== 'boss');
  }
}

// Singleton store instance
export const store = new Store();

// Import React for the hooks
import React, { useState, useEffect, useRef, useCallback } from 'react';

// ============================================================================
// LEGACY HOOK - Use granular selectors below instead for better performance
// ============================================================================

/**
 * @deprecated Use granular selectors (useAgents, useSelectedAgentIds, etc.) instead.
 * This hook causes re-renders on ANY store change.
 */
export function useStore(): StoreState {
  const [, forceUpdate] = useState({});

  useEffect(() => {
    return store.subscribe(() => forceUpdate({}));
  }, []);

  return store.getState();
}

// ============================================================================
// GRANULAR SELECTORS - Use these for optimized re-renders
// ============================================================================

/**
 * Shallow comparison for arrays - returns true if arrays have same elements
 */
function shallowArrayEqual<T>(a: T[], b: T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Shallow comparison for Maps - returns true if maps have same keys and values
 */
function shallowMapEqual<K, V>(a: Map<K, V>, b: Map<K, V>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
}

/**
 * Shallow comparison for Sets
 */
function shallowSetEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

/**
 * Generic selector hook with shallow comparison
 */
function useSelector<T>(
  selector: (state: StoreState) => T,
  equalityFn: (a: T, b: T) => boolean = Object.is
): T {
  const [value, setValue] = useState(() => selector(store.getState()));
  const valueRef = useRef(value);

  useEffect(() => {
    const checkForUpdates = () => {
      const newValue = selector(store.getState());
      if (!equalityFn(valueRef.current, newValue)) {
        valueRef.current = newValue;
        setValue(newValue);
      }
    };

    // Check immediately in case state changed between render and effect
    checkForUpdates();

    return store.subscribe(checkForUpdates);
  }, [selector, equalityFn]);

  return value;
}

// ============================================================================
// AGENT SELECTORS
// ============================================================================

/**
 * Get all agents as a Map. Only re-renders when agents Map changes.
 */
export function useAgents(): Map<string, Agent> {
  return useSelector(
    useCallback((state: StoreState) => state.agents, []),
    shallowMapEqual
  );
}

/**
 * Get all agents as an array. Only re-renders when agents change.
 */
export function useAgentsArray(): Agent[] {
  const agents = useAgents();
  const arrayRef = useRef<Agent[]>([]);

  const newArray = Array.from(agents.values());
  if (!shallowArrayEqual(arrayRef.current, newArray)) {
    arrayRef.current = newArray;
  }
  return arrayRef.current;
}

/**
 * Get a single agent by ID. Only re-renders when that specific agent changes.
 */
export function useAgent(agentId: string | null): Agent | undefined {
  return useSelector(
    useCallback(
      (state: StoreState) => agentId ? state.agents.get(agentId) : undefined,
      [agentId]
    )
  );
}

/**
 * Get selected agent IDs. Only re-renders when selection changes.
 */
export function useSelectedAgentIds(): Set<string> {
  return useSelector(
    useCallback((state: StoreState) => state.selectedAgentIds, []),
    shallowSetEqual
  );
}

/**
 * Get selected agents as array. Only re-renders when selection or agents change.
 */
export function useSelectedAgents(): Agent[] {
  const agents = useAgents();
  const selectedIds = useSelectedAgentIds();
  const arrayRef = useRef<Agent[]>([]);

  const newArray: Agent[] = [];
  for (const id of selectedIds) {
    const agent = agents.get(id);
    if (agent) newArray.push(agent);
  }

  if (!shallowArrayEqual(arrayRef.current, newArray)) {
    arrayRef.current = newArray;
  }
  return arrayRef.current;
}

/**
 * Get boss agents only. Only re-renders when boss agents change.
 */
export function useBossAgents(): Agent[] {
  const agents = useAgents();
  const arrayRef = useRef<Agent[]>([]);

  const newArray = Array.from(agents.values()).filter(a => a.class === 'boss');
  if (!shallowArrayEqual(arrayRef.current, newArray)) {
    arrayRef.current = newArray;
  }
  return arrayRef.current;
}

/**
 * Get non-boss agents (subordinates). Only re-renders when they change.
 */
export function useSubordinateAgents(): Agent[] {
  const agents = useAgents();
  const arrayRef = useRef<Agent[]>([]);

  const newArray = Array.from(agents.values()).filter(a => a.class !== 'boss');
  if (!shallowArrayEqual(arrayRef.current, newArray)) {
    arrayRef.current = newArray;
  }
  return arrayRef.current;
}

// ============================================================================
// OUTPUT SELECTORS
// ============================================================================

/**
 * Get outputs for a specific agent. Only re-renders when that agent's outputs change.
 */
export function useAgentOutputs(agentId: string | null): ClaudeOutput[] {
  const emptyArray = useRef<ClaudeOutput[]>([]);

  return useSelector(
    useCallback(
      (state: StoreState) => {
        if (!agentId) return emptyArray.current;
        return state.agentOutputs.get(agentId) || emptyArray.current;
      },
      [agentId]
    ),
    shallowArrayEqual
  );
}

/**
 * Get last prompt for a specific agent.
 */
export function useLastPrompt(agentId: string | null): LastPrompt | undefined {
  return useSelector(
    useCallback(
      (state: StoreState) => agentId ? state.lastPrompts.get(agentId) : undefined,
      [agentId]
    )
  );
}

// ============================================================================
// ACTIVITY SELECTORS
// ============================================================================

/**
 * Get activities. Only re-renders when activities change.
 */
export function useActivities(): Activity[] {
  return useSelector(
    useCallback((state: StoreState) => state.activities, []),
    shallowArrayEqual
  );
}

// ============================================================================
// CONNECTION SELECTORS
// ============================================================================

/**
 * Get connection status. Only re-renders when connection status changes.
 */
export function useIsConnected(): boolean {
  return useSelector(
    useCallback((state: StoreState) => state.isConnected, [])
  );
}

// ============================================================================
// AREA SELECTORS
// ============================================================================

/**
 * Get all areas. Only re-renders when areas change.
 */
export function useAreas(): Map<string, DrawingArea> {
  return useSelector(
    useCallback((state: StoreState) => state.areas, []),
    shallowMapEqual
  );
}

/**
 * Get active drawing tool. Only re-renders when tool changes.
 */
export function useActiveTool(): DrawingTool {
  return useSelector(
    useCallback((state: StoreState) => state.activeTool, [])
  );
}

/**
 * Get selected area ID. Only re-renders when selection changes.
 */
export function useSelectedAreaId(): string | null {
  return useSelector(
    useCallback((state: StoreState) => state.selectedAreaId, [])
  );
}

// ============================================================================
// BUILDING SELECTORS
// ============================================================================

/**
 * Get all buildings. Only re-renders when buildings change.
 */
export function useBuildings(): Map<string, Building> {
  return useSelector(
    useCallback((state: StoreState) => state.buildings, []),
    shallowMapEqual
  );
}

/**
 * Get selected building IDs. Only re-renders when selection changes.
 */
export function useSelectedBuildingIds(): Set<string> {
  return useSelector(
    useCallback((state: StoreState) => state.selectedBuildingIds, []),
    shallowSetEqual
  );
}

/**
 * Get building logs. Only re-renders when logs change.
 */
export function useBuildingLogs(): Map<string, string[]> {
  return useSelector(
    useCallback((state: StoreState) => state.buildingLogs, []),
    shallowMapEqual
  );
}

// ============================================================================
// SUPERVISOR SELECTORS
// ============================================================================

/**
 * Get supervisor state. Only re-renders when supervisor state changes.
 */
export function useSupervisor(): SupervisorState {
  return useSelector(
    useCallback((state: StoreState) => state.supervisor, [])
  );
}

/**
 * Get supervisor enabled status. Only re-renders when enabled changes.
 */
export function useSupervisorEnabled(): boolean {
  return useSelector(
    useCallback((state: StoreState) => state.supervisor.enabled, [])
  );
}

/**
 * Get supervisor history for a specific agent.
 */
export function useAgentSupervisorHistory(agentId: string | null): AgentSupervisorHistoryEntry[] {
  const emptyArray = useRef<AgentSupervisorHistoryEntry[]>([]);

  return useSelector(
    useCallback(
      (state: StoreState) => {
        if (!agentId) return emptyArray.current;
        return state.supervisor.agentHistories.get(agentId) || emptyArray.current;
      },
      [agentId]
    ),
    shallowArrayEqual
  );
}

// ============================================================================
// PERMISSION SELECTORS
// ============================================================================

/**
 * Get permission requests. Only re-renders when requests change.
 */
export function usePermissionRequests(): Map<string, PermissionRequest> {
  return useSelector(
    useCallback((state: StoreState) => state.permissionRequests, []),
    shallowMapEqual
  );
}

// ============================================================================
// DELEGATION SELECTORS
// ============================================================================

/**
 * Get delegation history for a specific boss.
 */
export function useDelegationHistory(bossId: string | null): DelegationDecision[] {
  const emptyArray = useRef<DelegationDecision[]>([]);

  return useSelector(
    useCallback(
      (state: StoreState) => {
        if (!bossId) return emptyArray.current;
        return state.delegationHistories.get(bossId) || emptyArray.current;
      },
      [bossId]
    ),
    shallowArrayEqual
  );
}

/**
 * Get pending delegation. Only re-renders when pending delegation changes.
 */
export function usePendingDelegation(): { bossId: string; command: string } | null {
  return useSelector(
    useCallback((state: StoreState) => state.pendingDelegation, [])
  );
}

/**
 * Get last delegation received for an agent.
 */
export function useLastDelegationReceived(agentId: string | null): { bossName: string; taskCommand: string; timestamp: number } | undefined {
  return useSelector(
    useCallback(
      (state: StoreState) => agentId ? state.lastDelegationReceived.get(agentId) : undefined,
      [agentId]
    )
  );
}

// ============================================================================
// SETTINGS SELECTORS
// ============================================================================

/**
 * Get settings. Only re-renders when settings change.
 */
export function useSettings(): Settings {
  return useSelector(
    useCallback((state: StoreState) => state.settings, [])
  );
}

/**
 * Get hideCost setting. Only re-renders when hideCost changes.
 * Optimized selector for components that only need this single setting.
 */
export function useHideCost(): boolean {
  return useSelector(
    useCallback((state: StoreState) => state.settings.hideCost, [])
  );
}

/**
 * Get shortcuts. Only re-renders when shortcuts change.
 */
export function useShortcuts(): ShortcutConfig[] {
  return useSelector(
    useCallback((state: StoreState) => state.shortcuts, []),
    shallowArrayEqual
  );
}

/**
 * Get terminal open state. Only re-renders when terminal state changes.
 */
export function useTerminalOpen(): boolean {
  return useSelector(
    useCallback((state: StoreState) => state.terminalOpen, [])
  );
}

/**
 * Get file viewer path. Only re-renders when path changes.
 */
export function useFileViewerPath(): string | null {
  return useSelector(
    useCallback((state: StoreState) => state.fileViewerPath, [])
  );
}

// ============================================================================
// TOOL HISTORY SELECTORS
// ============================================================================

/**
 * Get tool executions. Only re-renders when executions change.
 */
export function useToolExecutions(): ToolExecution[] {
  return useSelector(
    useCallback((state: StoreState) => state.toolExecutions, []),
    shallowArrayEqual
  );
}

/**
 * Get file changes. Only re-renders when file changes update.
 */
export function useFileChanges(): FileChange[] {
  return useSelector(
    useCallback((state: StoreState) => state.fileChanges, []),
    shallowArrayEqual
  );
}
