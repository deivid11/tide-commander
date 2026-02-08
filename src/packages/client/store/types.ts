/**
 * Store Types
 *
 * Central location for all store-related types and interfaces.
 */

import type {
  Agent,
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
  ExecTask,
  Secret,
  QueryResult,
  QueryHistoryEntry,
  TableInfo,
  TableColumn,
  TableIndex,
  ForeignKey,
  ExistingDockerContainer,
  ExistingComposeProject,
  Subagent,
} from '../../shared/types';
import type { ShortcutConfig } from './shortcuts';
import type { MouseControlsState } from './mouseControls';
import type { SnapshotListItem, ConversationSnapshot } from '../../shared/types/snapshot';

// Activity type
export interface Activity {
  agentId: string;
  agentName: string;
  message: string;
  timestamp: number;
}

// Skill update notification data
export interface SkillUpdateData {
  skills: Array<{
    name: string;
    description: string;
  }>;
}

// Agent output entry (provider-agnostic)
export interface AgentOutput {
  text: string;
  isStreaming: boolean;
  timestamp: number;
  isUserPrompt?: boolean; // True if this is a user-sent command
  isDelegation?: boolean; // True if this is a delegation message from a boss agent
  skillUpdate?: SkillUpdateData; // True if this is a skill update notification
  subagentName?: string; // Name of the subagent that produced this output (for badge display)
  uuid?: string; // Unique message UUID from Claude (for deduplication)
  toolName?: string; // Tool name extracted from "Using tool:" messages (for real-time display)
  toolInput?: Record<string, unknown>; // Parsed tool input JSON (for key param extraction before look-ahead)
  toolOutput?: string; // Tool result/bash output text
}

// Backward-compatible alias for existing references
export type ClaudeOutput = AgentOutput;

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
  // Custom agent names for random selection
  customAgentNames: string[];
  // Experimental features (disabled by default)
  experimental2DView: boolean;
  experimentalVoiceAssistant: boolean;
  experimentalTTS: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  historyLimit: 500,
  hideCost: true,
  showFPS: false,
  powerSaving: false,
  customAgentNames: [],
  experimental2DView: false,
  experimentalVoiceAssistant: false,
  experimentalTTS: false,
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
  lastSelectedAgentId: string | null; // Track last selected agent for Escape key behavior
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
  streamingBuildingLogs: Map<string, string>; // Building ID -> streaming log buffer (for real-time modal)
  streamingBuildingIds: Set<string>; // Building IDs currently streaming logs
  // Boss building unified logs
  bossStreamingLogs: Map<string, Array<{ subordinateId: string; subordinateName: string; chunk: string; timestamp: number; isError?: boolean }>>;
  // Agent outputs per agent
  agentOutputs: Map<string, AgentOutput[]>;
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
  // OR line range for Read tool with offset/limit
  fileViewerEditData: {
    oldString?: string;
    newString?: string;
    operation?: string;
    // For Read tool - highlight these lines
    highlightRange?: { offset: number; limit: number };
    // Optional target line from `path:line` references
    targetLine?: number;
  } | null;
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
  // Exec tasks (streaming command execution via /api/exec)
  execTasks?: Map<string, ExecTask>;
  // Secrets (key-value pairs for placeholder replacement)
  secrets: Map<string, Secret>;
  // Database state per building
  databaseState: Map<string, DatabaseBuildingState>;
  // Docker containers list (for "existing" mode selection)
  dockerContainersList: ExistingDockerContainer[];
  dockerComposeProjectsList: ExistingComposeProject[];
  // Snapshots
  snapshots: Map<string, SnapshotListItem>;
  currentSnapshot: ConversationSnapshot | null;
  snapshotsLoading: boolean;
  snapshotsError: string | null;
  // Flag to track if last agent selection was via swipe (prevents autofocus on mobile)
  lastSelectionViaSwipe: boolean;
  // Flag to track if last agent selection was via direct click on agent bar (prevents autofocus)
  lastSelectionViaDirectClick: boolean;
  // Virtual subagents (Task tool spawned by Claude Code)
  subagents: Map<string, Subagent>;  // subagent.id -> Subagent
  // View mode for main viewport (3d, 2d, dashboard)
  viewMode: '2d' | '3d' | 'dashboard';
  // Agent overview panel open state (persists across agent switches)
  overviewPanelOpen: boolean;
}

// Database building state
export interface DatabaseBuildingState {
  // Connection status per connection ID
  connectionStatus: Map<string, { connected: boolean; error?: string; serverVersion?: string }>;
  // Available databases per connection ID
  databases: Map<string, string[]>;
  // Tables per connection ID + database
  tables: Map<string, TableInfo[]>;
  // Table schema cache (key: connectionId:database:table)
  tableSchemas: Map<string, { columns: TableColumn[]; indexes: TableIndex[]; foreignKeys: ForeignKey[] }>;
  // Query results (most recent first)
  queryResults: QueryResult[];
  // Query history
  queryHistory: QueryHistoryEntry[];
  // Currently executing query
  executingQuery: boolean;
  // Active connection and database
  activeConnectionId: string | null;
  activeDatabase: string | null;
}

// Store listener type
export type Listener = () => void;
