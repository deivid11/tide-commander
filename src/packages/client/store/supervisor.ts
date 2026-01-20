/**
 * Supervisor Store Actions
 *
 * Handles supervisor state, reports, and narratives.
 */

import type {
  ClientMessage,
  SupervisorReport,
  SupervisorConfig,
  ActivityNarrative,
  AgentAnalysis,
  AgentSupervisorHistory,
  AgentSupervisorHistoryEntry,
} from '../../shared/types';
import type { StoreState } from './types';

export interface SupervisorActions {
  setSupervisorReport(report: SupervisorReport): void;
  addNarrative(agentId: string, narrative: ActivityNarrative): void;
  getNarratives(agentId: string): ActivityNarrative[];
  setSupervisorStatus(status: {
    enabled: boolean;
    lastReportTime: number | null;
    nextReportTime: number | null;
  }): void;
  setSupervisorConfig(config: Partial<SupervisorConfig>): void;
  requestSupervisorReport(): void;
  requestAgentSupervisorHistory(agentId: string): void;
  setAgentSupervisorHistory(history: AgentSupervisorHistory): void;
  getAgentSupervisorHistory(agentId: string): AgentSupervisorHistoryEntry[];
  addAgentAnalysis(agentId: string, analysis: AgentAnalysis): void;
  isLoadingHistoryForAgent(agentId: string): boolean;
  hasHistoryBeenFetched(agentId: string): boolean;
}

export function createSupervisorActions(
  getState: () => StoreState,
  setState: (updater: (state: StoreState) => void) => void,
  notify: () => void,
  getSendMessage: () => ((msg: ClientMessage) => void) | null
): SupervisorActions {
  return {
    setSupervisorReport(report: SupervisorReport): void {
      setState((state) => {
        state.supervisor.lastReport = report;
        state.supervisor.lastReportTime = report.timestamp;

        // Also update agent histories with the new report data
        const newHistories = new Map(state.supervisor.agentHistories);
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
          if (!agentHistory.some((e) => e.reportId === report.id)) {
            const updatedHistory = [newEntry, ...agentHistory];
            // Keep max 50 entries
            if (updatedHistory.length > 50) {
              updatedHistory.pop();
            }
            newHistories.set(analysis.agentId, updatedHistory);
          }
        }
        state.supervisor.agentHistories = newHistories;
        state.supervisor.generatingReport = false;
      });
      notify();
    },

    addNarrative(agentId: string, narrative: ActivityNarrative): void {
      setState((state) => {
        const agentNarratives = state.supervisor.narratives.get(agentId) || [];
        agentNarratives.unshift(narrative);
        if (agentNarratives.length > 50) {
          agentNarratives.pop();
        }
        const newNarratives = new Map(state.supervisor.narratives);
        newNarratives.set(agentId, agentNarratives);
        state.supervisor.narratives = newNarratives;
      });
      notify();
    },

    getNarratives(agentId: string): ActivityNarrative[] {
      return getState().supervisor.narratives.get(agentId) || [];
    },

    setSupervisorStatus(status: {
      enabled: boolean;
      lastReportTime: number | null;
      nextReportTime: number | null;
    }): void {
      setState((state) => {
        state.supervisor.enabled = status.enabled;
        state.supervisor.lastReportTime = status.lastReportTime;
        state.supervisor.nextReportTime = status.nextReportTime;
      });
      notify();
    },

    setSupervisorConfig(config: Partial<SupervisorConfig>): void {
      getSendMessage()?.({
        type: 'set_supervisor_config',
        payload: config,
      });
    },

    requestSupervisorReport(): void {
      setState((state) => {
        state.supervisor.generatingReport = true;
      });
      notify();
      getSendMessage()?.({
        type: 'request_supervisor_report',
        payload: {},
      });
    },

    requestAgentSupervisorHistory(agentId: string): void {
      setState((state) => {
        state.supervisor.loadingHistoryForAgent = agentId;
      });
      notify();
      getSendMessage()?.({
        type: 'request_agent_supervisor_history',
        payload: { agentId },
      });
    },

    setAgentSupervisorHistory(history: AgentSupervisorHistory): void {
      setState((state) => {
        const newHistories = new Map(state.supervisor.agentHistories);
        newHistories.set(history.agentId, history.entries);
        state.supervisor.agentHistories = newHistories;
        state.supervisor.historyFetchedForAgents.add(history.agentId);
        if (state.supervisor.loadingHistoryForAgent === history.agentId) {
          state.supervisor.loadingHistoryForAgent = null;
        }
      });
      notify();
    },

    getAgentSupervisorHistory(agentId: string): AgentSupervisorHistoryEntry[] {
      return getState().supervisor.agentHistories.get(agentId) || [];
    },

    addAgentAnalysis(agentId: string, analysis: AgentAnalysis): void {
      setState((state) => {
        const newHistories = new Map(state.supervisor.agentHistories);
        const agentHistory = newHistories.get(agentId) || [];

        const newEntry: AgentSupervisorHistoryEntry = {
          id: `single-${Date.now()}-${agentId}`,
          timestamp: Date.now(),
          reportId: `single-${Date.now()}`,
          analysis,
        };

        // Avoid duplicates within 5 seconds
        const recentDuplicate = agentHistory.some(
          (e) =>
            Math.abs(e.timestamp - newEntry.timestamp) < 5000 &&
            e.analysis.statusDescription === analysis.statusDescription
        );

        if (!recentDuplicate) {
          const updatedHistory = [newEntry, ...agentHistory];
          if (updatedHistory.length > 50) {
            updatedHistory.pop();
          }
          newHistories.set(agentId, updatedHistory);
          state.supervisor.agentHistories = newHistories;
        }
      });
      notify();
    },

    isLoadingHistoryForAgent(agentId: string): boolean {
      return getState().supervisor.loadingHistoryForAgent === agentId;
    },

    hasHistoryBeenFetched(agentId: string): boolean {
      return getState().supervisor.historyFetchedForAgents.has(agentId);
    },
  };
}
