import type { Agent, ServerMessage, ClientMessage, PermissionRequest, DelegationDecision, CustomAgentClass, AgentNotification, Subagent } from '../../shared/types';
import { store } from '../store';
import { perf } from '../utils/profiling';
import { agentDebugger, debugLog } from '../services/agentDebugger';
import { STORAGE_KEYS, getStorageString, getAuthToken } from '../utils/storage';

// Persist WebSocket state across HMR reloads using window object
// This prevents orphaned connections and ensures we maintain the same socket
interface HmrWebSocketState {
  ws: WebSocket | null;
  isConnecting: boolean;
  reconnectAttempts: number;
  reconnectTimeout: NodeJS.Timeout | null;
}

declare global {
  interface Window {
    __tideWsState?: HmrWebSocketState;
  }
}

// Initialize or restore HMR state
if (!window.__tideWsState) {
  window.__tideWsState = {
    ws: null,
    isConnecting: false,
    reconnectAttempts: 0,
    reconnectTimeout: null,
  };
}

// Use window state instead of module-level variables for HMR persistence
const getWs = () => window.__tideWsState!.ws;
const setWs = (socket: WebSocket | null) => { window.__tideWsState!.ws = socket; };
const getIsConnecting = () => window.__tideWsState!.isConnecting;
const setIsConnecting = (v: boolean) => { window.__tideWsState!.isConnecting = v; };
const getReconnectAttempts = () => window.__tideWsState!.reconnectAttempts;
const setReconnectAttempts = (v: number) => { window.__tideWsState!.reconnectAttempts = v; };
const getReconnectTimeout = () => window.__tideWsState!.reconnectTimeout;
const setReconnectTimeout = (v: NodeJS.Timeout | null) => { window.__tideWsState!.reconnectTimeout = v; };

const maxReconnectAttempts = 10;

// Track if we've added the beforeunload listener
let beforeUnloadListenerAdded = false;

// Clean up WebSocket on page unload (actual refresh/close, not HMR)
function handleBeforeUnload(): void {
  const ws = getWs();
  if (ws && ws.readyState === WebSocket.OPEN) {
    // Use synchronous close to ensure it happens before page unload
    ws.close(1000, 'Page unloading');
  }
  // Clear reconnect timeout to prevent reconnection attempts
  const timeout = getReconnectTimeout();
  if (timeout) {
    clearTimeout(timeout);
  }
  // Clear all WebSocket state to allow GC
  if (window.__tideWsState) {
    window.__tideWsState.ws = null;
    window.__tideWsState.reconnectTimeout = null;
    window.__tideWsState.isConnecting = false;
    window.__tideWsState.reconnectAttempts = 0;
  }
  // Clear session storage flag to prevent stale reconnection state on refresh
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

// Add beforeunload listener once (idempotent)
function ensureBeforeUnloadListener(): void {
  if (!beforeUnloadListenerAdded) {
    window.addEventListener('beforeunload', handleBeforeUnload);
    beforeUnloadListenerAdded = true;
  }
}

// Export disconnect for manual cleanup
export function disconnect(): void {
  handleBeforeUnload();
  store.setConnected(false);
  store.stopStatusPolling();
}

// Reconnect with potentially new backend URL
export function reconnect(): void {
  disconnect();
  setReconnectAttempts(0);
  // Small delay to ensure clean disconnect
  setTimeout(() => connect(), 100);
}

// Use sessionStorage to persist connection state across HMR reloads
// This ensures we detect reconnections even when the frontend code reloads
const SESSION_STORAGE_KEY = 'tide_ws_has_connected';
function getHasConnectedBefore(): boolean {
  return sessionStorage.getItem(SESSION_STORAGE_KEY) === 'true';
}
function setHasConnectedBefore(value: boolean): void {
  sessionStorage.setItem(SESSION_STORAGE_KEY, value ? 'true' : 'false');
}
let onToast: ((type: 'error' | 'success' | 'warning' | 'info', title: string, message: string) => void) | null = null;
let onAgentCreated: ((agent: Agent) => void) | null = null;
let onAgentUpdated: ((agent: Agent, positionChanged: boolean) => void) | null = null;
let onAgentDeleted: ((agentId: string) => void) | null = null;
let onAgentsSync: ((agents: Agent[]) => void) | null = null;
let onAreasSync: (() => void) | null = null; // Called after areas are synced, to re-filter agents for archived areas
let onSpawnError: (() => void) | null = null;
let onSpawnSuccess: (() => void) | null = null;
let onToolUse: ((agentId: string, toolName: string, toolInput?: Record<string, unknown>) => void) | null = null;
let onDirectoryNotFound: ((path: string) => void) | null = null;
let onDelegation: ((bossId: string, subordinateId: string) => void) | null = null;
let onCustomClassesSync: ((classes: Map<string, CustomAgentClass>) => void) | null = null;
let onReconnect: (() => void) | null = null;
let onAgentNotification: ((notification: AgentNotification) => void) | null = null;
let onBuildingUpdated: ((building: import('../../shared/types').Building) => void) | null = null;
let onSubagentStarted: ((subagent: Subagent) => void) | null = null;
let onSubagentCompleted: ((subagentId: string) => void) | null = null;

export function setCallbacks(callbacks: {
  onToast?: typeof onToast;
  onAgentCreated?: typeof onAgentCreated;
  onAgentUpdated?: typeof onAgentUpdated;
  onAgentDeleted?: typeof onAgentDeleted;
  onAgentsSync?: typeof onAgentsSync;
  onAreasSync?: typeof onAreasSync;
  onSpawnError?: typeof onSpawnError;
  onSpawnSuccess?: typeof onSpawnSuccess;
  onToolUse?: typeof onToolUse;
  onDirectoryNotFound?: typeof onDirectoryNotFound;
  onDelegation?: typeof onDelegation;
  onCustomClassesSync?: typeof onCustomClassesSync;
  onReconnect?: typeof onReconnect;
  onAgentNotification?: typeof onAgentNotification;
  onBuildingUpdated?: typeof onBuildingUpdated;
  onSubagentStarted?: typeof onSubagentStarted;
  onSubagentCompleted?: typeof onSubagentCompleted;
}): void {
  if (callbacks.onToast) onToast = callbacks.onToast;
  if (callbacks.onAgentCreated) onAgentCreated = callbacks.onAgentCreated;
  if (callbacks.onAgentUpdated) onAgentUpdated = callbacks.onAgentUpdated;
  if (callbacks.onAgentDeleted) onAgentDeleted = callbacks.onAgentDeleted;
  if (callbacks.onAgentsSync) onAgentsSync = callbacks.onAgentsSync;
  if (callbacks.onAreasSync) onAreasSync = callbacks.onAreasSync;
  if (callbacks.onSpawnError) onSpawnError = callbacks.onSpawnError;
  if (callbacks.onSpawnSuccess) onSpawnSuccess = callbacks.onSpawnSuccess;
  if (callbacks.onToolUse) onToolUse = callbacks.onToolUse;
  if (callbacks.onDirectoryNotFound) onDirectoryNotFound = callbacks.onDirectoryNotFound;
  if (callbacks.onDelegation) onDelegation = callbacks.onDelegation;
  if (callbacks.onCustomClassesSync) onCustomClassesSync = callbacks.onCustomClassesSync;
  if (callbacks.onReconnect) onReconnect = callbacks.onReconnect;
  if (callbacks.onAgentNotification) onAgentNotification = callbacks.onAgentNotification;
  if (callbacks.onBuildingUpdated) onBuildingUpdated = callbacks.onBuildingUpdated;
  if (callbacks.onSubagentStarted) onSubagentStarted = callbacks.onSubagentStarted;
  if (callbacks.onSubagentCompleted) onSubagentCompleted = callbacks.onSubagentCompleted;
}

/**
 * Clear all callbacks to prevent memory leaks on page unload.
 * This breaks reference chains that could keep React components alive.
 */
export function clearCallbacks(): void {
  onToast = null;
  onAgentCreated = null;
  onAgentUpdated = null;
  onAgentDeleted = null;
  onAgentsSync = null;
  onAreasSync = null;
  onSpawnError = null;
  onSpawnSuccess = null;
  onToolUse = null;
  onDirectoryNotFound = null;
  onDelegation = null;
  onCustomClassesSync = null;
  onReconnect = null;
  onAgentNotification = null;
  onSubagentStarted = null;
  onSubagentCompleted = null;
}

/**
 * Clear only scene-specific callbacks (for 3D scene disposal when switching to 2D mode).
 * Preserves toast, reconnect, and notification callbacks that are still needed.
 */
export function clearSceneCallbacks(): void {
  onAgentCreated = null;
  onAgentUpdated = null;
  onAgentDeleted = null;
  onAgentsSync = null;
  onAreasSync = null;
  onToolUse = null;
  onDelegation = null;
  onCustomClassesSync = null;
  onBuildingUpdated = null;
  onSubagentStarted = null;
  onSubagentCompleted = null;
}

export function connect(): void {
  // Ensure we have a beforeunload listener to clean up on page refresh
  ensureBeforeUnloadListener();

  // Clear any pending reconnect
  const pendingTimeout = getReconnectTimeout();
  if (pendingTimeout) {
    clearTimeout(pendingTimeout);
    setReconnectTimeout(null);
  }

  const ws = getWs();

  // Prevent duplicate connection attempts
  if (getIsConnecting() || (ws && ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    // Even if socket is already open (e.g., after HMR), trigger reconnect callback
    // to ensure components refresh their data
    if (getHasConnectedBefore() && onReconnect) {
      onReconnect();
    }
    return;
  }

  setReconnectAttempts(getReconnectAttempts() + 1);
  setIsConnecting(true);

  // Get configured backend URL or use defaults
  const configuredUrl = getStorageString(STORAGE_KEYS.BACKEND_URL, '');
  const authToken = getAuthToken();

  // Build WebSocket URL - use configured URL or default to localhost with server port
  // __SERVER_PORT__ is injected by Vite from the PORT env variable (defaults to 5174)
  const defaultPort = typeof __SERVER_PORT__ !== 'undefined' ? __SERVER_PORT__ : 5174;
  let wsUrl: string;
  if (configuredUrl) {
    // User has configured a custom backend URL
    // Convert http(s):// to ws(s):// if needed
    const wsConfigured = configuredUrl
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://');
    // Ensure it ends with /ws
    wsUrl = wsConfigured.endsWith('/ws') ? wsConfigured : `${wsConfigured.replace(/\/$/, '')}/ws`;
  } else {
    // Default: connect directly to backend on the configured server port
    wsUrl = `ws://127.0.0.1:${defaultPort}/ws`;
  }

  let newSocket: WebSocket | null = null;
  try {
    // Use Sec-WebSocket-Protocol header for auth token (more secure than URL query param)
    // Format: auth-<token> - server extracts token by removing 'auth-' prefix
    if (authToken) {
      newSocket = new WebSocket(wsUrl, [`auth-${authToken}`]);
    } else {
      newSocket = new WebSocket(wsUrl);
    }
  } catch {
    setIsConnecting(false);
    handleReconnect();
    return;
  }

  setWs(newSocket);

  newSocket.onopen = () => {
    const hasConnectedBefore = getHasConnectedBefore();
    const isReconnection = hasConnectedBefore;
    setIsConnecting(false);
    setReconnectAttempts(0); // Reset on successful connection
    setHasConnectedBefore(true); // Mark that we've connected at least once (persisted in sessionStorage)
    store.setConnected(true);
    // Start status polling as fallback for missed WebSocket updates
    store.startStatusPolling();

    // Clear stale permissions - server will send fresh list of pending permissions
    store.clearAllPermissions();

    if (isReconnection) {
      onToast?.('success', 'Reconnected', 'Connection restored - refreshing data...');
      // Trigger reconnection callback to refresh history and re-establish listeners
      onReconnect?.();
    } else {
      onToast?.('success', 'Connected', 'Connected to Tide Commander server');
    }
  };

  newSocket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data) as ServerMessage;

      // Capture for agent-specific debugger if message has agentId
      const isDebuggerEnabled = agentDebugger.isEnabled();
      if (isDebuggerEnabled) {
        const agentId = extractAgentId(message);
        console.log('[AgentDebugger] RECEIVED - type:', message.type, 'agentId:', agentId, 'payload:', message.payload);
        if (agentId) {
          agentDebugger.captureReceived(agentId, event.data);
        }
      }

      handleServerMessage(message);
    } catch (err) {
      // Log the malformed data to debug message contamination issues
      const preview = event.data.substring(0, 200);
      console.error(`[WS] Failed to parse message:`, err);
      console.error(`[WS] Raw data (first 200 chars):`, preview);
      console.error(`[WS] Full data length:`, event.data.length);
      // Only log full data if it's not too large
      if (event.data.length < 5000) {
        console.error(`[WS] Full malformed message:`, event.data);
      }
    }
  };

  newSocket.onclose = () => {
    setIsConnecting(false);
    setWs(null);
    store.setConnected(false);
    store.stopStatusPolling();

    const attempts = getReconnectAttempts();
    if (attempts < maxReconnectAttempts) {
      onToast?.('warning', 'Disconnected', `Connection lost. Reconnecting... (attempt ${attempts + 1}/${maxReconnectAttempts})`);
      handleReconnect();
    } else {
      onToast?.('error', 'Connection Failed', `Could not connect to server. Please check if the backend is running on port ${defaultPort}.`);
    }
  };

  newSocket.onerror = () => {
    setIsConnecting(false);
  };

  // Set up store to use this connection
  store.setSendMessage(sendMessage);
}

function handleServerMessage(message: ServerMessage): void {
  perf.start(`ws:${message.type}`);

  switch (message.type) {
    case 'agents_update': {
      const agentList = message.payload as Agent[];
      // Debug: log boss agents with their subordinateIds
      const bossAgents = agentList.filter(a => a.class === 'boss' || a.isBoss);
      if (bossAgents.length > 0) {
        console.log('[WS agents_update] Boss agents received:', bossAgents.map(b => ({
          id: b.id,
          name: b.name,
          subordinateIds: b.subordinateIds,
        })));
      }
      store.setAgents(agentList);
      onAgentsSync?.(agentList);
      // Load tool history after agents are synced
      store.loadToolHistory();
      break;
    }

    case 'agent_created': {
      const newAgent = message.payload as Agent;
      console.log('[WebSocket] Agent created:', newAgent);
      store.addAgent(newAgent);
      store.selectAgent(newAgent.id);
      onAgentCreated?.(newAgent);
      onSpawnSuccess?.();

      // Call global handler if it exists (for SpawnModal)
      if ((window as any).__spawnModalSuccess) {
        console.log('[WebSocket] Calling __spawnModalSuccess');
        (window as any).__spawnModalSuccess();
      }

      onToast?.('success', 'Agent Deployed', `${newAgent.name} is ready for commands`);
      break;
    }

    case 'agent_updated': {
      const updatedAgent = message.payload as Agent;
      const state = store.getState();
      const previousAgent = state.agents.get(updatedAgent.id);

      const statusChanged = previousAgent?.status !== updatedAgent.status;
      console.log(`[Tide] Agent updated: ${updatedAgent.name} (${updatedAgent.id}) status=${updatedAgent.status} (was ${previousAgent?.status})${statusChanged ? ' ⚡ STATUS CHANGED' : ''}`);

      if (statusChanged) {
        console.log(`[Tide] 🔔 Status change for ${updatedAgent.name}: ${previousAgent?.status} → ${updatedAgent.status}`);
      }

      const positionChanged = previousAgent
        ? previousAgent.position.x !== updatedAgent.position.x ||
          previousAgent.position.z !== updatedAgent.position.z
        : false;

      store.updateAgent(updatedAgent);
      onAgentUpdated?.(updatedAgent, positionChanged);
      break;
    }

    case 'agent_deleted': {
      const { id } = message.payload as { id: string };
      store.removeAgent(id);
      onAgentDeleted?.(id);
      break;
    }

    case 'activity': {
      const activity = message.payload as {
        agentId: string;
        agentName: string;
        message: string;
        timestamp: number;
      };
      store.addActivity(activity);
      break;
    }

    case 'event': {
      // Claude event - trigger visual effects and track tools
      const event = message.payload as {
        agentId: string;
        type: string;
        toolName?: string;
        toolInput?: Record<string, unknown>;
      };
      debugLog.debug(`Event: ${event.type}`, {
        agentId: event.agentId,
        toolName: event.toolName,
      }, 'ws:event');
      if (event.type === 'tool_start' && event.toolName) {
        onToolUse?.(event.agentId, event.toolName, event.toolInput);
        // Track tool execution with input
        store.addToolExecution(event.agentId, event.toolName, event.toolInput);
        // Track file changes from file-related tools
        if (event.toolInput) {
          const filePath = (event.toolInput.file_path || event.toolInput.path) as string | undefined;
          if (filePath) {
            if (event.toolName === 'Write') {
              store.addFileChange(event.agentId, 'created', filePath);
            } else if (event.toolName === 'Edit') {
              store.addFileChange(event.agentId, 'modified', filePath);
            } else if (event.toolName === 'Read') {
              store.addFileChange(event.agentId, 'read', filePath);
            }
          }
        }
      }
      break;
    }

    case 'output': {
      // Streaming output from Claude - goes to dedicated output store
      const output = message.payload as {
        agentId: string;
        text: string;
        isStreaming: boolean;
        timestamp: number;
        isDelegation?: boolean;
        skillUpdate?: import('../../shared/types').SkillUpdateData;
        subagentName?: string;
        uuid?: string;
        toolName?: string;
        toolInput?: Record<string, unknown>;
        toolInputRaw?: string;
        toolOutput?: string;
      };
      debugLog.debug(`Output: "${output.text.slice(0, 80)}..."`, {
        agentId: output.agentId,
        isStreaming: output.isStreaming,
        length: output.text.length,
        hasSkillUpdate: !!output.skillUpdate,
        uuid: output.uuid,
        toolName: output.toolName,
      }, 'ws:output');
      store.addOutput(output.agentId, {
        text: output.text,
        isStreaming: output.isStreaming,
        timestamp: output.timestamp,
        isDelegation: output.isDelegation,
        skillUpdate: output.skillUpdate,
        subagentName: output.subagentName,
        uuid: output.uuid,
        toolName: output.toolName,
        toolInput: output.toolInput,
        toolOutput: output.toolOutput,
      });
      break;
    }

    case 'context_stats': {
      // Context stats from /context command
      const { agentId, stats } = message.payload as {
        agentId: string;
        stats: import('../../shared/types').ContextStats;
      };
      console.log(`[Tide] Received context stats for agent ${agentId}: ${stats.usedPercent}% used`);
      store.updateAgentContextStats(agentId, stats);
      break;
    }

    case 'error': {
      const errorPayload = message.payload as { message: string };
      console.error('[WebSocket] Error from server:', errorPayload.message);
      onToast?.('error', 'Error', errorPayload.message);
      onSpawnError?.();

      // Call global handler if it exists (for SpawnModal)
      if ((window as any).__spawnModalError) {
        console.log('[WebSocket] Calling __spawnModalError');
        (window as any).__spawnModalError();
      }
      break;
    }

    case 'directory_not_found': {
      const { path } = message.payload as { path: string };
      console.log('[WebSocket] Directory not found:', path);
      onDirectoryNotFound?.(path);

      // Call global handler if it exists (for SpawnModal)
      if ((window as any).__spawnModalDirNotFound) {
        console.log('[WebSocket] Calling __spawnModalDirNotFound');
        (window as any).__spawnModalDirNotFound(path);
      }
      break;
    }

    case 'command_started': {
      const { agentId, command } = message.payload as {
        agentId: string;
        command: string;
      };
      // Skip adding utility slash commands to output (they're handled specially)
      const trimmedCommand = command.trim();
      if (trimmedCommand === '/context' || trimmedCommand === '/cost' || trimmedCommand === '/compact') {
        break;
      }
      // Add user prompt to output when command actually starts executing
      store.addUserPromptToOutput(agentId, command);
      break;
    }

    case 'session_updated': {
      // An orphaned agent's session file was updated - refresh its history
      const { agentId } = message.payload as { agentId: string };
      // Reload the tool history to get the latest updates from the detached process
      store.loadToolHistory();
      // Also update the agent to trigger a UI refresh
      const agent = store.getState().agents.get(agentId);
      if (agent) {
        store.updateAgent({ ...agent });
      }
      break;
    }

    case 'supervisor_report': {
      const report = message.payload as import('../../shared/types').SupervisorReport;
      store.setSupervisorReport(report);
      break;
    }

    case 'narrative_update': {
      const { agentId, narrative } = message.payload as {
        agentId: string;
        narrative: import('../../shared/types').ActivityNarrative;
      };
      store.addNarrative(agentId, narrative);
      break;
    }

    case 'supervisor_status': {
      const status = message.payload as {
        enabled: boolean;
        autoReportOnComplete?: boolean;
        lastReportTime: number | null;
        nextReportTime: number | null;
      };
      store.setSupervisorStatus(status);
      break;
    }

    case 'agent_supervisor_history': {
      const history = message.payload as import('../../shared/types').AgentSupervisorHistory;
      store.setAgentSupervisorHistory(history);
      break;
    }

    case 'agent_analysis': {
      const { agentId, analysis } = message.payload as {
        agentId: string;
        analysis: import('../../shared/types').AgentAnalysis;
      };
      store.addAgentAnalysis(agentId, analysis);
      break;
    }

    case 'areas_update': {
      const areasArray = message.payload as import('../../shared/types').DrawingArea[];
      store.setAreasFromServer(areasArray);
      // Notify scene to re-sync agents (to filter out those in archived areas)
      onAreasSync?.();
      break;
    }

    case 'buildings_update': {
      const buildingsArray = message.payload as import('../../shared/types').Building[];
      store.setBuildingsFromServer(buildingsArray);
      break;
    }

    case 'building_created': {
      const building = message.payload as import('../../shared/types').Building;
      store.addBuilding(building);
      break;
    }

    case 'building_updated': {
      const building = message.payload as import('../../shared/types').Building;
      store.updateBuildingFromServer(building);
      onBuildingUpdated?.(building);
      break;
    }

    case 'building_deleted': {
      const { id } = message.payload as { id: string };
      store.removeBuildingFromServer(id);
      break;
    }

    case 'building_logs': {
      const { buildingId, logs } = message.payload as {
        buildingId: string;
        logs: string;
        timestamp: number;
      };
      store.addBuildingLogs(buildingId, logs);
      break;
    }

    case 'pm2_logs_chunk': {
      const { buildingId, chunk } = message.payload as {
        buildingId: string;
        chunk: string;
        timestamp: number;
        isError?: boolean;
      };
      store.appendStreamingLogChunk(buildingId, chunk);
      break;
    }

    case 'pm2_logs_streaming': {
      const { buildingId, streaming } = message.payload as {
        buildingId: string;
        streaming: boolean;
      };
      store.setStreamingStatus(buildingId, streaming);
      break;
    }

    // ========================================================================
    // Docker Log Streaming Messages
    // ========================================================================

    case 'docker_logs_chunk': {
      const { buildingId, chunk } = message.payload as {
        buildingId: string;
        chunk: string;
        timestamp: number;
        isError?: boolean;
        service?: string;
      };
      store.appendStreamingLogChunk(buildingId, chunk);
      break;
    }

    case 'docker_logs_streaming': {
      const { buildingId, streaming } = message.payload as {
        buildingId: string;
        streaming: boolean;
      };
      store.setStreamingStatus(buildingId, streaming);
      break;
    }

    case 'docker_containers_list': {
      const { containers, composeProjects } = message.payload as {
        containers: import('../../shared/types').ExistingDockerContainer[];
        composeProjects: import('../../shared/types').ExistingComposeProject[];
      };
      console.log(`[WebSocket] Received ${containers.length} containers, ${composeProjects.length} compose projects`);
      store.setDockerContainersList(containers, composeProjects);
      break;
    }

    // ========================================================================
    // Boss Building Messages
    // ========================================================================

    case 'boss_building_logs_chunk': {
      const { bossBuildingId, subordinateBuildingId, subordinateBuildingName, chunk, isError } = message.payload as {
        bossBuildingId: string;
        subordinateBuildingId: string;
        subordinateBuildingName: string;
        chunk: string;
        timestamp: number;
        isError?: boolean;
      };
      store.appendBossStreamingLogChunk(bossBuildingId, subordinateBuildingId, subordinateBuildingName, chunk, isError);
      break;
    }

    case 'boss_building_subordinates_updated': {
      const { bossBuildingId, subordinateBuildingIds } = message.payload as {
        bossBuildingId: string;
        subordinateBuildingIds: string[];
      };
      // Update the building's subordinateBuildingIds
      store.updateBuilding(bossBuildingId, { subordinateBuildingIds });
      break;
    }

    case 'permission_request': {
      const request = message.payload as PermissionRequest;
      store.addPermissionRequest(request);
      break;
    }

    case 'permission_resolved': {
      const { requestId, approved } = message.payload as {
        requestId: string;
        approved: boolean;
      };
      store.resolvePermissionRequest(requestId, approved);
      break;
    }

    // ========================================================================
    // Boss Agent Messages
    // ========================================================================

    case 'delegation_decision': {
      const decision = message.payload as DelegationDecision;
      store.handleDelegationDecision(decision);
      // Show toast for the delegation
      if (decision.status === 'sent') {
        onToast?.('info', 'Task Delegated', `Delegated to ${decision.selectedAgentName}: ${decision.reasoning.slice(0, 80)}...`);

        // Trigger delegation animation (paper flying from boss to subordinate)
        if (decision.bossId && decision.selectedAgentId) {
          onDelegation?.(decision.bossId, decision.selectedAgentId);
        }

        // NOTE: Auto-forward is now handled by the backend to prevent duplicate commands
        // when multiple clients are connected
      }
      break;
    }

    case 'boss_subordinates_updated': {
      const { bossId, subordinateIds } = message.payload as {
        bossId: string;
        subordinateIds: string[];
      };
      store.updateBossSubordinates(bossId, subordinateIds);
      break;
    }

    case 'delegation_history': {
      const { bossId, decisions } = message.payload as {
        bossId: string;
        decisions: DelegationDecision[];
      };
      store.setDelegationHistory(bossId, decisions);
      break;
    }

    case 'boss_spawned_agent': {
      // Boss spawned a subordinate agent - do NOT auto-select, walk to boss position
      const { agent, bossPosition } = message.payload as {
        agent: Agent;
        bossId: string;
        bossPosition: { x: number; y: number; z: number };
      };
      console.log('[WebSocket] Boss spawned agent:', agent.name, '- walking to boss at', bossPosition);

      // Add agent without selecting it
      store.addAgent(agent);
      onAgentCreated?.(agent);

      // Issue move command to walk toward boss position
      sendMessage({
        type: 'move_agent',
        payload: {
          agentId: agent.id,
          position: bossPosition,
        },
      });

      onToast?.('success', 'Agent Deployed', `${agent.name} spawned by boss, walking to position`);
      break;
    }

    case 'agent_task_started': {
      const { bossId, subordinateId, subordinateName, taskDescription } = message.payload as {
        bossId: string;
        subordinateId: string;
        subordinateName: string;
        taskDescription: string;
      };
      console.log(`[WebSocket] Agent ${subordinateName} started task for boss ${bossId}: ${taskDescription.slice(0, 50)}...`);
      store.handleAgentTaskStarted(bossId, subordinateId, subordinateName, taskDescription);
      break;
    }

    case 'agent_task_output': {
      const { bossId, subordinateId, output } = message.payload as {
        bossId: string;
        subordinateId: string;
        output: string;
      };
      store.handleAgentTaskOutput(bossId, subordinateId, output);
      break;
    }

    case 'agent_task_completed': {
      const { bossId, subordinateId, success } = message.payload as {
        bossId: string;
        subordinateId: string;
        success: boolean;
      };
      console.log(`[WebSocket] Agent task completed for boss ${bossId}, subordinate ${subordinateId}, success: ${success}`);
      store.handleAgentTaskCompleted(bossId, subordinateId, success);
      break;
    }

    // ========================================================================
    // Skill Messages
    // ========================================================================

    case 'skills_update': {
      const skillsArray = message.payload as import('../../shared/types').Skill[];
      store.setSkillsFromServer(skillsArray);
      break;
    }

    case 'skill_created': {
      const skill = message.payload as import('../../shared/types').Skill;
      store.addSkillFromServer(skill);
      console.log(`[WebSocket] Skill created: ${skill.name}`);
      break;
    }

    case 'skill_updated': {
      const skill = message.payload as import('../../shared/types').Skill;
      store.updateSkillFromServer(skill);
      console.log(`[WebSocket] Skill updated: ${skill.name}`);
      break;
    }

    case 'skill_deleted': {
      const { id } = message.payload as { id: string };
      store.removeSkillFromServer(id);
      console.log(`[WebSocket] Skill deleted: ${id}`);
      break;
    }

    case 'agent_skills': {
      // Response to request_agent_skills - currently just logged, could be used for validation
      const { agentId, skills } = message.payload as {
        agentId: string;
        skills: import('../../shared/types').Skill[];
      };
      console.log(`[WebSocket] Agent ${agentId} has ${skills.length} skills`);
      break;
    }

    // ========================================================================
    // Custom Agent Class Messages
    // ========================================================================

    case 'custom_agent_classes_update': {
      const classesArray = message.payload as import('../../shared/types').CustomAgentClass[];
      store.setCustomAgentClassesFromServer(classesArray);
      console.log(`[WebSocket] Received ${classesArray.length} custom agent classes`);
      // Notify scene to update custom classes for model lookups
      const classesMap = new Map<string, CustomAgentClass>();
      for (const c of classesArray) {
        classesMap.set(c.id, c);
      }
      onCustomClassesSync?.(classesMap);
      break;
    }

    case 'custom_agent_class_created': {
      const customClass = message.payload as import('../../shared/types').CustomAgentClass;
      store.addCustomAgentClassFromServer(customClass);
      console.log(`[WebSocket] Custom agent class created: ${customClass.name}`);
      // Update scene with new custom classes
      onCustomClassesSync?.(store.getState().customAgentClasses);
      break;
    }

    case 'custom_agent_class_updated': {
      const customClass = message.payload as import('../../shared/types').CustomAgentClass;
      store.updateCustomAgentClassFromServer(customClass);
      console.log(`[WebSocket] Custom agent class updated: ${customClass.name}`);
      // Update scene with updated custom classes
      onCustomClassesSync?.(store.getState().customAgentClasses);
      break;
    }

    case 'custom_agent_class_deleted': {
      const { id } = message.payload as { id: string };
      store.removeCustomAgentClassFromServer(id);
      console.log(`[WebSocket] Custom agent class deleted: ${id}`);
      // Update scene with remaining custom classes
      onCustomClassesSync?.(store.getState().customAgentClasses);
      break;
    }

    // ========================================================================
    // Global Usage Messages
    // ========================================================================

    case 'global_usage': {
      const usage = message.payload as import('../../shared/types').GlobalUsageStats | null;
      console.log(`[WebSocket] Global usage update:`, usage);
      store.setGlobalUsage(usage);
      break;
    }

    // ========================================================================
    // Agent Notification Messages
    // ========================================================================

    case 'agent_notification': {
      const notification = message.payload as AgentNotification;
      console.log(`[WebSocket] Agent notification from ${notification.agentName}: ${notification.title}`);
      onAgentNotification?.(notification);
      break;
    }

    // ========================================================================
    // Exec Task Messages (Streaming Command Execution)
    // ========================================================================

    case 'exec_task_started': {
      const { taskId, agentId, agentName, command, cwd } = message.payload as {
        taskId: string;
        agentId: string;
        agentName: string;
        command: string;
        cwd: string;
      };
      console.log(`[WebSocket] Exec task started: ${taskId} for agent ${agentName}: ${command.slice(0, 50)}...`);
      store.handleExecTaskStarted(taskId, agentId, agentName, command, cwd);
      break;
    }

    case 'exec_task_output': {
      const { taskId, agentId, output, isError } = message.payload as {
        taskId: string;
        agentId: string;
        output: string;
        isError?: boolean;
      };
      store.handleExecTaskOutput(taskId, agentId, output, isError);
      break;
    }

    case 'exec_task_completed': {
      const { taskId, agentId, exitCode, success } = message.payload as {
        taskId: string;
        agentId: string;
        exitCode: number | null;
        success: boolean;
      };
      console.log(`[WebSocket] Exec task completed: ${taskId} for agent ${agentId}, success: ${success}`);
      store.handleExecTaskCompleted(taskId, agentId, exitCode, success);
      break;
    }

    // ========================================================================
    // Subagent Messages (Claude Code Task tool)
    // ========================================================================

    case 'subagent_started': {
      const subagent = message.payload as Subagent;
      console.log(`[WebSocket] Subagent started: ${subagent.name} (${subagent.id}) for agent ${subagent.parentAgentId}`);
      store.addSubagent(subagent);
      onSubagentStarted?.(subagent);
      // Also add an output line to the parent agent's terminal
      store.addOutput(subagent.parentAgentId, {
        text: `🔀 Spawned subagent: ${subagent.name} (${subagent.subagentType})`,
        isStreaming: false,
        timestamp: subagent.startedAt,
        subagentName: subagent.name,
      });
      break;
    }

    case 'subagent_output': {
      const { subagentId, parentAgentId, text, isStreaming, timestamp } = message.payload as {
        subagentId: string;
        parentAgentId: string;
        text: string;
        isStreaming: boolean;
        timestamp: number;
      };
      // Resolve subagent name for badge display
      const subForOutput = store.getSubagent(subagentId) || store.getSubagentByToolUseId(subagentId);
      const subOutputName = subForOutput?.name || subagentId;
      // Route subagent output to the parent agent's terminal with a prefix
      store.addOutput(parentAgentId, {
        text: `[${subagentId}] ${text}`,
        isStreaming,
        timestamp,
        subagentName: subOutputName,
      });
      break;
    }

    case 'subagent_completed': {
      const { subagentId, parentAgentId, success, resultPreview, subagentName: completedSubName } = message.payload as {
        subagentId: string;
        parentAgentId: string;
        success: boolean;
        resultPreview?: string;
        subagentName?: string;
      };
      console.log(`[WebSocket] Subagent completed: ${subagentId} for agent ${parentAgentId}, success: ${success}`);
      store.completeSubagent(subagentId, parentAgentId, success);
      onSubagentCompleted?.(subagentId);
      // Resolve name: prefer server-provided name, then store lookup, then ID
      const sub = store.getSubagent(subagentId) || store.getSubagentByToolUseId(subagentId);
      const subName = completedSubName || sub?.name || subagentId;
      const statusEmoji = success ? '✅' : '❌';
      const preview = resultPreview ? `: ${resultPreview.slice(0, 100)}` : '';
      store.addOutput(parentAgentId, {
        text: `${statusEmoji} Subagent ${subName} ${success ? 'completed' : 'failed'}${preview}`,
        isStreaming: false,
        timestamp: Date.now(),
        subagentName: subName,
      });
      break;
    }

    // ========================================================================
    // Secrets Messages
    // ========================================================================

    case 'secrets_update': {
      const secretsArray = message.payload as import('../../shared/types').Secret[];
      store.setSecretsFromServer(secretsArray);
      console.log(`[WebSocket] Received ${secretsArray.length} secrets`);
      break;
    }

    case 'secret_created': {
      const secret = message.payload as import('../../shared/types').Secret;
      store.addSecretFromServer(secret);
      console.log(`[WebSocket] Secret created: ${secret.name}`);
      break;
    }

    case 'secret_updated': {
      const secret = message.payload as import('../../shared/types').Secret;
      store.updateSecretFromServer(secret);
      console.log(`[WebSocket] Secret updated: ${secret.name}`);
      break;
    }

    case 'secret_deleted': {
      const { id } = message.payload as { id: string };
      store.removeSecretFromServer(id);
      console.log(`[WebSocket] Secret deleted: ${id}`);
      break;
    }

    // ========================================================================
    // Database Messages
    // ========================================================================

    case 'database_connection_result': {
      const { buildingId, connectionId, success, error, serverVersion } = message.payload as {
        buildingId: string;
        connectionId: string;
        success: boolean;
        error?: string;
        serverVersion?: string;
      };
      store.setConnectionStatus(buildingId, connectionId, { connected: success, error, serverVersion });
      console.log(`[WebSocket] Database connection ${success ? 'succeeded' : 'failed'}: ${connectionId}`);
      break;
    }

    case 'databases_list': {
      const { buildingId, connectionId, databases } = message.payload as {
        buildingId: string;
        connectionId: string;
        databases: string[];
      };
      store.setDatabases(buildingId, connectionId, databases);
      console.log(`[WebSocket] Received ${databases.length} databases for ${connectionId}`);
      break;
    }

    case 'tables_list': {
      const { buildingId, connectionId, database, tables } = message.payload as {
        buildingId: string;
        connectionId: string;
        database: string;
        tables: import('../../shared/types').TableInfo[];
      };
      store.setTables(buildingId, connectionId, database, tables);
      console.log(`[WebSocket] Received ${tables.length} tables for ${database}`);
      break;
    }

    case 'table_schema': {
      const { buildingId, connectionId, database, table, columns, indexes, foreignKeys } = message.payload as {
        buildingId: string;
        connectionId: string;
        database: string;
        table: string;
        columns: import('../../shared/types').TableColumn[];
        indexes?: import('../../shared/types').TableIndex[];
        foreignKeys?: import('../../shared/types').ForeignKey[];
      };
      store.setTableSchema(buildingId, connectionId, database, table, { columns, indexes: indexes || [], foreignKeys: foreignKeys || [] });
      console.log(`[WebSocket] Received schema for ${table}`);
      break;
    }

    case 'query_result': {
      const { buildingId, result } = message.payload as {
        buildingId: string;
        result: import('../../shared/types').QueryResult;
      };
      store.setQueryResult(buildingId, result);
      console.log(`[WebSocket] Query ${result.status}: ${result.rowCount ?? result.affectedRows ?? 0} rows in ${result.duration}ms`);
      break;
    }

    case 'query_history_update': {
      const { buildingId, history } = message.payload as {
        buildingId: string;
        history: import('../../shared/types').QueryHistoryEntry[];
      };
      store.setQueryHistory(buildingId, history);
      console.log(`[WebSocket] Received ${history.length} query history entries for ${buildingId}`);
      break;
    }

  }

  perf.end(`ws:${message.type}`);
}

// Helper function to handle reconnection
function handleReconnect(): void {
  const attempts = getReconnectAttempts();
  const delay = Math.min(1000 * Math.pow(2, attempts - 1), 30000); // Exponential backoff, max 30s
  setReconnectTimeout(setTimeout(connect, delay));
}

/**
 * Extract agentId from a message payload
 */
function extractAgentId(message: ServerMessage | ClientMessage): string | null {
  // Check if payload has agentId
  if (message.payload && typeof message.payload === 'object') {
    const payload = message.payload as any;
    if (payload.agentId) return payload.agentId;
    if (payload.id) return payload.id;
  }
  return null;
}

export function sendMessage(message: ClientMessage): void {
  const ws = getWs();
  if (!ws) {
    connect();
    onToast?.('error', 'Not Connected', 'Connecting to server... Please try again in a moment.');
    return;
  }

  if (ws.readyState !== WebSocket.OPEN) {
    if (ws.readyState === WebSocket.CONNECTING) {
      onToast?.('warning', 'Connecting...', 'WebSocket is still connecting. Please wait a moment and try again.');
    } else if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      connect();
      onToast?.('warning', 'Reconnecting...', 'Connection lost. Reconnecting to server...');
    }
    return;
  }

  try {
    const messageStr = JSON.stringify(message);

    // Capture for agent-specific debugger if message has agentId
    const isDebuggerEnabled = agentDebugger.isEnabled();
    if (isDebuggerEnabled) {
      const agentId = extractAgentId(message);
      console.log('[AgentDebugger] SENT - type:', message.type, 'agentId:', agentId, 'payload:', message.payload);
      if (agentId) {
        agentDebugger.captureSent(agentId, messageStr);
      }
    }

    ws.send(messageStr);
  } catch (error) {
    onToast?.('error', 'Send Failed', `Failed to send message: ${error}`);
  }
}

export function isConnected(): boolean {
  const ws = getWs();
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

export function getSocket(): WebSocket | null {
  return getWs();
}
