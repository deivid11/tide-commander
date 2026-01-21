/**
 * Custom hook for managing agent history loading, pagination, and caching
 *
 * On reconnect:
 * 1. Preserves current outputs from store before clearing
 * 2. Loads history from server (JSONL file)
 * 3. Merges preserved outputs with history to capture any messages
 *    that weren't persisted to the file yet (race condition fix)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Agent } from '../../../shared/types';
import type { AgentHistory } from './types';
import type { ClaudeOutput } from '../../store/types';
import { MESSAGES_PER_PAGE } from './types';
import { useReconnectCount, store } from '../../store';

interface UseAgentHistoryOptions {
  isOpen: boolean;
  agents: Map<string, Agent>;
}

interface UseAgentHistoryReturn {
  histories: Map<string, AgentHistory>;
  loadMoreHistory: (agentId: string) => Promise<void>;
}

export function useAgentHistory({ isOpen, agents }: UseAgentHistoryOptions): UseAgentHistoryReturn {
  const reconnectCount = useReconnectCount(); // Watch for reconnections to refresh history
  const [histories, setHistories] = useState<Map<string, AgentHistory>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());

  // Clear loading state when closing to allow refresh on reopen
  useEffect(() => {
    if (!isOpen) {
      loadingRef.current.clear();
      setHistories(new Map());
    }
  }, [isOpen]);

  // Load history for all agents when view opens, agents change, or on reconnect
  useEffect(() => {
    if (!isOpen) return;

    // Get current agent IDs
    const currentAgentIds = new Set(Array.from(agents.keys()));

    // Clear loading ref for agents that no longer exist
    for (const id of loadingRef.current) {
      if (!currentAgentIds.has(id)) {
        loadingRef.current.delete(id);
      }
    }

    // Preserve outputs BEFORE clearing on reconnect
    // This captures any messages that may not have been persisted to the JSONL file yet
    let preservedOutputs: Map<string, ClaudeOutput[]> | null = null;
    if (reconnectCount > 0) {
      preservedOutputs = store.preserveOutputs();
      loadingRef.current.clear();
    }

    const loadHistory = async (agent: Agent, preserved: ClaudeOutput[] | undefined, delayMs = 0) => {
      // Mark as loading in ref to prevent duplicate requests
      loadingRef.current.add(agent.id);

      // If delay is specified, wait before loading to ensure JSONL file is fully written
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      // Set loading state
      setHistories(prev => {
        const newMap = new Map(prev);
        newMap.set(agent.id, {
          agentId: agent.id,
          messages: [],
          loading: true,
          hasMore: false,
          totalCount: 0,
        });
        return newMap;
      });

      if (!agent.sessionId) {
        // No session yet - mark as done loading with empty messages
        // But if we have preserved outputs, restore them
        if (preserved && preserved.length > 0) {
          store.mergeOutputsWithHistory(agent.id, [], preserved);
        }
        setHistories(prev => {
          const newMap = new Map(prev);
          newMap.set(agent.id, {
            agentId: agent.id,
            messages: [],
            loading: false,
            hasMore: false,
            totalCount: 0,
          });
          return newMap;
        });
        return;
      }

      try {
        const res = await fetch(`/api/agents/${agent.id}/history?limit=${MESSAGES_PER_PAGE}&offset=0`);
        const data = await res.json();
        const historyMessages = (data.messages || []) as import('./types').HistoryMessage[];

        // If we have preserved outputs, restore only the ones newer than history
        // Don't merge history into outputs - they have different formats
        // History is rendered by HistoryLine, outputs by OutputLine
        if (preserved && preserved.length > 0) {
          // Find the most recent history timestamp
          const lastHistoryTimestamp = historyMessages.length > 0
            ? Math.max(...historyMessages.map(m => m.timestamp ? new Date(m.timestamp).getTime() : 0))
            : 0;

          // Only keep outputs newer than history to avoid duplicates
          const newerOutputs = preserved.filter(o => o.timestamp > lastHistoryTimestamp);

          // Restore newer outputs
          store.clearOutputs(agent.id);
          for (const output of newerOutputs) {
            store.addOutput(agent.id, output);
          }
        }

        setHistories(prev => {
          const newMap = new Map(prev);
          newMap.set(agent.id, {
            agentId: agent.id,
            messages: historyMessages,
            loading: false,
            hasMore: data.hasMore || false,
            totalCount: data.totalCount || 0,
          });
          return newMap;
        });
      } catch (err) {
        console.error(`Failed to load history for ${agent.name}:`, err);
        // Even on error, restore preserved outputs if we have them
        if (preserved && preserved.length > 0) {
          store.clearOutputs(agent.id);
          for (const output of preserved) {
            store.addOutput(agent.id, output);
          }
        }
        setHistories(prev => {
          const newMap = new Map(prev);
          newMap.set(agent.id, {
            agentId: agent.id,
            messages: [],
            loading: false,
            hasMore: false,
            totalCount: 0,
          });
          return newMap;
        });
      }
    };

    // Load history for all agents - use ref to track loading status
    // On reconnect, add a small delay to ensure JSONL files are fully written by Claude
    const historyLoadDelay = reconnectCount > 0 ? 500 : 0;
    const allAgents = Array.from(agents.values());
    for (const agent of allAgents) {
      if (!loadingRef.current.has(agent.id)) {
        const preserved = preservedOutputs?.get(agent.id);
        loadHistory(agent, preserved, historyLoadDelay);
      }
    }
  }, [isOpen, agents, reconnectCount]); // reconnectCount triggers refresh on reconnection

  // Load more history for a specific agent (pagination)
  const loadMoreHistory = useCallback(async (agentId: string) => {
    const agent = agents.get(agentId);
    const currentHistory = histories.get(agentId);
    if (!agent?.sessionId || !currentHistory || !currentHistory.hasMore) return;

    const currentOffset = currentHistory.messages.length;

    try {
      const res = await fetch(
        `/api/agents/${agentId}/history?limit=${MESSAGES_PER_PAGE}&offset=${currentOffset}`
      );
      const data = await res.json();

      if (data.messages && data.messages.length > 0) {
        setHistories(prev => {
          const newMap = new Map(prev);
          const existing = prev.get(agentId);
          if (existing) {
            newMap.set(agentId, {
              ...existing,
              messages: [...data.messages, ...existing.messages],
              hasMore: data.hasMore || false,
            });
          }
          return newMap;
        });
      }
    } catch (err) {
      console.error(`Failed to load more history for agent ${agentId}:`, err);
    }
  }, [agents, histories]);

  return { histories, loadMoreHistory };
}
