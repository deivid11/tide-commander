/**
 * Custom hook for managing agent history loading, pagination, and caching
 *
 * On reconnect:
 * 1. Preserves current outputs from store before clearing
 * 2. Loads history from server (JSONL file)
 * 3. Merges preserved outputs with history to capture any messages
 *    that weren't persisted to the file yet (race condition fix)
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Agent } from '../../../shared/types';
import type { AgentHistory } from './types';
import type { ClaudeOutput } from '../../store/types';
import { MESSAGES_PER_PAGE } from './types';
import { useReconnectCount, store } from '../../store';
import { apiUrl, authFetch } from '../../utils/storage';

const HISTORY_LIVE_DEDUP_WINDOW_MS = 120_000;

function normalizeMessage(text: string): string {
  return text.trim().replace(/\r\n/g, '\n');
}

function buildOutputHistoryKey(type: 'user' | 'assistant', content: string): string {
  return `${type}:${normalizeMessage(content)}`;
}

function shouldKeepOutput(
  output: ClaudeOutput,
  historyUuidSet: Set<string>,
  latestHistoryTsByKey: Map<string, number>,
  lastHistoryTimestamp: number
): boolean {
  if (output.uuid && historyUuidSet.has(output.uuid)) {
    return false;
  }

  const outputType: 'user' | 'assistant' = output.isUserPrompt ? 'user' : 'assistant';
  const key = buildOutputHistoryKey(outputType, output.text);
  const outputTs = output.timestamp || 0;
  const historyTs = latestHistoryTsByKey.get(key);

  if (historyTs !== undefined && Math.abs(outputTs - historyTs) <= HISTORY_LIVE_DEDUP_WINDOW_MS) {
    return false;
  }

  return outputTs > lastHistoryTimestamp;
}

/**
 * Compare two Maps for equality by checking if all keys and values are the same.
 * For Agent values, we only compare the id to avoid re-renders on status changes.
 */
function _agentMapKeysEqual(a: Map<string, Agent>, b: Map<string, Agent>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const key of a.keys()) {
    if (!b.has(key)) return false;
  }
  return true;
}

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

  // Track previous agents map to only reload when agents are added/removed, not updated
  const _prevAgentsRef = useRef<Map<string, Agent>>(agents);

  // Only trigger effect when agent IDs change (not when agent status/outputs change)
  const agentIds = useMemo(() => {
    const ids = Array.from(agents.keys()).sort().join(',');
    return ids;
  }, [agents]);

  // Also track which agents have sessionIds to reload when they get one
  const agentSessionIds = useMemo(() => {
    return Array.from(agents.values())
      .map(a => `${a.id}:${a.sessionId || ''}`)
      .sort()
      .join(',');
  }, [agents]);

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
        const res = await authFetch(apiUrl(`/api/agents/${agent.id}/history?limit=${MESSAGES_PER_PAGE}&offset=0`));
        const data = await res.json();
        const historyMessages = (data.messages || []) as import('./types').HistoryMessage[];

        // Find the most recent history timestamp
        const lastHistoryTimestamp = historyMessages.length > 0
          ? Math.max(...historyMessages.map(m => m.timestamp ? new Date(m.timestamp).getTime() : 0))
          : 0;
        const historyUuidSet = new Set(historyMessages.map(m => m.uuid).filter((uuid): uuid is string => !!uuid));
        const latestHistoryTsByKey = new Map<string, number>();
        for (const msg of historyMessages) {
          if (msg.type !== 'user' && msg.type !== 'assistant') continue;
          const key = buildOutputHistoryKey(msg.type, msg.content);
          const msgTs = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
          const prev = latestHistoryTsByKey.get(key) ?? 0;
          if (msgTs > prev) latestHistoryTsByKey.set(key, msgTs);
        }

        // Get current outputs from store
        const currentOutputs = store.getOutputs(agent.id);

        // Combine preserved outputs (if any) with current outputs
        const allOutputs = preserved && preserved.length > 0
          ? [...preserved, ...currentOutputs]
          : currentOutputs;

        const newerOutputs = allOutputs.filter((output) => shouldKeepOutput(
          output,
          historyUuidSet,
          latestHistoryTsByKey,
          lastHistoryTimestamp
        ));

        // Clear and restore only newer outputs
        store.clearOutputs(agent.id);
        for (const output of newerOutputs) {
          store.addOutput(agent.id, output);
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
  }, [isOpen, agentIds, agentSessionIds, reconnectCount]); // Only reload when agent IDs or sessionIds change, not on every agent update

  // Keep refs to avoid recreating callback on every agents/histories change
  const agentsRef = useRef(agents);
  const historiesRef = useRef(histories);
  agentsRef.current = agents;
  historiesRef.current = histories;

  // Load more history for a specific agent (pagination)
  // Using refs to avoid recreating this callback when agents/histories change
  const loadMoreHistory = useCallback(async (agentId: string) => {
    const agent = agentsRef.current.get(agentId);
    const currentHistory = historiesRef.current.get(agentId);
    if (!agent?.sessionId || !currentHistory || !currentHistory.hasMore) return;

    const currentOffset = currentHistory.messages.length;

    try {
      const res = await fetch(
        apiUrl(`/api/agents/${agentId}/history?limit=${MESSAGES_PER_PAGE}&offset=${currentOffset}`)
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
  }, []); // No dependencies - uses refs

  return { histories, loadMoreHistory };
}
