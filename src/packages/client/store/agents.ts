/**
 * Agent Store Actions
 *
 * Handles agent management: CRUD operations, selection, movement, etc.
 */

import type { Agent, AgentClass, PermissionMode, ClaudeModel, ClientMessage, ContextStats } from '../../shared/types';
import type { StoreState, Activity } from './types';
import { perf } from '../utils/profiling';
import { apiUrl, authFetch } from '../utils/storage';

export interface AgentActions {
  // Agent CRUD
  setAgents(agentList: Agent[]): void;
  addAgent(agent: Agent): void;
  updateAgent(agent: Agent): void;
  updateAgentContextStats(agentId: string, stats: ContextStats): void;
  removeAgent(agentId: string): void;

  // Selection
  selectAgent(agentId: string | null): void;
  addToSelection(agentId: string): void;
  selectMultiple(agentIds: string[]): void;
  deselectAll(): void;

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
    model?: ClaudeModel,
    customInstructions?: string
  ): void;
  createDirectoryAndSpawn(path: string, name: string, agentClass: AgentClass): void;
  sendCommand(agentId: string, command: string): void;
  refreshAgentContext(agentId: string): void;
  moveAgent(agentId: string, position: { x: number; y: number; z: number }): void;
  killAgent(agentId: string): void;
  stopAgent(agentId: string): void;
  clearContext(agentId: string): void;
  collapseContext(agentId: string): void;
  removeAgentFromServer(agentId: string): void;
  renameAgent(agentId: string, name: string): void;
  updateAgentProperties(
    agentId: string,
    updates: {
      class?: AgentClass;
      permissionMode?: PermissionMode;
      model?: ClaudeModel;
      useChrome?: boolean;
      skillIds?: string[];
      cwd?: string;
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
  getSendMessage: () => ((msg: ClientMessage) => void) | null
): AgentActions {
  return {
    setAgents(agentList: Agent[]): void {
      perf.start('store:setAgents');
      const newAgents = new Map<string, Agent>();
      for (const agent of agentList) {
        newAgents.set(agent.id, agent);
        // Debug: log boss agents with subordinates
        if (agent.class === 'boss' || agent.isBoss) {
          console.log('[Store.setAgents] Boss agent:', agent.name, 'subordinateIds:', agent.subordinateIds);
        }
      }

      // Find a working agent to auto-select (helps with page refresh during streaming)
      const workingAgent = agentList.find((a) => a.status === 'working');

      setState((state) => {
        state.agents = newAgents;
        // Auto-select working agent if no agent is currently selected
        if (workingAgent && state.selectedAgentIds.size === 0) {
          state.selectedAgentIds.add(workingAgent.id);
          state.terminalOpen = true;
        }
      });
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
      const statusChanged = oldAgent?.status !== agent.status;
      if (statusChanged) {
        console.log(`[Store] Agent ${agent.name} status update: ${oldAgent?.status} → ${agent.status}`);
      }
      setState((s) => {
        const newAgents = new Map(s.agents);
        newAgents.set(agent.id, agent);
        s.agents = newAgents;
      });
      notify();
      if (statusChanged) {
        console.log(`[Store] Agent ${agent.name} status now in store: ${getState().agents.get(agent.id)?.status}`);
      }
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

    removeAgent(agentId: string): void {
      setState((state) => {
        const newAgents = new Map(state.agents);
        newAgents.delete(agentId);
        state.agents = newAgents;
        state.selectedAgentIds.delete(agentId);
        // Clean up agent outputs to prevent memory leak
        state.agentOutputs.delete(agentId);
      });
      notify();
    },

    selectAgent(agentId: string | null): void {
      setState((state) => {
        state.selectedAgentIds.clear();
        if (agentId) {
          state.selectedAgentIds.add(agentId);
          state.lastSelectedAgentId = agentId;
        }
      });
      notify();
    },

    addToSelection(agentId: string): void {
      setState((state) => {
        if (state.selectedAgentIds.has(agentId)) {
          state.selectedAgentIds.delete(agentId);
        } else {
          state.selectedAgentIds.add(agentId);
        }
      });
      notify();
    },

    selectMultiple(agentIds: string[]): void {
      setState((state) => {
        state.selectedAgentIds.clear();
        for (const id of agentIds) {
          state.selectedAgentIds.add(id);
        }
      });
      notify();
    },

    deselectAll(): void {
      setState((state) => {
        state.selectedAgentIds.clear();
      });
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
      model?: ClaudeModel,
      customInstructions?: string
    ): void {
      console.log('[Store] spawnAgent called with:', {
        name,
        agentClass,
        cwd,
        position,
        sessionId,
        useChrome,
        permissionMode,
        initialSkillIds,
        model,
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
          model,
          customInstructions,
        },
      };

      const sendMessage = getSendMessage();
      if (!sendMessage) {
        console.error('[Store] sendMessage is not defined! WebSocket may not be connected');
        return;
      }

      sendMessage(message);
      console.log('[Store] Message sent to WebSocket');
    },

    createDirectoryAndSpawn(path: string, name: string, agentClass: AgentClass): void {
      getSendMessage()?.({
        type: 'create_directory',
        payload: { path, name, class: agentClass },
      });
    },

    sendCommand(agentId: string, command: string): void {
      setState((state) => {
        state.lastPrompts.set(agentId, {
          text: command,
          timestamp: Date.now(),
        });
      });
      notify();

      getSendMessage()?.({
        type: 'send_command',
        payload: { agentId, command },
      });
    },

    refreshAgentContext(agentId: string): void {
      getSendMessage()?.({
        type: 'request_context_stats',
        payload: { agentId },
      });
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
      // Also clear local outputs
      setState((state) => {
        const newAgentOutputs = new Map(state.agentOutputs);
        newAgentOutputs.delete(agentId);
        state.agentOutputs = newAgentOutputs;
      });
      notify();
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
        model?: ClaudeModel;
        useChrome?: boolean;
        skillIds?: string[];
        cwd?: string;
      }
    ): void {
      const state = getState();
      const agent = state.agents.get(agentId);
      if (agent) {
        setState((s) => {
          const updatedAgent = { ...agent };
          if (updates.class !== undefined) {
            updatedAgent.class = updates.class;
          }
          if (updates.permissionMode !== undefined) {
            updatedAgent.permissionMode = updates.permissionMode;
          }
          if (updates.model !== undefined) {
            updatedAgent.model = updates.model;
          }
          if (updates.useChrome !== undefined) {
            updatedAgent.useChrome = updates.useChrome;
          }
          if (updates.cwd !== undefined) {
            updatedAgent.cwd = updates.cwd;
          }
          const newAgents = new Map(s.agents);
          newAgents.set(agentId, updatedAgent);
          s.agents = newAgents;
        });
        notify();
      }

      getSendMessage()?.({
        type: 'update_agent_properties',
        payload: { agentId, updates },
      });
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
