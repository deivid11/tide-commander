/**
 * useSwipeNavigation - Hook for swipe-based agent navigation
 *
 * Handles swipe gestures for navigating between agents on mobile,
 * including animation state and keyboard shortcuts (Alt+J/K).
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { store, useAreas } from '../../store';
import { useSwipeGesture } from '../../hooks';
import type { Agent } from '../../../shared/types';

export interface UseSwipeNavigationProps {
  agents: Map<string, Agent>;
  selectedAgentId: string | null;
  isOpen: boolean;
  loadingHistory: boolean;
  /** Optional callback when modals are open to prevent navigation */
  hasModalOpen?: boolean;
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
  loadingHistory,
  hasModalOpen = false,
}: UseSwipeNavigationProps): UseSwipeNavigationReturn {
  // Get areas for grouping agents
  const areas = useAreas();

  // Memoized sorted agents list matching AgentBar's visual order
  const sortedAgents = useMemo(() => {
    const agentList = Array.from(agents.values()).sort(
      (a, b) => (a.createdAt || 0) - (b.createdAt || 0)
    );

    // Group agents by their area
    const groups = new Map<string | null, { area: { name: string } | null; agents: typeof agentList }>();

    for (const agent of agentList) {
      const area = store.getAreaForAgent(agent.id);
      const areaKey = area?.id || null;

      if (!groups.has(areaKey)) {
        groups.set(areaKey, { area: area ? { name: area.name } : null, agents: [] });
      }
      groups.get(areaKey)!.agents.push(agent);
    }

    // Sort groups: areas first (alphabetically), then unassigned
    const groupArray = Array.from(groups.values());
    groupArray.sort((a, b) => {
      if (!a.area && b.area) return 1;
      if (a.area && !b.area) return -1;
      if (!a.area && !b.area) return 0;
      return (a.area?.name || '').localeCompare(b.area?.name || '');
    });

    return groupArray.flatMap((group) => group.agents);
  }, [agents, areas]);

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

  // Get next/previous agent for indicators
  const prevAgent = currentAgentIndex > 0 ? sortedAgents[currentAgentIndex - 1] : sortedAgents[sortedAgents.length - 1];
  const nextAgent = currentAgentIndex < sortedAgents.length - 1 ? sortedAgents[currentAgentIndex + 1] : sortedAgents[0];

  // Refs for swipe targets
  const headerRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // Swipe handlers
  const handleSwipeLeft = useCallback(() => {
    if (!selectedAgentId || sortedAgents.length <= 1) return;
    const currentIndex = sortedAgents.findIndex((a) => a.id === selectedAgentId);
    if (currentIndex === -1) return;
    const nextIndex = (currentIndex + 1) % sortedAgents.length;

    setPendingSwipeDirection('left');
    setSwipeOffset(0);
    setSwipeAnimationClass('');
    store.selectAgent(sortedAgents[nextIndex].id);
  }, [selectedAgentId, sortedAgents]);

  const handleSwipeRight = useCallback(() => {
    if (!selectedAgentId || sortedAgents.length <= 1) return;
    const currentIndex = sortedAgents.findIndex((a) => a.id === selectedAgentId);
    if (currentIndex === -1) return;
    const prevIndex = (currentIndex - 1 + sortedAgents.length) % sortedAgents.length;

    setPendingSwipeDirection('right');
    setSwipeOffset(0);
    setSwipeAnimationClass('');
    store.selectAgent(sortedAgents[prevIndex].id);
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
    onSwipeLeft: handleSwipeLeft,
    onSwipeRight: handleSwipeRight,
    onSwipeMove: handleSwipeMove,
    onSwipeCancel: handleSwipeCancel,
    threshold: 40,
    maxVerticalMovement: 50,
  });

  // Attach swipe gesture to output area
  useSwipeGesture(outputRef, {
    enabled: isOpen && sortedAgents.length > 1,
    onSwipeLeft: handleSwipeLeft,
    onSwipeRight: handleSwipeRight,
    onSwipeMove: handleSwipeMove,
    onSwipeCancel: handleSwipeCancel,
    threshold: 50,
    maxVerticalMovement: 35,
  });

  // Keyboard shortcuts for agent navigation (Alt+J / Alt+K)
  useEffect(() => {
    const handleAgentNavKeyDown = (e: KeyboardEvent) => {
      if (!isOpen || sortedAgents.length <= 1) return;
      if (hasModalOpen) return;

      // Alt+K → previous agent
      if (e.altKey && e.key === 'k') {
        e.preventDefault();
        handleSwipeRight();
      }
      // Alt+J → next agent
      if (e.altKey && e.key === 'j') {
        e.preventDefault();
        handleSwipeLeft();
      }
    };
    document.addEventListener('keydown', handleAgentNavKeyDown);
    return () => document.removeEventListener('keydown', handleAgentNavKeyDown);
  }, [isOpen, sortedAgents.length, handleSwipeLeft, handleSwipeRight, hasModalOpen]);

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
