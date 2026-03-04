/**
 * useSwipeNavigation - Hook for swipe-based agent navigation
 *
 * Handles swipe gestures for navigating between agents on mobile,
 * including animation state and keyboard shortcuts (Alt+J/K).
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { store, useAreas, useToolExecutions, useSettings } from '../../store';
import { matchesShortcut } from '../../store/shortcuts';
import { useSwipeGesture } from '../../hooks';
import { STORAGE_KEYS, getStorage } from '../../utils/storage';
import type { VibrationIntensity } from '../../utils/haptics';
import type { Agent } from '../../../shared/types';

export interface UseSwipeNavigationProps {
  agents: Map<string, Agent>;
  selectedAgentId: string | null;
  isOpen: boolean;
  overviewPanelOpen: boolean;
  loadingHistory: boolean;
  /** Optional callback when modals are open to prevent navigation */
  hasModalOpen?: boolean;
  /** External ref for the swipeable output element */
  outputRef: React.RefObject<HTMLDivElement | null>;
}

export interface UseSwipeNavigationReturn {
  /** Sorted agents list matching visual order */
  sortedAgents: Agent[];
  /** Current swipe offset for visual feedback */
  swipeOffset: number;
  /** CSS class for swipe animation */
  swipeAnimationClass: string;
  /** Current agent index in sorted list */
  currentAgentIndex: number;
  /** Previous agent in list (for indicator) */
  prevAgent: Agent | undefined;
  /** Next agent in list (for indicator) */
  nextAgent: Agent | undefined;
  /** Ref for the swipeable header element */
  headerRef: React.RefObject<HTMLDivElement | null>;
  /** Ref for the swipeable output element */
  outputRef: React.RefObject<HTMLDivElement | null>;
  /** Handler for left swipe (next agent) */
  handleSwipeLeft: () => void;
  /** Handler for right swipe (prev agent) */
  handleSwipeRight: () => void;
}

export function useSwipeNavigation({
  agents,
  selectedAgentId,
  isOpen,
  overviewPanelOpen,
  loadingHistory,
  hasModalOpen = false,
  outputRef,
}: UseSwipeNavigationProps): UseSwipeNavigationReturn {
  const areas = useAreas();
  const toolExecutions = useToolExecutions();
  const settings = useSettings();
  const vibrationIntensity = (settings.vibrationIntensity ?? 1) as VibrationIntensity;
  const isAgentBarVisible = (): boolean => {
    if (typeof document === 'undefined') return false;
    const agentBar = document.querySelector<HTMLElement>('.agent-bar');
    if (!agentBar) return false;
    const style = window.getComputedStyle(agentBar);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = agentBar.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  // Match Agent Overview ordering so keyboard/swipe navigation follows the same visual sequence.
  const sortedAgents = useMemo(() => {
    const allAgents = Array.from(agents.values());

    // When overview is closed and the bottom agent toolbar is visible, use toolbar order for swipe nav.
    // This must replicate the AgentBar's area-grouped visual order exactly:
    //   Area A agents → Area B agents → ... → Unassigned agents
    // Each group preserves custom drag-reorder from useAgentOrder.
    if (!overviewPanelOpen && isAgentBarVisible()) {
      // 1. Build base agents (non-archived, sorted by createdAt) — same as AgentBar
      const baseAgents = allAgents
        .filter(agent => !store.isAgentInArchivedArea(agent.id))
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

      // 2. Apply saved custom order — same as useAgentOrder hook
      const savedOrder = getStorage<string[]>(STORAGE_KEYS.AGENT_ORDER, []);
      const baseIdSet = new Set(baseAgents.map(a => a.id));
      const validSaved = savedOrder.filter(id => baseIdSet.has(id));
      const newIds = baseAgents.filter(a => !validSaved.includes(a.id)).map(a => a.id);
      const finalOrder = [...validSaved, ...newIds];
      const agentMap = new Map(baseAgents.map(a => [a.id, a]));
      const orderedAgents = finalOrder
        .map(id => agentMap.get(id))
        .filter((a): a is Agent => a !== undefined);

      // 3. Group by area preserving custom order — same as AgentBar's agentGroups
      const groups = new Map<string | null, { name: string; agents: Agent[] }>();
      for (const agent of orderedAgents) {
        const area = store.getAreaForAgent(agent.id);
        const areaKey = area?.id ?? null;
        if (!groups.has(areaKey)) {
          groups.set(areaKey, { name: area?.name ?? '', agents: [] });
        }
        groups.get(areaKey)!.agents.push(agent);
      }

      // 4. Sort groups: areas alphabetically, unassigned (null) last — same as AgentBar
      const groupEntries = Array.from(groups.entries());
      groupEntries.sort(([keyA, groupA], [keyB, groupB]) => {
        if (keyA === null && keyB !== null) return 1;
        if (keyA !== null && keyB === null) return -1;
        if (keyA === null && keyB === null) return 0;
        return groupA.name.localeCompare(groupB.name);
      });

      // 5. Flatten groups to get final visual order
      return groupEntries.flatMap(([, group]) => group.agents);
    }

    type SortMode = 'name' | 'status' | 'recent';
    type FilterMode = 'all' | 'working' | 'idle' | 'error';
    interface AopConfig {
      groupByArea: boolean;
      sortMode: SortMode;
      filterMode: FilterMode;
      sameAreaOnly: boolean;
    }

    const aopConfig = getStorage<AopConfig>(STORAGE_KEYS.AOP_CONFIG, {
      groupByArea: true,
      sortMode: 'recent',
      filterMode: 'all',
      sameAreaOnly: false,
    });

    const state = store.getState();
    const toolsByAgent = new Map<string, number>();
    for (const exec of toolExecutions) {
      if (!toolsByAgent.has(exec.agentId)) {
        toolsByAgent.set(exec.agentId, exec.timestamp);
      }
    }

    const agentAreaMap = new Map<string, string>();
    for (const agent of allAgents) {
      const area = store.getAreaForAgent(agent.id);
      if (!area || area.archived) continue;
      agentAreaMap.set(agent.id, area.id);
    }

    let filteredAgents = allAgents.filter((agent) => {
      if (aopConfig.filterMode === 'working' && agent.status !== 'working') return false;
      if (aopConfig.filterMode === 'idle' && agent.status !== 'idle') return false;
      if (aopConfig.filterMode === 'error' && agent.status !== 'error') return false;

      if (aopConfig.sameAreaOnly && selectedAgentId) {
        const selectedAreaId = agentAreaMap.get(selectedAgentId) ?? null;
        const agentAreaId = agentAreaMap.get(agent.id) ?? null;
        if (selectedAreaId !== agentAreaId) return false;
      }
      return true;
    });

    const sortAgents = (list: Agent[]) => [...list].sort((a, b) => {
      if (aopConfig.sortMode === 'name') return a.name.localeCompare(b.name);
      if (aopConfig.sortMode === 'status') {
        // 1. Working/waiting agents always first
        const statusOrder = ['working', 'waiting_input', 'waiting_permission', 'error', 'idle', 'stopped'];
        const statusDiff = statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
        if (statusDiff !== 0) return statusDiff;

        // 2. Within same status: unread notifications first
        const aUnread = state.agentsWithUnseenOutput.has(a.id);
        const bUnread = state.agentsWithUnseenOutput.has(b.id);
        if (aUnread !== bUnread) return aUnread ? -1 : 1;

        // 3. Within working: sort by name for stable ordering
        if (a.status === 'working' && b.status === 'working') {
          return a.name.localeCompare(b.name);
        }

        // 4. Within idle: boss agents first, then taskLabel, then most recently active
        if (a.status === 'idle' && b.status === 'idle') {
          const aIsBoss = !!a.isBoss;
          const bIsBoss = !!b.isBoss;
          if (aIsBoss !== bIsBoss) return aIsBoss ? -1 : 1;
          const aHasTask = !!a.taskLabel;
          const bHasTask = !!b.taskLabel;
          if (aHasTask !== bHasTask) return aHasTask ? -1 : 1;
          return (b.lastActivity || 0) - (a.lastActivity || 0);
        }

        // 5. Most recently active first
        return (b.lastActivity || 0) - (a.lastActivity || 0);
      }
      const aTime = toolsByAgent.get(a.id) || 0;
      const bTime = toolsByAgent.get(b.id) || 0;
      return bTime - aTime;
    });

    if (!aopConfig.groupByArea) {
      return sortAgents(filteredAgents);
    }

    const result: Agent[] = [];
    const used = new Set<string>();

    for (const [areaId, area] of areas) {
      if (area.archived) continue;
      const areaAgents = filteredAgents.filter((agent) => agentAreaMap.get(agent.id) === areaId);
      if (areaAgents.length > 0) {
        const sortedAreaAgents = sortAgents(areaAgents);
        result.push(...sortedAreaAgents);
        for (const agent of sortedAreaAgents) {
          used.add(agent.id);
        }
      }
    }

    const unassigned = sortAgents(filteredAgents.filter((agent) => !used.has(agent.id)));
    result.push(...unassigned);
    filteredAgents = result;

    return filteredAgents;
  }, [agents, areas, toolExecutions, selectedAgentId, overviewPanelOpen]);

  // Swipe animation state
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swipeAnimationClass, setSwipeAnimationClass] = useState('');
  const swipeAnimationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track pending swipe direction for animation after agent switch
  const [pendingSwipeDirection, setPendingSwipeDirection] = useState<'left' | 'right' | null>(null);

  // Get current agent index
  const currentAgentIndex = selectedAgentId
    ? sortedAgents.findIndex((a) => a.id === selectedAgentId)
    : -1;

  // Get next/previous agent for indicators (left indicator = prev in list, right indicator = next in list)
  const prevAgent = currentAgentIndex > 0 ? sortedAgents[currentAgentIndex - 1] : sortedAgents[sortedAgents.length - 1];
  const nextAgent = currentAgentIndex < sortedAgents.length - 1 ? sortedAgents[currentAgentIndex + 1] : sortedAgents[0];

  // Refs for swipe targets
  const headerRef = useRef<HTMLDivElement>(null);

  // Swipe handlers — swipe left = previous agent (up in list), swipe right = next agent (down in list)
  const handleSwipeLeft = useCallback(() => {
    if (!selectedAgentId || sortedAgents.length <= 1) return;
    const currentIndex = sortedAgents.findIndex((a) => a.id === selectedAgentId);
    if (currentIndex === -1) return;
    const prevIndex = (currentIndex - 1 + sortedAgents.length) % sortedAgents.length;

    setPendingSwipeDirection('left');
    setSwipeOffset(0);
    setSwipeAnimationClass('');
    // Mark that this selection is from swipe to prevent autofocus
    store.setLastSelectionViaSwipe(true);
    store.selectAgent(sortedAgents[prevIndex].id);
  }, [selectedAgentId, sortedAgents]);

  const handleSwipeRight = useCallback(() => {
    if (!selectedAgentId || sortedAgents.length <= 1) return;
    const currentIndex = sortedAgents.findIndex((a) => a.id === selectedAgentId);
    if (currentIndex === -1) return;
    const nextIndex = (currentIndex + 1) % sortedAgents.length;

    setPendingSwipeDirection('right');
    setSwipeOffset(0);
    setSwipeAnimationClass('');
    // Mark that this selection is from swipe to prevent autofocus
    store.setLastSelectionViaSwipe(true);
    store.selectAgent(sortedAgents[nextIndex].id);
  }, [selectedAgentId, sortedAgents]);

  // Handle swipe movement for visual feedback
  const handleSwipeMove = useCallback((offset: number) => {
    setSwipeOffset(offset);
    setSwipeAnimationClass('is-swiping');
  }, []);

  // Handle swipe cancel
  const handleSwipeCancel = useCallback(() => {
    setSwipeAnimationClass('is-animating');
    setSwipeOffset(0);
    if (swipeAnimationTimeoutRef.current) {
      clearTimeout(swipeAnimationTimeoutRef.current);
    }
    swipeAnimationTimeoutRef.current = setTimeout(() => {
      setSwipeAnimationClass('');
    }, 100);
  }, []);

  // Trigger swipe-in animation after history finishes loading
  useEffect(() => {
    if (!pendingSwipeDirection || loadingHistory) return;

    const direction = pendingSwipeDirection;
    setPendingSwipeDirection(null);

    requestAnimationFrame(() => {
      setSwipeAnimationClass(direction === 'left' ? 'swipe-in-left' : 'swipe-in-right');
      swipeAnimationTimeoutRef.current = setTimeout(() => {
        setSwipeAnimationClass('');
      }, 120);
    });
  }, [pendingSwipeDirection, loadingHistory]);

  // Cleanup animation timeout on unmount
  useEffect(() => {
    return () => {
      if (swipeAnimationTimeoutRef.current) {
        clearTimeout(swipeAnimationTimeoutRef.current);
      }
    };
  }, []);

  // Attach swipe gesture to header
  useSwipeGesture(headerRef, {
    enabled: isOpen && sortedAgents.length > 1,
    // Gesture direction is intentionally inverted from keyboard next/prev semantics:
    // swipe left => previous agent, swipe right => next agent.
    onSwipeLeft: handleSwipeRight,
    onSwipeRight: handleSwipeLeft,
    onSwipeMove: handleSwipeMove,
    onSwipeCancel: handleSwipeCancel,
    threshold: 40,
    maxVerticalMovement: 50,
    vibrationIntensity,
  });

  // Attach swipe gesture to output area
  useSwipeGesture(outputRef, {
    enabled: isOpen && sortedAgents.length > 1,
    onSwipeLeft: handleSwipeRight,
    onSwipeRight: handleSwipeLeft,
    onSwipeMove: handleSwipeMove,
    onSwipeCancel: handleSwipeCancel,
    threshold: 50,
    maxVerticalMovement: 35,
    vibrationIntensity,
  });

  // Keyboard shortcuts for agent navigation (Alt+H / Alt+L)
  useEffect(() => {
    const handleAgentNavKeyDown = (e: KeyboardEvent) => {
      if (!isOpen || sortedAgents.length <= 1) return;
      if (hasModalOpen) return;

      const shortcuts = store.getShortcuts();
      const prevWorkingShortcut = shortcuts.find(s => s.id === 'prev-working-agent');
      const nextWorkingShortcut = shortcuts.find(s => s.id === 'next-working-agent');
      const prevAgentShortcut = shortcuts.find(s => s.id === 'prev-agent-terminal');
      const nextAgentShortcut = shortcuts.find(s => s.id === 'next-agent-terminal');
      const isAltShiftNext = e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyJ';
      const isAltShiftPrev = e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyK';

      // Previous working/unseen agent
      if (matchesShortcut(e, prevWorkingShortcut)) {
        e.preventDefault();
        const currentState = store.getState();

        // NEW: Prioritize unseen, fall back to working
        let targetAgents = sortedAgents.filter(a => currentState.agentsWithUnseenOutput.has(a.id));
        if (targetAgents.length === 0) {
          targetAgents = sortedAgents.filter(a => a.status === 'working');
        }
        if (targetAgents.length === 0) return;

        const currentIndex = selectedAgentId ? targetAgents.findIndex(a => a.id === selectedAgentId) : -1;
        const nextIndex = currentIndex === -1 ? targetAgents.length - 1 : (currentIndex - 1 + targetAgents.length) % targetAgents.length;
        store.selectAgent(targetAgents[nextIndex].id);
        return;
      }
      // Next working/unseen agent
      if (matchesShortcut(e, nextWorkingShortcut)) {
        e.preventDefault();
        const currentState = store.getState();

        // NEW: Prioritize unseen, fall back to working
        let targetAgents = sortedAgents.filter(a => currentState.agentsWithUnseenOutput.has(a.id));
        if (targetAgents.length === 0) {
          targetAgents = sortedAgents.filter(a => a.status === 'working');
        }
        if (targetAgents.length === 0) return;

        const currentIndex = selectedAgentId ? targetAgents.findIndex(a => a.id === selectedAgentId) : -1;
        const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % targetAgents.length;
        store.selectAgent(targetAgents[nextIndex].id);
        return;
      }
      // Previous agent
      if (matchesShortcut(e, prevAgentShortcut) || isAltShiftPrev) {
        e.preventDefault();
        handleSwipeLeft();
        return;
      }
      // Next agent
      if (matchesShortcut(e, nextAgentShortcut) || isAltShiftNext) {
        e.preventDefault();
        handleSwipeRight();
        return;
      }
    };
    document.addEventListener('keydown', handleAgentNavKeyDown);
    return () => document.removeEventListener('keydown', handleAgentNavKeyDown);
  }, [isOpen, sortedAgents, selectedAgentId, handleSwipeLeft, handleSwipeRight, hasModalOpen]);

  return {
    sortedAgents,
    swipeOffset,
    swipeAnimationClass,
    currentAgentIndex,
    prevAgent,
    nextAgent,
    headerRef,
    outputRef,
    handleSwipeLeft,
    handleSwipeRight,
  };
}
