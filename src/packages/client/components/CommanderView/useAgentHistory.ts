/**
 * Custom hook for managing agent history loading, pagination, and caching
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Agent } from '../../../shared/types';
import type { AgentHistory } from './types';
import { MESSAGES_PER_PAGE } from './types';

interface UseAgentHistoryOptions {
  isOpen: boolean;
  agents: Map<string, Agent>;
}

interface UseAgentHistoryReturn {
  histories: Map<string, AgentHistory>;
  loadMoreHistory: (agentId: string) => Promise<void>;
}

export function useAgentHistory({ isOpen, agents }: UseAgentHistoryOptions): UseAgentHistoryReturn {
  const [histories, setHistories] = useState<Map<string, AgentHistory>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());

  // Clear loading state when closing to allow refresh on reopen
  useEffect(() => {
    if (!isOpen) {
      loadingRef.current.clear();
      setHistories(new Map());
    }
  }, [isOpen]);

  // Load history for all agents when view opens or agents change
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

    const loadHistory = async (agent: Agent) => {
      // Mark as loading in ref to prevent duplicate requests
      loadingRef.current.add(agent.id);

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
        setHistories(prev => {
          const newMap = new Map(prev);
          newMap.set(agent.id, {
            agentId: agent.id,
            messages: data.messages || [],
            loading: false,
            hasMore: data.hasMore || false,
            totalCount: data.totalCount || 0,
          });
          return newMap;
        });
      } catch (err) {
        console.error(`Failed to load history for ${agent.name}:`, err);
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
    const allAgents = Array.from(agents.values());
    for (const agent of allAgents) {
      if (!loadingRef.current.has(agent.id)) {
        loadHistory(agent);
      }
    }
  }, [isOpen, agents]);

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
