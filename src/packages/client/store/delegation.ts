/**
 * Delegation Store Actions
 *
 * Handles boss agent delegation logic.
 */

import type { ClientMessage, Agent, AgentClass, PermissionMode, ClaudeModel, DelegationDecision } from '../../shared/types';
import type { StoreState, AgentTaskProgress } from './types';

export interface DelegationActions {
  // Boss agent spawning
  spawnBossAgent(
    name: string,
    agentClass: AgentClass,
    cwd: string,
    position?: { x: number; z: number },
    subordinateIds?: string[],
    useChrome?: boolean,
    permissionMode?: PermissionMode,
    model?: ClaudeModel,
    customInstructions?: string
  ): void;

  // Subordinate management
  assignSubordinates(bossId: string, subordinateIds: string[]): void;
  removeSubordinate(bossId: string, subordinateId: string): void;
  updateBossSubordinates(bossId: string, subordinateIds: string[]): void;
  getSubordinates(bossId: string): Agent[];
  getAvailableSubordinates(): Agent[];

  // Boss commands and delegation
  sendBossCommand(bossId: string, command: string): void;
  requestDelegationHistory(bossId: string): void;
  handleDelegationDecision(decision: DelegationDecision): void;
  setDelegationHistory(bossId: string, decisions: DelegationDecision[]): void;
  getDelegationHistory(bossId: string): DelegationDecision[];

  // Delegation tracking
  getLastDelegationReceived(agentId: string): { bossName: string; taskCommand: string; timestamp: number } | null;
  clearLastDelegationReceived(agentId: string): void;

  // Boss helpers
  isBossAgent(agentId: string): boolean;
  getBossForAgent(agentId: string): Agent | null;

  // Agent task progress tracking (for subordinates in boss terminal)
  handleAgentTaskStarted(bossId: string, subordinateId: string, subordinateName: string, taskDescription: string): void;
  handleAgentTaskOutput(bossId: string, subordinateId: string, output: string): void;
  handleAgentTaskCompleted(bossId: string, subordinateId: string, success: boolean): void;
  getAgentTaskProgress(bossId: string): Map<string, AgentTaskProgress>;
  clearAgentTaskProgress(bossId: string, subordinateId?: string): void;
}

export function createDelegationActions(
  getState: () => StoreState,
  setState: (updater: (state: StoreState) => void) => void,
  notify: () => void,
  getSendMessage: () => ((msg: ClientMessage) => void) | null
): DelegationActions {
  return {
    spawnBossAgent(
      name: string,
      agentClass: AgentClass,
      cwd: string,
      position?: { x: number; z: number },
      subordinateIds?: string[],
      useChrome?: boolean,
      permissionMode?: PermissionMode,
      model?: ClaudeModel,
      customInstructions?: string
    ): void {
      const pos3d = position ? { x: position.x, y: 0, z: position.z } : undefined;
      getSendMessage()?.({
        type: 'spawn_boss_agent',
        payload: { name, class: agentClass, cwd, position: pos3d, subordinateIds, useChrome, permissionMode, model, customInstructions },
      });
    },

    assignSubordinates(bossId: string, subordinateIds: string[]): void {
      getSendMessage()?.({
        type: 'assign_subordinates',
        payload: { bossId, subordinateIds },
      });
    },

    removeSubordinate(bossId: string, subordinateId: string): void {
      getSendMessage()?.({
        type: 'remove_subordinate',
        payload: { bossId, subordinateId },
      });
    },

    sendBossCommand(bossId: string, command: string): void {
      setState((state) => {
        state.pendingDelegation = { bossId, command };
      });
      notify();

      getSendMessage()?.({
        type: 'send_boss_command',
        payload: { bossId, command },
      });
    },

    requestDelegationHistory(bossId: string): void {
      getSendMessage()?.({
        type: 'request_delegation_history',
        payload: { bossId },
      });
    },

    handleDelegationDecision(decision: DelegationDecision): void {
      setState((state) => {
        // Add to history
        const newHistories = new Map(state.delegationHistories);
        const bossHistory = newHistories.get(decision.bossId) || [];

        // Update or add decision
        const existingIdx = bossHistory.findIndex((d) => d.id === decision.id);
        if (existingIdx !== -1) {
          bossHistory[existingIdx] = decision;
        } else {
          bossHistory.unshift(decision);
          if (bossHistory.length > 100) {
            bossHistory.pop();
          }
        }
        newHistories.set(decision.bossId, bossHistory);
        state.delegationHistories = newHistories;

        // Track that the subordinate received a delegated task
        if (decision.status === 'sent' && decision.selectedAgentId) {
          const boss = state.agents.get(decision.bossId);
          const newReceived = new Map(state.lastDelegationReceived);
          newReceived.set(decision.selectedAgentId, {
            bossName: boss?.name || 'Boss',
            taskCommand: decision.userCommand,
            timestamp: Date.now(),
          });
          state.lastDelegationReceived = newReceived;
        }

        // Clear pending if this is the result
        if (state.pendingDelegation?.bossId === decision.bossId && decision.status !== 'pending') {
          state.pendingDelegation = null;
        }
      });
      notify();
    },

    setDelegationHistory(bossId: string, decisions: DelegationDecision[]): void {
      setState((state) => {
        const newHistories = new Map(state.delegationHistories);
        newHistories.set(bossId, decisions);
        state.delegationHistories = newHistories;
      });
      notify();
    },

    getDelegationHistory(bossId: string): DelegationDecision[] {
      return getState().delegationHistories.get(bossId) || [];
    },

    getLastDelegationReceived(
      agentId: string
    ): { bossName: string; taskCommand: string; timestamp: number } | null {
      return getState().lastDelegationReceived.get(agentId) || null;
    },

    clearLastDelegationReceived(agentId: string): void {
      const state = getState();
      if (state.lastDelegationReceived.has(agentId)) {
        setState((s) => {
          const newReceived = new Map(s.lastDelegationReceived);
          newReceived.delete(agentId);
          s.lastDelegationReceived = newReceived;
        });
        notify();
      }
    },

    updateBossSubordinates(bossId: string, subordinateIds: string[]): void {
      const state = getState();
      const boss = state.agents.get(bossId);
      if (boss) {
        setState((s) => {
          const updatedBoss = { ...boss, subordinateIds };
          const newAgents = new Map(s.agents);
          newAgents.set(bossId, updatedBoss);
          s.agents = newAgents;
        });
        notify();
      }
    },

    getSubordinates(bossId: string): Agent[] {
      const state = getState();
      const boss = state.agents.get(bossId);
      // Check both isBoss property and class === 'boss' for backward compatibility
      const isBoss = boss?.isBoss === true || boss?.class === 'boss';
      if (!boss || !isBoss || !boss.subordinateIds) return [];

      return boss.subordinateIds
        .map((id) => state.agents.get(id))
        .filter((agent): agent is Agent => agent !== undefined);
    },

    isBossAgent(agentId: string): boolean {
      const agent = getState().agents.get(agentId);
      return agent?.isBoss === true || agent?.class === 'boss';
    },

    getBossForAgent(agentId: string): Agent | null {
      const state = getState();
      const agent = state.agents.get(agentId);
      if (!agent?.bossId) return null;
      return state.agents.get(agent.bossId) || null;
    },

    getAvailableSubordinates(): Agent[] {
      return Array.from(getState().agents.values()).filter((agent) => agent.class !== 'boss');
    },

    handleAgentTaskStarted(
      bossId: string,
      subordinateId: string,
      subordinateName: string,
      taskDescription: string
    ): void {
      setState((state) => {
        const newProgress = new Map(state.agentTaskProgress);
        let bossProgress = newProgress.get(bossId);
        if (!bossProgress) {
          bossProgress = new Map();
          newProgress.set(bossId, bossProgress);
        }
        bossProgress.set(subordinateId, {
          agentId: subordinateId,
          agentName: subordinateName,
          taskDescription,
          status: 'working',
          output: [],
          startedAt: Date.now(),
        });
        state.agentTaskProgress = newProgress;
      });
      notify();
    },

    handleAgentTaskOutput(bossId: string, subordinateId: string, output: string): void {
      setState((state) => {
        const bossProgress = state.agentTaskProgress.get(bossId);
        if (!bossProgress) return;

        const taskProgress = bossProgress.get(subordinateId);
        if (!taskProgress) return;

        // Create new map structure for immutability
        const newProgress = new Map(state.agentTaskProgress);
        const newBossProgress = new Map(bossProgress);
        newBossProgress.set(subordinateId, {
          ...taskProgress,
          output: [...taskProgress.output, output],
        });
        newProgress.set(bossId, newBossProgress);
        state.agentTaskProgress = newProgress;
      });
      notify();
    },

    handleAgentTaskCompleted(bossId: string, subordinateId: string, success: boolean): void {
      setState((state) => {
        const bossProgress = state.agentTaskProgress.get(bossId);
        if (!bossProgress) return;

        const taskProgress = bossProgress.get(subordinateId);
        if (!taskProgress) return;

        const newProgress = new Map(state.agentTaskProgress);
        const newBossProgress = new Map(bossProgress);
        newBossProgress.set(subordinateId, {
          ...taskProgress,
          status: success ? 'completed' : 'failed',
          completedAt: Date.now(),
        });
        newProgress.set(bossId, newBossProgress);
        state.agentTaskProgress = newProgress;
      });
      notify();
    },

    getAgentTaskProgress(bossId: string): Map<string, AgentTaskProgress> {
      return getState().agentTaskProgress.get(bossId) || new Map();
    },

    clearAgentTaskProgress(bossId: string, subordinateId?: string): void {
      setState((state) => {
        if (subordinateId) {
          const bossProgress = state.agentTaskProgress.get(bossId);
          if (bossProgress) {
            const newProgress = new Map(state.agentTaskProgress);
            const newBossProgress = new Map(bossProgress);
            newBossProgress.delete(subordinateId);
            newProgress.set(bossId, newBossProgress);
            state.agentTaskProgress = newProgress;
          }
        } else {
          const newProgress = new Map(state.agentTaskProgress);
          newProgress.delete(bossId);
          state.agentTaskProgress = newProgress;
        }
      });
      notify();
    },
  };
}
