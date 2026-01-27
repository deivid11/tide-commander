import { useState, useEffect, useCallback, useMemo } from 'react';
import { STORAGE_KEYS, getStorage, setStorage } from '../utils/storage';
import type { Agent } from '../../shared/types';

// Custom event for syncing agent order across components
const AGENT_ORDER_CHANGE_EVENT = 'agent-order-change';

/**
 * Hook to manage agent order in the toolbar with localStorage persistence.
 * Resilient to agents being removed - filters out non-existent agent IDs.
 * Syncs across all component instances via custom events.
 */
export function useAgentOrder(agents: Agent[]) {
  // Get current agent IDs for validation
  const currentAgentIds = useMemo(() => new Set(agents.map(a => a.id)), [agents]);

  // Load saved order from localStorage
  const [savedOrder, setSavedOrder] = useState<string[]>(() => {
    return getStorage<string[]>(STORAGE_KEYS.AGENT_ORDER, []);
  });

  // Listen for order changes from other components
  useEffect(() => {
    const handleOrderChange = (e: CustomEvent<string[]>) => {
      setSavedOrder(e.detail);
    };

    window.addEventListener(AGENT_ORDER_CHANGE_EVENT, handleOrderChange as EventListener);
    return () => {
      window.removeEventListener(AGENT_ORDER_CHANGE_EVENT, handleOrderChange as EventListener);
    };
  }, []);

  // Compute the effective ordered agents list
  const orderedAgents = useMemo(() => {
    // Filter saved order to only include existing agents
    const validSavedOrder = savedOrder.filter(id => currentAgentIds.has(id));

    // Find agents that exist but aren't in saved order (new agents)
    const newAgentIds = agents
      .filter(a => !validSavedOrder.includes(a.id))
      .map(a => a.id);

    // Combine: saved order (valid only) + new agents at the end
    const finalOrder = [...validSavedOrder, ...newAgentIds];

    // Map IDs to actual agent objects
    const agentMap = new Map(agents.map(a => [a.id, a]));
    return finalOrder
      .map(id => agentMap.get(id))
      .filter((a): a is Agent => a !== undefined);
  }, [agents, savedOrder, currentAgentIds]);

  // Save order to localStorage and broadcast to other components
  const saveOrder = useCallback((order: string[]) => {
    setSavedOrder(order);
    setStorage(STORAGE_KEYS.AGENT_ORDER, order);
    // Broadcast change to other components using this hook
    window.dispatchEvent(new CustomEvent(AGENT_ORDER_CHANGE_EVENT, { detail: order }));
  }, []);

  // Move an agent from one index to another
  const moveAgent = useCallback((fromIndex: number, toIndex: number) => {
    const currentOrder = orderedAgents.map(a => a.id);
    const [movedId] = currentOrder.splice(fromIndex, 1);
    currentOrder.splice(toIndex, 0, movedId);
    saveOrder(currentOrder);
  }, [orderedAgents, saveOrder]);

  // Reset order (clear saved order, fall back to creation time)
  const resetOrder = useCallback(() => {
    setSavedOrder([]);
    setStorage(STORAGE_KEYS.AGENT_ORDER, []);
  }, []);

  // Clean up saved order when agents change (remove stale IDs)
  // IMPORTANT: Only run cleanup when agents have actually loaded (size > 0)
  // Otherwise, on initial render before agents load, we'd clear the saved order
  useEffect(() => {
    // Don't clean up if agents haven't loaded yet
    if (currentAgentIds.size === 0) {
      return;
    }

    const validOrder = savedOrder.filter(id => currentAgentIds.has(id));
    if (validOrder.length !== savedOrder.length) {
      // Some agents were removed, update storage
      saveOrder(validOrder);
    }
  }, [currentAgentIds, savedOrder, saveOrder]);

  return {
    orderedAgents,
    moveAgent,
    resetOrder,
  };
}
