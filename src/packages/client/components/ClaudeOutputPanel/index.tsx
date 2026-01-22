/**
 * ClaudeOutputPanel - Main component
 *
 * A Guake-style terminal interface for interacting with Claude agents.
 * Features:
 * - Conversation history with pagination
 * - Live streaming output
 * - Search functionality
 * - View modes (simple, chat, advanced)
 * - Permission request handling
 * - File attachments and image paste
 * - Resizable terminal height
 * - Agent switcher bar
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  useAgents,
  useSelectedAgentIds,
  useTerminalOpen,
  useLastPrompts,
  useSupervisor,
  useSettings,
  useAgentOutputs,
  store,
  ClaudeOutput,
  useContextModalAgentId,
  useFileViewerPath,
  useFileViewerEditData,
  useReconnectCount,
} from '../../store';
import type { AgentAnalysis } from '../../../shared/types';
import { filterCostText } from '../../utils/formatting';
import {
  STORAGE_KEYS,
  getStorageString,
  getStorageNumber,
  setStorageString,
  setStorageNumber,
  removeStorage,
} from '../../utils/storage';
import { extractToolKeyParam } from '../../utils/outputRendering';
import { ContextViewModal } from '../ContextViewModal';
import { FileViewerModal } from '../FileViewerModal';

// Import extracted components and utilities
import {
  ViewMode,
  VIEW_MODES,
  DEFAULT_TERMINAL_HEIGHT,
  MIN_TERMINAL_HEIGHT,
  MAX_TERMINAL_HEIGHT,
  MESSAGES_PER_PAGE,
  SCROLL_THRESHOLD,
  BASH_TRUNCATE_LENGTH,
} from './types';
import type { HistoryMessage, AttachedFile, EditData, EnrichedHistoryMessage } from './types';
import { markdownComponents } from './MarkdownComponents';
import { useFilteredOutputsWithLogging } from '../shared/useFilteredOutputs';
import { HistoryLine } from './HistoryLine';
import { OutputLine } from './OutputLine';
import { GuakeAgentLink } from './GuakeAgentLink';
import { PermissionRequestInline } from './PermissionRequest';
import { useTerminalInput } from './useTerminalInput';
import { getImageWebUrl } from './contentRendering';
import { AgentDebugPanel } from './AgentDebugPanel';
import { agentDebugger } from '../../services/agentDebugger';

export function ClaudeOutputPanel() {
  // Use granular selectors instead of useStore() to prevent unnecessary re-renders
  const agents = useAgents();
  const selectedAgentIds = useSelectedAgentIds();
  const terminalOpen = useTerminalOpen();
  const lastPrompts = useLastPrompts();
  const supervisor = useSupervisor();
  const settings = useSettings();
  const reconnectCount = useReconnectCount(); // Watch for reconnections to refresh history

  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const isUserScrolledUpRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // View mode state
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = getStorageString(STORAGE_KEYS.VIEW_MODE);
    if (saved === 'simple' || saved === 'chat' || saved === 'advanced') {
      return saved;
    }
    // Migrate from old boolean setting
    const oldSaved = getStorageString(STORAGE_KEYS.ADVANCED_VIEW);
    if (oldSaved === 'true') return 'advanced';
    return 'simple';
  });

  // Search state
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HistoryMessage[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Image modal state
  const [imageModal, setImageModal] = useState<{ url: string; name: string } | null>(null);

  // Bash output modal state - stores command and whether we're watching for live output
  const [bashModal, setBashModal] = useState<{ command: string; output: string; isLive?: boolean } | null>(null);

  // Context action confirmation modal
  const [contextConfirm, setContextConfirm] = useState<'collapse' | 'clear' | null>(null);

  // Debug panel state
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [debuggerEnabled, setDebuggerEnabled] = useState(() => agentDebugger.isEnabled());

  // Completion indicator state - shows briefly when agent finishes processing
  const [showCompletion, setShowCompletion] = useState(false);
  const prevStatusRef = useRef<string | null>(null);

  // Auto-enable debugger when panel is opened
  useEffect(() => {
    if (debugPanelOpen && !debuggerEnabled) {
      setDebuggerEnabled(true);
      agentDebugger.setEnabled(true);
    }
  }, [debugPanelOpen, debuggerEnabled]);

  // Terminal height state with storage persistence
  const [terminalHeight, setTerminalHeight] = useState(() => {
    const saved = getStorageNumber(STORAGE_KEYS.TERMINAL_HEIGHT, DEFAULT_TERMINAL_HEIGHT);
    if (saved >= MIN_TERMINAL_HEIGHT && saved <= MAX_TERMINAL_HEIGHT) {
      return saved;
    }
    return DEFAULT_TERMINAL_HEIGHT;
  });
  const isResizingRef = useRef(false);
  const resizeStartYRef = useRef(0);
  const resizeStartHeightRef = useRef(0);
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalHeightRef = useRef(terminalHeight);
  terminalHeightRef.current = terminalHeight;

  // Get selected agent
  const selectedAgentIdsArray = Array.from(selectedAgentIds);
  const isSingleSelection = selectedAgentIdsArray.length === 1;
  const selectedAgentId = isSingleSelection ? selectedAgentIdsArray[0] : null;
  const selectedAgent = selectedAgentId ? agents.get(selectedAgentId) : null;

  // Use the reactive hook for outputs
  const outputs = useAgentOutputs(selectedAgentId);

  // Detect when agent finishes processing and show completion indicator
  useEffect(() => {
    const currentStatus = selectedAgent?.status;
    const prevStatus = prevStatusRef.current;

    // If agent was working and is now idle, show completion
    if (prevStatus === 'working' && currentStatus === 'idle') {
      setShowCompletion(true);
      // Hide after animation completes
      const timer = setTimeout(() => setShowCompletion(false), 1000);
      return () => clearTimeout(timer);
    }

    prevStatusRef.current = currentStatus || null;
  }, [selectedAgent?.status]);

  // Use terminal input hook for per-agent input state
  const terminalInput = useTerminalInput({ selectedAgentId });
  const {
    command,
    setCommand,
    forceTextarea,
    setForceTextarea,
    useTextarea,
    pastedTexts,
    setPastedTexts,
    incrementPastedCount,
    resetPastedCount,
    attachedFiles,
    setAttachedFiles,
    removeAttachedFile,
    uploadFile,
    expandPastedTexts,
    getTextareaRows,
  } = terminalInput;


  // Get pending permission requests for this agent
  const pendingPermissions = selectedAgentId ? store.getPendingPermissionsForAgent(selectedAgentId) : [];

  // Use store's terminal state
  const isOpen = terminalOpen && selectedAgent !== null;


  // Memoized callbacks to prevent re-renders of child components
  const handleImageClick = useCallback((url: string, name: string) => {
    setImageModal({ url, name });
  }, []);

  const handleFileClick = useCallback((path: string, editData?: EditData) => {
    store.setFileViewerPath(path, editData);
  }, []);

  const handleBashClick = useCallback((command: string, output: string) => {
    // Check if this is a "running" message - mark as live so we can auto-update
    const isLive = output === 'Running...';
    setBashModal({ command, output, isLive });
  }, []);

  // Memoized sorted agents list for the agent links bar
  const sortedAgents = useMemo(() => {
    return Array.from(agents.values()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }, [agents]);

  // Memoized filtered and enriched history messages based on view mode
  const filteredHistory = useMemo((): EnrichedHistoryMessage[] => {
    // First, build a map of toolUseId -> tool_result content for linking
    const toolResultMap = new Map<string, string>();
    for (const msg of history) {
      if (msg.type === 'tool_result' && msg.toolUseId) {
        toolResultMap.set(msg.toolUseId, msg.content);
      }
    }

    // Enrich tool_use messages with their corresponding tool_result
    const enrichHistory = (messages: HistoryMessage[]): EnrichedHistoryMessage[] => {
      return messages.map((msg) => {
        if (msg.type === 'tool_use' && msg.toolName === 'Bash' && msg.toolUseId) {
          const bashOutput = toolResultMap.get(msg.toolUseId);
          let bashCommand: string | undefined;
          try {
            const input = msg.toolInput || (msg.content ? JSON.parse(msg.content) : {});
            bashCommand = input.command;
          } catch { /* ignore */ }
          return {
            ...msg,
            _bashOutput: bashOutput,
            _bashCommand: bashCommand,
          };
        }
        return msg as EnrichedHistoryMessage;
      });
    };

    if (viewMode === 'advanced') return enrichHistory(history);
    if (viewMode === 'chat') {
      return enrichHistory(history.filter((msg, index, arr) => {
        if (msg.type === 'user') return true;
        if (msg.type === 'assistant') {
          const nextMsg = arr[index + 1];
          return !nextMsg || nextMsg.type === 'user';
        }
        return false;
      }));
    }
    // simple mode - show user messages, assistant responses, and tool actions (compact)
    return enrichHistory(history.filter((msg) => msg.type === 'user' || msg.type === 'assistant' || msg.type === 'tool_use'));
  }, [history, viewMode]);

  // Memoized filtered outputs based on view mode (using shared hook with debug logging)
  const filteredOutputs = useFilteredOutputsWithLogging({ outputs, viewMode });

  // Auto-update bash modal when in live mode and output arrives
  useEffect(() => {
    if (!bashModal?.isLive || !bashModal.command) return;

    // Look for the bash output in filteredOutputs
    for (const output of filteredOutputs) {
      if (output._bashCommand === bashModal.command && output._bashOutput) {
        // Found the output, update the modal and mark as no longer live
        setBashModal({ command: bashModal.command, output: output._bashOutput, isLive: false });
        return;
      }
    }
  }, [bashModal, filteredOutputs]);

  // Handle resize drag
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingRef.current = true;
      resizeStartYRef.current = e.clientY;
      resizeStartHeightRef.current = terminalHeight;
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
    },
    [terminalHeight]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;

      const deltaY = e.clientY - resizeStartYRef.current;
      const windowHeight = window.innerHeight;
      const deltaPercent = (deltaY / windowHeight) * 100;
      const newHeight = Math.min(
        MAX_TERMINAL_HEIGHT,
        Math.max(MIN_TERMINAL_HEIGHT, resizeStartHeightRef.current + deltaPercent)
      );
      setTerminalHeight(newHeight);
    };

    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setStorageNumber(STORAGE_KEYS.TERMINAL_HEIGHT, terminalHeightRef.current);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Load saved input text and pasted texts from storage when switching agents
  useEffect(() => {
    if (!selectedAgentId) return;
    // Load is handled by useTerminalInput hook
  }, [selectedAgentId]);

  // Focus input when terminal opens or switches to textarea
  useEffect(() => {
    if (isOpen) {
      if (useTextarea && textareaRef.current) {
        textareaRef.current.focus();
        const len = textareaRef.current.value.length;
        textareaRef.current.setSelectionRange(len, len);
      } else if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  }, [isOpen, useTextarea]);

  const handleSendCommand = () => {
    if ((!command.trim() && attachedFiles.length === 0) || !selectedAgentId) return;

    let fullCommand = expandPastedTexts(command.trim());

    if (attachedFiles.length > 0) {
      const fileRefs = attachedFiles
        .map((f) => {
          if (f.isImage) {
            return `[Image: ${f.path}]`;
          } else {
            return `[File: ${f.path}]`;
          }
        })
        .join('\n');

      if (fullCommand) {
        fullCommand = `${fullCommand}\n\n${fileRefs}`;
      } else {
        fullCommand = fileRefs;
      }
    }

    store.sendCommand(selectedAgentId, fullCommand);
    setCommand('');
    setForceTextarea(false);
    setPastedTexts(new Map());
    setAttachedFiles([]);
    resetPastedCount();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.shiftKey) {
      if (!useTextarea) {
        e.preventDefault();
        setForceTextarea(true);
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSendCommand();
    }
  };

  // Handle paste event
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          const attached = await uploadFile(blob);
          if (attached) {
            setAttachedFiles((prev) => [...prev, attached]);
          }
        }
        return;
      }
    }

    const files = e.clipboardData.files;
    if (files.length > 0) {
      e.preventDefault();
      for (const file of files) {
        const attached = await uploadFile(file);
        if (attached) {
          setAttachedFiles((prev) => [...prev, attached]);
        }
      }
      return;
    }

    const pastedText = e.clipboardData.getData('text');
    const lineCount = (pastedText.match(/\n/g) || []).length + 1;

    if (lineCount > 5) {
      e.preventDefault();
      const pasteId = incrementPastedCount();

      setPastedTexts((prev) => new Map(prev).set(pasteId, pastedText));

      const placeholder = `[Pasted text #${pasteId} +${lineCount} lines]`;
      const target = e.target as HTMLInputElement | HTMLTextAreaElement;
      const start = target.selectionStart || 0;
      const end = target.selectionEnd || 0;
      const newCommand = command.slice(0, start) + placeholder + command.slice(end);
      setCommand(newCommand);

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
        setAttachedFiles((prev) => [...prev, attached]);
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Track the previous agent ID to detect agent switches
  const prevAgentIdRef = useRef<string | null>(null);

  // Load conversation history when agent changes or on reconnect
  // IMPORTANT: We do NOT clear outputs during normal streaming - only when:
  // 1. User switches to a different agent
  // 2. User reconnects after disconnect
  const hasSessionId = !!selectedAgent?.sessionId;
  useEffect(() => {
    if (!selectedAgentId || !hasSessionId) {
      setHistory([]);
      setHasMore(false);
      setTotalCount(0);
      return;
    }

    // Detect if this is an agent switch or reconnect vs session establishment
    const isAgentSwitch = prevAgentIdRef.current !== null && prevAgentIdRef.current !== selectedAgentId;
    const isReconnect = reconnectCount > 0;
    const shouldClearOutputs = isAgentSwitch || isReconnect;

    // Update the ref AFTER we check it
    prevAgentIdRef.current = selectedAgentId;

    // On reconnect, preserve current outputs BEFORE fetching new history
    // This ensures we don't lose any messages that weren't persisted to the JSONL file yet
    let preservedOutputsSnapshot: ClaudeOutput[] | undefined;
    if (isReconnect) {
      const currentOutputs = store.getOutputs(selectedAgentId);
      if (currentOutputs.length > 0) {
        preservedOutputsSnapshot = currentOutputs.map(o => ({ ...o }));
      }
    }

    setLoadingHistory(true);
    fetch(`/api/agents/${selectedAgentId}/history?limit=${MESSAGES_PER_PAGE}&offset=0`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        return res.json();
      })
      .then((data) => {
        const messages = data.messages || [];
        setHistory(messages);
        setHasMore(data.hasMore || false);
        setTotalCount(data.totalCount || 0);

        // Only clear and filter outputs on agent switch or reconnect
        // Do NOT clear when session is first established (new agent starting work)
        if (shouldClearOutputs) {
          if (preservedOutputsSnapshot && preservedOutputsSnapshot.length > 0) {
            // On reconnect, restore preserved outputs (don't merge with history)
            // History is rendered separately by HistoryLine, outputs by OutputLine
            // They have different content formats and should not be mixed
            const lastHistoryTimestamp = messages.length > 0
              ? Math.max(...messages.map((m: HistoryMessage) => m.timestamp ? new Date(m.timestamp).getTime() : 0))
              : 0;

            // Only keep preserved outputs that are newer than the last history message
            // This avoids duplicating messages that are already in history
            const newerOutputs = preservedOutputsSnapshot.filter(o => o.timestamp > lastHistoryTimestamp);

            // Restore the newer outputs
            store.clearOutputs(selectedAgentId);
            for (const output of newerOutputs) {
              store.addOutput(selectedAgentId, output);
            }
          } else if (messages.length > 0) {
            // Agent switch - filter outputs to only keep those newer than history
            // This prevents duplicates between history and live outputs
            const lastHistoryTimestamp = Math.max(
              ...messages.map((m: HistoryMessage) => m.timestamp ? new Date(m.timestamp).getTime() : 0)
            );

            const currentOutputs = store.getOutputs(selectedAgentId);
            const newerOutputs = currentOutputs.filter(o => o.timestamp > lastHistoryTimestamp);

            store.clearOutputs(selectedAgentId);
            for (const output of newerOutputs) {
              store.addOutput(selectedAgentId, output);
            }
          }
        }
        // When session is first established (not agent switch or reconnect),
        // we DON'T clear outputs - let streaming messages accumulate naturally

        if (!lastPrompts.get(selectedAgentId)) {
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].type === 'user') {
              store.setLastPrompt(selectedAgentId, messages[i].content);
              break;
            }
          }
        }
      })
      .catch((err) => {
        console.error('Failed to load history:', err);
        setHistory([]);
        setHasMore(false);
        setTotalCount(0);
        // Even on error, restore preserved outputs if we have them
        if (shouldClearOutputs && preservedOutputsSnapshot && preservedOutputsSnapshot.length > 0) {
          store.clearOutputs(selectedAgentId);
          for (const output of preservedOutputsSnapshot) {
            store.addOutput(selectedAgentId, output);
          }
        }
      })
      .finally(() => {
        setLoadingHistory(false);
      });
  }, [selectedAgentId, hasSessionId, reconnectCount]); // hasSessionId (boolean) triggers when session is established

  // Load more history when scrolling to top
  const loadMoreHistory = useCallback(async () => {
    if (!selectedAgentId || !selectedAgent?.sessionId || loadingMore || !hasMore) return;

    const scrollContainer = outputRef.current;
    if (!scrollContainer) return;

    const distanceFromBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop;

    setLoadingMore(true);
    const currentOffset = history.length;

    try {
      const res = await fetch(`/api/agents/${selectedAgentId}/history?limit=${MESSAGES_PER_PAGE}&offset=${currentOffset}`);
      const data = await res.json();

      if (data.messages && data.messages.length > 0) {
        setHistory((prev) => [...data.messages, ...prev]);
        setHasMore(data.hasMore || false);

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (outputRef.current) {
              outputRef.current.scrollTop = outputRef.current.scrollHeight - distanceFromBottom;
            }
            setLoadingMore(false);
          });
        });
      } else {
        setLoadingMore(false);
      }
    } catch (err) {
      console.error('Failed to load more history:', err);
      setLoadingMore(false);
    }
  }, [selectedAgentId, selectedAgent?.sessionId, loadingMore, hasMore, history.length]);

  // Handle scroll to detect when to load more and track if user scrolled up
  const handleScroll = useCallback(() => {
    if (!outputRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
    // Use a larger threshold (150px) to better detect if user has scrolled up
    // This prevents auto-scroll from fighting with user's scroll position during streaming
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 150;
    isUserScrolledUpRef.current = !isAtBottom;

    if (!loadingMore && hasMore && !searchMode && scrollTop < SCROLL_THRESHOLD) {
      loadMoreHistory();
    }
  }, [loadMoreHistory, loadingMore, hasMore, searchMode]);

  // Search conversation
  const handleSearch = useCallback(async () => {
    if (!selectedAgentId || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    try {
      const res = await fetch(`/api/agents/${selectedAgentId}/search?q=${encodeURIComponent(searchQuery)}&limit=100`);
      const data = await res.json();
      setSearchResults(data.matches || []);
    } catch (err) {
      console.error('Search failed:', err);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [selectedAgentId, searchQuery]);

  // Focus search input when entering search mode
  useEffect(() => {
    if (searchMode && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchMode]);

  // Toggle search with Ctrl+F
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && isOpen) {
        e.preventDefault();
        setSearchMode((prev) => !prev);
        if (!searchMode) {
          setSearchResults([]);
          setSearchQuery('');
        }
      }
      if (e.key === 'Escape') {
        if (bashModal) {
          setBashModal(null);
        } else if (imageModal) {
          setImageModal(null);
        } else if (searchMode) {
          setSearchMode(false);
          setSearchResults([]);
          setSearchQuery('');
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, searchMode, imageModal, bashModal]);

  // Auto-resize textarea to fit content (shrinks when content is removed)
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !useTextarea) return;

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';
    // Set to scrollHeight (capped by max-height in CSS)
    const newHeight = Math.min(textarea.scrollHeight, 180);
    textarea.style.height = `${newHeight}px`;
  }, [command, useTextarea]);

  // Auto-scroll to bottom on new output (only if user is at bottom)
  useEffect(() => {
    let rafId: number;
    rafId = requestAnimationFrame(() => {
      if (outputRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 150;

        // Only auto-scroll if user is at (or near) bottom
        if (isAtBottom) {
          outputRef.current.scrollTop = scrollHeight;
        }
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [outputs.length]);

  // Scroll to bottom when switching agents or when reconnect triggers history refresh
  useEffect(() => {
    if (loadingHistory) return;

    isUserScrolledUpRef.current = false;

    let rafId: number;
    rafId = requestAnimationFrame(() => {
      if (outputRef.current) {
        outputRef.current.scrollTop = outputRef.current.scrollHeight;
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [selectedAgentId, loadingHistory, reconnectCount]);

  // Keyboard shortcut to toggle (backtick key like Guake)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '`' && !e.ctrlKey && !e.altKey && selectedAgent) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          store.toggleTerminal();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedAgent]);

  // Close terminal when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    // Small delay to avoid closing immediately after opening via touch
    let ignoreClicks = true;
    const timer = setTimeout(() => {
      ignoreClicks = false;
    }, 100);

    const handleClickOutside = (e: MouseEvent) => {
      // Ignore clicks right after opening (especially from touch events)
      if (ignoreClicks) return;

      const target = e.target as HTMLElement;

      // Also ignore if the click is on the canvas (3D scene)
      if (target.tagName === 'CANVAS') return;

      if (terminalRef.current && !terminalRef.current.contains(target)) {
        store.setTerminalOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Don't render if no agent selected
  if (!selectedAgent) {
    return null;
  }

  return (
    <div
      ref={terminalRef}
      className={`guake-terminal ${isOpen ? 'open' : 'collapsed'} ${debugPanelOpen && isOpen ? 'with-debug-panel' : ''}`}
      style={{ '--terminal-height': `${terminalHeight}%` } as React.CSSProperties}
    >
      {/* Debug Panel - Left Side (only visible when terminal is open) */}
      {debugPanelOpen && isOpen && selectedAgentId && (
        <AgentDebugPanel
          agentId={selectedAgentId}
          onClose={() => setDebugPanelOpen(false)}
        />
      )}

      <div className="guake-content">
        <div className="guake-header">
          <div className="guake-header-left">
            {selectedAgent.status === 'working' && (
              <span className="guake-working-indicator">
                <span className="guake-working-dot"></span>
                <span className="guake-working-dot"></span>
                <span className="guake-working-dot"></span>
              </span>
            )}
            <span className="guake-title">{selectedAgent.name}</span>
            {(() => {
              const lastInput =
                selectedAgent.currentTask ||
                selectedAgent.lastAssignedTask ||
                lastPrompts.get(selectedAgentId || '')?.text;

              const agentAnalysis = supervisor.lastReport?.agentSummaries.find(
                (a: AgentAnalysis) => a.agentId === selectedAgent.id || a.agentName === selectedAgent.name
              );

              const progressColors: Record<string, string> = {
                on_track: '#4aff9e',
                stalled: '#ff9e4a',
                blocked: '#ff4a4a',
                completed: '#4a9eff',
                idle: '#888',
              };

              if (!lastInput && !agentAnalysis) return null;

              const filteredStatus = agentAnalysis?.statusDescription
                ? filterCostText(agentAnalysis.statusDescription, settings.hideCost)
                : null;

              return (
                <span
                  className="guake-status-line"
                  title={`${lastInput || 'No task'}${agentAnalysis ? `\n\n🎖️ ${agentAnalysis.statusDescription}\n${agentAnalysis.recentWorkSummary}` : ''}`}
                >
                  {agentAnalysis && (
                    <span
                      className="guake-supervisor-badge"
                      style={{ color: progressColors[agentAnalysis.progress] || '#888' }}
                    >
                      🎖️ {agentAnalysis.progress.replace('_', ' ')}
                    </span>
                  )}
                  {filteredStatus && <span className="guake-supervisor-summary">{filteredStatus}</span>}
                  {!filteredStatus && lastInput && <span className="guake-last-input">{lastInput}</span>}
                </span>
              );
            })()}
          </div>
          <div className="guake-actions">
            <button
              className={`guake-debug-toggle ${debugPanelOpen ? 'active' : ''}`}
              onClick={() => {
                const newOpen = !debugPanelOpen;
                setDebugPanelOpen(newOpen);
                // Enable debugger when opening, keep enabled when closing (to preserve data)
                if (newOpen && !debuggerEnabled) {
                  setDebuggerEnabled(true);
                  agentDebugger.setEnabled(true);
                }
              }}
              title={debugPanelOpen ? 'Hide Debug Panel' : 'Show Debug Panel'}
            >
              🐛
            </button>
            <button
              className={`guake-search-toggle ${searchMode ? 'active' : ''}`}
              onClick={() => {
                setSearchMode(!searchMode);
                if (searchMode) {
                  setSearchResults([]);
                  setSearchQuery('');
                }
              }}
              title="Search (Ctrl+F)"
            >
              🔍
            </button>
            <button
              className={`guake-view-toggle ${viewMode !== 'simple' ? 'active' : ''} view-mode-${viewMode}`}
              onClick={() => {
                const currentIndex = VIEW_MODES.indexOf(viewMode);
                const nextMode = VIEW_MODES[(currentIndex + 1) % VIEW_MODES.length];
                setViewMode(nextMode);
                setStorageString(STORAGE_KEYS.VIEW_MODE, nextMode);
              }}
              title={
                viewMode === 'simple'
                  ? 'Simple: Shows tools and responses'
                  : viewMode === 'chat'
                    ? 'Chat: Shows only user messages and final responses'
                    : 'Advanced: Shows all details including tool inputs/outputs'
              }
            >
              {viewMode === 'simple' ? '○ Simple' : viewMode === 'chat' ? '◐ Chat' : '◉ Advanced'}
            </button>
            {outputs.length > 0 && (
              <button
                className="guake-clear"
                onClick={() => selectedAgentId && store.clearOutputs(selectedAgentId)}
                title="Clear output"
              >
                Clear
              </button>
            )}
            <button
              className="guake-context-btn"
              onClick={() => setContextConfirm('collapse')}
              title="Collapse context - summarize conversation to save tokens"
              disabled={selectedAgent.status !== 'idle'}
            >
              📦 Collapse
            </button>
            <button
              className="guake-context-btn danger"
              onClick={() => setContextConfirm('clear')}
              title="Clear context - start fresh session"
            >
              🗑️ Clear Context
            </button>
            <span className="guake-hint">Press ` to toggle</span>
          </div>
        </div>

        {/* Search bar */}
        {searchMode && (
          <div className="guake-search">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search conversation... (Esc to close)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearch();
                if (e.key === 'Escape') {
                  setSearchMode(false);
                  setSearchResults([]);
                  setSearchQuery('');
                }
              }}
            />
            <button onClick={handleSearch} disabled={searchLoading}>
              {searchLoading ? '...' : 'Search'}
            </button>
            {searchResults.length > 0 && <span className="guake-search-count">{searchResults.length} results</span>}
          </div>
        )}

        <div className="guake-output" ref={outputRef} onScroll={handleScroll}>
          {searchMode && searchResults.length > 0 ? (
            <>
              <div className="guake-search-header">Search Results:</div>
              {searchResults.map((msg, index) => (
                <HistoryLine
                  key={`s-${index}`}
                  message={msg as EnrichedHistoryMessage}
                  agentId={selectedAgentId}
                  highlight={searchQuery}
                  onImageClick={(url, name) => setImageModal({ url, name })}
                  onFileClick={(path) => store.setFileViewerPath(path)}
                  onBashClick={handleBashClick}
                />
              ))}
            </>
          ) : loadingHistory ? (
            <div className="guake-empty">Loading history...</div>
          ) : history.length === 0 && outputs.length === 0 ? (
            <div className="guake-empty">No output yet. Send a command to this agent.</div>
          ) : (
            <>
              {hasMore && !searchMode && (
                <div className="guake-load-more">
                  {loadingMore ? (
                    <span>Loading older messages...</span>
                  ) : (
                    <button onClick={loadMoreHistory}>Load more ({totalCount - history.length} older messages)</button>
                  )}
                </div>
              )}
              {filteredHistory.map((msg, index) => (
                <HistoryLine
                  key={`h-${index}`}
                  message={msg}
                  agentId={selectedAgentId}
                  simpleView={viewMode !== 'advanced'}
                  onImageClick={handleImageClick}
                  onFileClick={handleFileClick}
                  onBashClick={handleBashClick}
                />
              ))}
              {filteredOutputs.map((output, index) => (
                <OutputLine
                  key={`o-${index}`}
                  output={output}
                  agentId={selectedAgentId}
                  onImageClick={handleImageClick}
                  onFileClick={handleFileClick}
                  onBashClick={handleBashClick}
                />
              ))}
            </>
          )}
        </div>

        {/* Permission requests bar */}
        {pendingPermissions.length > 0 && (
          <div className="permission-bar">
            {pendingPermissions.map((request) => (
              <PermissionRequestInline
                key={request.id}
                request={request}
                onApprove={(remember) => store.respondToPermissionRequest(request.id, true, undefined, remember)}
                onDeny={() => store.respondToPermissionRequest(request.id, false)}
              />
            ))}
          </div>
        )}

        {/* Attached files display */}
        {attachedFiles.length > 0 && (
          <div className="guake-attachments">
            {attachedFiles.map((file) => (
              <div
                key={file.id}
                className={`guake-attachment ${file.isImage ? 'is-image clickable' : ''}`}
                onClick={() => {
                  if (file.isImage) {
                    setImageModal({ url: getImageWebUrl(file.path), name: file.name });
                  }
                }}
              >
                <span className="guake-attachment-icon">{file.isImage ? '🖼️' : '📎'}</span>
                <span className="guake-attachment-name" title={file.path}>
                  {file.name}
                </span>
                <span className="guake-attachment-size">({Math.round(file.size / 1024)}KB)</span>
                <button
                  className="guake-attachment-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAttachedFile(file.id);
                  }}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className={`guake-input-wrapper ${selectedAgent?.status === 'working' ? 'has-stop-btn is-working' : ''} ${showCompletion ? 'is-completed' : ''}`}>
          {/* Floating stop button - shown when agent is working */}
          {selectedAgent?.status === 'working' && (
            <div className="guake-stop-bar">
              <button
                className="guake-stop-btn"
                onClick={() => store.stopAgent(selectedAgent.id)}
                title="Stop current operation (Esc)"
              >
                <span className="stop-icon">■</span>
                <span className="stop-label">Stop</span>
              </button>
            </div>
          )}

          <div className={`guake-input ${useTextarea ? 'guake-input-expanded' : ''}`}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
            accept="image/*,.txt,.md,.json,.js,.ts,.tsx,.jsx,.py,.sh,.css,.scss,.html,.xml,.yaml,.yml,.toml,.ini,.cfg,.conf"
          />
          <div className="guake-input-container">
            <button
              className="guake-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Attach file (or paste image)"
            >
              📎
            </button>
            {useTextarea ? (
              <textarea
                ref={textareaRef}
                placeholder={`Message ${selectedAgent.name}...`}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
              />
            ) : (
              <input
                ref={inputRef}
                type="text"
                placeholder={`Message ${selectedAgent.name}...`}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
              />
            )}
            <button onClick={handleSendCommand} disabled={!command.trim() && attachedFiles.length === 0} title="Send">
              ➤
            </button>
          </div>
          </div>
        </div>

        {/* Agent Links Indicators */}
        <div className="guake-agent-links">
          {sortedAgents.map((agent) => (
            <GuakeAgentLink
              key={agent.id}
              agent={agent}
              isSelected={agent.id === selectedAgentId}
              onClick={() => store.selectAgent(agent.id)}
            />
          ))}
        </div>
      </div>

      {/* Resize handle */}
      {isOpen && <div className="guake-resize-handle" onMouseDown={handleResizeStart} title="Drag to resize" />}

      <div
        className="guake-handle"
        onClick={() => {
          if (isOpen) {
            store.toggleTerminal();
          }
        }}
        onDoubleClick={() => {
          if (!isOpen) {
            store.toggleTerminal();
          }
        }}
        style={{ top: isOpen ? `${terminalHeight}%` : '0' }}
      >
        <span className="guake-handle-icon">{isOpen ? '▲' : '▼'}</span>
        <span className="guake-handle-text">{selectedAgent.name}</span>
      </div>

      {/* Image Modal */}
      {imageModal && (
        <div className="image-modal-overlay" onClick={() => setImageModal(null)}>
          <div className="image-modal" onClick={(e) => e.stopPropagation()}>
            <div className="image-modal-header">
              <span className="image-modal-title">{imageModal.name}</span>
              <button className="image-modal-close" onClick={() => setImageModal(null)}>
                ×
              </button>
            </div>
            <div className="image-modal-content">
              <img src={imageModal.url} alt={imageModal.name} />
            </div>
          </div>
        </div>
      )}

      {/* Bash Output Modal */}
      {bashModal && (
        <div className="bash-modal-overlay" onClick={() => setBashModal(null)}>
          <div className="bash-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bash-modal-header">
              <span className="bash-modal-icon">$</span>
              <span className="bash-modal-title">Terminal Output</span>
              <button className="bash-modal-close" onClick={() => setBashModal(null)}>
                ×
              </button>
            </div>
            <div className="bash-modal-command">
              <pre>{bashModal.command}</pre>
            </div>
            <div className={`bash-modal-content ${bashModal.isLive ? 'is-loading' : ''}`}>
              <pre>{bashModal.output}</pre>
            </div>
          </div>
        </div>
      )}

      {/* Context Action Confirmation Modal */}
      {contextConfirm && (
        <div className="modal-overlay visible" onClick={() => setContextConfirm(null)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">{contextConfirm === 'collapse' ? 'Collapse Context' : 'Clear Context'}</div>
            <div className="modal-body confirm-modal-body">
              {contextConfirm === 'collapse' ? (
                <>
                  <p>Collapse the conversation context?</p>
                  <p className="confirm-modal-note">
                    This will summarize the conversation to save tokens while preserving important information.
                  </p>
                </>
              ) : (
                <>
                  <p>Clear all context for this agent?</p>
                  <p className="confirm-modal-note">
                    This will start a fresh session on the next command. All conversation history will be lost.
                  </p>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setContextConfirm(null)}>
                Cancel
              </button>
              <button
                className={`btn ${contextConfirm === 'clear' ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => {
                  if (selectedAgentId) {
                    if (contextConfirm === 'collapse') {
                      store.collapseContext(selectedAgentId);
                    } else {
                      store.clearContext(selectedAgentId);
                      setHistory([]);
                    }
                  }
                  setContextConfirm(null);
                }}
                autoFocus
              >
                {contextConfirm === 'collapse' ? 'Collapse' : 'Clear Context'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context View Modal */}
      <ContextModalFromGuake />

      {/* File Viewer Modal */}
      <FileViewerFromGuake />
    </div>
  );
}

// Separate component for context modal to avoid re-renders
function ContextModalFromGuake() {
  const contextModalAgentId = useContextModalAgentId();
  const agents = useAgents();
  const agent = contextModalAgentId ? agents.get(contextModalAgentId) : null;

  if (!agent) return null;

  return (
    <ContextViewModal
      agent={agent}
      isOpen={!!contextModalAgentId}
      onClose={() => store.closeContextModal()}
      onRefresh={() => {
        if (contextModalAgentId) {
          store.sendCommand(contextModalAgentId, '/context');
        }
      }}
    />
  );
}

// Separate component for file viewer modal to avoid re-renders
function FileViewerFromGuake() {
  const fileViewerPath = useFileViewerPath();
  const editData = useFileViewerEditData();

  if (!fileViewerPath) return null;

  return (
    <FileViewerModal
      isOpen={!!fileViewerPath}
      onClose={() => store.clearFileViewerPath()}
      filePath={fileViewerPath}
      action={editData ? 'modified' : 'read'}
      editData={editData || undefined}
    />
  );
}

// Re-export types for convenience
export type { HistoryMessage, AttachedFile, ViewMode, EditData };
