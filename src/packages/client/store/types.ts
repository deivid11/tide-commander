/**
 * Store Types
 *
 * Central location for all store-related types and interfaces.
 */

import type {
  Agent,
  AgentAnalysis,
  DrawingArea,
  DrawingTool,
  ActivityNarrative,
  SupervisorReport,
  AgentSupervisorHistoryEntry,
  Building,
  PermissionRequest,
  DelegationDecision,
  Skill,
  CustomAgentClass,
  GlobalUsageStats,
} from '../../shared/types';
import type { ShortcutConfig } from './shortcuts';
import type { MouseControlsState } from './mouseControls';

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
  isDelegation?: boolean; // True if this is a delegation message from a boss agent
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

// Agent task progress entry (for subordinate progress in boss terminal)
export interface AgentTaskProgress {
  agentId: string;
  agentName: string;
  taskDescription: string;
  status: 'working' | 'completed' | 'failed';
  output: string[];           // Streaming output lines
  startedAt: number;
  completedAt?: number;
}

// Settings
export interface Settings {
  historyLimit: number;
  hideCost: boolean;
  showFPS: boolean;
  powerSaving: boolean; // Experimental: Reduce FPS when idle to save power
}

export const DEFAULT_SETTINGS: Settings = {
  historyLimit: 500,
  hideCost: true,
  showFPS: false,
  powerSaving: false,
};

// Supervisor state
export interface SupervisorState {
  enabled: boolean;
  autoReportOnComplete: boolean; // Auto-generate report when agent completes task
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
  // Global Claude API usage stats (from /usage command)
  globalUsage: GlobalUsageStats | null;
  // Track if usage refresh is in progress
  refreshingUsage: boolean;
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
  // Terminal resizing state (disables battlefield drag selection)
  terminalResizing: boolean;
  // Mobile view mode
  mobileView: 'terminal' | '3d';
  // Settings
  settings: Settings;
  // Keyboard shortcuts
  shortcuts: ShortcutConfig[];
  // Mouse controls
  mouseControls: MouseControlsState;
  // File viewer path (to open files from other components)
  fileViewerPath: string | null;
  // File viewer edit data for diff view (old_string, new_string from Edit tool)
  fileViewerEditData: { oldString: string; newString: string } | null;
  // File explorer folder path (to open file explorer from other components)
  explorerFolderPath: string | null;
  // Context modal agent ID (to open context modal from other components)
  contextModalAgentId: string | null;
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
  // Track agent task progress for boss terminal (bossId -> Map of subordinateId -> progress)
  agentTaskProgress: Map<string, Map<string, AgentTaskProgress>>;
  // Skills
  skills: Map<string, Skill>;
  // Custom Agent Classes
  customAgentClasses: Map<string, CustomAgentClass>;
  // Reconnection counter - increments on each WebSocket reconnect
  // Components can watch this to refresh their data
  reconnectCount: number;
}

// Store listener type
export type Listener = () => void;
