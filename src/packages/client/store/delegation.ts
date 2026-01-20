/**
 * Delegation Store Actions
 *
 * Handles boss agent delegation logic.
 */

import type { ClientMessage, Agent, AgentClass, PermissionMode, ClaudeModel, DelegationDecision } from '../../shared/types';
import type { StoreState } from './types';

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
    model?: ClaudeModel
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
      model?: ClaudeModel
    ): void {
      const pos3d = position ? { x: position.x, y: 0, z: position.z } : undefined;
      getSendMessage()?.({
        type: 'spawn_boss_agent',
        payload: { name, class: agentClass, cwd, position: pos3d, subordinateIds, useChrome, permissionMode, model },
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
      if (!boss || boss.class !== 'boss' || !boss.subordinateIds) return [];

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
  };
}
