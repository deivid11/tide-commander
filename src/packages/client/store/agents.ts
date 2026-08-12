/**
 * Agent Store Actions
 *
 * Handles agent management: CRUD operations, selection, movement, etc.
 */

import type { Agent, AgentClass, PermissionMode, ClaudeModel, ClaudeEffort, CodexModel, AgentProvider, CodexConfig, ClientMessage, ContextStats } from '../../shared/types';
// Note: opencodeModel is a free-form string (e.g., 'minimax/MiniMax-M1-80k')
import type { StoreState, Activity } from './types';
import { perf } from '../utils/profiling';
import { apiUrl, authFetch } from '../utils/storage';
import { evictHistoryCache } from '../components/ClaudeOutputPanel/useHistoryLoader';

type AgentWithShortcut = Agent & { shortcut?: string };

const verboseAgentStoreLogs =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  (window as any).__TIDE_VERBOSE_STORE__ === true;

function logAgentStore(...args: unknown[]): void {
  if (verboseAgentStoreLogs) {
    console.log(...args);
  }
}

function isExplicitContextReset(agent: Agent): boolean {
  return (agent.tokensUsed ?? 0) === 0
    && (agent.contextUsed ?? 0) === 0
    && !agent.contextStats
    && !agent.sessionId
    && !agent.currentTask
    && !agent.lastAssignedTask;
}

function mergeFreshestContext(existing: Agent | undefined, incoming: Agent): Agent {
  if (!existing) return incoming;
  if (isExplicitContextReset(incoming)) {
    return incoming;
  }

  const existingContextUpdatedAt = existing.contextStats?.lastUpdated ?? 0;
  const incomingContextUpdatedAt = incoming.contextStats?.lastUpdated ?? 0;
  const keepExistingContext =
    existingContextUpdatedAt > 0
    && existingContextUpdatedAt > incomingContextUpdatedAt;

  if (!keepExistingContext) {
    return incoming;
  }

  return {
    ...incoming,
    contextUsed: existing.contextUsed,
    contextLimit: existing.contextLimit,
    contextStats: existing.contextStats,
  };
}

export interface AgentActions {
  // Agent CRUD
  setAgents(agentList: Agent[]): void;
  addAgent(agent: Agent): void;
  updateAgent(agent: Agent): void;
  setAgentCurrentTool(agentId: string, toolName: string | undefined): void;
  updateAgentContextStats(agentId: string, stats: ContextStats): void;
  updateAgentContext(agentId: string, contextUsed: number, contextLimit: number): void;
  removeAgent(agentId: string): void;

  // Selection
  selectAgent(agentId: string | null): void;
  addToSelection(agentId: string): void;
  selectMultiple(agentIds: string[]): void;
  deselectAll(): void;

  // Pinning (quick-select thumbnail bar)
  togglePinnedAgent(agentId: string): void;
  /** Reorder a pinned agent: move `agentId` next to `targetId` (before it, or
   * after it when `placeAfter`). No-op if either id isn't pinned. */
  reorderPinnedAgent(agentId: string, targetId: string, placeAfter?: boolean): void;

  // Commands
  spawnAgent(
    name: string,
    agentClass: AgentClass,
    cwd: string,
    position?: { x: number; z: number },
    sessionId?: string,
    useChrome?: boolean,
    permissionMode?: PermissionMode,
    initialSkillIds?: string[],
    provider?: AgentProvider,
    codexConfig?: CodexConfig,
    codexModel?: CodexModel,
    model?: ClaudeModel,
    customInstructions?: string,
    effort?: ClaudeEffort,
    opencodeModel?: string,
    grokModel?: string,
    piModel?: string
  ): void;
  cloneAgent(
    sourceAgentId: string,
    name?: string,
    position?: { x: number; z: number }
  ): void;
  forkAgent(
    sourceAgentId: string,
    name?: string,
    position?: { x: number; z: number }
  ): void;
  createDirectoryAndSpawn(path: string, name: string, agentClass: AgentClass): void;
  sendCommand(agentId: string, command: string, opts?: { forceInterrupt?: boolean }): void;
  refreshAgentContext(agentId: string): void;
  moveAgentLocal(agentId: string, position: { x: number; y: number; z: number }): void;
  moveAgent(agentId: string, position: { x: number; y: number; z: number }): void;
  killAgent(agentId: string): void;
  stopAgent(agentId: string): void;
  clearContext(agentId: string): void;
  restoreSession(agentId: string, sessionId: string, cwd?: string): void;
  /** Restore a session onto a brand-new agent (server copies the config and
   * skills of the most similar existing agent in that project). */
  restoreSessionToNewAgent(sessionId: string, cwd: string, name?: string): void;
  requestSessionHistory(agentId: string): void;
  setSessionHistory(agentId: string, entries: import('../../shared/types').SessionHistoryEntry[]): void;
  getSessionHistory(agentId: string): import('../../shared/types').SessionHistoryEntry[];
  collapseContext(agentId: string): void;
  removeAgentFromServer(agentId: string): void;
  renameAgent(agentId: string, name: string): void;
  updateAgentProperties(
    agentId: string,
    updates: {
      class?: AgentClass;
      permissionMode?: PermissionMode;
      provider?: AgentProvider;
      codexConfig?: CodexConfig;
      codexModel?: CodexModel;
      opencodeModel?: string;
      grokModel?: string;
      piModel?: string;
      model?: ClaudeModel;
      effort?: ClaudeEffort;
      useChrome?: boolean;
      skillIds?: string[];
      cwd?: string;
      shortcut?: string;
      soundsMuted?: boolean;
      customInstructions?: string;
      customPrompt?: string;
      autoCollapse?: boolean;
      autoCollapseCron?: string;
      autoCollapseTz?: string;
      autoCollapsePrompt?: string;
    }
  ): void;

  // Computed values
  getTotalTokens(): number;
  getSelectedAgents(): Agent[];

  // Activity feed
  addActivity(activity: Activity): void;

  // Tool and file tracking
  addToolExecution(agentId: string, toolName: string, toolInput?: Record<string, unknown>): void;
  addFileChange(agentId: string, action: 'created' | 'modified' | 'deleted' | 'read', filePath: string): void;
  loadToolHistory(): Promise<void>;
}

export function createAgentActions(
  getState: () => StoreState,
  setState: (updater: (state: StoreState) => void) => void,
  notify: () => void,
  getSendMessage: () => ((msg: ClientMessage) => void) | null,
  saveUnseenAgents?: () => void,
  savePinnedAgents?: () => void
): AgentActions {
  // One-shot guard: on a fresh load (app or web) the very first agent sync should
  // auto-open the most-recently-active agent's Guake terminal. Scoped to this store
  // instance so it resets on page reload and never re-fires mid-session (e.g. if the
  // user later deselects every agent).
  let firstAgentSyncHandled = false;
  return {
    setAgents(agentList: Agent[]): void {
      perf.start('store:setAgents');
      const newAgents = new Map<string, Agent>();
      const existingAgents = getState().agents;
      for (const agent of agentList) {
        const existingAgent = existingAgents.get(agent.id);
        newAgents.set(agent.id, mergeFreshestContext(existingAgent, agent));
        // Debug: log boss agents with subordinates
        if (agent.class === 'boss' || agent.isBoss) {
          logAgentStore('[Store.setAgents] Boss agent:', agent.name, 'subordinateIds:', agent.subordinateIds);
        }
      }

      // On the FIRST sync of a fresh load, pick the most-recently-active agent so the
      // app/web opens straight into that agent's Guake terminal (works in flat view and
      // every other view mode). "Last active" = greatest lastActivity, which also covers
      // the working-agent-on-refresh case. Deep links (handled in App.tsx) still override.
      const isFirstSync = !firstAgentSyncHandled;
      let lastActiveAgent: Agent | null = null;
      if (isFirstSync && agentList.length > 0) {
        for (const agent of agentList) {
          if (!lastActiveAgent || (agent.lastActivity || 0) > (lastActiveAgent.lastActivity || 0)) {
            lastActiveAgent = agent;
          }
        }
      }

      setState((state) => {
        state.agents = newAgents;
        // Auto-open the last-active agent only if the user hasn't already selected one
        // (respects deep links / prior selection). Selecting the agent is what surfaces
        // the chat in flat view; the Guake overlay is opened only outside flat view, where
        // selection alone doesn't reveal it (and opening it in flat would stack a duplicate).
        if (isFirstSync && lastActiveAgent && state.selectedAgentIds.size === 0) {
          state.selectedAgentIds = new Set([lastActiveAgent.id]);
          state.lastSelectedAgentId = lastActiveAgent.id;
          if (state.viewMode !== 'flat') {
            state.terminalOpen = true;
          }
        }
      });
      if (isFirstSync && agentList.length > 0) {
        firstAgentSyncHandled = true;
      }
      notify();
      perf.end('store:setAgents');
    },

    addAgent(agent: Agent): void {
      setState((state) => {
        const newAgents = new Map(state.agents);
        newAgents.set(agent.id, agent);
        state.agents = newAgents;
      });
      notify();
    },

    updateAgent(agent: Agent): void {
      const state = getState();
      const oldAgent = state.agents.get(agent.id);
      let normalizedAgent = agent;
      const explicitTrackingStatus = agent.trackingStatus;
      const shouldPreserveExplicitTrackingStatus = explicitTrackingStatus !== undefined
        && explicitTrackingStatus !== null
        && explicitTrackingStatus !== 'working';
      const enteredWorkingState = oldAgent?.status !== 'working' && agent.status === 'working';
      if (enteredWorkingState && !shouldPreserveExplicitTrackingStatus) {
        normalizedAgent = {
          ...agent,
          trackingStatus: 'working',
          trackingStatusDetail: undefined,
          trackingStatusTimestamp: agent.trackingStatusTimestamp ?? Date.now(),
        };
      }
      const statusChanged = oldAgent?.status !== normalizedAgent.status;
      if (statusChanged) {
        logAgentStore(`[Store] Agent ${normalizedAgent.name} status update: ${oldAgent?.status} → ${normalizedAgent.status}`);
      }
      let unseenChanged = false;
      setState((s) => {
        const newAgents = new Map(s.agents);
        newAgents.set(normalizedAgent.id, mergeFreshestContext(oldAgent, normalizedAgent));
        s.agents = newAgents;

        // NEW: Mark agent as having unseen output when completing work
        if (statusChanged && oldAgent?.status === 'working' && normalizedAgent.status === 'idle') {
          // Only mark if user isn't currently viewing this agent
          const isViewing = s.terminalOpen && s.selectedAgentIds.has(normalizedAgent.id);
          if (!isViewing) {
            s.agentsWithUnseenOutput = new Set(s.agentsWithUnseenOutput);
            s.agentsWithUnseenOutput.add(normalizedAgent.id);
            logAgentStore(`[Store] Agent ${normalizedAgent.name} completed work - marked as unseen`);
            unseenChanged = true;
          }

          // Close any stuck live streams (thinking caret / raw MD) when the
          // agent goes idle — server finalize can be missed on Grok tool races.
          const outs = s.agentOutputs.get(normalizedAgent.id);
          if (outs && outs.some((o) => o.isStreaming)) {
            const settled = outs.map((o) => (o.isStreaming ? { ...o, isStreaming: false } : o));
            const nextOutputs = new Map(s.agentOutputs);
            nextOutputs.set(normalizedAgent.id, settled);
            s.agentOutputs = nextOutputs;
          }
        }
      });
      if (unseenChanged && saveUnseenAgents) {
        saveUnseenAgents();
      }
      notify();
      if (statusChanged) {
        logAgentStore(`[Store] Agent ${normalizedAgent.name} status now in store: ${getState().agents.get(normalizedAgent.id)?.status}`);
      }
    },

    // Local patch driven by `event` messages (tool_start/tool_result). The
    // server no longer broadcasts a full agent_updated for currentTool churn.
    setAgentCurrentTool(agentId: string, toolName: string | undefined): void {
      const agent = getState().agents.get(agentId);
      if (!agent || agent.currentTool === toolName) return;
      setState((s) => {
        const newAgents = new Map(s.agents);
        newAgents.set(agentId, { ...agent, currentTool: toolName });
        s.agents = newAgents;
      });
      notify();
    },

    updateAgentContextStats(agentId: string, stats: ContextStats): void {
      const state = getState();
      const agent = state.agents.get(agentId);
      if (agent) {
        setState((s) => {
          const newAgents = new Map(s.agents);
          newAgents.set(agentId, {
            ...agent,
            contextStats: stats,
            contextUsed: stats.totalTokens,
            contextLimit: stats.contextWindow,
          });
          s.agents = newAgents;
        });
        notify();
      }
    },

    // Lightweight real-time context update (from usage_snapshot events during streaming)
    updateAgentContext(agentId: string, contextUsed: number, contextLimit: number): void {
      const state = getState();
      const agent = state.agents.get(agentId);
      if (agent) {
        const safeLimit = Math.max(1, contextLimit || 200000);
        const usedPercent = Math.max(0, Math.min(100, Number(((contextUsed / safeLimit) * 100).toFixed(1))));
        setState((s) => {
          const newAgents = new Map(s.agents);
          const nextContextStats = agent.contextStats
            ? {
                ...agent.contextStats,
                totalTokens: contextUsed,
                contextWindow: safeLimit,
                usedPercent,
                lastUpdated: Date.now(),
              }
            : undefined;
          newAgents.set(agentId, {
            ...agent,
            contextUsed,
            contextLimit: safeLimit,
            contextStats: nextContextStats,
          });
          s.agents = newAgents;
        });
        notify();
      }
    },

    removeAgent(agentId: string): void {
      const hadUnseen = getState().agentsWithUnseenOutput.has(agentId);
      setState((state) => {
        const newAgents = new Map(state.agents);
        newAgents.delete(agentId);
        state.agents = newAgents;
        const newSelectedIds = new Set(state.selectedAgentIds);
        newSelectedIds.delete(agentId);
        state.selectedAgentIds = newSelectedIds;
        // Clean up agent outputs to prevent memory leak
        state.agentOutputs.delete(agentId);
        // Clean up last prompts
        state.lastPrompts.delete(agentId);
        // Clean up unseen badge
        if (state.agentsWithUnseenOutput.has(agentId)) {
          state.agentsWithUnseenOutput = new Set(state.agentsWithUnseenOutput);
          state.agentsWithUnseenOutput.delete(agentId);
        }
        // Clean up delegation data for this agent
        state.delegationHistories.delete(agentId);
        state.lastDelegationReceived.delete(agentId);
        state.agentTaskProgress.delete(agentId);
        // Clean up subagents
        state.subagents.delete(agentId);
      });
      // Evict from history cache
      evictHistoryCache(agentId);
      if (hadUnseen && saveUnseenAgents) {
        saveUnseenAgents();
      }
      notify();
    },

    selectAgent(agentId: string | null): void {
      let unseenChanged = false;
      setState((state) => {
        // Create a new Set so selectors (shallowSetEqual) detect the reference change
        state.selectedAgentIds = new Set(agentId ? [agentId] : []);
        if (agentId) {
          state.lastSelectedAgentId = agentId;
          // Bump even when re-selecting the same agent: the terminal pane
          // re-pins to the bottom on every explicit click, and selectedAgentIds
          // alone can't observe a same-agent re-click.
          state.agentSelectionSeq = (state.agentSelectionSeq ?? 0) + 1;

          // NEW: Clear unseen badge when agent is selected
          if (state.agentsWithUnseenOutput.has(agentId)) {
            state.agentsWithUnseenOutput = new Set(state.agentsWithUnseenOutput);
            state.agentsWithUnseenOutput.delete(agentId);
            logAgentStore(`[Store] Cleared unseen badge for selected agent ${agentId}`);
            unseenChanged = true;
          }
        }
      });
      if (unseenChanged && saveUnseenAgents) {
        saveUnseenAgents();
      }
      notify();
    },

    addToSelection(agentId: string): void {
      let unseenChanged = false;
      setState((state) => {
        // Create a new Set so selectors (shallowSetEqual) detect the reference change
        const newSet = new Set(state.selectedAgentIds);
        if (newSet.has(agentId)) {
          newSet.delete(agentId);
        } else {
          newSet.add(agentId);

          // NEW: Clear unseen badge when agent is added to selection
          if (state.agentsWithUnseenOutput.has(agentId)) {
            state.agentsWithUnseenOutput = new Set(state.agentsWithUnseenOutput);
            state.agentsWithUnseenOutput.delete(agentId);
            logAgentStore(`[Store] Cleared unseen badge for multi-selected agent ${agentId}`);
            unseenChanged = true;
          }
        }
        state.selectedAgentIds = newSet;
      });
      if (unseenChanged && saveUnseenAgents) {
        saveUnseenAgents();
      }
      notify();
    },

    selectMultiple(agentIds: string[]): void {
      setState((state) => {
        state.selectedAgentIds = new Set(agentIds);
      });
      notify();
    },

    deselectAll(): void {
      setState((state) => {
        state.selectedAgentIds = new Set();
      });
      notify();
    },

    togglePinnedAgent(agentId: string): void {
      if (!agentId) return;
      setState((state) => {
        // New array reference so selectors detect the change.
        const next = state.pinnedAgentIds.filter((id) => id !== agentId);
        if (next.length === state.pinnedAgentIds.length) next.push(agentId);
        state.pinnedAgentIds = next;
      });
      if (savePinnedAgents) savePinnedAgents();
      notify();
    },

    reorderPinnedAgent(agentId: string, targetId: string, placeAfter = false): void {
      if (!agentId || agentId === targetId) return;
      setState((state) => {
        const ids = state.pinnedAgentIds.slice();
        const from = ids.indexOf(agentId);
        if (from < 0) return;
        ids.splice(from, 1);
        let to = ids.indexOf(targetId);
        if (to < 0) to = ids.length; // unknown target → append
        else if (placeAfter) to += 1;
        ids.splice(to, 0, agentId);
        state.pinnedAgentIds = ids;
      });
      if (savePinnedAgents) savePinnedAgents();
      notify();
    },

    spawnAgent(
      name: string,
      agentClass: AgentClass,
      cwd: string,
      position?: { x: number; z: number },
      sessionId?: string,
      useChrome?: boolean,
      permissionMode?: PermissionMode,
      initialSkillIds?: string[],
      provider?: AgentProvider,
      codexConfig?: CodexConfig,
      codexModel?: CodexModel,
      model?: ClaudeModel,
      customInstructions?: string,
      effort?: ClaudeEffort,
      opencodeModel?: string,
      grokModel?: string,
      piModel?: string
    ): void {
      logAgentStore('[Store] spawnAgent called with:', {
        name,
        agentClass,
        cwd,
        position,
        sessionId,
        useChrome,
        permissionMode,
        initialSkillIds,
        provider,
        codexConfig,
        codexModel,
        model,
        effort,
        opencodeModel,
        grokModel,
        piModel,
        customInstructions: customInstructions ? `${customInstructions.length} chars` : undefined,
      });

      const pos3d = position ? { x: position.x, y: 0, z: position.z } : undefined;
      const message = {
        type: 'spawn_agent' as const,
        payload: {
          name,
          class: agentClass,
          cwd,
          position: pos3d,
          sessionId,
          useChrome,
          permissionMode,
          initialSkillIds,
          provider,
          codexConfig,
          codexModel,
          opencodeModel,
          grokModel,
          piModel,
          model,
          effort,
          customInstructions,
        },
      };

      const sendMessage = getSendMessage();
      if (!sendMessage) {
        console.error('[Store] sendMessage is not defined! WebSocket may not be connected');
        return;
      }

      sendMessage(message);
      logAgentStore('[Store] Message sent to WebSocket');
    },

    cloneAgent(
      sourceAgentId: string,
      name?: string,
      position?: { x: number; z: number }
    ): void {
      const pos3d = position ? { x: position.x, y: 0, z: position.z } : undefined;
      const message = {
        type: 'clone_agent' as const,
        payload: {
          sourceAgentId,
          name,
          position: pos3d,
        },
      };

      const sendMessage = getSendMessage();
      if (!sendMessage) {
        console.error('[Store] sendMessage is not defined! WebSocket may not be connected');
        return;
      }

      sendMessage(message);
      logAgentStore('[Store] clone_agent message sent to WebSocket');
    },

    forkAgent(
      sourceAgentId: string,
      name?: string,
      position?: { x: number; z: number }
    ): void {
      const pos3d = position ? { x: position.x, y: 0, z: position.z } : undefined;
      const message = {
        type: 'fork_agent' as const,
        payload: {
          sourceAgentId,
          name,
          position: pos3d,
        },
      };

      const sendMessage = getSendMessage();
      if (!sendMessage) {
        console.error('[Store] sendMessage is not defined! WebSocket may not be connected');
        return;
      }

      sendMessage(message);
      logAgentStore('[Store] fork_agent message sent to WebSocket');
    },

    createDirectoryAndSpawn(path: string, name: string, agentClass: AgentClass): void {
      getSendMessage()?.({
        type: 'create_directory',
        payload: { path, name, class: agentClass },
      });
    },

    sendCommand(agentId: string, command: string, opts?: { forceInterrupt?: boolean }): void {
      setState((state) => {
        state.lastPrompts.set(agentId, {
          text: command,
          timestamp: Date.now(),
        });
      });
      notify();

      const msg: ClientMessage = {
        type: 'send_command',
        payload: {
          agentId,
          command,
          ...(opts?.forceInterrupt ? { forceInterrupt: true } : {}),
        },
      };

      const sendMessage = getSendMessage();
      if (sendMessage) {
        sendMessage(msg);
      } else {
        // Fallback: websocket send module handles queuing when disconnected.
        // Dynamic import avoids pulling in browser-only code during tests.
        import('../websocket/send').then(({ sendMessage: wsSend }) => {
          wsSend(msg);
        }).catch(() => {
          console.error('[Store] Failed to send command - no WebSocket connection available');
        });
      }
    },

    refreshAgentContext(agentId: string): void {
      getSendMessage()?.({
        type: 'request_context_stats',
        payload: { agentId },
      });
    },

    moveAgentLocal(agentId: string, position: { x: number; y: number; z: number }): void {
      const state = getState();
      const agent = state.agents.get(agentId);
      if (agent) {
        setState((s) => {
          const updatedAgent = { ...agent, position };
          const newAgents = new Map(s.agents);
          newAgents.set(agentId, updatedAgent);
          s.agents = newAgents;
        });
        notify();
      }
    },

    moveAgent(agentId: string, position: { x: number; y: number; z: number }): void {
      const state = getState();
      const agent = state.agents.get(agentId);
      if (agent) {
        setState((s) => {
          const updatedAgent = { ...agent, position };
          const newAgents = new Map(s.agents);
          newAgents.set(agentId, updatedAgent);
          s.agents = newAgents;
        });
        notify();
      }

      getSendMessage()?.({
        type: 'move_agent',
        payload: { agentId, position },
      });
    },

    killAgent(agentId: string): void {
      getSendMessage()?.({
        type: 'kill_agent',
        payload: { agentId },
      });
    },

    stopAgent(agentId: string): void {
      getSendMessage()?.({
        type: 'stop_agent',
        payload: { agentId },
      });
    },

    clearContext(agentId: string): void {
      getSendMessage()?.({
        type: 'clear_context',
        payload: { agentId },
      });
      // Also clear local outputs and reset agent session metadata for immediate UI parity.
      setState((state) => {
        const agent = state.agents.get(agentId);
        if (agent) {
          const updatedAgent = {
            ...agent,
            status: 'idle' as const,
            currentTask: undefined,
            taskLabel: undefined,
            trackingStatus: undefined,
            trackingStatusDetail: undefined,
            trackingStatusTimestamp: undefined,
            currentTool: undefined,
            lastAssignedTask: undefined,
            lastAssignedTaskTime: undefined,
            sessionId: undefined,
            tokensUsed: 0,
            contextUsed: 0,
            contextStats: undefined,
          };
          const newAgents = new Map(state.agents);
          newAgents.set(agentId, updatedAgent);
          state.agents = newAgents;
        }

        const newAgentOutputs = new Map(state.agentOutputs);
        newAgentOutputs.delete(agentId);
        state.agentOutputs = newAgentOutputs;

        const newLastPrompts = new Map(state.lastPrompts);
        newLastPrompts.delete(agentId);
        state.lastPrompts = newLastPrompts;

        // Clear subagents for this agent so badge indicators are removed
        const newSubagents = new Map(state.subagents);
        let subagentsChanged = false;
        for (const [id, sub] of newSubagents) {
          if (sub.parentAgentId === agentId) {
            newSubagents.delete(id);
            subagentsChanged = true;
          }
        }
        if (subagentsChanged) {
          state.subagents = newSubagents;
        }
      });
      notify();
    },

    restoreSessionToNewAgent(sessionId: string, cwd: string, name?: string): void {
      getSendMessage()?.({
        type: 'restore_session_new_agent',
        payload: name ? { sessionId, cwd, name } : { sessionId, cwd },
      });
    },

    restoreSession(agentId: string, sessionId: string, cwd?: string): void {
      getSendMessage()?.({
        type: 'restore_session',
        payload: cwd ? { agentId, sessionId, cwd } : { agentId, sessionId },
      });
      // Optimistic update: set sessionId and clear outputs for immediate UI parity
      setState((state) => {
        const agent = state.agents.get(agentId);
        if (agent) {
          const updatedAgent = {
            ...agent,
            status: 'idle' as const,
            currentTask: undefined,
            taskLabel: undefined,
            currentTool: undefined,
            sessionId,
            ...(cwd ? { cwd } : {}),
            tokensUsed: 0,
            contextUsed: 0,
            contextStats: undefined,
          };
          const newAgents = new Map(state.agents);
          newAgents.set(agentId, updatedAgent);
          state.agents = newAgents;
        }

        const newAgentOutputs = new Map(state.agentOutputs);
        newAgentOutputs.delete(agentId);
        state.agentOutputs = newAgentOutputs;

        const newLastPrompts = new Map(state.lastPrompts);
        newLastPrompts.delete(agentId);
        state.lastPrompts = newLastPrompts;
      });
      notify();
    },

    requestSessionHistory(agentId: string): void {
      getSendMessage()?.({
        type: 'request_session_history',
        payload: { agentId },
      });
    },

    setSessionHistory(agentId: string, entries: import('../../shared/types').SessionHistoryEntry[]): void {
      setState((state) => {
        const newHistories = new Map(state.sessionHistories);
        newHistories.set(agentId, entries);
        state.sessionHistories = newHistories;
      });
      notify();
    },

    getSessionHistory(agentId: string): import('../../shared/types').SessionHistoryEntry[] {
      return getState().sessionHistories.get(agentId) || [];
    },

    collapseContext(agentId: string): void {
      getSendMessage()?.({
        type: 'collapse_context',
        payload: { agentId },
      });
    },

    removeAgentFromServer(agentId: string): void {
      getSendMessage()?.({
        type: 'remove_agent',
        payload: { agentId },
      });
    },

    renameAgent(agentId: string, name: string): void {
      const state = getState();
      const agent = state.agents.get(agentId);
      if (agent) {
        setState((s) => {
          const updatedAgent = { ...agent, name };
          const newAgents = new Map(s.agents);
          newAgents.set(agentId, updatedAgent);
          s.agents = newAgents;
        });
        notify();
      }

      getSendMessage()?.({
        type: 'rename_agent',
        payload: { agentId, name },
      });
    },

    updateAgentProperties(
      agentId: string,
      updates: {
        class?: AgentClass;
        permissionMode?: PermissionMode;
        provider?: AgentProvider;
        codexConfig?: CodexConfig;
        codexModel?: CodexModel;
        opencodeModel?: string;
        grokModel?: string;
        model?: ClaudeModel;
        effort?: ClaudeEffort;
        useChrome?: boolean;
        skillIds?: string[];
        cwd?: string;
        shortcut?: string;
        soundsMuted?: boolean;
        customInstructions?: string;
        customPrompt?: string;
        autoCollapse?: boolean;
        autoCollapseCron?: string;
        autoCollapseTz?: string;
        autoCollapsePrompt?: string;
      }
    ): void {
      const state = getState();
      const agent = state.agents.get(agentId);
      if (agent) {
        setState((s) => {
          const updatedAgent: AgentWithShortcut = { ...agent };
          if (updates.class !== undefined) {
            updatedAgent.class = updates.class;
          }
          if (updates.permissionMode !== undefined) {
            updatedAgent.permissionMode = updates.permissionMode;
          }
          if (updates.model !== undefined) {
            updatedAgent.model = updates.model;
          }
          if (updates.effort !== undefined) {
            updatedAgent.effort = updates.effort;
          }
          if (updates.provider !== undefined) {
            updatedAgent.provider = updates.provider;
          }
          if (updates.codexConfig !== undefined) {
            updatedAgent.codexConfig = updates.codexConfig;
          }
          if (updates.codexModel !== undefined) {
            updatedAgent.codexModel = updates.codexModel;
          }
          if (updates.opencodeModel !== undefined) {
            (updatedAgent as any).opencodeModel = updates.opencodeModel;
          }
          if (updates.grokModel !== undefined) {
            (updatedAgent as any).grokModel = updates.grokModel;
          }
          if (updates.useChrome !== undefined) {
            updatedAgent.useChrome = updates.useChrome;
          }
          if (updates.cwd !== undefined) {
            updatedAgent.cwd = updates.cwd;
          }
          if (updates.shortcut !== undefined) {
            updatedAgent.shortcut = updates.shortcut;
          }
          if (updates.customInstructions !== undefined) {
            updatedAgent.customInstructions = updates.customInstructions || undefined;
          }
          if (updates.customPrompt !== undefined) {
            updatedAgent.customPrompt = updates.customPrompt || undefined;
          }
          if (updates.autoCollapse !== undefined) {
            updatedAgent.autoCollapse = updates.autoCollapse;
          }
          if (updates.autoCollapseCron !== undefined) {
            updatedAgent.autoCollapseCron = updates.autoCollapseCron || undefined;
          }
          if (updates.autoCollapseTz !== undefined) {
            updatedAgent.autoCollapseTz = updates.autoCollapseTz || undefined;
          }
          if (updates.autoCollapsePrompt !== undefined) {
            updatedAgent.autoCollapsePrompt = updates.autoCollapsePrompt || undefined;
          }
          const newAgents = new Map(s.agents);
          newAgents.set(agentId, updatedAgent);
          s.agents = newAgents;
        });
        notify();
      }

      getSendMessage()?.({
        type: 'update_agent_properties',
        payload: { agentId, updates: updates as any },
      });

      if (updates.shortcut !== undefined) {
        authFetch(apiUrl(`/api/agents/${agentId}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shortcut: updates.shortcut }),
        }).catch((error) => {
          console.error('[Store] Failed to persist agent shortcut', error);
        });
      }

      if (updates.customInstructions !== undefined) {
        authFetch(apiUrl(`/api/agents/${agentId}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customInstructions: updates.customInstructions || null }),
        }).catch((error) => {
          console.error('[Store] Failed to persist agent customInstructions', error);
        });
      }

      if (updates.customPrompt !== undefined) {
        authFetch(apiUrl(`/api/agents/${agentId}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customPrompt: updates.customPrompt || null }),
        }).catch((error) => {
          console.error('[Store] Failed to persist agent customPrompt', error);
        });
      }

      if (updates.autoCollapse !== undefined || updates.autoCollapseCron !== undefined || updates.autoCollapseTz !== undefined || updates.autoCollapsePrompt !== undefined) {
        const body: Record<string, unknown> = {};
        if (updates.autoCollapse !== undefined) body.autoCollapse = updates.autoCollapse;
        if (updates.autoCollapseCron !== undefined) body.autoCollapseCron = updates.autoCollapseCron || null;
        if (updates.autoCollapseTz !== undefined) body.autoCollapseTz = updates.autoCollapseTz || null;
        if (updates.autoCollapsePrompt !== undefined) body.autoCollapsePrompt = updates.autoCollapsePrompt || null;
        authFetch(apiUrl(`/api/agents/${agentId}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).catch((error) => {
          console.error('[Store] Failed to persist agent auto-collapse config', error);
        });
      }
    },

    getTotalTokens(): number {
      let total = 0;
      for (const agent of getState().agents.values()) {
        total += agent.tokensUsed;
      }
      return total;
    },

    getSelectedAgents(): Agent[] {
      const state = getState();
      const agents: Agent[] = [];
      for (const id of state.selectedAgentIds) {
        const agent = state.agents.get(id);
        if (agent) agents.push(agent);
      }
      return agents;
    },

    addActivity(activity: Activity): void {
      setState((state) => {
        state.activities.unshift(activity);
        if (state.activities.length > 100) {
          state.activities.pop();
        }
      });
      notify();
    },

    addToolExecution(agentId: string, toolName: string, toolInput?: Record<string, unknown>): void {
      const state = getState();
      const agent = state.agents.get(agentId);
      setState((s) => {
        s.toolExecutions.unshift({
          agentId,
          agentName: agent?.name || 'Unknown',
          toolName,
          toolInput,
          timestamp: Date.now(),
        });
        if (s.toolExecutions.length > 200) {
          s.toolExecutions.pop();
        }
      });
      notify();
    },

    addFileChange(agentId: string, action: 'created' | 'modified' | 'deleted' | 'read', filePath: string): void {
      const state = getState();
      const agent = state.agents.get(agentId);
      setState((s) => {
        s.fileChanges.unshift({
          agentId,
          agentName: agent?.name || 'Unknown',
          action,
          filePath,
          timestamp: Date.now(),
        });
        if (s.fileChanges.length > 200) {
          s.fileChanges.pop();
        }
      });
      notify();
    },

    async loadToolHistory(): Promise<void> {
      try {
        const res = await authFetch(apiUrl('/api/agents/tool-history?limit=100'));
        const data = await res.json();

        setState((state) => {
          if (data.toolExecutions) {
            state.toolExecutions = data.toolExecutions;
          }
          if (data.fileChanges) {
            state.fileChanges = data.fileChanges;
          }
        });
        notify();
      } catch (err) {
        console.error('[Store] Failed to load tool history:', err);
      }
    },
  };
}
