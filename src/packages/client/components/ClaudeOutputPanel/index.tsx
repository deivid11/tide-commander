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
import type { HistoryMessage, AttachedFile, EditData } from './types';
import { markdownComponents } from './MarkdownComponents';
import { isSimpleViewOutput, isChatViewOutput } from './viewFilters';
import { HistoryLine } from './HistoryLine';
import { OutputLine } from './OutputLine';
import { GuakeAgentLink } from './GuakeAgentLink';
import { PermissionRequestInline } from './PermissionRequest';
import { useTerminalInput } from './useTerminalInput';
import { getImageWebUrl } from './contentRendering';

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

  // Context action confirmation modal
  const [contextConfirm, setContextConfirm] = useState<'collapse' | 'clear' | null>(null);

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

  // Memoized sorted agents list for the agent links bar
  const sortedAgents = useMemo(() => {
    return Array.from(agents.values()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }, [agents]);

  // Memoized filtered history messages based on view mode
  const filteredHistory = useMemo(() => {
    if (viewMode === 'advanced') return history;
    if (viewMode === 'chat') {
      return history.filter((msg, index, arr) => {
        if (msg.type === 'user') return true;
        if (msg.type === 'assistant') {
          const nextMsg = arr[index + 1];
          return !nextMsg || nextMsg.type === 'user';
        }
        return false;
      });
    }
    // simple mode - show user messages, assistant responses, and tool actions (compact)
    return history.filter((msg) => msg.type === 'user' || msg.type === 'assistant' || msg.type === 'tool_use');
  }, [history, viewMode]);

  // Memoized filtered outputs based on view mode
  const filteredOutputs = useMemo(() => {
    if (viewMode === 'advanced') return outputs;

    if (viewMode === 'chat') {
      return outputs.filter((output) => {
        if (output.isUserPrompt) return true;
        return isChatViewOutput(output.text);
      });
    }

    // Simple view: enrich tool lines with key parameters
    const result: (ClaudeOutput & { _toolKeyParam?: string; _editData?: EditData })[] = [];
    for (let i = 0; i < outputs.length; i++) {
      const output = outputs[i];

      if (output.isUserPrompt) {
        result.push(output);
        continue;
      }

      if (output.text.startsWith('Using tool:')) {
        const toolName = output.text.replace('Using tool:', '').trim();

        let keyParam: string | null = null;
        let editData: EditData | undefined;
        for (let j = i + 1; j < outputs.length && j <= i + 3; j++) {
          const nextOutput = outputs[j];
          if (nextOutput.text.startsWith('Tool input:')) {
            const inputJson = nextOutput.text.replace('Tool input:', '').trim();
            keyParam = extractToolKeyParam(toolName, inputJson);
            if (toolName === 'Edit') {
              try {
                const parsed = JSON.parse(inputJson);
                if (parsed.old_string !== undefined || parsed.new_string !== undefined) {
                  editData = { oldString: parsed.old_string || '', newString: parsed.new_string || '' };
                }
              } catch {
                /* ignore parse errors */
              }
            }
            break;
          }
          if (nextOutput.text.startsWith('Using tool:') || nextOutput.text.startsWith('Tool result:')) {
            break;
          }
        }

        if (toolName === 'Bash' && keyParam && keyParam.length > BASH_TRUNCATE_LENGTH) {
          keyParam = keyParam.substring(0, BASH_TRUNCATE_LENGTH - 3) + '...';
        }

        result.push({
          ...output,
          _toolKeyParam: keyParam || undefined,
          _editData: editData,
        });
        continue;
      }

      if (isSimpleViewOutput(output.text)) {
        result.push(output);
      }
    }
    return result;
  }, [outputs, viewMode]);

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

  // Load conversation history when agent changes or on reconnect
  useEffect(() => {
    if (!selectedAgentId || !selectedAgent?.sessionId) {
      setHistory([]);
      setHasMore(false);
      setTotalCount(0);
      return;
    }

    // On reconnect, preserve current outputs BEFORE fetching new history
    // This ensures we don't lose any messages that weren't persisted to the JSONL file yet
    let preservedOutputsSnapshot: ClaudeOutput[] | undefined;
    if (reconnectCount > 0) {
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

        // On reconnect, restore preserved outputs (don't merge with history)
        // History is rendered separately by HistoryLine, outputs by OutputLine
        // They have different content formats and should not be mixed
        if (preservedOutputsSnapshot && preservedOutputsSnapshot.length > 0) {
          // Find the most recent history timestamp to filter out duplicate outputs
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
        } else {
          // Normal flow - handle outputs based on agent status
          const currentAgent = agents.get(selectedAgentId);
          const isAgentWorking = currentAgent?.status === 'working';
          if (messages.length > 0 && !isAgentWorking) {
            const currentOutputs = store.getOutputs(selectedAgentId);
            const thirtySecondsAgo = Date.now() - 30000;
            const preservedOutputs = currentOutputs.filter(
              (o) => o.isDelegation || o.isStreaming || (o.timestamp && o.timestamp > thirtySecondsAgo)
            );
            store.clearOutputs(selectedAgentId);
            for (const output of preservedOutputs) {
              store.addOutput(selectedAgentId, output);
            }
          }
        }

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
        if (preservedOutputsSnapshot && preservedOutputsSnapshot.length > 0) {
          store.clearOutputs(selectedAgentId);
          for (const output of preservedOutputsSnapshot) {
            store.addOutput(selectedAgentId, output);
          }
        }
      })
      .finally(() => {
        setLoadingHistory(false);
      });
  }, [selectedAgentId, selectedAgent?.sessionId, reconnectCount]); // reconnectCount triggers refresh on reconnection

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
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
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
        if (imageModal) {
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
  }, [isOpen, searchMode, imageModal]);

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

  // Auto-scroll to bottom on new output
  useEffect(() => {
    if (isUserScrolledUpRef.current) return;

    let rafId: number;
    rafId = requestAnimationFrame(() => {
      if (outputRef.current && !isUserScrolledUpRef.current) {
        outputRef.current.scrollTop = outputRef.current.scrollHeight;
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
      className={`guake-terminal ${isOpen ? 'open' : 'collapsed'}`}
      style={{ '--terminal-height': `${terminalHeight}%` } as React.CSSProperties}
    >
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
                  message={msg}
                  agentId={selectedAgentId}
                  highlight={searchQuery}
                  onImageClick={(url, name) => setImageModal({ url, name })}
                  onFileClick={(path) => store.setFileViewerPath(path)}
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
                />
              ))}
              {filteredOutputs.map((output, index) => (
                <OutputLine
                  key={`o-${index}`}
                  output={output}
                  agentId={selectedAgentId}
                  onImageClick={handleImageClick}
                  onFileClick={handleFileClick}
                />
              ))}
              {selectedAgent.status === 'working' && (
                <div className="typing-indicator">
                  <span className="typing-dot"></span>
                  <span className="typing-dot"></span>
                  <span className="typing-dot"></span>
                  <button
                    className="stop-button"
                    onClick={() => store.stopAgent(selectedAgent.id)}
                    title="Stop current operation"
                  >
                    Stop
                  </button>
                </div>
              )}
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
