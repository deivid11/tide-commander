import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore, store, ClaudeOutput } from '../store';
import type { Agent, DrawingArea, AgentClass } from '../../shared/types';
import { AGENT_CLASS_CONFIG, DEFAULT_NAMES, CHARACTER_MODELS } from '../scene/config';
import { FileExplorerPanel } from './FileExplorerPanel';
import { matchesShortcut } from '../store/shortcuts';
import {
  TOOL_ICONS,
  isHumanReadableOutput,
  isErrorResult,
  formatTimestamp,
} from '../utils/outputRendering';
import { formatTokens } from '../utils/formatting';

interface HistoryMessage {
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result';
  content: string;
  timestamp: string;
  toolName?: string;
}

interface AgentHistory {
  agentId: string;
  messages: HistoryMessage[];
  loading: boolean;
  hasMore: boolean;
  totalCount: number;
}

// Constants for pagination
const MESSAGES_PER_PAGE = 30;
const SCROLL_THRESHOLD = 50;

interface AttachedFile {
  id: number;
  name: string;
  path: string;
  isImage: boolean;
  size: number;
}

interface CommanderViewProps {
  isOpen: boolean;
  onClose: () => void;
}

const AGENTS_PER_PAGE = 20;

const GRID_COLS = 3;

// Tab types: 'all', 'unassigned', or area ID
type TabId = 'all' | 'unassigned' | string;

const COMMANDER_TAB_KEY = 'tide-commander-tab';

export function CommanderView({ isOpen, onClose }: CommanderViewProps) {
  const state = useStore();
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    return localStorage.getItem(COMMANDER_TAB_KEY) || 'all';
  });
  const [page, setPage] = useState(0);
  const [histories, setHistories] = useState<Map<string, AgentHistory>>(new Map());
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [showSpawnForm, setShowSpawnForm] = useState(false);
  const [fileExplorerAreaId, setFileExplorerAreaId] = useState<string | null>(null);
  const [advancedView, setAdvancedView] = useState(false);
  const [, forceUpdate] = useState(0);
  const loadingRef = useRef<Set<string>>(new Set());
  const inputRefs = useRef<Map<string, HTMLInputElement | HTMLTextAreaElement>>(new Map());
  const visibleAgentsRef = useRef<Agent[]>([]);

  // Subscribe to store changes when opened (areas are loaded from server via WebSocket)
  useEffect(() => {
    if (!isOpen) return;
    return store.subscribe(() => {
      forceUpdate(n => n + 1);
    });
  }, [isOpen]);

  // Clear loading state when closing to allow refresh on reopen
  useEffect(() => {
    if (!isOpen) {
      loadingRef.current.clear();
      setHistories(new Map());
      setExpandedAgentId(null);
      setFocusedIndex(0);
      setShowSpawnForm(false);
    }
  }, [isOpen]);

  // Build tabs list: All, areas sorted alphabetically, Unassigned
  const tabs = useMemo(() => {
    const areasArray = Array.from(state.areas.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const tabList: { id: TabId; name: string; color?: string }[] = [
      { id: 'all', name: 'All' }
    ];
    for (const area of areasArray) {
      tabList.push({ id: area.id, name: area.name, color: area.color });
    }
    tabList.push({ id: 'unassigned', name: 'Unassigned' });
    return tabList;
  }, [state.areas]);

  // Get current area for spawn
  const currentArea = useMemo(() => {
    if (activeTab === 'all' || activeTab === 'unassigned') return null;
    return state.areas.get(activeTab) || null;
  }, [activeTab, state.areas]);

  // Sort and filter agents by active tab
  // Bosses always appear first, then sorted by creation time
  const filteredAgents = useMemo(() => {
    const agents = Array.from(state.agents.values()).sort((a, b) => {
      // Bosses first
      if (a.class === 'boss' && b.class !== 'boss') return -1;
      if (a.class !== 'boss' && b.class === 'boss') return 1;
      // Then by creation time
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

    if (activeTab === 'all') return agents;
    if (activeTab === 'unassigned') {
      return agents.filter(agent => !store.getAreaForAgent(agent.id));
    }
    // Filter by specific area
    return agents.filter(agent => {
      const area = store.getAreaForAgent(agent.id);
      return area?.id === activeTab;
    });
  }, [state.agents, activeTab]);

  const totalPages = Math.ceil(filteredAgents.length / AGENTS_PER_PAGE);
  const visibleAgents = filteredAgents.slice(page * AGENTS_PER_PAGE, (page + 1) * AGENTS_PER_PAGE);

  // Keep ref in sync for focus effect (avoids re-focusing on terminal updates)
  visibleAgentsRef.current = visibleAgents;

  // Reset page and save tab when switching tabs
  useEffect(() => {
    setPage(0);
    localStorage.setItem(COMMANDER_TAB_KEY, activeTab);
  }, [activeTab]);

  // Load history for all agents when view opens or agents change
  useEffect(() => {
    if (!isOpen) return;

    // Get current agent IDs
    const currentAgentIds = new Set(Array.from(state.agents.keys()));

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
        newMap.set(agent.id, { agentId: agent.id, messages: [], loading: true, hasMore: false, totalCount: 0 });
        return newMap;
      });

      if (!agent.sessionId) {
        // No session yet - mark as done loading with empty messages
        setHistories(prev => {
          const newMap = new Map(prev);
          newMap.set(agent.id, { agentId: agent.id, messages: [], loading: false, hasMore: false, totalCount: 0 });
          return newMap;
        });
        return;
      }

      try {
        console.log(`[CommanderView] Fetching history for agent ${agent.id} (${agent.name}), sessionId: ${agent.sessionId}`);
        const res = await fetch(`/api/agents/${agent.id}/history?limit=${MESSAGES_PER_PAGE}&offset=0`);
        const data = await res.json();
        console.log(`[CommanderView] Got ${data.messages?.length || 0} messages for agent ${agent.id}:`, data.sessionId);
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
          newMap.set(agent.id, { agentId: agent.id, messages: [], loading: false, hasMore: false, totalCount: 0 });
          return newMap;
        });
      }
    };

    // Load history for all agents - use ref to track loading status
    const allAgents = Array.from(state.agents.values());
    console.log(`[CommanderView] Loading history for ${allAgents.length} agents`);
    for (const agent of allAgents) {
      console.log(`[CommanderView] Agent ${agent.name}: sessionId=${agent.sessionId}, inLoadingRef=${loadingRef.current.has(agent.id)}`);
      if (!loadingRef.current.has(agent.id)) {
        loadHistory(agent);
      }
    }
  }, [isOpen, state.agents]);

  // Load more history for a specific agent
  const loadMoreHistory = useCallback(async (agentId: string) => {
    const agent = state.agents.get(agentId);
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
  }, [state.agents, histories]);

  // Focus input when focusedIndex changes or when expanded (not on terminal updates)
  useEffect(() => {
    if (!isOpen) return;
    const agentId = expandedAgentId || visibleAgentsRef.current[focusedIndex]?.id;
    if (agentId) {
      const input = inputRefs.current.get(agentId);
      if (input && document.activeElement !== input) {
        setTimeout(() => input.focus(), 50);
      }
    }
  }, [isOpen, focusedIndex, expandedAgentId]);

  // Keyboard shortcuts (use capture phase to handle before inputs)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const shortcuts = store.getShortcuts();
      const target = e.target as HTMLElement;
      const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      const maxIndex = visibleAgents.length - 1;

      // Escape: collapse or close
      const closeShortcut = shortcuts.find(s => s.id === 'commander-close');
      if (matchesShortcut(e, closeShortcut)) {
        e.preventDefault();
        e.stopPropagation();
        if (expandedAgentId) {
          setExpandedAgentId(null);
        } else {
          onClose();
        }
        return;
      }

      // Vim-style navigation
      const vimLeftShortcut = shortcuts.find(s => s.id === 'commander-vim-left');
      if (matchesShortcut(e, vimLeftShortcut) && !expandedAgentId) {
        e.preventDefault();
        setFocusedIndex(i => i > 0 ? i - 1 : i);
        return;
      }

      const vimRightShortcut = shortcuts.find(s => s.id === 'commander-vim-right');
      if (matchesShortcut(e, vimRightShortcut) && !expandedAgentId) {
        e.preventDefault();
        setFocusedIndex(i => i < maxIndex ? i + 1 : i);
        return;
      }

      const vimUpShortcut = shortcuts.find(s => s.id === 'commander-vim-up');
      if (matchesShortcut(e, vimUpShortcut) && !expandedAgentId) {
        e.preventDefault();
        setFocusedIndex(i => i >= GRID_COLS ? i - GRID_COLS : i);
        return;
      }

      const vimDownShortcut = shortcuts.find(s => s.id === 'commander-vim-down');
      if (matchesShortcut(e, vimDownShortcut) && !expandedAgentId) {
        e.preventDefault();
        setFocusedIndex(i => i + GRID_COLS <= maxIndex ? i + GRID_COLS : i);
        return;
      }

      // Toggle expand
      const expandShortcut = shortcuts.find(s => s.id === 'commander-expand');
      if (matchesShortcut(e, expandShortcut)) {
        e.preventDefault();
        if (expandedAgentId) {
          setExpandedAgentId(null);
        } else if (visibleAgents[focusedIndex]) {
          setExpandedAgentId(visibleAgents[focusedIndex].id);
        }
        return;
      }

      // New agent
      const newAgentShortcut = shortcuts.find(s => s.id === 'commander-new-agent');
      if (matchesShortcut(e, newAgentShortcut)) {
        e.preventDefault();
        setShowSpawnForm(true);
        return;
      }

      // Tab key to cycle through area tabs
      const nextTabShortcut = shortcuts.find(s => s.id === 'commander-next-tab');
      const prevTabShortcut = shortcuts.find(s => s.id === 'commander-prev-tab');
      if (!isInputFocused) {
        if (matchesShortcut(e, nextTabShortcut)) {
          e.preventDefault();
          e.stopPropagation();
          const currentIndex = tabs.findIndex(t => t.id === activeTab);
          const nextIndex = (currentIndex + 1) % tabs.length;
          setActiveTab(tabs[nextIndex].id);
          setFocusedIndex(0);
          return;
        }
        if (matchesShortcut(e, prevTabShortcut)) {
          e.preventDefault();
          e.stopPropagation();
          const currentIndex = tabs.findIndex(t => t.id === activeTab);
          const nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
          setActiveTab(tabs[nextIndex].id);
          setFocusedIndex(0);
          return;
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose, expandedAgentId, visibleAgents, focusedIndex, tabs, activeTab]);

  if (!isOpen) return null;

  return (
    <div className="commander-overlay" onClick={onClose}>
      <div className="commander-view" onClick={e => e.stopPropagation()}>
        <div className="commander-header">
          <div className="commander-title-section">
            <h2 className="commander-title">Commander View</h2>
            <span className="commander-shortcuts">
              Tab switch areas • ⌥H/J/K/L nav • ⌥O expand • ⌥N new
            </span>
          </div>
          <div className="commander-controls">
            <button
              className={`commander-view-toggle ${advancedView ? 'active' : ''}`}
              onClick={() => setAdvancedView(!advancedView)}
              title={advancedView ? 'Show simple view' : 'Show advanced view'}
            >
              {advancedView ? '◉ Advanced' : '○ Simple'}
            </button>
            <button
              className="commander-add-btn"
              onClick={() => setShowSpawnForm(true)}
              title="Add Agent (⌥N)"
            >
              + Add Agent
            </button>
            <button className="commander-close" onClick={onClose}>
              Close (Esc)
            </button>
          </div>
        </div>

        {/* Area Tabs */}
        <div className="commander-tabs">
          {tabs.map(tab => {
            const area = tab.id !== 'all' && tab.id !== 'unassigned' ? state.areas.get(tab.id) : null;
            const hasDirectories = area && area.directories && area.directories.length > 0;

            return (
              <button
                key={tab.id}
                className={`commander-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => { setActiveTab(tab.id); setFocusedIndex(0); }}
                style={tab.color ? { borderBottomColor: activeTab === tab.id ? tab.color : 'transparent' } : undefined}
              >
                {tab.color && <span className="commander-tab-dot" style={{ background: tab.color }} />}
                <span>{tab.name}</span>
                <span className="commander-tab-count">
                  {tab.id === 'all'
                    ? state.agents.size
                    : tab.id === 'unassigned'
                      ? Array.from(state.agents.values()).filter(a => !store.getAreaForAgent(a.id)).length
                      : Array.from(state.agents.values()).filter(a => store.getAreaForAgent(a.id)?.id === tab.id).length
                  }
                </span>
                {hasDirectories && (
                  <span
                    className="commander-tab-folder"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFileExplorerAreaId(tab.id);
                    }}
                    title="Open file explorer"
                  >
                    📁
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="commander-pagination">
            <button
              className="commander-page-btn"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              ← Prev
            </button>
            <span className="commander-page-info">
              Page {page + 1} of {totalPages} ({filteredAgents.length} agents)
            </span>
            <button
              className="commander-page-btn"
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
            >
              Next →
            </button>
          </div>
        )}

        <div className={`commander-grid ${expandedAgentId ? 'has-expanded' : ''}`} data-agent-count={visibleAgents.length}>
          {visibleAgents.length === 0 ? (
            <div className="commander-empty">
              {activeTab === 'all'
                ? 'No agents deployed. Press ⌥N to add an agent.'
                : activeTab === 'unassigned'
                  ? 'No unassigned agents.'
                  : `No agents in this area. Press ⌥N to add one.`
              }
            </div>
          ) : expandedAgentId ? (
            // Show only expanded agent
            (() => {
              const agent = state.agents.get(expandedAgentId);
              if (!agent) return null;
              return (
                <AgentPanel
                  key={agent.id}
                  agent={agent}
                  history={histories.get(agent.id)}
                  outputs={store.getOutputs(agent.id)}
                  isExpanded={true}
                  isFocused={true}
                  advancedView={advancedView}
                  onExpand={() => setExpandedAgentId(null)}
                  inputRef={(el) => { if (el) inputRefs.current.set(agent.id, el); }}
                  onLoadMore={() => loadMoreHistory(agent.id)}
                />
              );
            })()
          ) : (
            visibleAgents.map((agent, index) => (
              <AgentPanel
                key={agent.id}
                agent={agent}
                history={histories.get(agent.id)}
                outputs={store.getOutputs(agent.id)}
                isExpanded={false}
                isFocused={index === focusedIndex}
                advancedView={advancedView}
                onExpand={() => setExpandedAgentId(agent.id)}
                onFocus={() => setFocusedIndex(index)}
                inputRef={(el) => { if (el) inputRefs.current.set(agent.id, el); }}
                onLoadMore={() => loadMoreHistory(agent.id)}
              />
            ))
          )}
        </div>

        {/* Spawn Form Modal */}
        {showSpawnForm && (
          <SpawnForm
            currentArea={currentArea}
            onClose={() => setShowSpawnForm(false)}
          />
        )}

        {/* File Explorer Panel */}
        {fileExplorerAreaId && (
          <FileExplorerPanel
            isOpen={true}
            areaId={fileExplorerAreaId}
            onClose={() => setFileExplorerAreaId(null)}
            onChangeArea={(newAreaId) => setFileExplorerAreaId(newAreaId)}
          />
        )}
      </div>
    </div>
  );
}

interface AgentPanelProps {
  agent: Agent;
  history?: AgentHistory;
  outputs: ClaudeOutput[];
  isExpanded: boolean;
  isFocused: boolean;
  advancedView: boolean;
  onExpand: () => void;
  onFocus?: () => void;
  inputRef: (el: HTMLInputElement | HTMLTextAreaElement | null) => void;
  onLoadMore?: () => void;
}

// Tool icons and helper functions imported from ../utils/outputRendering

function AgentPanel({ agent, history, outputs, isExpanded, isFocused, advancedView, onExpand, onFocus, inputRef, onLoadMore }: AgentPanelProps) {
  const state = useStore();
  const outputRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [command, setCommand] = useState('');
  const [forceTextarea, setForceTextarea] = useState(false);
  const [pastedTexts, setPastedTexts] = useState<Map<number, string>>(new Map());
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const pastedCountRef = useRef(0);
  const fileCountRef = useRef(0);
  const scrollPositionRef = useRef<number>(0);

  // Get supervisor status for this agent
  const supervisorStatus = useMemo(() => {
    const report = state.supervisor?.lastReport;
    if (!report?.agentSummaries) return null;
    return report.agentSummaries.find(
      s => s.agentId === agent.id || s.agentName === agent.name
    );
  }, [state.supervisor?.lastReport, agent.id, agent.name]);

  // Calculate context usage info
  const contextInfo = useMemo(() => {
    const stats = agent.contextStats;
    if (stats) {
      const usedPercent = stats.usedPercent;
      const freePercent = 100 - usedPercent;
      return {
        usedPercent,
        freePercent,
        hasData: true,
        totalTokens: stats.totalTokens,
        contextWindow: stats.contextWindow,
      };
    }
    // Fallback to basic calculation
    const used = agent.contextUsed || 0;
    const limit = agent.contextLimit || 200000;
    const usedPercent = (used / limit) * 100;
    return {
      usedPercent,
      freePercent: 100 - usedPercent,
      hasData: false,
      totalTokens: used,
      contextWindow: limit,
    };
  }, [agent.contextStats, agent.contextUsed, agent.contextLimit]);

  // Handle scroll to detect when to load more
  const handleScroll = useCallback(() => {
    if (!outputRef.current || loadingMore || !history?.hasMore || !onLoadMore) return;

    // Check if scrolled near top
    if (outputRef.current.scrollTop < SCROLL_THRESHOLD) {
      setLoadingMore(true);
      // Save scroll position
      scrollPositionRef.current = outputRef.current.scrollHeight - outputRef.current.scrollTop;
      onLoadMore();
      // loadingMore will be reset when history updates
    }
  }, [loadingMore, history?.hasMore, onLoadMore]);

  // Reset loadingMore when history changes
  useEffect(() => {
    if (loadingMore && history && !history.loading) {
      setLoadingMore(false);
      // Restore scroll position after new messages are prepended
      requestAnimationFrame(() => {
        if (outputRef.current) {
          outputRef.current.scrollTop = outputRef.current.scrollHeight - scrollPositionRef.current;
        }
      });
    }
  }, [history, loadingMore]);

  // Use textarea if: forced, has newlines, or text is long
  const hasNewlines = command.includes('\n');
  const useTextarea = forceTextarea || hasNewlines || command.length > 50;

  // Calculate textarea rows based on content
  const getTextareaRows = () => {
    const lineCount = (command.match(/\n/g) || []).length + 1;
    const charRows = Math.ceil(command.length / 50); // ~50 chars per row (narrower panels)
    const rows = Math.max(lineCount, charRows, 2);
    return Math.min(rows, 8); // Max 8 rows
  };

  // Upload file to server
  const uploadFile = async (file: File | Blob, filename?: string): Promise<AttachedFile | null> => {
    try {
      const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Filename': filename || (file instanceof File ? file.name : ''),
        },
        body: file,
      });

      if (!response.ok) {
        console.error('Upload failed:', await response.text());
        return null;
      }

      const data = await response.json();
      fileCountRef.current += 1;

      return {
        id: fileCountRef.current,
        name: data.filename,
        path: data.absolutePath, // Use absolute filesystem path for Claude Code to read
        isImage: data.isImage,
        size: data.size,
      };
    } catch (err) {
      console.error('Upload error:', err);
      return null;
    }
  };

  // Handle paste event - collapse large pastes into variables or upload images
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;

    // Check for images first
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          const attached = await uploadFile(blob);
          if (attached) {
            setAttachedFiles(prev => [...prev, attached]);
          }
        }
        return;
      }
    }

    // Check for files
    const files = e.clipboardData.files;
    if (files.length > 0) {
      e.preventDefault();
      for (const file of files) {
        const attached = await uploadFile(file);
        if (attached) {
          setAttachedFiles(prev => [...prev, attached]);
        }
      }
      return;
    }

    // Handle text paste (collapse large text)
    const pastedText = e.clipboardData.getData('text');
    const lineCount = (pastedText.match(/\n/g) || []).length + 1;

    // If pasting more than 5 lines, collapse into a variable
    if (lineCount > 5) {
      e.preventDefault();
      pastedCountRef.current += 1;
      const pasteId = pastedCountRef.current;

      // Store the pasted text
      setPastedTexts(prev => new Map(prev).set(pasteId, pastedText));

      // Insert placeholder in command
      const placeholder = `[Pasted text #${pasteId} +${lineCount} lines]`;
      const target = e.target as HTMLInputElement | HTMLTextAreaElement;
      const start = target.selectionStart || 0;
      const end = target.selectionEnd || 0;
      const newCommand = command.slice(0, start) + placeholder + command.slice(end);
      setCommand(newCommand);

      // Auto-expand to textarea if needed
      if (!useTextarea) {
        setForceTextarea(true);
      }
    }
  };

  // Handle file input change
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of files) {
      const attached = await uploadFile(file);
      if (attached) {
        setAttachedFiles(prev => [...prev, attached]);
      }
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Remove attached file
  const removeAttachedFile = (id: number) => {
    setAttachedFiles(prev => prev.filter(f => f.id !== id));
  };

  // Expand pasted text placeholders before sending
  const expandPastedTexts = (text: string): string => {
    let expanded = text;
    for (const [id, pastedText] of pastedTexts) {
      const placeholder = new RegExp(`\\[Pasted text #${id} \\+\\d+ lines\\]`, 'g');
      expanded = expanded.replace(placeholder, pastedText);
    }
    return expanded;
  };

  // Auto-scroll on new content
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history?.messages.length, outputs.length]);

  const handleSend = () => {
    if (!command.trim() && attachedFiles.length === 0) return;

    // Build the full command with attachments
    let fullCommand = expandPastedTexts(command.trim());

    // Add file references for Claude to read
    if (attachedFiles.length > 0) {
      const fileRefs = attachedFiles.map(f => {
        if (f.isImage) {
          return `[Image: ${f.path}]`;
        } else {
          return `[File: ${f.path}]`;
        }
      }).join('\n');

      if (fullCommand) {
        fullCommand = `${fullCommand}\n\n${fileRefs}`;
      } else {
        fullCommand = fileRefs;
      }
    }

    store.sendCommand(agent.id, fullCommand);
    setCommand('');
    setForceTextarea(false);
    setPastedTexts(new Map());
    setAttachedFiles([]);
    pastedCountRef.current = 0;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Shift+Enter: switch to textarea mode (from input) or add newline (in textarea)
    if (e.key === 'Enter' && e.shiftKey) {
      if (!useTextarea) {
        e.preventDefault();
        setForceTextarea(true);
      }
      // In textarea, let default behavior add newline
      return;
    }
    // Regular Enter: send command
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const statusColor = {
    idle: '#4aff9e',
    working: '#4a9eff',
    waiting: '#ff9e4a',
    waiting_permission: '#ffcc00',
    error: '#ff4a4a',
    offline: '#888888',
    orphaned: '#ff9e4a',
  }[agent.status] || '#888888';

  return (
    <div
      className={`agent-panel ${agent.status === 'working' ? 'working' : ''} ${isExpanded ? 'expanded' : ''} ${isFocused ? 'focused' : ''}`}
      onClick={onFocus}
    >
      <div className="agent-panel-header">
        <div className="agent-panel-info">
          <span
            className="agent-panel-status"
            style={{ background: statusColor }}
            title={agent.status}
          />
          <span className="agent-panel-name">
            {agent.class === 'boss' && <span className="agent-panel-boss-crown">👑</span>}
            {agent.name}
          </span>
          <span className="agent-panel-class">{agent.class}</span>
          <span className="agent-panel-id" title={`ID: ${agent.id}`}>
            [{agent.id.substring(0, 4)}]
          </span>
        </div>
        {/* Context usage indicator */}
        <div
          className="agent-panel-context"
          title={`Context: ${Math.round(contextInfo.usedPercent)}% used (${formatTokens(contextInfo.totalTokens)} / ${formatTokens(contextInfo.contextWindow)})`}
        >
          <div
            className="agent-panel-context-bar"
            style={{
              background: contextInfo.freePercent < 20
                ? '#ff4a4a'
                : contextInfo.freePercent < 50
                  ? '#ff9e4a'
                  : '#4aff9e',
              width: `${contextInfo.freePercent}%`,
            }}
          />
          <span className="agent-panel-context-text">
            {Math.round(contextInfo.freePercent)}%
          </span>
        </div>
        <div className="agent-panel-actions">
          {agent.currentTask && (
            <div className="agent-panel-task" title={agent.currentTask}>
              {agent.currentTask.substring(0, 40)}...
            </div>
          )}
          <button
            className="agent-panel-expand"
            onClick={onExpand}
            title={isExpanded ? 'Collapse (Esc)' : 'Expand'}
          >
            {isExpanded ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Supervisor Status */}
      {supervisorStatus && (
        <div className="agent-panel-supervisor-status">
          {supervisorStatus.statusDescription}
        </div>
      )}

      <div className="agent-panel-content" ref={outputRef} onScroll={handleScroll}>
        {history?.loading ? (
          <div className="agent-panel-loading">Loading...</div>
        ) : (
          <>
            {/* Load more indicator */}
            {history?.hasMore && (
              <div className="agent-panel-load-more">
                {loadingMore ? (
                  <span>Loading...</span>
                ) : (
                  <button onClick={onLoadMore}>
                    Load more ({(history?.totalCount || 0) - (history?.messages.length || 0)})
                  </button>
                )}
              </div>
            )}
            {history?.messages
              .filter(msg => advancedView || msg.type === 'user' || msg.type === 'assistant')
              .map((msg, i) => (
                <MessageLine key={`h-${i}`} message={msg} />
              ))}
            {outputs
              .filter(output => advancedView || output.isUserPrompt || isHumanReadableOutput(output.text))
              .map((output, i) => (
                <OutputLine key={`o-${i}`} output={output} />
              ))}
            {(!history?.messages.length && !outputs.length) && (
              <div className="agent-panel-empty">
                No messages yet
                {!agent.sessionId && <div style={{fontSize: '10px', color: '#666'}}>No session ID</div>}
              </div>
            )}
            {agent.status === 'working' && (
              <div className="agent-panel-typing">
                <span className="typing-dot"></span>
                <span className="typing-dot"></span>
                <span className="typing-dot"></span>
                <button
                  className="agent-panel-stop-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    store.stopAgent(agent.id);
                  }}
                  title="Stop current operation"
                >
                  Stop
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Attached files display */}
      {attachedFiles.length > 0 && (
        <div className="agent-panel-attachments">
          {attachedFiles.map(file => (
            <div key={file.id} className={`agent-panel-attachment ${file.isImage ? 'is-image' : ''}`}>
              <span className="agent-panel-attachment-icon">{file.isImage ? '🖼️' : '📎'}</span>
              <span className="agent-panel-attachment-name" title={file.path}>{file.name}</span>
              <button
                className="agent-panel-attachment-remove"
                onClick={() => removeAttachedFile(file.id)}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={`agent-panel-input ${useTextarea ? 'agent-panel-input-expanded' : ''}`}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          style={{ display: 'none' }}
          accept="image/*,.txt,.md,.json,.js,.ts,.tsx,.jsx,.py,.sh,.css,.scss,.html,.xml,.yaml,.yml,.toml,.ini,.cfg,.conf"
        />
        <button
          className="agent-panel-attach-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Attach file (or paste image)"
        >
          📎
        </button>
        {useTextarea ? (
          <textarea
            ref={inputRef as React.RefCallback<HTMLTextAreaElement>}
            placeholder={`Command ${agent.name}... (paste image)`}
            value={command}
            onChange={e => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={getTextareaRows()}
          />
        ) : (
          <input
            ref={inputRef as React.RefCallback<HTMLInputElement>}
            type="text"
            placeholder={`Command ${agent.name}... (paste image)`}
            value={command}
            onChange={e => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
          />
        )}
        <button onClick={handleSend} disabled={!command.trim() && attachedFiles.length === 0}>
          Send
        </button>
      </div>
    </div>
  );
}

function MessageLine({ message }: { message: HistoryMessage }) {
  const { type, content, toolName, timestamp } = message;

  // Format timestamp for display
  const timeStr = timestamp ? formatTimestamp(timestamp) : '';

  // NO TRUNCATION - show full content
  if (type === 'tool_use') {
    const icon = TOOL_ICONS[toolName || ''] || TOOL_ICONS.default;
    // Try to format content nicely
    let formattedContent = content;
    try {
      const parsed = JSON.parse(content);
      formattedContent = JSON.stringify(parsed, null, 2);
    } catch {
      // Not JSON, use as-is
    }

    return (
      <div className="msg-line msg-tool">
        <div className="msg-tool-header">
          {timeStr && <span className="msg-timestamp">{timeStr}</span>}
          <span className="msg-tool-icon">{icon}</span>
          <span className="msg-tool-name">{toolName}</span>
        </div>
        <pre className="msg-tool-content">{formattedContent}</pre>
      </div>
    );
  }

  if (type === 'tool_result') {
    // Determine if result is success/error using shared utility
    const isError = isErrorResult(content);
    const resultIcon = isError ? '❌' : '✓';

    return (
      <div className={`msg-line msg-result ${isError ? 'msg-result-error' : 'msg-result-success'}`}>
        <div className="msg-result-header">
          {timeStr && <span className="msg-timestamp">{timeStr}</span>}
          <span className="msg-result-icon">{resultIcon}</span>
          <span className="msg-result-label">{isError ? 'Error' : 'Result'}</span>
        </div>
        <pre className="msg-result-content">{content}</pre>
      </div>
    );
  }

  const isUser = type === 'user';

  return (
    <div className={`msg-line ${isUser ? 'msg-user' : 'msg-assistant'}`}>
      {timeStr && <span className="msg-timestamp">{timeStr}</span>}
      <span className="msg-role">{isUser ? 'You' : 'Claude'}</span>
      <span className="msg-content markdown-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </span>
    </div>
  );
}

function OutputLine({ output }: { output: ClaudeOutput }) {
  const { text, isStreaming, isUserPrompt, timestamp } = output;

  // Format timestamp for display
  const timeStr = formatTimestamp(timestamp || Date.now());

  // Handle user prompts
  if (isUserPrompt) {
    return (
      <div className="msg-line msg-user msg-live">
        <span className="msg-timestamp">{timeStr}</span>
        <span className="msg-role">You</span>
        <span className="msg-content markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </span>
      </div>
    );
  }

  // Handle tool usage messages
  if (text.startsWith('Using tool:')) {
    const toolName = text.replace('Using tool:', '').trim();
    const icon = TOOL_ICONS[toolName] || TOOL_ICONS.default;
    return (
      <div className="msg-line msg-tool msg-live">
        <div className="msg-tool-header">
          <span className="msg-timestamp">{timeStr}</span>
          <span className="msg-tool-icon">{icon}</span>
          <span className="msg-tool-name">{toolName}</span>
          {isStreaming && <span className="msg-tool-streaming">...</span>}
        </div>
      </div>
    );
  }

  // Handle tool result messages
  if (text.startsWith('Tool result:')) {
    const resultContent = text.replace('Tool result:', '').trim();
    const isError = isErrorResult(resultContent);
    const resultIcon = isError ? '❌' : '✓';
    return (
      <div className={`msg-line msg-result msg-live ${isError ? 'msg-result-error' : 'msg-result-success'}`}>
        <div className="msg-result-header">
          <span className="msg-timestamp">{timeStr}</span>
          <span className="msg-result-icon">{resultIcon}</span>
          <span className="msg-result-label">{isError ? 'Error' : 'Result'}</span>
        </div>
        <pre className="msg-result-content">{resultContent}</pre>
      </div>
    );
  }

  let className = 'msg-line msg-output msg-assistant msg-live';
  if (isStreaming) className += ' streaming';

  return (
    <div className={className}>
      <span className="msg-timestamp">{timeStr}</span>
      <span className="msg-role">Claude</span>
      <span className="msg-content markdown-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </span>
    </div>
  );
}

// Inline spawn form for commander view
interface SpawnFormProps {
  currentArea: DrawingArea | null;
  onClose: () => void;
}

function SpawnForm({ currentArea, onClose }: SpawnFormProps) {
  const [name, setName] = useState(() => {
    const usedNames = new Set(Array.from(store.getState().agents.values()).map(a => a.name));
    return DEFAULT_NAMES.find(n => !usedNames.has(n)) || `Agent-${Date.now().toString(36)}`;
  });
  const [cwd, setCwd] = useState(() => localStorage.getItem('tide-last-cwd') || '');
  const [selectedClass, setSelectedClass] = useState<AgentClass>('scout');
  const [isSpawning, setIsSpawning] = useState(false);

  const handleSpawn = () => {
    if (!name.trim() || !cwd.trim()) return;

    setIsSpawning(true);
    localStorage.setItem('tide-last-cwd', cwd);

    // Calculate position based on area center
    let position: { x: number; z: number } | undefined;
    if (currentArea) {
      // Place in center of area
      position = {
        x: currentArea.center.x,
        z: currentArea.center.z
      };
    }

    store.spawnAgent(name.trim(), selectedClass, cwd.trim(), position);

    // Close after a short delay
    setTimeout(() => {
      onClose();
    }, 500);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSpawn();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="commander-spawn-overlay" onClick={onClose}>
      <div className="commander-spawn-form" onClick={e => e.stopPropagation()}>
        <div className="commander-spawn-header">
          <h3>Add New Agent</h3>
          {currentArea && (
            <span className="commander-spawn-area">
              <span className="commander-spawn-area-dot" style={{ background: currentArea.color }} />
              {currentArea.name}
            </span>
          )}
        </div>

        <div className="commander-spawn-body">
          <div className="commander-spawn-field">
            <label>Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </div>

          <div className="commander-spawn-field">
            <label>Working Directory</label>
            <input
              type="text"
              value={cwd}
              onChange={e => setCwd(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="/path/to/project"
            />
          </div>

          <div className="commander-spawn-field">
            <label>Class</label>
            <div className="commander-spawn-classes">
              {CHARACTER_MODELS.map(char => {
                const config = AGENT_CLASS_CONFIG[char.id];
                return (
                  <button
                    key={char.id}
                    className={`commander-spawn-class ${selectedClass === char.id ? 'selected' : ''}`}
                    onClick={() => setSelectedClass(char.id)}
                  >
                    <span className="commander-spawn-class-icon">{config.icon}</span>
                    <span>{char.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="commander-spawn-footer">
          <button className="commander-spawn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="commander-spawn-submit"
            onClick={handleSpawn}
            disabled={!name.trim() || !cwd.trim() || isSpawning}
          >
            {isSpawning ? 'Deploying...' : 'Deploy Agent'}
          </button>
        </div>
      </div>
    </div>
  );
}
