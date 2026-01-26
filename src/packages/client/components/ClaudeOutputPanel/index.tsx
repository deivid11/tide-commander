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
  useAgent,
  useSelectedAgentIds,
  useTerminalOpen,
  useLastPrompts,
  useSupervisor,
  useSettings,
  useAgentOutputs,
  useMobileView,
  store,
  ClaudeOutput,
  useContextModalAgentId,
  useFileViewerPath,
  useFileViewerEditData,
  useReconnectCount,
  useAreas,
  useAgentTaskProgress,
} from '../../store';
import { useSwipeGesture } from '../../hooks';
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
import { AgentResponseModal } from './AgentResponseModal';
import { AgentProgressIndicator } from './AgentProgressIndicator';
import { apiUrl } from '../../utils/storage';

export function ClaudeOutputPanel() {
  // Use granular selectors instead of useStore() to prevent unnecessary re-renders
  const agents = useAgents();
  const selectedAgentIds = useSelectedAgentIds();
  const terminalOpen = useTerminalOpen();
  const lastPrompts = useLastPrompts();
  const supervisor = useSupervisor();
  const settings = useSettings();
  const reconnectCount = useReconnectCount(); // Watch for reconnections to refresh history
  const mobileView = useMobileView(); // Mobile view state

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
  const isMountedRef = useRef(true);

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

  // Agent response modal state - stores the markdown content to display
  const [responseModalContent, setResponseModalContent] = useState<string | null>(null);

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
  // Use useAgent hook to ensure re-render on agent status changes (fixes animation sync issue)
  const selectedAgent = useAgent(selectedAgentId) || null;

  // Use the reactive hook for outputs
  const outputs = useAgentOutputs(selectedAgentId);

  // Check if selected agent is a boss and get subordinate task progress
  const isBoss = selectedAgent?.class === 'boss' || selectedAgent?.isBoss;
  const agentTaskProgress = useAgentTaskProgress(isBoss ? selectedAgentId : null);

  // Detect when agent finishes processing and show completion indicator
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const currentStatus = selectedAgent?.status;
    const prevStatus = prevStatusRef.current;

    // If agent was working and is now idle, show completion
    if (prevStatus === 'working' && currentStatus === 'idle') {
      // Clear any existing timer first
      if (completionTimerRef.current) {
        clearTimeout(completionTimerRef.current);
      }
      setShowCompletion(true);
      // Hide after animation completes
      completionTimerRef.current = setTimeout(() => {
        setShowCompletion(false);
        completionTimerRef.current = null;
      }, 1000);
    } else if (currentStatus === 'working') {
      // If agent starts working again, clear completion state immediately
      if (completionTimerRef.current) {
        clearTimeout(completionTimerRef.current);
        completionTimerRef.current = null;
      }
      setShowCompletion(false);
    }

    prevStatusRef.current = currentStatus || null;

    // Cleanup on unmount
    return () => {
      if (completionTimerRef.current) {
        clearTimeout(completionTimerRef.current);
      }
    };
  }, [selectedAgent?.status]);

  // Track mount state to prevent state updates after unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

  const handleViewMarkdown = useCallback((content: string) => {
    setResponseModalContent(content);
  }, []);

  // Get areas for grouping agents the same way as AgentBar
  const areas = useAreas();

  // Memoized sorted agents list matching AgentBar's visual order
  // Groups by area (alphabetically), then unassigned, with createdAt order within groups
  const sortedAgents = useMemo(() => {
    const agentList = Array.from(agents.values()).sort(
      (a, b) => (a.createdAt || 0) - (b.createdAt || 0)
    );

    // Group agents by their area (same logic as AgentBar)
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

    // Flatten back to a single array in the correct visual order
    return groupArray.flatMap((group) => group.agents);
  }, [agents, areas]);

  // Swipe animation state
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swipeAnimationClass, setSwipeAnimationClass] = useState('');
  const swipeAnimationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Get current agent index for swipe indicators
  const currentAgentIndex = selectedAgentId
    ? sortedAgents.findIndex((a) => a.id === selectedAgentId)
    : -1;

  // Get next/previous agent names for indicators
  const prevAgent = currentAgentIndex > 0 ? sortedAgents[currentAgentIndex - 1] : sortedAgents[sortedAgents.length - 1];
  const nextAgent = currentAgentIndex < sortedAgents.length - 1 ? sortedAgents[currentAgentIndex + 1] : sortedAgents[0];

  // Track pending swipe direction for animation after agent switch
  const [pendingSwipeDirection, setPendingSwipeDirection] = useState<'left' | 'right' | null>(null);

  // Swipe gesture handlers for mobile agent navigation
  const handleSwipeLeft = useCallback(() => {
    // Swipe left (right-to-left) → go to next agent
    if (!selectedAgentId || sortedAgents.length <= 1) return;
    const currentIndex = sortedAgents.findIndex((a) => a.id === selectedAgentId);
    if (currentIndex === -1) return;
    const nextIndex = (currentIndex + 1) % sortedAgents.length;

    // Set pending direction and switch agent immediately
    // The swipe-in animation will play after content loads
    setPendingSwipeDirection('left');
    setSwipeOffset(0);
    setSwipeAnimationClass('');
    store.selectAgent(sortedAgents[nextIndex].id);
  }, [selectedAgentId, sortedAgents]);

  const handleSwipeRight = useCallback(() => {
    // Swipe right (left-to-right) → go to previous agent
    if (!selectedAgentId || sortedAgents.length <= 1) return;
    const currentIndex = sortedAgents.findIndex((a) => a.id === selectedAgentId);
    if (currentIndex === -1) return;
    const prevIndex = (currentIndex - 1 + sortedAgents.length) % sortedAgents.length;

    // Set pending direction and switch agent immediately
    // The swipe-in animation will play after content loads
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

  // Handle swipe cancel - animate back to center (very fast)
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

  // Trigger swipe-in animation after history finishes loading (when agent switches via swipe)
  useEffect(() => {
    if (!pendingSwipeDirection || loadingHistory) return;

    // History loaded, now play the swipe-in animation
    const direction = pendingSwipeDirection;
    setPendingSwipeDirection(null);

    // Use RAF to ensure DOM is ready
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

  // Attach swipe gesture to the guake header for agent navigation on mobile
  const headerRef = useRef<HTMLDivElement>(null);
  useSwipeGesture(headerRef, {
    enabled: isOpen && sortedAgents.length > 1,
    onSwipeLeft: handleSwipeLeft,
    onSwipeRight: handleSwipeRight,
    onSwipeMove: handleSwipeMove,
    onSwipeCancel: handleSwipeCancel,
    threshold: 40, // Low threshold for quick swipes on header
    maxVerticalMovement: 50,
  });

  // Also attach swipe gesture to the output/messages area for agent navigation
  useSwipeGesture(outputRef, {
    enabled: isOpen && sortedAgents.length > 1,
    onSwipeLeft: handleSwipeLeft,
    onSwipeRight: handleSwipeRight,
    onSwipeMove: handleSwipeMove,
    onSwipeCancel: handleSwipeCancel,
    threshold: 50, // Moderate threshold for output area
    maxVerticalMovement: 35,
  });

  // Keyboard shortcuts for agent navigation (Alt+J / Alt+K)
  useEffect(() => {
    const handleAgentNavKeyDown = (e: KeyboardEvent) => {
      if (!isOpen || sortedAgents.length <= 1) return;

      // Don't switch agents when a modal is open
      if (imageModal || bashModal || responseModalContent) return;

      // Alt+K → go to previous agent (like swipe right)
      if (e.altKey && e.key === 'k') {
        e.preventDefault();
        handleSwipeRight();
      }
      // Alt+J → go to next agent (like swipe left)
      if (e.altKey && e.key === 'j') {
        e.preventDefault();
        handleSwipeLeft();
      }
    };
    document.addEventListener('keydown', handleAgentNavKeyDown);
    return () => document.removeEventListener('keydown', handleAgentNavKeyDown);
  }, [isOpen, sortedAgents.length, handleSwipeLeft, handleSwipeRight, imageModal, bashModal, responseModalContent]);

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
      // Notify store that terminal is being resized (disables battlefield drag selection)
      store.setTerminalResizing(true);
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
        // Notify store that terminal resize is complete
        store.setTerminalResizing(false);
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

  // Track previous isOpen state to detect when terminal actually opens
  const prevIsOpenRef = useRef(false);

  // Focus input when terminal opens or switches to textarea
  // On mobile, don't auto-focus at all (to avoid keyboard popup)
  useEffect(() => {
    prevIsOpenRef.current = isOpen;

    if (isOpen) {
      // On mobile, never auto-focus (user can tap to focus if needed)
      const isMobile = window.innerWidth <= 768;
      if (isMobile) {
        return;
      }

      if (useTextarea && textareaRef.current) {
        textareaRef.current.focus();
        const len = textareaRef.current.value.length;
        textareaRef.current.setSelectionRange(len, len);
      } else if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  }, [isOpen, useTextarea, selectedAgentId]);

  // Track whether an input is focused to avoid viewport scroll interference during typing
  const isInputFocusedRef = useRef(false);


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

    // On mobile, blur the input to hide the keyboard after sending
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      inputRef.current?.blur();
      textareaRef.current?.blur();
    }
  };

  // Refs for keyboard handling cleanup
  const keyboardHandlerRef = useRef<(() => void) | null>(null);
  const lastKeyboardHeightRef = useRef<number>(0);
  const keyboardScrollLockRef = useRef<boolean>(false); // Prevents auto-scroll from interfering
  const keyboardRafRef = useRef<number>(0);
  // Store the initial viewport height before keyboard ever opens (captured once on first focus)
  const initialViewportHeightRef = useRef<number>(0);

  // Set the CSS custom property for keyboard height on the app element
  const setKeyboardHeight = useCallback((height: number) => {
    const app = document.querySelector('.app.mobile-view-terminal') as HTMLElement;
    if (app) {
      app.style.setProperty('--keyboard-height', `${height}px`);
      app.style.setProperty('--keyboard-visible', height > 0 ? '1' : '0');
    }
    lastKeyboardHeightRef.current = height;
  }, []);

  // Reset keyboard styles by clearing the CSS custom property
  const resetKeyboardStyles = useCallback(() => {
    setKeyboardHeight(0);
    keyboardScrollLockRef.current = false;
    console.log('[Keyboard] Reset styles - keyboard height set to 0');
  }, [setKeyboardHeight]);

  // Cleanup keyboard listeners
  const cleanupKeyboardHandling = useCallback(() => {
    // Cancel any pending RAF
    if (keyboardRafRef.current) {
      cancelAnimationFrame(keyboardRafRef.current);
      keyboardRafRef.current = 0;
    }

    // Remove viewport listeners
    if (window.visualViewport && keyboardHandlerRef.current) {
      window.visualViewport.removeEventListener('resize', keyboardHandlerRef.current);
      window.visualViewport.removeEventListener('scroll', keyboardHandlerRef.current);
      keyboardHandlerRef.current = null;
    }
  }, []);

  // On mobile, adjust layout when keyboard opens so input stays visible
  // Strategy: Store initial viewport height before keyboard opens, then compare
  const handleInputFocus = useCallback(() => {
    isInputFocusedRef.current = true;

    const isMobile = window.innerWidth <= 768;
    console.log('[Keyboard] handleInputFocus called, isMobile:', isMobile, 'width:', window.innerWidth);
    if (!isMobile) return;

    // Cleanup any existing handlers first
    cleanupKeyboardHandling();

    // Lock scrolling during keyboard animation to prevent auto-scroll from interfering
    keyboardScrollLockRef.current = true;

    // Use Visual Viewport API - the most reliable way to detect keyboard on modern mobile browsers
    if (window.visualViewport) {
      // Capture initial viewport height BEFORE keyboard opens (only once per session)
      // This is the full height when no keyboard is visible
      if (initialViewportHeightRef.current === 0) {
        initialViewportHeightRef.current = window.visualViewport.height;
        console.log('[Keyboard] Captured initial viewport height:', initialViewportHeightRef.current);
      }
      console.log('[Keyboard] visualViewport available, initial height:', initialViewportHeightRef.current);

      const adjustForKeyboard = () => {
        const viewport = window.visualViewport;
        if (!viewport) return;

        // Cancel previous RAF to debounce rapid calls
        if (keyboardRafRef.current) {
          cancelAnimationFrame(keyboardRafRef.current);
        }

        keyboardRafRef.current = requestAnimationFrame(() => {
          // Only adjust if input is still focused
          if (!isInputFocusedRef.current) {
            console.log('[Keyboard] Input not focused, resetting styles');
            resetKeyboardStyles();
            return;
          }

          // Simple approach: Compare current visualViewport.height to initial height
          // When keyboard opens, visualViewport.height shrinks by the keyboard height
          const currentViewportHeight = viewport.height;
          const initialHeight = initialViewportHeightRef.current;

          // Keyboard height is simply the difference
          let keyboardHeight = Math.max(0, initialHeight - currentViewportHeight);

          // Apply a minimum threshold to avoid false positives from address bar changes
          if (keyboardHeight < 150) {
            keyboardHeight = 0;
          }

          console.log('[Keyboard] adjustForKeyboard:', {
            initialHeight,
            currentViewportHeight,
            calculatedKeyboardHeight: keyboardHeight,
          });

          // Update the CSS custom property
          if (keyboardHeight !== lastKeyboardHeightRef.current) {
            setKeyboardHeight(keyboardHeight);

            // Scroll output to bottom when keyboard opens or changes size
            if (keyboardHeight > 0 && outputRef.current) {
              outputRef.current.scrollTop = outputRef.current.scrollHeight;
            }
          }

          // Release scroll lock after keyboard has stabilized (after first adjustment)
          if (keyboardHeight > 0) {
            // Give a small delay before releasing scroll lock
            setTimeout(() => {
              keyboardScrollLockRef.current = false;
            }, 300);
          }
        });
      };

      // Store handler reference for cleanup
      keyboardHandlerRef.current = adjustForKeyboard;

      // Listen for viewport changes (both resize and scroll for iOS)
      window.visualViewport.addEventListener('resize', adjustForKeyboard);
      window.visualViewport.addEventListener('scroll', adjustForKeyboard);

      // Initial adjustment - the keyboard may already be animating
      adjustForKeyboard();
    }
  }, [cleanupKeyboardHandling, resetKeyboardStyles, setKeyboardHeight]);

  const handleInputBlur = useCallback(() => {
    isInputFocusedRef.current = false;

    const isMobile = window.innerWidth <= 768;
    if (!isMobile) return;

    // Small delay to handle blur->refocus scenarios (like switching between inputs)
    // This prevents flickering when user taps from input to textarea or vice versa
    setTimeout(() => {
      // Only reset if still not focused
      if (!isInputFocusedRef.current) {
        resetKeyboardStyles();
        cleanupKeyboardHandling();
      }
    }, 100);
  }, [resetKeyboardStyles, cleanupKeyboardHandling]);

  // Cleanup on unmount and handle visibility changes (app switching)
  useEffect(() => {
    const handleVisibilityChange = () => {
      // When page becomes hidden (app switch), reset keyboard styles
      // The keyboard will dismiss but blur may not fire
      if (document.hidden) {
        const isMobile = window.innerWidth <= 768;
        if (isMobile && lastKeyboardHeightRef.current > 0) {
          isInputFocusedRef.current = false;
          resetKeyboardStyles();
          cleanupKeyboardHandling();
        }
      }
    };

    // Also listen for orientation changes which can affect keyboard
    const handleOrientationChange = () => {
      const isMobile = window.innerWidth <= 768;
      if (isMobile && lastKeyboardHeightRef.current > 0) {
        // Re-trigger adjustment after orientation change
        if (keyboardHandlerRef.current) {
          keyboardHandlerRef.current();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('orientationchange', handleOrientationChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('orientationchange', handleOrientationChange);
      cleanupKeyboardHandling();
    };
  }, [cleanupKeyboardHandling, resetKeyboardStyles]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const isMobile = window.innerWidth <= 768;

    if (e.key === 'Enter') {
      // On mobile: Enter adds newline, grows field
      // On desktop: Shift+Enter adds newline, Enter sends
      if (isMobile) {
        // Switch to textarea if not already
        if (!useTextarea) {
          e.preventDefault();
          setForceTextarea(true);
          // Set command with newline after switching
          setTimeout(() => {
            setCommand(command + '\n');
          }, 0);
        }
        // Let the newline be added naturally in textarea
        return;
      }

      // Desktop behavior
      if (e.shiftKey) {
        if (!useTextarea) {
          e.preventDefault();
          setForceTextarea(true);
        }
        return;
      }
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

  // Track the previous agent ID and sessionId to detect agent switches vs session establishment
  const prevAgentIdRef = useRef<string | null>(null);
  const prevHasSessionIdRef = useRef<boolean>(false);

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
      setLoadingHistory(false);
      prevHasSessionIdRef.current = false;
      return;
    }

    // Detect if this is an agent switch or reconnect vs session establishment
    const isAgentSwitch = prevAgentIdRef.current !== null && prevAgentIdRef.current !== selectedAgentId;
    const isReconnect = reconnectCount > 0;
    const shouldClearOutputs = isAgentSwitch || isReconnect;

    // Detect if session was just established for the current agent (not an agent switch)
    // This happens when user sends a command to an idle agent - we don't want to show loading
    const isSessionEstablishment = !isAgentSwitch && !prevHasSessionIdRef.current && hasSessionId;

    // Update the refs AFTER we check them
    prevAgentIdRef.current = selectedAgentId;
    prevHasSessionIdRef.current = hasSessionId;

    // On reconnect, preserve current outputs BEFORE fetching new history
    // This ensures we don't lose any messages that weren't persisted to the JSONL file yet
    let preservedOutputsSnapshot: ClaudeOutput[] | undefined;
    if (isReconnect) {
      const currentOutputs = store.getOutputs(selectedAgentId);
      if (currentOutputs.length > 0) {
        preservedOutputsSnapshot = currentOutputs.map(o => ({ ...o }));
      }
    }

    // Only show loading indicator on agent switch or reconnect, not on session establishment
    // This prevents flicker when sending a command to an agent that was idle
    if (!isSessionEstablishment) {
      setLoadingHistory(true);
    }
    fetch(apiUrl(`/api/agents/${selectedAgentId}/history?limit=${MESSAGES_PER_PAGE}&offset=0`))
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
      const res = await fetch(apiUrl(`/api/agents/${selectedAgentId}/history?limit=${MESSAGES_PER_PAGE}&offset=${currentOffset}`));
      const data = await res.json();

      if (data.messages && data.messages.length > 0) {
        if (!isMountedRef.current) return;
        setHistory((prev) => [...data.messages, ...prev]);
        setHasMore(data.hasMore || false);

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!isMountedRef.current) return;
            if (outputRef.current) {
              outputRef.current.scrollTop = outputRef.current.scrollHeight - distanceFromBottom;
            }
            setLoadingMore(false);
          });
        });
      } else {
        if (!isMountedRef.current) return;
        setLoadingMore(false);
      }
    } catch (err) {
      console.error('Failed to load more history:', err);
      if (!isMountedRef.current) return;
      setLoadingMore(false);
    }
  }, [selectedAgentId, selectedAgent?.sessionId, loadingMore, hasMore, history.length]);

  // Handle scroll to detect when to load more and track if user scrolled up
  // Don't track scroll position changes during keyboard adjustment
  const handleScroll = useCallback(() => {
    if (!outputRef.current) return;

    // Skip tracking during keyboard adjustment - the keyboard handler is controlling scroll
    if (keyboardScrollLockRef.current) return;

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
      const res = await fetch(apiUrl(`/api/agents/${selectedAgentId}/search?q=${encodeURIComponent(searchQuery)}&limit=100`));
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
        if (responseModalContent) {
          setResponseModalContent(null);
        } else if (bashModal) {
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
  }, [isOpen, searchMode, imageModal, bashModal, responseModalContent]);

  // Auto-resize textarea to fit content (shrinks when content is removed)
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !useTextarea) return;

    const isMobile = window.innerWidth <= 768;
    const maxHeight = isMobile ? 200 : 180;

    // Use RAF to avoid layout thrashing during typing
    requestAnimationFrame(() => {
      // Temporarily remove height constraint to measure true scrollHeight
      const prevHeight = textarea.style.height;
      textarea.style.height = '0px';
      textarea.style.overflow = 'hidden';

      // Get the natural content height
      const scrollHeight = textarea.scrollHeight;
      const newHeight = Math.max(46, Math.min(scrollHeight, maxHeight));

      // Apply the calculated height
      textarea.style.height = `${newHeight}px`;
      textarea.style.overflow = newHeight >= maxHeight ? 'auto' : 'hidden';
    });
  }, [command, useTextarea]);

  // Auto-scroll to bottom on new output (only if user is at bottom)
  // Skip if keyboard scroll lock is active to prevent fighting with keyboard positioning
  // Also track the last output's text length for streaming updates
  const lastOutputLength = outputs.length > 0 ? outputs[outputs.length - 1]?.text?.length || 0 : 0;
  useEffect(() => {
    // Don't auto-scroll if keyboard is adjusting - let the keyboard handler control scroll
    if (keyboardScrollLockRef.current) return;

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
  }, [outputs.length, lastOutputLength]);

  // Track agent switches to trigger scroll
  const prevSelectedAgentIdRef = useRef<string | null>(null);
  const justSwitchedAgentRef = useRef(false);

  // Detect agent switch
  useEffect(() => {
    if (selectedAgentId !== prevSelectedAgentIdRef.current) {
      justSwitchedAgentRef.current = true;
      prevSelectedAgentIdRef.current = selectedAgentId;
    }
  }, [selectedAgentId]);

  // Track previous terminal open state for scroll on open
  const prevIsOpenForScrollRef = useRef(false);
  // Track if we need to scroll after content loads
  const pendingScrollRef = useRef(false);
  // Track if history content should fade in (on fresh load)
  const [historyFadeIn, setHistoryFadeIn] = useState(false);

  // Helper to scroll output to bottom
  const scrollToBottom = useCallback(() => {
    if (keyboardScrollLockRef.current) return;
    isUserScrolledUpRef.current = false;

    // Use double RAF to ensure DOM has updated
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (outputRef.current) {
          outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
      });
    });
  }, []);

  // When terminal opens, mark that we need to scroll
  useEffect(() => {
    const wasOpen = prevIsOpenForScrollRef.current;
    prevIsOpenForScrollRef.current = isOpen;

    if (!wasOpen && isOpen) {
      // Mark pending scroll - will be executed after content renders
      pendingScrollRef.current = true;
      // Reset fade-in state when opening - will be triggered when history loads
      setHistoryFadeIn(false);
      // Immediate scroll attempt
      scrollToBottom();
    }
  }, [isOpen, scrollToBottom]);

  // Scroll to bottom when history finishes loading or agent switches
  // This is the main scroll effect that waits for content
  useEffect(() => {
    if (!isOpen) return;
    if (loadingHistory) return;

    // Trigger fade-in animation for history content
    setHistoryFadeIn(true);

    // After history loads, scroll to bottom
    // Use delay to ensure markdown/code blocks are fully rendered
    const timeoutId = setTimeout(() => {
      scrollToBottom();
      pendingScrollRef.current = false;
      justSwitchedAgentRef.current = false;
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [selectedAgentId, loadingHistory, reconnectCount, isOpen, scrollToBottom]);

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

  // Close terminal when clicking outside (desktop only)
  // On mobile, this behavior can interfere with input focus and keyboard events
  useEffect(() => {
    if (!isOpen) return;

    // Disable on mobile to prevent focus interference
    const isMobile = window.innerWidth <= 768;
    if (isMobile) return;

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

  // On mobile terminal view, show placeholder ONLY if no agent is selected at all
  // On desktop, don't render anything if no agent selected
  // Check both mobileView AND actual screen width to ensure we're on mobile
  const isMobileWidth = typeof window !== 'undefined' && window.innerWidth <= 768;

  if (!selectedAgent) {
    // Only show mobile placeholder if actually on mobile device AND in terminal view AND no agent selected
    if (isMobileWidth && mobileView === 'terminal' && selectedAgentIds.size === 0) {
      return (
        <div
          ref={terminalRef}
          className="guake-terminal open"
          style={{ '--terminal-height': `${terminalHeight}%` } as React.CSSProperties}
        >
          <div className="guake-content">
            <div className="guake-output" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6272a4' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>👆</div>
                <div style={{ fontSize: '16px' }}>Tap an agent on the battlefield to view their terminal</div>
                <div style={{ fontSize: '14px', marginTop: '8px', opacity: 0.7 }}>Switch to 3D view using the menu button (☰)</div>
              </div>
            </div>
          </div>
        </div>
      );
    }
    // If agent is selected (ID exists) but not found in map yet, show loading state (mobile only)
    if (isMobileWidth && mobileView === 'terminal' && selectedAgentIds.size > 0) {
      return (
        <div
          ref={terminalRef}
          className="guake-terminal open"
          style={{ '--terminal-height': `${terminalHeight}%` } as React.CSSProperties}
        >
          <div className="guake-content">
            <div className="guake-output" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6272a4' }}>
              <div className="guake-empty loading">
                Loading terminal
                <span className="loading-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
              </div>
            </div>
          </div>
        </div>
      );
    }
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
        <div className={`guake-header ${sortedAgents.length > 1 ? 'has-multiple-agents' : ''} ${swipeOffset > 0.1 ? 'swiping-right' : ''} ${swipeOffset < -0.1 ? 'swiping-left' : ''}`} ref={headerRef}>
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
              className={`guake-debug-toggle hide-on-mobile ${debugPanelOpen ? 'active' : ''}`}
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
              className={`guake-search-toggle hide-on-mobile ${searchMode ? 'active' : ''}`}
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
              className={`guake-view-toggle hide-on-mobile ${viewMode !== 'simple' ? 'active' : ''} view-mode-${viewMode}`}
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
            {/* Mobile view mode toggle - compact icon button */}
            <button
              className={`guake-mode-btn show-on-mobile view-mode-${viewMode}`}
              onClick={() => {
                const currentIndex = VIEW_MODES.indexOf(viewMode);
                const nextMode = VIEW_MODES[(currentIndex + 1) % VIEW_MODES.length];
                setViewMode(nextMode);
                setStorageString(STORAGE_KEYS.VIEW_MODE, nextMode);
              }}
              title={`View: ${viewMode}`}
            >
              {viewMode === 'simple' ? '○' : viewMode === 'chat' ? '◐' : '◉'}
            </button>
            {outputs.length > 0 && (
              <button
                className="guake-clear"
                onClick={() => selectedAgentId && store.clearOutputs(selectedAgentId)}
                title="Clear output"
              >
                🗑
              </button>
            )}
            <button
              className="guake-context-btn hide-on-mobile"
              onClick={() => setContextConfirm('collapse')}
              title="Collapse context - summarize conversation to save tokens"
              disabled={selectedAgent.status !== 'idle'}
            >
              📦 Collapse
            </button>
            <button
              className="guake-context-btn danger hide-on-mobile"
              onClick={() => setContextConfirm('clear')}
              title="Clear context - start fresh session"
            >
              🗑️ Clear Context
            </button>
            <span className="guake-hint hide-on-mobile">Press ` to toggle</span>
            {/* Mobile close button - switch to 3D view */}
            <button
              className="guake-close-btn show-on-mobile"
              onClick={() => store.setMobileView('3d')}
              title="Close terminal"
            >
              ✕
            </button>
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

        {/* Swipe container for mobile animation */}
        <div
          className={`guake-swipe-container ${swipeAnimationClass}`}
          style={swipeOffset !== 0 ? { transform: `translateX(${swipeOffset * 40}%)` } : undefined}
        >
          {/* Swipe indicators showing next/prev agent */}
          {sortedAgents.length > 1 && swipeOffset !== 0 && (
            <>
              <div className={`swipe-indicator left ${swipeOffset > 0.3 ? 'visible' : ''}`}>
                <span className="indicator-icon">←</span>
                <span className="indicator-name">{prevAgent?.name}</span>
              </div>
              <div className={`swipe-indicator right ${swipeOffset < -0.3 ? 'visible' : ''}`}>
                <span className="indicator-name">{nextAgent?.name}</span>
                <span className="indicator-icon">→</span>
              </div>
            </>
          )}

          {/* Swipe dots showing position in agent list */}
          {sortedAgents.length > 1 && sortedAgents.length <= 8 && swipeOffset !== 0 && (
            <div className={`swipe-dots ${Math.abs(swipeOffset) > 0.1 ? 'visible' : ''}`}>
              {sortedAgents.map((agent, index) => (
                <div
                  key={agent.id}
                  className={`swipe-dot ${index === currentAgentIndex ? 'active' : ''}`}
                />
              ))}
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
                  onViewMarkdown={handleViewMarkdown}
                />
              ))}
            </>
          ) : loadingHistory ? (
            <div className="guake-empty loading">
              Loading conversation
              <span className="loading-dots">
                <span></span>
                <span></span>
                <span></span>
              </span>
            </div>
          ) : history.length === 0 && outputs.length === 0 && selectedAgent?.status !== 'working' ? (
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
              <div className={`guake-history-content ${historyFadeIn ? 'fade-in' : ''}`}>
                {filteredHistory.map((msg, index) => (
                  <HistoryLine
                    key={`h-${index}`}
                    message={msg}
                    agentId={selectedAgentId}
                    simpleView={viewMode !== 'advanced'}
                    onImageClick={handleImageClick}
                    onFileClick={handleFileClick}
                    onBashClick={handleBashClick}
                    onViewMarkdown={handleViewMarkdown}
                  />
                ))}
              </div>
              {filteredOutputs.map((output, index) => (
                <OutputLine
                  key={`o-${index}`}
                  output={output}
                  agentId={selectedAgentId}
                  onImageClick={handleImageClick}
                  onFileClick={handleFileClick}
                  onBashClick={handleBashClick}
                  onViewMarkdown={handleViewMarkdown}
                />
              ))}
              {/* Agent Progress Indicators - shown for boss agents */}
              {isBoss && agentTaskProgress.size > 0 && (
                <div className="agent-progress-container">
                  <div className="agent-progress-container-header">
                    <span className="progress-crown">👑</span>
                    <span>Subordinate Progress</span>
                    <span className="progress-count">({agentTaskProgress.size} active)</span>
                  </div>
                  {Array.from(agentTaskProgress.values()).map((progress) => (
                    <AgentProgressIndicator
                      key={progress.agentId}
                      progress={progress}
                      defaultExpanded={progress.status === 'working'}
                      onAgentClick={(agentId) => store.selectAgent(agentId)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        </div>{/* End swipe container */}

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
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
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
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
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

      {/* Agent Response Modal */}
      {selectedAgent && (
        <AgentResponseModal
          agent={selectedAgent}
          content={responseModalContent || ''}
          isOpen={!!responseModalContent}
          onClose={() => setResponseModalContent(null)}
        />
      )}
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
