/**
 * Custom hook for managing agent selection and related state
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useStore, store } from '../../store';
import type { Agent } from '../../../shared/types';
import type { RememberedPattern } from './types';

interface UseAgentSelectionOptions {
  agentId?: string;
}

interface AgentSelectionState {
  // Name editing state
  isEditingName: boolean;
  setIsEditingName: (value: boolean) => void;
  editName: string;
  setEditName: (value: string) => void;
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  handleNameSave: () => void;
  handleNameKeyDown: (e: React.KeyboardEvent) => void;

  // UI state
  showHistory: boolean;
  setShowHistory: (value: boolean) => void;
  showPatterns: boolean;
  setShowPatterns: (value: boolean) => void;
  showEditModal: boolean;
  setShowEditModal: (value: boolean) => void;
  showContextModal: boolean;
  setShowContextModal: (value: boolean) => void;

  // Remembered patterns (for interactive mode)
  rememberedPatterns: RememberedPattern[];
  handleRemovePattern: (tool: string, pattern: string) => Promise<void>;
  handleClearAllPatterns: () => Promise<void>;
}

export function useAgentSelection({ agentId }: UseAgentSelectionOptions): AgentSelectionState {
  const state = useStore();
  const agent = agentId ? state.agents.get(agentId) : undefined;

  // Name editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(agent?.name || '');
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // UI state
  const [showHistory, setShowHistory] = useState(true);
  const [showPatterns, setShowPatterns] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showContextModal, setShowContextModal] = useState(false);

  // Remembered patterns
  const [rememberedPatterns, setRememberedPatterns] = useState<RememberedPattern[]>([]);

  // Update editName when agent changes
  useEffect(() => {
    if (agent?.name) {
      setEditName(agent.name);
    }
  }, [agent?.name]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  // Fetch remembered patterns for interactive mode agents
  useEffect(() => {
    if (agent?.permissionMode === 'interactive') {
      fetch('http://localhost:5174/api/remembered-patterns')
        .then(res => res.json())
        .then(setRememberedPatterns)
        .catch(err => console.error('Failed to fetch remembered patterns:', err));
    }
  }, [agent?.permissionMode]);

  // Name save handler
  const handleNameSave = () => {
    if (!agentId || !agent) return;
    const trimmedName = editName.trim();
    if (trimmedName && trimmedName !== agent.name) {
      store.renameAgent(agentId, trimmedName);
    } else {
      setEditName(agent.name);
    }
    setIsEditingName(false);
  };

  // Name key down handler
  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameSave();
    } else if (e.key === 'Escape') {
      if (agent) {
        setEditName(agent.name);
      }
      setIsEditingName(false);
    }
  };

  // Pattern removal handler
  const handleRemovePattern = async (tool: string, pattern: string) => {
    try {
      const res = await fetch(`http://localhost:5174/api/remembered-patterns/${tool}/${encodeURIComponent(pattern)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setRememberedPatterns(prev => prev.filter(p => !(p.tool === tool && p.pattern === pattern)));
      }
    } catch (err) {
      console.error('Failed to remove pattern:', err);
    }
  };

  // Clear all patterns handler
  const handleClearAllPatterns = async () => {
    if (!confirm('Clear all remembered permission patterns?')) return;
    try {
      const res = await fetch('http://localhost:5174/api/remembered-patterns', {
        method: 'DELETE',
      });
      if (res.ok) {
        setRememberedPatterns([]);
      }
    } catch (err) {
      console.error('Failed to clear patterns:', err);
    }
  };

  return {
    isEditingName,
    setIsEditingName,
    editName,
    setEditName,
    nameInputRef,
    handleNameSave,
    handleNameKeyDown,
    showHistory,
    setShowHistory,
    showPatterns,
    setShowPatterns,
    showEditModal,
    setShowEditModal,
    showContextModal,
    setShowContextModal,
    rememberedPatterns,
    handleRemovePattern,
    handleClearAllPatterns,
  };
}

/**
 * Hook for managing idle timer updates
 */
export function useIdleTimer(status: string): void {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (status === 'idle') {
      const interval = setInterval(() => {
        setTick(t => t + 1);
      }, 15000);
      return () => clearInterval(interval);
    }
  }, [status]);
}

/**
 * Hook for fetching supervisor history on mount
 */
export function useSupervisorHistory(agentId: string): void {
  const isLoadingHistory = store.isLoadingHistoryForAgent(agentId);

  useEffect(() => {
    if (!store.hasHistoryBeenFetched(agentId) && !isLoadingHistory) {
      store.requestAgentSupervisorHistory(agentId);
    }
  }, [agentId, isLoadingHistory]);
}
