import type {
  Agent, AgentClass, AgentProvider, PermissionMode, ClaudeModel, CodexModel, CodexConfig,
  ContextStats, GlobalUsageStats, Subagent, DelegationDecision,
  WorkPlan, AnalysisRequest, ActivityNarrative, AgentAnalysis,
  SupervisorReport, SupervisorConfig, AgentSupervisorHistory,
  CustomAgentClass,
} from './agent-types';
import type {
  Building, BuildingStatus, ExistingDockerContainer, ExistingComposeProject,
} from './building-types';
import type {
  QueryResult, QueryHistoryEntry, TableColumn, TableIndex, ForeignKey, TableInfo,
} from './database-types';
import type {
  ClaudeEvent, DrawingArea, Skill, PermissionRequest, PermissionResponse,
  AgentNotification, Secret, SnapshotListItem, ConversationSnapshot,
  CreateSnapshotRequest, RestoreSnapshotRequest, RestoreSnapshotResponse,
  SkillUpdateData,
} from './common-types';

// ============================================================================
// WebSocket Base
// ============================================================================

export interface WSMessage {
  type: string;
  payload?: unknown;
}

// ============================================================================
// Agent Messages (Server -> Client)
// ============================================================================

export interface AgentsUpdateMessage extends WSMessage {
  type: 'agents_update';
  payload: Agent[];
}

export interface AgentCreatedMessage extends WSMessage {
  type: 'agent_created';
  payload: Agent;
}

export interface AgentUpdatedMessage extends WSMessage {
  type: 'agent_updated';
  payload: Agent;
}

export interface AgentDeletedMessage extends WSMessage {
  type: 'agent_deleted';
  payload: { id: string };
}

export interface EventMessage extends WSMessage {
  type: 'event';
  payload: ClaudeEvent & { agentId: string };
}

export interface ActivityMessage extends WSMessage {
  type: 'activity';
  payload: {
    agentId: string;
    agentName: string;
    message: string;
    timestamp: number;
  };
}

// Streaming output from Claude
export interface OutputMessage extends WSMessage {
  type: 'output';
  payload: {
    agentId: string;
    text: string;
    isStreaming: boolean;
    timestamp: number;
    isDelegation?: boolean; // True if this is a delegation message from a boss agent
    skillUpdate?: SkillUpdateData; // Skill update notification (UI only, not injected into conversation)
    subagentName?: string; // Name of subagent if this output is from a delegated task
    uuid?: string; // Unique message UUID for deduplication
    // Tool information extracted from text for better debugger display
    toolName?: string; // Name of tool being used (e.g., "Bash", "Read")
    toolInput?: Record<string, unknown>; // Parsed tool input parameters
    toolInputRaw?: string; // Raw tool input if JSON parsing failed
    toolOutput?: string; // Tool output/result
  };
}

// Context stats response (detailed breakdown from /context command)
export interface ContextStatsMessage extends WSMessage {
  type: 'context_stats';
  payload: {
    agentId: string;
    stats: ContextStats;
  };
}

export interface ErrorMessage extends WSMessage {
  type: 'error';
  payload: { message: string };
}

// Command started message - sent when a command begins execution
export interface CommandStartedMessage extends WSMessage {
  type: 'command_started';
  payload: {
    agentId: string;
    command: string;
  };
}

// Session updated message - sent when an orphaned agent's session file is updated
// Clients should refresh the agent's history when receiving this
export interface SessionUpdatedMessage extends WSMessage {
  type: 'session_updated';
  payload: {
    agentId: string;
  };
}

// Directory not found error - prompts user to create directory
export interface DirectoryNotFoundMessage extends WSMessage {
  type: 'directory_not_found';
  payload: {
    path: string;
    name: string;
    class: AgentClass;
  };
}

// ============================================================================
// Agent Messages (Client -> Server)
// ============================================================================

export interface SpawnAgentMessage extends WSMessage {
  type: 'spawn_agent';
  payload: {
    name: string;
    class: AgentClass;
    cwd: string;
    position?: { x: number; y: number; z: number };
    sessionId?: string;
    useChrome?: boolean;
    permissionMode?: PermissionMode; // defaults to 'bypass' for backwards compatibility
    provider?: AgentProvider; // defaults to 'claude' for backwards compatibility
    codexConfig?: CodexConfig;
    codexModel?: CodexModel;
    initialSkillIds?: string[]; // Skills to assign on creation
    model?: ClaudeModel; // Claude model to use (defaults to sonnet)
    customInstructions?: string;  // Custom instructions to append to system prompt
  };
}

export interface SendCommandMessage extends WSMessage {
  type: 'send_command';
  payload: {
    agentId: string;
    command: string;
  };
}

export interface ReattachAgentMessage extends WSMessage {
  type: 'reattach_agent';
  payload: {
    agentId: string;
  };
}

export interface MoveAgentMessage extends WSMessage {
  type: 'move_agent';
  payload: {
    agentId: string;
    position: { x: number; y: number; z: number };
  };
}

export interface KillAgentMessage extends WSMessage {
  type: 'kill_agent';
  payload: {
    agentId: string;
  };
}

// Stop current operation (but keep agent alive)
export interface StopAgentMessage extends WSMessage {
  type: 'stop_agent';
  payload: {
    agentId: string;
  };
}

// Clear agent's context/session (force new session on next command)
export interface ClearContextMessage extends WSMessage {
  type: 'clear_context';
  payload: {
    agentId: string;
  };
}

// Collapse context (compact the session to save tokens)
export interface CollapseContextMessage extends WSMessage {
  type: 'collapse_context';
  payload: {
    agentId: string;
  };
}

// Request detailed context stats (triggers /context command)
export interface RequestContextStatsMessage extends WSMessage {
  type: 'request_context_stats';
  payload: {
    agentId: string;
  };
}

export interface CreateDirectoryMessage extends WSMessage {
  type: 'create_directory';
  payload: {
    path: string;
    name: string;
    class: AgentClass;
  };
}

// Remove agent from UI and persistence (keeps Claude session running)
export interface RemoveAgentMessage extends WSMessage {
  type: 'remove_agent';
  payload: {
    agentId: string;
  };
}

// Rename agent
export interface RenameAgentMessage extends WSMessage {
  type: 'rename_agent';
  payload: {
    agentId: string;
    name: string;
  };
}

// Update agent properties (class, permission mode, skills, model)
export interface UpdateAgentPropertiesMessage extends WSMessage {
  type: 'update_agent_properties';
  payload: {
    agentId: string;
    updates: {
      class?: AgentClass;
      permissionMode?: PermissionMode;
      provider?: AgentProvider;
      model?: ClaudeModel;
      codexModel?: CodexModel;
      codexConfig?: CodexConfig;
      skillIds?: string[];  // Complete list of skill IDs to assign (replaces existing)
    };
  };
}

// ============================================================================
// Subagent Messages
// ============================================================================

// Subagent started message (Server -> Client)
export interface SubagentStartedMessage extends WSMessage {
  type: 'subagent_started';
  payload: Subagent;
}

// Subagent output message (Server -> Client)
export interface SubagentOutputMessage extends WSMessage {
  type: 'subagent_output';
  payload: {
    subagentId: string;
    parentAgentId: string;
    text: string;
    isStreaming: boolean;
    timestamp: number;
  };
}

// Subagent completed message (Server -> Client)
export interface SubagentCompletedMessage extends WSMessage {
  type: 'subagent_completed';
  payload: {
    subagentId: string;
    parentAgentId: string;
    success: boolean;
    resultPreview?: string;           // First 500 chars of result
  };
}

// ============================================================================
// Areas Messages
// ============================================================================

// Areas sync message (Server -> Client) - sent on connect and when areas change
export interface AreasUpdateMessage extends WSMessage {
  type: 'areas_update';
  payload: DrawingArea[];
}

// Sync areas message (Client -> Server) - sent when client modifies areas
export interface SyncAreasMessage extends WSMessage {
  type: 'sync_areas';
  payload: DrawingArea[];
}

// ============================================================================
// Supervisor Messages
// ============================================================================

// Supervisor WebSocket messages (Server -> Client)
export interface SupervisorReportMessage extends WSMessage {
  type: 'supervisor_report';
  payload: SupervisorReport;
}

export interface SupervisorStatusMessage extends WSMessage {
  type: 'supervisor_status';
  payload: {
    enabled: boolean;
    lastReportTime: number | null;
    nextReportTime: number | null;
  };
}

export interface NarrativeUpdateMessage extends WSMessage {
  type: 'narrative_update';
  payload: {
    agentId: string;
    narrative: ActivityNarrative;
  };
}

export interface AgentSupervisorHistoryMessage extends WSMessage {
  type: 'agent_supervisor_history';
  payload: AgentSupervisorHistory;
}

export interface AgentAnalysisMessage extends WSMessage {
  type: 'agent_analysis';
  payload: {
    agentId: string;
    analysis: AgentAnalysis;
  };
}

// Global Usage WebSocket messages
export interface GlobalUsageMessage extends WSMessage {
  type: 'global_usage';
  payload: GlobalUsageStats | null;
}

export interface RequestGlobalUsageMessage extends WSMessage {
  type: 'request_global_usage';
  payload: Record<string, never>;
}

// Supervisor WebSocket messages (Client -> Server)
export interface SetSupervisorConfigMessage extends WSMessage {
  type: 'set_supervisor_config';
  payload: Partial<SupervisorConfig>;
}

export interface RequestSupervisorReportMessage extends WSMessage {
  type: 'request_supervisor_report';
  payload: Record<string, never>;
}

export interface RequestAgentSupervisorHistoryMessage extends WSMessage {
  type: 'request_agent_supervisor_history';
  payload: {
    agentId: string;
  };
}

// ============================================================================
// Building Messages
// ============================================================================

// Buildings sync message (Server -> Client)
export interface BuildingsUpdateMessage extends WSMessage {
  type: 'buildings_update';
  payload: Building[];
}

// Building created message (Server -> Client)
export interface BuildingCreatedMessage extends WSMessage {
  type: 'building_created';
  payload: Building;
}

// Building updated message (Server -> Client)
export interface BuildingUpdatedMessage extends WSMessage {
  type: 'building_updated';
  payload: Building;
}

// Building deleted message (Server -> Client)
export interface BuildingDeletedMessage extends WSMessage {
  type: 'building_deleted';
  payload: { id: string };
}

// Building logs message (Server -> Client)
export interface BuildingLogsMessage extends WSMessage {
  type: 'building_logs';
  payload: {
    buildingId: string;
    logs: string;
    timestamp: number;
  };
}

// Sync buildings message (Client -> Server)
export interface SyncBuildingsMessage extends WSMessage {
  type: 'sync_buildings';
  payload: Building[];
}

// Create building message (Client -> Server)
export interface CreateBuildingMessage extends WSMessage {
  type: 'create_building';
  payload: Omit<Building, 'id' | 'createdAt' | 'status'> & { status?: BuildingStatus };
}

// Update building message (Client -> Server)
export interface UpdateBuildingMessage extends WSMessage {
  type: 'update_building';
  payload: { id: string; updates: Partial<Building> };
}

// Delete building message (Client -> Server)
export interface DeleteBuildingMessage extends WSMessage {
  type: 'delete_building';
  payload: { id: string };
}

// Building command message (Client -> Server) - start/stop/restart/logs/delete
export interface BuildingCommandMessage extends WSMessage {
  type: 'building_command';
  payload: {
    buildingId: string;
    command: 'start' | 'stop' | 'restart' | 'healthCheck' | 'logs' | 'delete';
  };
}

// ============================================================================
// PM2 Log Streaming Messages
// ============================================================================

// Start streaming logs (Client -> Server)
export interface PM2LogsStartMessage extends WSMessage {
  type: 'pm2_logs_start';
  payload: {
    buildingId: string;
    lines?: number; // Initial lines to fetch (default 100)
  };
}

// Stop streaming logs (Client -> Server)
export interface PM2LogsStopMessage extends WSMessage {
  type: 'pm2_logs_stop';
  payload: {
    buildingId: string;
  };
}

// Log chunk from streaming (Server -> Client)
export interface PM2LogsChunkMessage extends WSMessage {
  type: 'pm2_logs_chunk';
  payload: {
    buildingId: string;
    chunk: string;
    timestamp: number;
    isError?: boolean; // stderr vs stdout
  };
}

// Streaming started confirmation (Server -> Client)
export interface PM2LogsStreamingMessage extends WSMessage {
  type: 'pm2_logs_streaming';
  payload: {
    buildingId: string;
    streaming: boolean;
  };
}

// ============================================================================
// Docker Log Streaming Messages
// ============================================================================

// Start streaming Docker logs (Client -> Server)
export interface DockerLogsStartMessage extends WSMessage {
  type: 'docker_logs_start';
  payload: {
    buildingId: string;
    lines?: number; // Initial lines to fetch (default 100)
    service?: string; // For compose mode: specific service to stream
  };
}

// Stop streaming Docker logs (Client -> Server)
export interface DockerLogsStopMessage extends WSMessage {
  type: 'docker_logs_stop';
  payload: {
    buildingId: string;
  };
}

// Docker log chunk from streaming (Server -> Client)
export interface DockerLogsChunkMessage extends WSMessage {
  type: 'docker_logs_chunk';
  payload: {
    buildingId: string;
    chunk: string;
    timestamp: number;
    isError?: boolean; // stderr vs stdout
    service?: string; // For compose mode: which service this log is from
  };
}

// Docker streaming started confirmation (Server -> Client)
export interface DockerLogsStreamingMessage extends WSMessage {
  type: 'docker_logs_streaming';
  payload: {
    buildingId: string;
    streaming: boolean;
  };
}

// Request list of existing Docker containers (Client -> Server)
export interface DockerListContainersMessage extends WSMessage {
  type: 'docker_list_containers';
  payload: Record<string, never>; // Empty payload
}

// Response with list of existing containers (Server -> Client)
export interface DockerContainersListMessage extends WSMessage {
  type: 'docker_containers_list';
  payload: {
    containers: ExistingDockerContainer[];
    composeProjects: ExistingComposeProject[];
  };
}

// ============================================================================
// Boss Building Messages
// ============================================================================

// Boss building bulk command message (Client -> Server) - start all/stop all/restart all
export interface BossBuildingCommandMessage extends WSMessage {
  type: 'boss_building_command';
  payload: {
    buildingId: string;  // The boss building ID
    command: 'start_all' | 'stop_all' | 'restart_all';
  };
}

// Assign buildings to boss (Client -> Server)
export interface AssignBuildingsMessage extends WSMessage {
  type: 'assign_buildings';
  payload: {
    bossBuildingId: string;
    subordinateBuildingIds: string[];
  };
}

// Request unified logs from boss building (Client -> Server)
export interface BossBuildingLogsStartMessage extends WSMessage {
  type: 'boss_building_logs_start';
  payload: {
    buildingId: string;  // The boss building ID
    lines?: number;      // Initial lines to fetch per subordinate (default 50)
  };
}

// Stop streaming unified logs (Client -> Server)
export interface BossBuildingLogsStopMessage extends WSMessage {
  type: 'boss_building_logs_stop';
  payload: {
    buildingId: string;
  };
}

// Unified log chunk from boss building (Server -> Client)
export interface BossBuildingLogsChunkMessage extends WSMessage {
  type: 'boss_building_logs_chunk';
  payload: {
    bossBuildingId: string;
    subordinateBuildingId: string;
    subordinateBuildingName: string;
    chunk: string;
    timestamp: number;
    isError?: boolean;
  };
}

// Boss building subordinates updated (Server -> Client)
export interface BossBuildingSubordinatesUpdatedMessage extends WSMessage {
  type: 'boss_building_subordinates_updated';
  payload: {
    bossBuildingId: string;
    subordinateBuildingIds: string[];
  };
}

// ============================================================================
// Permission Messages
// ============================================================================

// Permission WebSocket messages (Server -> Client)
export interface PermissionRequestMessage extends WSMessage {
  type: 'permission_request';
  payload: PermissionRequest;
}

export interface PermissionResolvedMessage extends WSMessage {
  type: 'permission_resolved';
  payload: {
    requestId: string;
    approved: boolean;
  };
}

// Permission WebSocket messages (Client -> Server)
export interface PermissionResponseMessage extends WSMessage {
  type: 'permission_response';
  payload: PermissionResponse;
}

// ============================================================================
// Agent Notification Messages
// ============================================================================

// Agent notification message (Server -> Client)
export interface AgentNotificationMessage extends WSMessage {
  type: 'agent_notification';
  payload: AgentNotification;
}

// Send notification request (Client -> Server, from agent via skill)
export interface SendNotificationMessage extends WSMessage {
  type: 'send_notification';
  payload: {
    agentId: string;
    title: string;
    message: string;
  };
}

// ============================================================================
// Boss Agent Messages
// ============================================================================

// Spawn a boss agent (Client -> Server)
export interface SpawnBossAgentMessage extends WSMessage {
  type: 'spawn_boss_agent';
  payload: {
    name: string;
    class?: AgentClass;  // Boss class (default: 'boss')
    cwd: string;
    position?: { x: number; y: number; z: number };
    subordinateIds?: string[];  // Initial subordinates (optional)
    useChrome?: boolean;
    permissionMode?: PermissionMode;
    provider?: AgentProvider; // defaults to 'claude' for backwards compatibility
    codexConfig?: CodexConfig;
    codexModel?: CodexModel;
    model?: ClaudeModel; // Claude model to use (defaults to sonnet)
    customInstructions?: string;  // Custom instructions to append to system prompt
    initialSkillIds?: string[];  // Initial skills to assign to the boss
  };
}

// Assign subordinates to a boss (Client -> Server)
export interface AssignSubordinatesMessage extends WSMessage {
  type: 'assign_subordinates';
  payload: {
    bossId: string;
    subordinateIds: string[];
  };
}

// Remove subordinate from boss (Client -> Server)
export interface RemoveSubordinateMessage extends WSMessage {
  type: 'remove_subordinate';
  payload: {
    bossId: string;
    subordinateId: string;
  };
}

// Send command to boss for delegation (Client -> Server)
export interface SendBossCommandMessage extends WSMessage {
  type: 'send_boss_command';
  payload: {
    bossId: string;
    command: string;
  };
}

// Request delegation history (Client -> Server)
export interface RequestDelegationHistoryMessage extends WSMessage {
  type: 'request_delegation_history';
  payload: {
    bossId: string;
  };
}

// Delegation decision notification (Server -> Client)
export interface DelegationDecisionMessage extends WSMessage {
  type: 'delegation_decision';
  payload: DelegationDecision;
}

// Boss subordinates updated (Server -> Client)
export interface BossSubordinatesUpdatedMessage extends WSMessage {
  type: 'boss_subordinates_updated';
  payload: {
    bossId: string;
    subordinateIds: string[];
  };
}

// Delegation history response (Server -> Client)
export interface DelegationHistoryMessage extends WSMessage {
  type: 'delegation_history';
  payload: {
    bossId: string;
    decisions: DelegationDecision[];
  };
}

// Boss spawned agent notification (Server -> Client)
// Used when a boss spawns a subordinate - client should NOT auto-select and should walk to boss
export interface BossSpawnedAgentMessage extends WSMessage {
  type: 'boss_spawned_agent';
  payload: {
    agent: Agent;
    bossId: string;
    bossPosition: { x: number; y: number; z: number };
  };
}

// Agent task started notification (Server -> Client)
// Sent when a subordinate starts working on a delegated task
export interface AgentTaskStartedMessage extends WSMessage {
  type: 'agent_task_started';
  payload: {
    bossId: string;
    subordinateId: string;
    subordinateName: string;
    taskDescription: string;
  };
}

// Agent task output notification (Server -> Client)
// Streaming output from a subordinate working on a delegated task
export interface AgentTaskOutputMessage extends WSMessage {
  type: 'agent_task_output';
  payload: {
    bossId: string;
    subordinateId: string;
    output: string;
  };
}

// Agent task completed notification (Server -> Client)
// Sent when a subordinate completes a delegated task
export interface AgentTaskCompletedMessage extends WSMessage {
  type: 'agent_task_completed';
  payload: {
    bossId: string;
    subordinateId: string;
    success: boolean;
  };
}

// ============================================================================
// Work Plan Messages
// ============================================================================

// Work plan created (Server -> Client)
export interface WorkPlanCreatedMessage extends WSMessage {
  type: 'work_plan_created';
  payload: WorkPlan;
}

// Work plan updated (Server -> Client)
export interface WorkPlanUpdatedMessage extends WSMessage {
  type: 'work_plan_updated';
  payload: WorkPlan;
}

// Work plan deleted (Server -> Client)
export interface WorkPlanDeletedMessage extends WSMessage {
  type: 'work_plan_deleted';
  payload: { id: string };
}

// Work plans sync (Server -> Client) - sent on connect
export interface WorkPlansUpdateMessage extends WSMessage {
  type: 'work_plans_update';
  payload: WorkPlan[];
}

// Analysis request created (Server -> Client)
export interface AnalysisRequestCreatedMessage extends WSMessage {
  type: 'analysis_request_created';
  payload: AnalysisRequest;
}

// Analysis request completed (Server -> Client)
export interface AnalysisRequestCompletedMessage extends WSMessage {
  type: 'analysis_request_completed';
  payload: AnalysisRequest;
}

// Approve work plan (Client -> Server)
export interface ApproveWorkPlanMessage extends WSMessage {
  type: 'approve_work_plan';
  payload: {
    planId: string;
    autoExecute?: boolean;  // Start execution immediately after approval
  };
}

// Execute work plan (Client -> Server)
export interface ExecuteWorkPlanMessage extends WSMessage {
  type: 'execute_work_plan';
  payload: {
    planId: string;
  };
}

// Pause work plan (Client -> Server)
export interface PauseWorkPlanMessage extends WSMessage {
  type: 'pause_work_plan';
  payload: {
    planId: string;
  };
}

// Cancel work plan (Client -> Server)
export interface CancelWorkPlanMessage extends WSMessage {
  type: 'cancel_work_plan';
  payload: {
    planId: string;
  };
}

// Request work plans for a boss (Client -> Server)
export interface RequestWorkPlansMessage extends WSMessage {
  type: 'request_work_plans';
  payload: {
    bossId: string;
  };
}

// ============================================================================
// Skill Messages
// ============================================================================

// Skills sync message (Server -> Client) - sent on connect and when skills change
export interface SkillsUpdateMessage extends WSMessage {
  type: 'skills_update';
  payload: Skill[];
}

// Skill created message (Server -> Client)
export interface SkillCreatedMessage extends WSMessage {
  type: 'skill_created';
  payload: Skill;
}

// Skill updated message (Server -> Client)
export interface SkillUpdatedMessage extends WSMessage {
  type: 'skill_updated';
  payload: Skill;
}

// Skill deleted message (Server -> Client)
export interface SkillDeletedMessage extends WSMessage {
  type: 'skill_deleted';
  payload: { id: string };
}

// Create skill message (Client -> Server)
export interface CreateSkillMessage extends WSMessage {
  type: 'create_skill';
  payload: Omit<Skill, 'id' | 'createdAt' | 'updatedAt'>;
}

// Update skill message (Client -> Server)
export interface UpdateSkillMessage extends WSMessage {
  type: 'update_skill';
  payload: { id: string; updates: Partial<Skill> };
}

// Delete skill message (Client -> Server)
export interface DeleteSkillMessage extends WSMessage {
  type: 'delete_skill';
  payload: { id: string };
}

// Assign skill to agent (Client -> Server)
export interface AssignSkillMessage extends WSMessage {
  type: 'assign_skill';
  payload: {
    skillId: string;
    agentId: string;
  };
}

// Unassign skill from agent (Client -> Server)
export interface UnassignSkillMessage extends WSMessage {
  type: 'unassign_skill';
  payload: {
    skillId: string;
    agentId: string;
  };
}

// Request skills for an agent (Client -> Server)
export interface RequestAgentSkillsMessage extends WSMessage {
  type: 'request_agent_skills';
  payload: {
    agentId: string;
  };
}

// Agent skills response (Server -> Client)
export interface AgentSkillsMessage extends WSMessage {
  type: 'agent_skills';
  payload: {
    agentId: string;
    skills: Skill[];
  };
}

// ============================================================================
// Custom Agent Class Messages
// ============================================================================

// Custom agent classes sync message (Server -> Client)
export interface CustomAgentClassesUpdateMessage extends WSMessage {
  type: 'custom_agent_classes_update';
  payload: CustomAgentClass[];
}

// Custom agent class created message (Server -> Client)
export interface CustomAgentClassCreatedMessage extends WSMessage {
  type: 'custom_agent_class_created';
  payload: CustomAgentClass;
}

// Custom agent class updated message (Server -> Client)
export interface CustomAgentClassUpdatedMessage extends WSMessage {
  type: 'custom_agent_class_updated';
  payload: CustomAgentClass;
}

// Custom agent class deleted message (Server -> Client)
export interface CustomAgentClassDeletedMessage extends WSMessage {
  type: 'custom_agent_class_deleted';
  payload: { id: string };
}

// Create custom agent class message (Client -> Server)
export interface CreateCustomAgentClassMessage extends WSMessage {
  type: 'create_custom_agent_class';
  payload: Omit<CustomAgentClass, 'id' | 'createdAt' | 'updatedAt'>;
}

// Update custom agent class message (Client -> Server)
export interface UpdateCustomAgentClassMessage extends WSMessage {
  type: 'update_custom_agent_class';
  payload: { id: string; updates: Partial<CustomAgentClass> };
}

// Delete custom agent class message (Client -> Server)
export interface DeleteCustomAgentClassMessage extends WSMessage {
  type: 'delete_custom_agent_class';
  payload: { id: string };
}

// ============================================================================
// Exec Task Messages
// ============================================================================

// Exec task started message (Server -> Client)
export interface ExecTaskStartedMessage extends WSMessage {
  type: 'exec_task_started';
  payload: {
    taskId: string;
    agentId: string;
    agentName: string;
    command: string;
    cwd: string;
  };
}

// Exec task output message (Server -> Client) - streaming output
export interface ExecTaskOutputMessage extends WSMessage {
  type: 'exec_task_output';
  payload: {
    taskId: string;
    agentId: string;
    output: string;
    isError?: boolean;
  };
}

// Exec task completed message (Server -> Client)
export interface ExecTaskCompletedMessage extends WSMessage {
  type: 'exec_task_completed';
  payload: {
    taskId: string;
    agentId: string;
    exitCode: number | null;
    success: boolean;
  };
}

// ============================================================================
// Secrets Messages
// ============================================================================

// Secrets sync message (Server -> Client) - sent on connect and when secrets change
export interface SecretsUpdateMessage extends WSMessage {
  type: 'secrets_update';
  payload: Secret[];
}

// Secret created message (Server -> Client)
export interface SecretCreatedMessage extends WSMessage {
  type: 'secret_created';
  payload: Secret;
}

// Secret updated message (Server -> Client)
export interface SecretUpdatedMessage extends WSMessage {
  type: 'secret_updated';
  payload: Secret;
}

// Secret deleted message (Server -> Client)
export interface SecretDeletedMessage extends WSMessage {
  type: 'secret_deleted';
  payload: { id: string };
}

// Create secret message (Client -> Server)
export interface CreateSecretMessage extends WSMessage {
  type: 'create_secret';
  payload: Omit<Secret, 'id' | 'createdAt' | 'updatedAt'>;
}

// Update secret message (Client -> Server)
export interface UpdateSecretMessage extends WSMessage {
  type: 'update_secret';
  payload: { id: string; updates: Partial<Omit<Secret, 'id' | 'createdAt' | 'updatedAt'>> };
}

// Delete secret message (Client -> Server)
export interface DeleteSecretMessage extends WSMessage {
  type: 'delete_secret';
  payload: { id: string };
}

// ============================================================================
// Snapshot Messages
// ============================================================================

// Snapshots sync message (Server -> Client) - sent on connect
export interface SnapshotsUpdateMessage extends WSMessage {
  type: 'snapshots_update';
  payload: SnapshotListItem[];
}

// Snapshot created message (Server -> Client)
export interface SnapshotCreatedMessage extends WSMessage {
  type: 'snapshot_created';
  payload: ConversationSnapshot;
}

// Snapshot deleted message (Server -> Client)
export interface SnapshotDeletedMessage extends WSMessage {
  type: 'snapshot_deleted';
  payload: { id: string };
}

// Request snapshot list (Client -> Server)
export interface RequestSnapshotsMessage extends WSMessage {
  type: 'request_snapshots';
  payload: {
    agentId?: string;          // Optional: filter by agent
    limit?: number;            // Max snapshots to return
  };
}

// Request snapshot details (Client -> Server)
export interface RequestSnapshotDetailsMessage extends WSMessage {
  type: 'request_snapshot_details';
  payload: {
    snapshotId: string;
  };
}

// Snapshot details response (Server -> Client)
export interface SnapshotDetailsMessage extends WSMessage {
  type: 'snapshot_details';
  payload: ConversationSnapshot;
}

// Create snapshot request (Client -> Server)
export interface CreateSnapshotMessage extends WSMessage {
  type: 'create_snapshot';
  payload: CreateSnapshotRequest;
}

// Delete snapshot request (Client -> Server)
export interface DeleteSnapshotMessage extends WSMessage {
  type: 'delete_snapshot';
  payload: { id: string };
}

// Restore snapshot request (Client -> Server)
export interface RestoreSnapshotMessage extends WSMessage {
  type: 'restore_snapshot';
  payload: RestoreSnapshotRequest;
}

// Restore snapshot response (Server -> Client)
export interface SnapshotRestoredMessage extends WSMessage {
  type: 'snapshot_restored';
  payload: RestoreSnapshotResponse;
}

// ============================================================================
// Database Messages
// ============================================================================

// Test database connection (Client -> Server)
export interface TestDatabaseConnectionMessage extends WSMessage {
  type: 'test_database_connection';
  payload: {
    buildingId: string;
    connectionId: string;
  };
}

// Test connection result (Server -> Client)
export interface DatabaseConnectionResultMessage extends WSMessage {
  type: 'database_connection_result';
  payload: {
    buildingId: string;
    connectionId: string;
    success: boolean;
    error?: string;
    serverVersion?: string;
  };
}

// List databases (Client -> Server)
export interface ListDatabasesMessage extends WSMessage {
  type: 'list_databases';
  payload: {
    buildingId: string;
    connectionId: string;
  };
}

// Databases list result (Server -> Client)
export interface DatabasesListMessage extends WSMessage {
  type: 'databases_list';
  payload: {
    buildingId: string;
    connectionId: string;
    databases: string[];
  };
}

// Execute query (Client -> Server)
export interface ExecuteQueryMessage extends WSMessage {
  type: 'execute_query';
  payload: {
    buildingId: string;
    connectionId: string;
    database: string;
    query: string;
    limit?: number;              // Max rows to return (default: 1000)
  };
}

// Query result (Server -> Client)
export interface QueryResultMessage extends WSMessage {
  type: 'query_result';
  payload: {
    buildingId: string;
    result: QueryResult;
  };
}

// Query history update (Server -> Client)
export interface QueryHistoryUpdateMessage extends WSMessage {
  type: 'query_history_update';
  payload: {
    buildingId: string;
    history: QueryHistoryEntry[];
  };
}

// Request query history (Client -> Server)
export interface RequestQueryHistoryMessage extends WSMessage {
  type: 'request_query_history';
  payload: {
    buildingId: string;
    limit?: number;              // Max entries to return (default: 100)
  };
}

// Toggle query favorite (Client -> Server)
export interface ToggleQueryFavoriteMessage extends WSMessage {
  type: 'toggle_query_favorite';
  payload: {
    buildingId: string;
    queryId: string;
  };
}

// Delete query from history (Client -> Server)
export interface DeleteQueryHistoryMessage extends WSMessage {
  type: 'delete_query_history';
  payload: {
    buildingId: string;
    queryId: string;
  };
}

// Clear all query history (Client -> Server)
export interface ClearQueryHistoryMessage extends WSMessage {
  type: 'clear_query_history';
  payload: {
    buildingId: string;
  };
}

// Get table schema (Client -> Server)
export interface GetTableSchemaMessage extends WSMessage {
  type: 'get_table_schema';
  payload: {
    buildingId: string;
    connectionId: string;
    database: string;
    table: string;
  };
}

// Table schema result (Server -> Client)
export interface TableSchemaMessage extends WSMessage {
  type: 'table_schema';
  payload: {
    buildingId: string;
    connectionId: string;
    database: string;
    table: string;
    columns: TableColumn[];
    indexes?: TableIndex[];
    foreignKeys?: ForeignKey[];
  };
}

// List tables in database (Client -> Server)
export interface ListTablesMessage extends WSMessage {
  type: 'list_tables';
  payload: {
    buildingId: string;
    connectionId: string;
    database: string;
  };
}

// Tables list result (Server -> Client)
export interface TablesListMessage extends WSMessage {
  type: 'tables_list';
  payload: {
    buildingId: string;
    connectionId: string;
    database: string;
    tables: TableInfo[];
  };
}

// ============================================================================
// Message Union Types
// ============================================================================

export type ServerMessage =
  | AgentsUpdateMessage
  | AgentCreatedMessage
  | AgentUpdatedMessage
  | AgentDeletedMessage
  | EventMessage
  | ActivityMessage
  | OutputMessage
  | ErrorMessage
  | DirectoryNotFoundMessage
  | CommandStartedMessage
  | SessionUpdatedMessage
  | SupervisorReportMessage
  | SupervisorStatusMessage
  | NarrativeUpdateMessage
  | AgentSupervisorHistoryMessage
  | AgentAnalysisMessage
  | AreasUpdateMessage
  | BuildingsUpdateMessage
  | BuildingCreatedMessage
  | BuildingUpdatedMessage
  | BuildingDeletedMessage
  | BuildingLogsMessage
  | PermissionRequestMessage
  | PermissionResolvedMessage
  | DelegationDecisionMessage
  | BossSubordinatesUpdatedMessage
  | DelegationHistoryMessage
  | BossSpawnedAgentMessage
  | AgentTaskStartedMessage
  | AgentTaskOutputMessage
  | AgentTaskCompletedMessage
  | SkillsUpdateMessage
  | SkillCreatedMessage
  | SkillUpdatedMessage
  | SkillDeletedMessage
  | AgentSkillsMessage
  | CustomAgentClassesUpdateMessage
  | CustomAgentClassCreatedMessage
  | CustomAgentClassUpdatedMessage
  | CustomAgentClassDeletedMessage
  | ContextStatsMessage
  | WorkPlanCreatedMessage
  | WorkPlanUpdatedMessage
  | WorkPlanDeletedMessage
  | WorkPlansUpdateMessage
  | AnalysisRequestCreatedMessage
  | AnalysisRequestCompletedMessage
  | GlobalUsageMessage
  | AgentNotificationMessage
  | ExecTaskStartedMessage
  | ExecTaskOutputMessage
  | ExecTaskCompletedMessage
  | SecretsUpdateMessage
  | SecretCreatedMessage
  | SecretUpdatedMessage
  | SecretDeletedMessage
  | PM2LogsChunkMessage
  | PM2LogsStreamingMessage
  | DockerLogsChunkMessage
  | DockerLogsStreamingMessage
  | DockerContainersListMessage
  | BossBuildingLogsChunkMessage
  | BossBuildingSubordinatesUpdatedMessage
  | DatabaseConnectionResultMessage
  | DatabasesListMessage
  | QueryResultMessage
  | QueryHistoryUpdateMessage
  | TableSchemaMessage
  | TablesListMessage
  | SnapshotsUpdateMessage
  | SnapshotCreatedMessage
  | SnapshotDeletedMessage
  | SnapshotDetailsMessage
  | SnapshotRestoredMessage
  | SubagentStartedMessage
  | SubagentOutputMessage
  | SubagentCompletedMessage;

export type ClientMessage =
  | SpawnAgentMessage
  | SendCommandMessage
  | ReattachAgentMessage
  | MoveAgentMessage
  | KillAgentMessage
  | StopAgentMessage
  | ClearContextMessage
  | CollapseContextMessage
  | CreateDirectoryMessage
  | RemoveAgentMessage
  | RenameAgentMessage
  | UpdateAgentPropertiesMessage
  | SetSupervisorConfigMessage
  | RequestSupervisorReportMessage
  | RequestAgentSupervisorHistoryMessage
  | SyncAreasMessage
  | SyncBuildingsMessage
  | CreateBuildingMessage
  | UpdateBuildingMessage
  | DeleteBuildingMessage
  | BuildingCommandMessage
  | PM2LogsStartMessage
  | PM2LogsStopMessage
  | DockerLogsStartMessage
  | DockerLogsStopMessage
  | DockerListContainersMessage
  | PermissionResponseMessage
  | SpawnBossAgentMessage
  | AssignSubordinatesMessage
  | RemoveSubordinateMessage
  | SendBossCommandMessage
  | RequestDelegationHistoryMessage
  | CreateSkillMessage
  | UpdateSkillMessage
  | DeleteSkillMessage
  | AssignSkillMessage
  | UnassignSkillMessage
  | RequestAgentSkillsMessage
  | CreateCustomAgentClassMessage
  | UpdateCustomAgentClassMessage
  | DeleteCustomAgentClassMessage
  | RequestContextStatsMessage
  | ApproveWorkPlanMessage
  | ExecuteWorkPlanMessage
  | PauseWorkPlanMessage
  | CancelWorkPlanMessage
  | RequestWorkPlansMessage
  | RequestGlobalUsageMessage
  | SendNotificationMessage
  | CreateSecretMessage
  | UpdateSecretMessage
  | DeleteSecretMessage
  | BossBuildingCommandMessage
  | AssignBuildingsMessage
  | BossBuildingLogsStartMessage
  | BossBuildingLogsStopMessage
  | TestDatabaseConnectionMessage
  | ListDatabasesMessage
  | ExecuteQueryMessage
  | RequestQueryHistoryMessage
  | ToggleQueryFavoriteMessage
  | DeleteQueryHistoryMessage
  | ClearQueryHistoryMessage
  | GetTableSchemaMessage
  | ListTablesMessage
  | RequestSnapshotsMessage
  | RequestSnapshotDetailsMessage
  | CreateSnapshotMessage
  | DeleteSnapshotMessage
  | RestoreSnapshotMessage;
