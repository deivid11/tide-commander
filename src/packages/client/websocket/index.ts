import type { Agent, ServerMessage, ClientMessage, PermissionRequest, DelegationDecision, CustomAgentClass, AgentNotification } from '../../shared/types';
import { store } from '../store';
import { perf } from '../utils/profiling';
import { agentDebugger, debugLog } from '../services/agentDebugger';
import { STORAGE_KEYS, getStorageString } from '../utils/storage';
import { showNotification, isNativeApp } from '../utils/notifications';

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

let connectionPromise: Promise<void> | null = null;
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
  // Clear module-level connection promise
  connectionPromise = null;
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
let onSpawnError: (() => void) | null = null;
let onSpawnSuccess: (() => void) | null = null;
let onToolUse: ((agentId: string, toolName: string, toolInput?: Record<string, unknown>) => void) | null = null;
let onDirectoryNotFound: ((path: string) => void) | null = null;
let onDelegation: ((bossId: string, subordinateId: string) => void) | null = null;
let onCustomClassesSync: ((classes: Map<string, CustomAgentClass>) => void) | null = null;
let onReconnect: (() => void) | null = null;
let onAgentNotification: ((notification: AgentNotification) => void) | null = null;

export function setCallbacks(callbacks: {
  onToast?: typeof onToast;
  onAgentCreated?: typeof onAgentCreated;
  onAgentUpdated?: typeof onAgentUpdated;
  onAgentDeleted?: typeof onAgentDeleted;
  onAgentsSync?: typeof onAgentsSync;
  onSpawnError?: typeof onSpawnError;
  onSpawnSuccess?: typeof onSpawnSuccess;
  onToolUse?: typeof onToolUse;
  onDirectoryNotFound?: typeof onDirectoryNotFound;
  onDelegation?: typeof onDelegation;
  onCustomClassesSync?: typeof onCustomClassesSync;
  onReconnect?: typeof onReconnect;
  onAgentNotification?: typeof onAgentNotification;
}): void {
  if (callbacks.onToast) onToast = callbacks.onToast;
  if (callbacks.onAgentCreated) onAgentCreated = callbacks.onAgentCreated;
  if (callbacks.onAgentUpdated) onAgentUpdated = callbacks.onAgentUpdated;
  if (callbacks.onAgentDeleted) onAgentDeleted = callbacks.onAgentDeleted;
  if (callbacks.onAgentsSync) onAgentsSync = callbacks.onAgentsSync;
  if (callbacks.onSpawnError) onSpawnError = callbacks.onSpawnError;
  if (callbacks.onSpawnSuccess) onSpawnSuccess = callbacks.onSpawnSuccess;
  if (callbacks.onToolUse) onToolUse = callbacks.onToolUse;
  if (callbacks.onDirectoryNotFound) onDirectoryNotFound = callbacks.onDirectoryNotFound;
  if (callbacks.onDelegation) onDelegation = callbacks.onDelegation;
  if (callbacks.onCustomClassesSync) onCustomClassesSync = callbacks.onCustomClassesSync;
  if (callbacks.onReconnect) onReconnect = callbacks.onReconnect;
  if (callbacks.onAgentNotification) onAgentNotification = callbacks.onAgentNotification;
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
  onSpawnError = null;
  onSpawnSuccess = null;
  onToolUse = null;
  onDirectoryNotFound = null;
  onDelegation = null;
  onCustomClassesSync = null;
  onReconnect = null;
  onAgentNotification = null;
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

  // Build WebSocket URL - use configured URL or default to localhost:5174
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
    // Default: connect directly to backend on port 5174
    wsUrl = 'ws://127.0.0.1:5174/ws';
  }

  let newSocket: WebSocket | null = null;
  try {
    newSocket = new WebSocket(wsUrl);
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

    if (isReconnection) {
      onToast?.('success', 'Reconnected', 'Connection restored - refreshing data...');
      // Trigger reconnection callback to refresh history and re-establish listeners
      onReconnect?.();
    } else {
      onToast?.('success', 'Connected', 'Connected to Tide Commander server');
    }
  };

  // Track message sequence for debugging dropped messages
  let messageSeq = 0;

  newSocket.onmessage = (event) => {
    messageSeq++;
    const seq = messageSeq;

    // Log raw data length first (always, even before parsing)
    const dataLen = event.data?.length || 0;
    console.log(`[WS RAW] #${seq} received ${dataLen} bytes`);

    try {
      const message = JSON.parse(event.data) as ServerMessage;

      // Log ALL incoming messages for debugging
      console.log(`[WS] #${seq} RECV type=${message.type}`, message.payload ? `payload.type=${(message.payload as any)?.type}` : '');

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
      console.error(`[WS] #${seq} Failed to parse message:`, err, event.data.slice(0, 200));
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
      onToast?.('error', 'Connection Failed', 'Could not connect to server. Please check if the backend is running on port 5174.');
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

        // Send native notification when agent finishes working (working -> idle)
        if (previousAgent?.status === 'working' && updatedAgent.status === 'idle') {
          showNotification({
            title: `${updatedAgent.name} finished`,
            body: 'Agent is now idle',
            data: { type: 'agent_idle', agentId: updatedAgent.id },
          });
        }
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
      };
      debugLog.debug(`Output: "${output.text.slice(0, 80)}..."`, {
        agentId: output.agentId,
        isStreaming: output.isStreaming,
        length: output.text.length,
      }, 'ws:output');
      store.addOutput(output.agentId, {
        text: output.text,
        isStreaming: output.isStreaming,
        timestamp: output.timestamp,
        isDelegation: output.isDelegation,
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
      console.log(`[WS] Received delegation_decision:`, decision);
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

    // ========================================================================
    // Skill Messages
    // ========================================================================

    case 'skills_update': {
      const skillsArray = message.payload as import('../../shared/types').Skill[];
      store.setSkillsFromServer(skillsArray);
      console.log(`[WebSocket] Received ${skillsArray.length} skills`);
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
