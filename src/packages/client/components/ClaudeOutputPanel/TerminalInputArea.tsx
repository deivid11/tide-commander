/**
 * TerminalInputArea - Input area component for the terminal panel
 *
 * Handles text input, file attachments, paste handling, and send functionality.
 */

import React, { useRef, useEffect, useState, useCallback, useMemo, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useSettings, useLastPrompt, usePinnedAgentIds } from '../../store';
import { PermissionRequestInline } from './PermissionRequest';
import { getImageWebUrl } from './contentRendering';
import { PastedTextChip } from './PastedTextChip';
import { FileMentionDropdown, type FileMentionItem } from './FileMentionDropdown';
import { SlashCommandDropdown } from './SlashCommandDropdown';
import { matchSlashCommands, type SlashCommand } from '../../utils/slashCommands';
import { useSTT } from '../../hooks/useSTT';
import type { Agent, PermissionRequest } from '../../../shared/types';
import { providerClosesStdinAfterPrompt } from '../../../shared/types';
import type { AttachedFile } from './types';
import { Icon } from '../Icon';
import { ActivityGlyph } from '../shared/ActivityGlyph';
import { getPendingMessagesForAgent, removePendingMessageForAgent } from '../../websocket/send';
import { useServerMessageQueue } from '../../hooks/useServerMessageQueue';
import { QueuedMessagesBar } from './QueuedMessagesBar';
import { apiUrl, authFetch } from '../../utils/storage';
import { getDisplayContextInfo } from '../../utils/context';
import { getUsedPercentColor } from '../../utils/claude-usage-format';
import { formatTokenCapacity } from '../../utils/formatting';
import { resolveElapsedTimerStartedAt } from './elapsedTimer';
import { getWeeklyUsageWindow, useProviderUsageSnapshot } from '../FlatView/PlanLimitsTooltip';
import { usePluginRegistryRevision } from '../../plugins/hooks';
import {
  executeShellSlashCommand,
  findShellSlashCommand,
  reportShellCommandExecutionError,
} from '../../plugins/shell-commands/execution';
import { renameAgentRequestPreview } from '../../plugins/rename-agent/renameAgentRequest';
import { bolbaRecommendationRequestPreview } from '../../plugins/bolba-tasks/bolbaRecommendationRequest';
import { shellCommandResultPreview } from '../../plugins/shell-commands/shellCommandResult';

/**
 * Isolated elapsed timer component — owns its own 1-second setInterval so the
 * parent TerminalInputArea is NOT re-rendered every tick.
 */
const ElapsedTimer = memo(function ElapsedTimer({
  agentId,
  isWorking,
  timestamp,
}: {
  agentId: string;
  isWorking: boolean;
  timestamp: number | undefined;
}) {
  const { t } = useTranslation(['terminal']);
  const [elapsed, setElapsed] = useState(0);
  const fallbackStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isWorking) {
      fallbackStartedAtRef.current = null;
      setElapsed(0);
      return;
    }

    // lastPrompts is client-local and can be empty after reload, reconnect, or
    // when another browser/device started the turn. Never render a permanently
    // frozen 0:00 in that case: start a local fallback clock, then replace it
    // with the authoritative timestamp if one arrives later.
    const now = Date.now();
    const startedAt = resolveElapsedTimerStartedAt(timestamp, fallbackStartedAtRef.current, now);
    fallbackStartedAtRef.current = startedAt;

    const updateElapsed = () => {
      setElapsed(Math.max(0, Date.now() - startedAt));
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) updateElapsed();
    };

    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1000);
    window.addEventListener('focus', updateElapsed);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', updateElapsed);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isWorking, timestamp]);

  if (!isWorking) return null;

  return (
    <div className="guake-stop-bar">
      <ActivityGlyph animated size={18} className="guake-stop-activity" />
      <span className="guake-elapsed-timer">{formatElapsed(elapsed)}</span>
      <button
        className="guake-stop-btn"
        onClick={() => store.stopAgent(agentId)}
        title={t('terminal:input.stopOperation')}
      >
        <span className="stop-icon"><Icon name="stop" size={12} weight="fill" /></span>
        <span className="stop-label">{t('terminal:input.stop')}</span>
      </button>
    </div>
  );
});

/**
 * Get VSCode icon SVG path for file type based on extension
 */
function getFileIcon(ext: string): string {
  const iconMap: Record<string, string> = {
    // Documents
    pdf: 'file_type_pdf.svg',
    doc: 'file_type_word.svg',
    docx: 'file_type_word.svg',
    xls: 'file_type_excel.svg',
    xlsx: 'file_type_excel.svg',
    ppt: 'file_type_powerpoint.svg',
    pptx: 'file_type_powerpoint.svg',
    txt: 'file_type_text.svg',
    md: 'file_type_markdown.svg',
    // Code
    js: 'file_type_javascript_official.svg',
    jsx: 'file_type_javascript_official.svg',
    ts: 'file_type_typescript_official.svg',
    tsx: 'file_type_typescript_official.svg',
    py: 'file_type_python.svg',
    java: 'file_type_java.svg',
    cpp: 'file_type_cpp.svg',
    c: 'file_type_cpp.svg',
    h: 'file_type_cpp.svg',
    hpp: 'file_type_cpp.svg',
    cs: 'file_type_csharp.svg',
    go: 'file_type_go.svg',
    rs: 'file_type_rust.svg',
    php: 'file_type_php.svg',
    rb: 'file_type_ruby.svg',
    swift: 'file_type_swift.svg',
    kt: 'file_type_kotlin.svg',
    scala: 'file_type_scala.svg',
    r: 'file_type_r.svg',
    // Web
    html: 'file_type_html.svg',
    htm: 'file_type_html.svg',
    css: 'file_type_css.svg',
    scss: 'file_type_scss.svg',
    sass: 'file_type_sass.svg',
    less: 'file_type_less.svg',
    // Config/Data
    json: 'file_type_json_official.svg',
    yaml: 'file_type_yaml_official.svg',
    yml: 'file_type_yaml_official.svg',
    xml: 'file_type_xml.svg',
    toml: 'file_type_toml.svg',
    ini: 'file_type_ini.svg',
    env: 'file_type_dotenv.svg',
    sh: 'file_type_shell.svg',
    bash: 'file_type_shell.svg',
    zsh: 'file_type_shell.svg',
    fish: 'file_type_shell.svg',
    // Images (fallback, usually handled separately)
    png: 'file_type_image.svg',
    jpg: 'file_type_image.svg',
    jpeg: 'file_type_image.svg',
    gif: 'file_type_image.svg',
    svg: 'file_type_image.svg',
    webp: 'file_type_image.svg',
    // Archives
    zip: 'file_type_zip.svg',
    tar: 'file_type_tar.svg',
    gz: 'file_type_gzip.svg',
    rar: 'file_type_rar.svg',
    '7z': 'file_type_zip.svg',
    // Audio/Video
    mp3: 'file_type_audio.svg',
    mp4: 'file_type_video.svg',
    wav: 'file_type_audio.svg',
    mov: 'file_type_video.svg',
    mkv: 'file_type_video.svg',
    flv: 'file_type_video.svg',
    avi: 'file_type_video.svg',
    // Default
    default: 'default_file.svg',
  };

  return iconMap[ext.toLowerCase()] || iconMap.default;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const MOBILE_SWIPE_CLOSE_THRESHOLD_PX = 72;
const MOBILE_SWIPE_CLOSE_MAX_PULL_PX = 128;

/** Hard character cap for the floating current-prompt bubble (CSS ellipsis
 * bounds the width; this bounds the DOM text itself). */
const PROMPT_BUBBLE_MAX_CHARS = 100;

export interface TerminalInputAreaProps {
  selectedAgent: Agent;
  selectedAgentId: string;
  // Terminal open state for autofocus
  isOpen: boolean;
  // Input state from useTerminalInput hook
  command: string;
  setCommand: (cmd: string) => void;
  forceTextarea: boolean;
  setForceTextarea: (force: boolean) => void;
  useTextarea: boolean;
  attachedFiles: AttachedFile[];
  uploadingFiles: Array<{ id: string; name: string; progress: number }>;
  cancelUpload: (id: string) => void;
  setAttachedFiles: React.Dispatch<React.SetStateAction<AttachedFile[]>>;
  removeAttachedFile: (id: number) => void;
  uploadFile: (
    file: File | Blob,
    filename?: string,
    onProgress?: (percentage: number) => void,
  ) => Promise<AttachedFile | null>;
  pastedTexts: Map<number, string>;
  expandPastedTexts: (text: string) => string;
  incrementPastedCount: () => number;
  setPastedTexts: React.Dispatch<React.SetStateAction<Map<number, string>>>;
  resetPastedCount: () => void;
  // Keyboard handling
  handleInputFocus: () => void;
  handleInputBlur: () => void;
  // Permission requests
  pendingPermissions: PermissionRequest[];
  // Completion indicator
  showCompletion: boolean;
  // Elapsed time at completion (ms)
  completionElapsed: number | null;
  // Image modal handler
  onImageClick: (url: string, name: string) => void;
  // External refs for input elements (for keyboard navigation focus)
  inputRef?: React.RefObject<HTMLInputElement | null>;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  // Clear loaded history in panel (used by /clear command parity with header action)
  onClearHistory: () => void;
  // Called after a message is sent (used to reset auto-scroll)
  onSendCommand?: () => void;
  // Mobile swipe-up close support (starts from input area)
  canSwipeClose?: boolean;
  onSwipeCloseOffsetChange?: (offset: number) => void;
  onSwipeClose?: () => void;
}

export const TerminalInputArea = memo(function TerminalInputArea({
  selectedAgent,
  selectedAgentId,
  isOpen: _isOpen,
  command,
  setCommand,
  forceTextarea: _forceTextarea,
  setForceTextarea,
  useTextarea,
  attachedFiles,
  uploadingFiles,
  cancelUpload,
  setAttachedFiles,
  removeAttachedFile,
  uploadFile,
  pastedTexts,
  expandPastedTexts,
  incrementPastedCount,
  setPastedTexts,
  resetPastedCount,
  handleInputFocus,
  handleInputBlur,
  pendingPermissions,
  showCompletion,
  completionElapsed,
  onImageClick,
  inputRef: externalInputRef,
  textareaRef: externalTextareaRef,
  onClearHistory,
  onSendCommand,
  canSwipeClose = false,
  onSwipeCloseOffsetChange,
  onSwipeClose,
}: TerminalInputAreaProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const pluginRegistryRevision = usePluginRegistryRevision();

  // Use external refs if provided, otherwise create internal ones
  const internalInputRef = useRef<HTMLInputElement>(null);
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = externalInputRef || internalInputRef;
  const textareaRef = externalTextareaRef || internalTextareaRef;
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevUseTextareaRef = useRef(useTextarea);
  const cursorPositionRef = useRef<number>(0);
  const swipeCloseResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeGestureRef = useRef({
    isTracking: false,
    startY: 0,
    startX: 0,
  });
  const [swipeCloseOffset, setSwipeCloseOffset] = useState(0);
  const [swipeClosePhase, setSwipeClosePhase] = useState<'idle' | 'dragging' | 'returning'>('idle');
  const [isInputExpanded, setIsInputExpanded] = useState(false);
  const [pendingMessages, setPendingMessages] = useState<Array<{ command: string; queuedAt: number }>>([]);

  // @ file mention state
  const [fileMentions, setFileMentions] = useState<FileMentionItem[]>([]);
  const [mentionQuery, setMentionQuery] = useState<{ active: boolean; query: string; start: number }>({ active: false, query: '', start: 0 });
  const [mentionResults, setMentionResults] = useState<FileMentionItem[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionFetchRef = useRef<AbortController | null>(null);

  // `/` slash-command autocomplete. Dismissed for the rest of the current input
  // once Esc is pressed, so it can't pop back on every keystroke.
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);

  // Poll pending messages so the queue UI stays in sync across tabs / reconnects.
  // getPendingMessagesForAgent always builds a fresh array; keep the previous
  // reference when the contents are unchanged so the poll doesn't re-render
  // this whole component every tick.
  useEffect(() => {
    const refresh = () => {
      setPendingMessages((prev) => {
        const next = getPendingMessagesForAgent(selectedAgentId);
        const unchanged =
          prev.length === next.length &&
          prev.every((p, i) => p.command === next[i].command && p.queuedAt === next[i].queuedAt);
        return unchanged ? prev : next;
      });
    };
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [selectedAgentId]);

  // Get settings to check if TTS feature is enabled
  const settings = useSettings();

  // Only poll provider quotas while this mobile-only surface can be visible.
  // The hook shares its short-lived cache with FlatView and the limits tooltip,
  // so switching views never creates duplicate upstream requests.
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  );
  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)');
    const sync = () => setIsMobileViewport(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const usageProviderSupported = selectedAgent.provider === 'claude'
    || selectedAgent.provider === 'codex'
    || selectedAgent.provider === 'opencode'
    || selectedAgent.provider === 'grok'
    || selectedAgent.provider === 'pi';
  const usageScope = selectedAgent.provider === 'pi'
    ? `${selectedAgent.provider}:${selectedAgent.piModelProvider ?? ''}:${selectedAgent.piModel ?? ''}`
    : selectedAgent.provider === 'opencode'
      ? `${selectedAgent.provider}:${selectedAgent.opencodeModel ?? ''}`
      : selectedAgent.provider;
  const providerUsage = useProviderUsageSnapshot(
    selectedAgentId,
    _isOpen && isMobileViewport && usageProviderSupported,
    60_000,
    usageScope,
  );
  const mobileContext = getDisplayContextInfo(selectedAgent);
  const mobileContextColor = getUsedPercentColor(mobileContext.usedPercent);
  const weeklyWindow = getWeeklyUsageWindow(providerUsage.snapshot);
  const weeklyUsedPercent = weeklyWindow
    ? Math.max(0, Math.min(100, weeklyWindow.utilization))
    : null;
  const isOpenCodeFree = providerUsage.snapshot?.provider === 'opencode'
    && providerUsage.snapshot.plan === 'free';
  const weeklyColor = isOpenCodeFree
    ? '#4aff9e'
    : weeklyUsedPercent === null
      ? 'var(--text-muted)'
      : getUsedPercentColor(weeklyUsedPercent);
  const weeklyValue = isOpenCodeFree
    ? 'Free'
    : weeklyUsedPercent === null
      ? (providerUsage.loading ? '…' : '—')
      : `${Math.round(weeklyUsedPercent)}%`;

  // Live elapsed timer — delegated to ElapsedTimer component to avoid
  // re-rendering the entire TerminalInputArea every second.
  const lastPrompt = useLastPrompt(selectedAgentId);
  const isWorking = selectedAgent.status === 'working';

  // Floating current-prompt bubble (top-center of the input container):
  // truncated preview; click scrolls the conversation to that prompt.
  const promptBubbleText = useMemo(() => {
    const internalPreview = shellCommandResultPreview(lastPrompt?.text)
      || renameAgentRequestPreview(lastPrompt?.text)
      || bolbaRecommendationRequestPreview(lastPrompt?.text);
    if (internalPreview) return internalPreview;
    const flat = (lastPrompt?.text ?? '').replace(/\s+/g, ' ').trim();
    return flat.length > PROMPT_BUBBLE_MAX_CHARS ? `${flat.slice(0, PROMPT_BUBBLE_MAX_CHARS)}…` : flat;
  }, [lastPrompt?.text]);
  // The local lastPrompt map is not hydrated in every client. Agent task time
  // is server-persisted and therefore the primary cross-device fallback;
  // lastWorkedAt covers legacy/silent work that has no assigned-task stamp.
  const latestPromptOrTaskTimestamp = Math.max(
    lastPrompt?.timestamp ?? 0,
    selectedAgent.lastAssignedTaskTime ?? 0,
  );
  const elapsedTimerTimestamp = latestPromptOrTaskTimestamp > 0
    ? latestPromptOrTaskTimestamp
    : selectedAgent.lastWorkedAt;
  const pinnedAgentIds = usePinnedAgentIds();
  const isPinned = pinnedAgentIds.includes(selectedAgentId);

  // Grok/Codex/OpenCode cannot inject mid-turn via stdin — queue by default.
  const closesStdin = providerClosesStdinAfterPrompt(selectedAgent.provider);

  // Server-side mid-run queue view: messages typed while the agent is busy are
  // sent to the server right away (sendCommand), which queues and delivers them
  // itself at turn end — front open or not. This hook only renders/edits it.
  const serverQueue = useServerMessageQueue(selectedAgentId, isWorking);

  // One-time migration: older builds held queued messages in localStorage
  // (tc-message-queue:<agentId>) and only delivered them while this panel was
  // open. Flush any leftovers to the server so they deliver back-side.
  useEffect(() => {
    if (!selectedAgentId) return;
    const key = `tc-message-queue:${selectedAgentId}`;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      localStorage.removeItem(key);
      const entries = JSON.parse(raw);
      if (!Array.isArray(entries)) return;
      const texts = entries
        .map((e) => (e && typeof e.text === 'string' ? e.text : null))
        .filter((t): t is string => !!t);
      texts.forEach((text, i) => {
        // Stagger so multi-entry legacy queues keep their order server-side.
        window.setTimeout(() => store.sendCommand(selectedAgentId, text), 750 * i);
      });
    } catch {
      // Corrupt legacy entry — drop it.
    }
  }, [selectedAgentId]);

  const handleEnforceQueued = useCallback((id: string) => {
    const entry = serverQueue.queue.find((m) => m.id === id);
    if (!entry) return;
    void (async () => {
      // Remove from the server queue first so the runner cannot also deliver
      // it at turn end (double-send). A false result means the queue changed
      // (likely drained) — the hook already refetched, nothing to send.
      const removed = await serverQueue.remove(entry);
      if (!removed) return;
      const live = store.getState().agents.get(selectedAgentId);
      const stillWorking = live?.status === 'working';
      // Send now: interrupt the in-flight turn for stdin-closed backends.
      store.sendCommand(selectedAgentId, entry.text, { forceInterrupt: stillWorking && closesStdin });
    })();
  }, [serverQueue, selectedAgentId, closesStdin]);

  const handleDeleteQueued = useCallback((id: string) => {
    const entry = serverQueue.queue.find((m) => m.id === id);
    if (entry) void serverQueue.remove(entry);
  }, [serverQueue]);

  const focusGuakeInputContainer = useCallback(() => {
    const container = inputContainerRef.current;
    const activeInput = useTextarea ? textareaRef.current : inputRef.current;

    container?.focus({ preventScroll: true });
    activeInput?.focus({ preventScroll: true });
  }, [inputRef, textareaRef, useTextarea]);

  // Speech-to-text hook - automatically send transcribed text to agent
  const { recording, transcribing, toggleRecording } = useSTT({
    language: 'Spanish',
    model: 'medium',
    onTranscription: (text) => {
      // Send transcribed text directly to the agent
      if (text.trim() && selectedAgentId) {
        store.sendCommand(selectedAgentId, text.trim());
      }
    },
  });

  const clearSwipeCloseResetTimer = useCallback(() => {
    if (!swipeCloseResetTimerRef.current) return;
    clearTimeout(swipeCloseResetTimerRef.current);
    swipeCloseResetTimerRef.current = null;
  }, []);

  const resetSwipeCloseVisuals = useCallback((phase: 'idle' | 'returning' = 'idle') => {
    clearSwipeCloseResetTimer();
    setSwipeCloseOffset(0);
    setSwipeClosePhase(phase);
    onSwipeCloseOffsetChange?.(0);
    if (phase === 'returning') {
      swipeCloseResetTimerRef.current = setTimeout(() => {
        setSwipeClosePhase('idle');
        swipeCloseResetTimerRef.current = null;
      }, 160);
    }
  }, [clearSwipeCloseResetTimer, onSwipeCloseOffsetChange]);

  const handleSwipeCloseTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!canSwipeClose || !onSwipeClose) return;
    if (window.innerWidth > 768) return;
    if (e.touches.length !== 1) return;

    clearSwipeCloseResetTimer();
    const touch = e.touches[0];
    swipeGestureRef.current = {
      isTracking: true,
      startY: touch.clientY,
      startX: touch.clientX,
    };
    setSwipeClosePhase('idle');
    setSwipeCloseOffset(0);
    onSwipeCloseOffsetChange?.(0);
  }, [canSwipeClose, onSwipeClose, clearSwipeCloseResetTimer, onSwipeCloseOffsetChange]);

  const handleSwipeCloseTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!swipeGestureRef.current.isTracking) return;

    const touch = e.touches[0];
    const deltaY = touch.clientY - swipeGestureRef.current.startY;
    const deltaX = Math.abs(touch.clientX - swipeGestureRef.current.startX);

    // Ignore mostly-horizontal gestures to avoid fighting agent swipe interactions.
    if (deltaX > 48 && deltaX > Math.abs(deltaY)) {
      swipeGestureRef.current.isTracking = false;
      resetSwipeCloseVisuals('returning');
      return;
    }

    if (deltaY >= 0) {
      setSwipeCloseOffset(0);
      setSwipeClosePhase('idle');
      return;
    }

    const upwardPull = Math.min(MOBILE_SWIPE_CLOSE_MAX_PULL_PX, Math.abs(deltaY));
    if (upwardPull > 8) {
      e.preventDefault();
    }
    setSwipeCloseOffset(upwardPull);
    setSwipeClosePhase('dragging');
    onSwipeCloseOffsetChange?.(upwardPull);
  }, [resetSwipeCloseVisuals, onSwipeCloseOffsetChange]);

  const handleSwipeCloseTouchEnd = useCallback(() => {
    if (!swipeGestureRef.current.isTracking) return;
    swipeGestureRef.current.isTracking = false;

    if (!canSwipeClose || !onSwipeClose) {
      resetSwipeCloseVisuals('returning');
      return;
    }

    if (swipeCloseOffset >= MOBILE_SWIPE_CLOSE_THRESHOLD_PX) {
      onSwipeClose();
      return;
    }

    resetSwipeCloseVisuals('returning');
  }, [canSwipeClose, onSwipeClose, swipeCloseOffset, resetSwipeCloseVisuals, onSwipeCloseOffsetChange]);

  const handleSwipeCloseTouchCancel = useCallback(() => {
    swipeGestureRef.current.isTracking = false;
    resetSwipeCloseVisuals('returning');
  }, [resetSwipeCloseVisuals]);

  useEffect(() => () => clearSwipeCloseResetTimer(), [clearSwipeCloseResetTimer]);

  useEffect(() => {
    if (canSwipeClose) return;
    swipeGestureRef.current.isTracking = false;
    resetSwipeCloseVisuals('idle');
  }, [canSwipeClose, resetSwipeCloseVisuals]);

  // Track cursor position on every input change
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const val = e.target.value;
    const cursor = e.target.selectionStart ?? val.length;
    cursorPositionRef.current = cursor;
    setCommand(val);

    // Drop tracked mentions whose @path text no longer appears in the command —
    // the user removed the inline reference, so we must not still inject context.
    setFileMentions((prev) => prev.filter((f) => val.includes(`@${f.path}`)));

    // An Esc dismissal only silences the slash dropdown for the command being
    // typed — clearing the box (or starting an ordinary message) re-arms it.
    if (!val.startsWith('/')) setSlashDismissed(false);

    // Detect @ mention trigger: look for @ followed by non-whitespace up to cursor
    const textBefore = val.slice(0, cursor);
    const atMatch = textBefore.match(/@(\S*)$/);
    if (atMatch) {
      setMentionQuery({ active: true, query: atMatch[1], start: cursor - atMatch[0].length });
    } else if (mentionQuery.active) {
      closeMention();
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !useTextarea) return;

    const isMobile = window.innerWidth <= 768;
    const minHeight = isInputExpanded ? 300 : 46;
    const maxHeight = isInputExpanded ? 500 : (isMobile ? 200 : 180);

    requestAnimationFrame(() => {
      textarea.style.height = '0px';
      textarea.style.overflow = 'hidden';

      const scrollHeight = textarea.scrollHeight;
      const newHeight = Math.max(minHeight, Math.min(scrollHeight, maxHeight));

      textarea.style.height = `${newHeight}px`;
      textarea.style.overflow = newHeight >= maxHeight ? 'auto' : 'hidden';
    });
  }, [command, useTextarea, isInputExpanded]);

  // Restore focus and cursor position when switching between input and textarea
  useEffect(() => {
    if (prevUseTextareaRef.current !== useTextarea) {
      prevUseTextareaRef.current = useTextarea;
      // When switching input type, restore focus and cursor position to the new element
      requestAnimationFrame(() => {
        const pos = cursorPositionRef.current;
        if (useTextarea && textareaRef.current) {
          focusGuakeInputContainer();
          textareaRef.current.setSelectionRange(pos, pos);
        } else if (!useTextarea && inputRef.current) {
          focusGuakeInputContainer();
          inputRef.current.setSelectionRange(pos, pos);
        }
      });
    }
  }, [focusGuakeInputContainer, inputRef, textareaRef, useTextarea]);

  // Track previous open state so agent switches can keep the main guake input focused.
  const prevIsOpenRef = useRef(false);

  useEffect(() => {
    const wasOpen = prevIsOpenRef.current;
    prevIsOpenRef.current = _isOpen;

    const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
    const isMobileWidth = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
    const wasSwipe = store.consumeSwipeSelectionFlag();
    const wasDirectClick = store.consumeDirectClickSelectionFlag();
    const shouldSuppressAutofocus = (isTouchDevice && (wasSwipe || wasDirectClick)) || isMobileWidth;

    if (_isOpen && (!wasOpen || selectedAgentId) && !shouldSuppressAutofocus) {
      const timeoutId = setTimeout(() => {
        focusGuakeInputContainer();
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [_isOpen, focusGuakeInputContainer, selectedAgentId]);

  // Remove a pasted text and its placeholder from the command
  const removePastedText = (id: number) => {
    // Remove placeholder from command
    const placeholder = new RegExp(`\\[Pasted text #${id} \\+\\d+ lines\\]\\s*`, 'g');
    setCommand(command.replace(placeholder, '').trim());
    // Remove from pastedTexts map
    setPastedTexts((prev) => {
      const newMap = new Map(prev);
      newMap.delete(id);
      return newMap;
    });
  };

  // Upload state and byte progress live in useTerminalInput so paste, picker,
  // composer-drop, and drops anywhere on Guake all share the same indicator.
  const uploadFileWithProgress = (file: File | Blob, filename?: string) => uploadFile(file, filename);

  // Update pasted text content and refresh the line count in the command placeholder
  const updatePastedText = (id: number, newText: string) => {
    const newLineCount = (newText.match(/\n/g) || []).length + 1;
    const oldPattern = new RegExp(`\\[Pasted text #${id} \\+\\d+ lines\\]`, 'g');
    setCommand(command.replace(oldPattern, `[Pasted text #${id} +${newLineCount} lines]`));
    setPastedTexts((prev) => new Map(prev).set(id, newText));
  };

  // Extract pasted text info from command for display
  const getPastedTextInfo = (): Array<{ id: number; lineCount: number }> => {
    const pattern = /\[Pasted text #(\d+) \+(\d+) lines\]/g;
    const results: Array<{ id: number; lineCount: number }> = [];
    let match;
    while ((match = pattern.exec(command)) !== null) {
      results.push({ id: parseInt(match[1], 10), lineCount: parseInt(match[2], 10) });
    }
    return results;
  };

  const pastedTextInfos = getPastedTextInfo();

  // Fetch suggestions for @ mention autocomplete: other agents (from the store)
  // first, then files/folders from the selected agent's cwd.
  useEffect(() => {
    if (!mentionQuery.active || !selectedAgentId) {
      setMentionResults([]);
      return;
    }
    // Agent matches come from the in-memory store — no fetch needed. Exclude the
    // current agent (you don't tag yourself) and match by name.
    const q = mentionQuery.query.toLowerCase();
    const agentItems: FileMentionItem[] = Array.from(store.getState().agents.values())
      .filter((a) => a.id !== selectedAgentId && (q === '' || a.name.toLowerCase().includes(q)))
      .slice(0, 5)
      .map((a) => ({
        path: a.name,
        name: a.name,
        type: 'agent' as const,
        agentId: a.id,
        subtitle: a.isBoss ? `boss · ${a.class}` : a.class,
      }));

    if (mentionFetchRef.current) mentionFetchRef.current.abort();
    const ctrl = new AbortController();
    mentionFetchRef.current = ctrl;
    authFetch(apiUrl(`/api/agents/${selectedAgentId}/files?q=${encodeURIComponent(mentionQuery.query)}`), { signal: ctrl.signal })
      .then((r) => r.json())
      .then((data) => { setMentionResults([...agentItems, ...(data.files ?? [])]); setMentionIndex(0); })
      .catch(() => { if (!ctrl.signal.aborted) { setMentionResults(agentItems); setMentionIndex(0); } });
  }, [mentionQuery.active, mentionQuery.query, selectedAgentId]);

  const closeMention = useCallback(() => {
    setMentionQuery({ active: false, query: '', start: 0 });
    setMentionResults([]);
  }, []);

  // Slash commands only make sense as the whole message, so match against the
  // raw input. matchSlashCommands returns null the moment it stops looking like
  // a command prefix (a pasted path, an added space, a second line…).
  const slashMatches: SlashCommand[] = useMemo(() => {
    if (slashDismissed) return [];
    return matchSlashCommands(command, selectedAgent?.provider) ?? [];
  }, [command, selectedAgent?.provider, slashDismissed, pluginRegistryRevision]);
  const slashActive = slashMatches.length > 0;

  // Keep the highlight in range as the list narrows while typing.
  useEffect(() => {
    setSlashIndex((i) => (i < slashMatches.length ? i : 0));
  }, [slashMatches.length]);

  const applySlashCommand = useCallback((item: SlashCommand) => {
    setCommand(item.name);
    setSlashDismissed(true);
    requestAnimationFrame(() => {
      (textareaRef.current || inputRef.current)?.focus();
    });
  }, [setCommand, textareaRef, inputRef]);

  const handleSelectMention = useCallback((item: FileMentionItem) => {
    // Replace @query with the selected item's path, preserving surrounding text
    const before = command.slice(0, mentionQuery.start);
    const after = command.slice(mentionQuery.start + 1 + mentionQuery.query.length);
    setCommand(before + `@${item.path} ` + after);
    // Track the mention (deduplicated). Agents are keyed by id (names can collide);
    // files/folders by path.
    const key = (m: FileMentionItem) => (m.type === 'agent' ? `agent:${m.agentId}` : m.path);
    setFileMentions((prev) => prev.some((f) => key(f) === key(item)) ? prev : [...prev, item]);
    closeMention();
    // Re-focus the input
    requestAnimationFrame(() => {
      (textareaRef.current || inputRef.current)?.focus();
    });
  }, [command, mentionQuery, setCommand, closeMention, textareaRef, inputRef]);

  const handleToggleExpand = () => {
    const next = !isInputExpanded;

    if (next) {
      // Expanding: inline each chip's full text so the user can view/edit the
      // pasted content directly in the textarea. pastedTexts is kept intact
      // so we can re-chip on collapse.
      let nextCommand = command;
      for (const [id, fullText] of pastedTexts) {
        const placeholder = new RegExp(`\\[Pasted text #${id} \\+\\d+ lines\\]`, 'g');
        nextCommand = nextCommand.replace(placeholder, fullText);
      }
      if (nextCommand !== command) setCommand(nextCommand);
    } else {
      // Collapsing: re-chip each pasted text that still appears verbatim in
      // the command. Entries the user edited inline lose their chip identity
      // and stay inline.
      let nextCommand = command;
      const preserved = new Map<number, string>();
      for (const [id, fullText] of pastedTexts) {
        if (nextCommand.includes(fullText)) {
          const lineCount = (fullText.match(/\n/g) || []).length + 1;
          const placeholder = `[Pasted text #${id} +${lineCount} lines]`;
          nextCommand = nextCommand.replaceAll(fullText, placeholder);
          preserved.set(id, fullText);
        }
      }
      if (nextCommand !== command) setCommand(nextCommand);
      if (preserved.size !== pastedTexts.size) setPastedTexts(preserved);
    }

    setIsInputExpanded(next);
    if (next && !useTextarea) setForceTextarea(true);
  };

  const handleSendCommand = (queueOnly = false) => {
    if ((!command.trim() && attachedFiles.length === 0 && fileMentions.length === 0) || !selectedAgentId) return;

    if (command.trim() === '/clear' && attachedFiles.length === 0) {
      store.clearContext(selectedAgentId);
      onClearHistory();
      setCommand('');
      setForceTextarea(false);
      setPastedTexts(new Map());
      setAttachedFiles([]);
      resetPastedCount();
      return;
    }

    // Commander-managed shell slash commands execute locally through the
    // streamed /api/exec path. They must never be forwarded to an LLM.
    const shellSlashCommand = findShellSlashCommand(command);
    if (shellSlashCommand) {
      void executeShellSlashCommand(
        shellSlashCommand.handler || shellSlashCommand.name.replace(/^\//, ''),
        command.trim(),
        selectedAgentId,
      ).catch((error) => {
        if (!(error instanceof Error) || error.message !== 'Shell command execution cancelled') {
          reportShellCommandExecutionError(error);
        }
      });
      onSendCommand?.();
      setCommand('');
      setForceTextarea(false);
      setPastedTexts(new Map());
      setAttachedFiles([]);
      setFileMentions([]);
      closeMention();
      resetPastedCount();
      return;
    }

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

    // Append [@file:path] / [@folder:path] / [@agent:id] tokens for server-side
    // context injection (expandFileMentions resolves them before the agent runs).
    if (fileMentions.length > 0) {
      const mentionTokens = fileMentions
        .map((f) =>
          f.type === 'agent'
            ? `[@agent:${f.agentId}]`
            : `[@${f.type === 'dir' ? 'folder' : 'file'}:${f.path}]`
        )
        .join('\n');
      fullCommand = fullCommand ? `${fullCommand}\n\n${mentionTokens}` : mentionTokens;
    }

    // Mid-run messages for stdin-closed backends (Grok/Codex/OpenCode) are
    // queued SERVER-side by sendCommand and delivered when the turn ends —
    // no front needs to stay open. The queue bar (server snapshot) offers
    // "Send now" to interrupt instead. Claude injects mid-turn via stdin.
    store.sendCommand(selectedAgentId, fullCommand, queueOnly ? { queueOnly: true } : undefined);
    onSendCommand?.();
    setCommand('');
    setForceTextarea(false);
    setPastedTexts(new Map());
    setAttachedFiles([]);
    setFileMentions([]);
    closeMention();
    resetPastedCount();

    // On mobile, blur input to hide keyboard
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      inputRef.current?.blur();
      textareaRef.current?.blur();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const isMobile = window.innerWidth <= 768;

    // Slash-command dropdown keyboard navigation
    if (slashActive) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((i) => Math.min(i + 1, slashMatches.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const item = slashMatches[slashIndex];
        if (item) applySlashCommand(item);
        return;
      }
      if (e.key === 'Enter') {
        const item = slashMatches[slashIndex];
        // Already fully typed → Enter means send, not complete. That way
        // `/comp` + Enter completes and a second Enter runs it.
        if (item && item.name !== command.trim()) {
          e.preventDefault();
          applySlashCommand(item);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }

    // @ mention dropdown keyboard navigation
    if (mentionQuery.active && mentionResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, mentionResults.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const item = mentionResults[mentionIndex];
        if (item) handleSelectMention(item);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMention();
        return;
      }
    }

    if (e.key === 'Enter') {
      if (e.ctrlKey || (e.altKey && e.shiftKey)) {
        e.preventDefault();
        // Ctrl+Enter schedules the complete composer payload (text, pasted
        // blocks, uploaded files and @ mentions) behind the active turn.
        // Keep Alt+Shift+Enter as a backward-compatible alias.
        handleSendCommand(true);
        return;
      }

      // On mobile: Enter adds newline
      // On desktop: Shift+Enter adds newline, Enter sends
      if (isMobile) {
        if (!useTextarea) {
          e.preventDefault();
          setForceTextarea(true);
          setTimeout(() => {
            setCommand(command + '\n');
          }, 0);
        }
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

  const handleMouseDown = (_e: React.MouseEvent) => {
    // Allow normal mouse events on input/textarea
    // Middle-click paste is now only disabled on the container itself
  };

  const handleContainerAuxClick = (e: React.MouseEvent) => {
    // Disable middle-click (auxclick is the proper event for middle-click)
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;

    // Try to get files from clipboard items (works when copying files from file explorer)
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          const attached = await uploadFileWithProgress(blob);
          if (attached) {
            setAttachedFiles((prev) => [...prev, attached]);
          }
        }
        return;
      }

      // Handle any file type (not just images)
      if (item.kind === 'file') {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const attached = await uploadFileWithProgress(file);
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
        const attached = await uploadFileWithProgress(file);
        if (attached) {
          setAttachedFiles((prev) => [...prev, attached]);
        }
      }
      return;
    }

    const pastedText = e.clipboardData.getData('text');

    // Check if pasted text is a file path (single line, looks like a file path, AND has a file extension)
    const isSingleLine = !pastedText.includes('\n');
    const looksLikeFilePath = /^[/~][^\s]*$|^[A-Za-z]:\\[^\s]*$/.test(pastedText.trim());
    const hasFileExtension = /\.[a-zA-Z0-9]{1,5}$/.test(pastedText.trim());

    if (isSingleLine && looksLikeFilePath && hasFileExtension) {
      e.preventDefault();
      try {
        // Request the file from the server
        const response = await fetch('/api/files/by-path', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: pastedText.trim() }),
        });

        if (response.ok) {
          const blob = await response.blob();
          const filename = pastedText.trim().split(/[/\\]/).pop() || 'file';
          const attached = await uploadFileWithProgress(blob, filename);
          if (attached) {
            setAttachedFiles((prev) => [...prev, attached]);
          }
          return;
        }
      } catch {
        /* File not found or fetch failed - fall through to insert as text */
      }
      // File not found or fetch failed - insert the path as plain text
      setCommand(command + pastedText);
      return;
    }

    const lineCount = (pastedText.match(/\n/g) || []).length + 1;

    // In expanded mode, let large pastes flow in inline so the user sees
    // everything they're editing without fabricating new chips to re-expand.
    if (lineCount > 5 && !isInputExpanded) {
      e.preventDefault();
      const pasteId = incrementPastedCount();

      setPastedTexts((prev) => new Map(prev).set(pasteId, pastedText));

      const placeholder = `[Pasted text #${pasteId} +${lineCount} lines]`;
      const target = e.target as HTMLInputElement | HTMLTextAreaElement;
      const start = target.selectionStart || 0;
      const end = target.selectionEnd || 0;
      const newCommand = command.slice(0, start) + placeholder + command.slice(end);
      const newCursorPos = start + placeholder.length;
      cursorPositionRef.current = newCursorPos;
      setCommand(newCommand);

      if (!useTextarea) {
        setForceTextarea(true);
      } else {
        // Already in textarea mode - restore cursor after React re-render
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
          }
        });
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of files) {
      const attached = await uploadFileWithProgress(file);
      if (attached) {
        setAttachedFiles((prev) => [...prev, attached]);
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // ── File drop directly on the input container ───────────────────────────────
  // The container previously relied on the file-drop handler attached to the far
  // outer `.guake-terminal` ancestor, but that delegated drop is not reliably
  // delivered when the drop lands on the editable <input>/<textarea> (the
  // intermediate SplitTerminalLayout only preventDefaults dragover for agent-id
  // drags). Handling drop on the container itself — with its own dragover
  // preventDefault so it is a valid drop target — makes it work, and matches the
  // established agent behavior (upload + attach as a chip, same as paste).
  const dropDragCounter = useRef(0);
  const [isFileDragOver, setIsFileDragOver] = useState(false);

  const handleInputDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return; // ignore agent-id / text drags
    e.preventDefault();
    e.stopPropagation();
    dropDragCounter.current++;
    setIsFileDragOver(true);
  };

  const handleInputDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault(); // mark the container as a valid drop target
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleInputDragLeave = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    dropDragCounter.current--;
    if (dropDragCounter.current <= 0) {
      dropDragCounter.current = 0;
      setIsFileDragOver(false);
    }
  };

  const handleInputDrop = async (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation(); // don't let the outer .guake-terminal handler upload again
    dropDragCounter.current = 0;
    setIsFileDragOver(false);

    const files = e.dataTransfer.files;
    if (!files.length) return;
    for (const file of Array.from(files)) {
      const attached = await uploadFileWithProgress(file);
      if (attached) {
        setAttachedFiles((prev) => [...prev, attached]);
      }
    }
  };

  return (
    <>
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

      {/* Pasted text chips display */}
      {pastedTextInfos.length > 0 && (
        <div className="guake-pasted-texts">
          {pastedTextInfos.map(({ id, lineCount }) => {
            const fullText = pastedTexts.get(id) || '';
            return (
              <PastedTextChip
                key={id}
                id={id}
                lineCount={lineCount}
                fullText={fullText}
                onRemove={() => removePastedText(id)}
                onUpdate={(newText) => updatePastedText(id, newText)}
              />
            );
          })}
        </div>
      )}

      {/* Attached files display */}
      {(attachedFiles.length > 0 || uploadingFiles.length > 0) && (
        <div className="guake-attachments">
          {uploadingFiles.map(({ id, name, progress }) => (
            <div key={id} className="guake-attachment guake-attachment-uploading">
              <span className="guake-attachment-spinner" />
              <div className="guake-attachment-info">
                <div className="guake-attachment-name-row">
                  <span className="guake-attachment-name">{name}</span>
                </div>
                <span className="guake-attachment-size">
                  {t('terminal:input.uploading')} · {progress}%
                </span>
                <span
                  className="guake-attachment-progress"
                  role="progressbar"
                  aria-label={`${name}: ${progress}%`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                >
                  <span style={{ width: `${progress}%` }} />
                </span>
              </div>
              <button
                type="button"
                className="guake-attachment-remove guake-attachment-cancel"
                onClick={() => cancelUpload(id)}
                title={t('common:buttons.cancel')}
                aria-label={`${t('common:buttons.cancel')}: ${name}`}
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          ))}
          {attachedFiles.map((file) => {
            const imageUrl = file.isImage ? getImageWebUrl(file.path) : null;
            const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';
            const isDocument = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(fileExtension);

            return (
              <div
                key={file.id}
                className={`guake-attachment ${file.isImage ? 'is-image clickable' : ''} ${isDocument ? 'is-document' : ''}`}
                onClick={() => {
                  if (file.isImage) {
                    onImageClick(imageUrl!, file.name);
                  }
                }}
              >
                {file.isImage && imageUrl ? (
                  <img src={imageUrl} alt={file.name} className="guake-attachment-thumb" />
                ) : (
                  <img
                    src={`${import.meta.env.BASE_URL}assets/vscode-icons/${getFileIcon(fileExtension)}`}
                    alt={file.name}
                    className="guake-attachment-icon"
                    style={{ width: '24px', height: '24px' }}
                  />
                )}
                <div className="guake-attachment-info">
                  <div className="guake-attachment-name-row">
                    <img
                      src={`${import.meta.env.BASE_URL}assets/vscode-icons/${getFileIcon(fileExtension)}`}
                      alt={fileExtension}
                      className="guake-attachment-type-icon"
                      style={{ width: '11px', height: '11px' }}
                    />
                    <span className="guake-attachment-name" title={file.path}>
                      {file.name}
                    </span>
                  </div>
                  <span className="guake-attachment-size">({Math.round(file.size / 1024)}KB)</span>
                </div>
                <button
                  className="guake-attachment-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAttachedFile(file.id);
                  }}
                  title={t('terminal:input.removeAttachment')}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Queued messages display */}
      {pendingMessages.length > 0 && (
        <div className="guake-pending-messages">
          <div className="guake-pending-messages-header">
            <Icon name="status-pending" size={12} />
            <span>
              {pendingMessages.length === 1
                ? t('terminal:input.pendingMessage', '1 message queued – will send when connected')
                : t('terminal:input.pendingMessages', '{{count}} messages queued – will send when connected', { count: pendingMessages.length })}
            </span>
          </div>
          <div className="guake-pending-messages-list">
            {pendingMessages.map((msg, idx) => (
              <div key={idx} className="guake-pending-message-chip">
                <span className="guake-pending-message-text" title={msg.command}>
                  {msg.command.length > 60 ? msg.command.slice(0, 60) + '...' : msg.command}
                </span>
                <button
                  className="guake-pending-message-remove"
                  onClick={() => {
                    removePendingMessageForAgent(selectedAgentId, idx);
                    setPendingMessages(getPendingMessagesForAgent(selectedAgentId));
                  }}
                  title={t('terminal:input.removeQueuedMessage', 'Remove queued message')}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <QueuedMessagesBar
        queue={serverQueue.queue}
        isWorking={isWorking}
        onEnforce={handleEnforceQueued}
        onDelete={handleDeleteQueued}
      />

      <div className={`guake-input-wrapper ${selectedAgent.status === 'working' ? 'has-stop-btn is-working' : ''} ${showCompletion ? 'is-completed' : ''} ${promptBubbleText ? 'has-prompt-bubble' : ''}`}>
        <div
          className={`guake-input-swipe-shell ${swipeClosePhase !== 'idle' ? 'swipe-close-active' : ''} ${swipeCloseOffset >= MOBILE_SWIPE_CLOSE_THRESHOLD_PX ? 'swipe-close-ready' : ''}`}
          onTouchStart={handleSwipeCloseTouchStart}
          onTouchMove={handleSwipeCloseTouchMove}
          onTouchEnd={handleSwipeCloseTouchEnd}
          onTouchCancel={handleSwipeCloseTouchCancel}
        >
          {/* Mobile limits bar: session context + weekly provider quota. */}
          <div className="mobile-context-bar show-on-mobile">
            <button
              type="button"
              className="mobile-limit-gauge"
              onClick={() => store.setContextModalAgentId(selectedAgentId)}
              title={`Session context: ${Math.round(mobileContext.usedPercent)}% used`}
              aria-label={`Session context ${Math.round(mobileContext.usedPercent)} percent used`}
            >
              <span
                className="mobile-context-bar-fill"
                style={{ width: `${Math.min(100, mobileContext.usedPercent)}%`, backgroundColor: mobileContextColor }}
              />
              <span className="mobile-context-bar-text">
                <span className="mobile-context-bar-label">Ctx</span>
                <span className="mobile-context-bar-window">{formatTokenCapacity(mobileContext.contextWindow)}</span>
                <span className="mobile-context-bar-value" style={{ color: mobileContextColor }}>
                  {Math.round(mobileContext.usedPercent)}%
                </span>
              </span>
            </button>
            <button
              type="button"
              className="mobile-limit-gauge"
              onClick={() => store.setContextModalAgentId(selectedAgentId)}
              title={weeklyWindow
                ? `Weekly usage: ${Math.round(weeklyUsedPercent!)}% used`
                : providerUsage.error || 'Weekly usage unavailable'}
              aria-label={`Weekly usage ${weeklyValue}`}
            >
              <span
                className="mobile-context-bar-fill"
                style={{ width: `${weeklyUsedPercent ?? 0}%`, backgroundColor: weeklyColor }}
              />
              <span className="mobile-context-bar-text">
                <span className="mobile-context-bar-label">Week</span>
                <span className="mobile-context-bar-value" style={{ color: weeklyColor }}>
                  {weeklyValue}
                </span>
              </span>
            </button>
          </div>
          {/* Floating stop button + elapsed timer - isolated component to avoid re-rendering input area */}
          <ElapsedTimer
            agentId={selectedAgentId}
            isWorking={isWorking}
            timestamp={elapsedTimerTimestamp}
          />
          {/* Completion elapsed time - shown briefly when agent finishes */}
          {showCompletion && completionElapsed !== null && (
            <div className="guake-completion-time">{formatElapsed(completionElapsed)}</div>
          )}

          <div className={`guake-input ${useTextarea ? 'guake-input-expanded' : ''}`} style={{ position: 'relative' }}>
            {/* / slash command dropdown */}
            {slashActive && (
              <SlashCommandDropdown
                items={slashMatches}
                selectedIndex={slashIndex}
                onSelect={applySlashCommand}
              />
            )}
            {/* @ file mention dropdown */}
            {mentionQuery.active && mentionResults.length > 0 && (
              <FileMentionDropdown
                items={mentionResults}
                selectedIndex={mentionIndex}
                onSelect={handleSelectMention}
                onClose={closeMention}
              />
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              style={{ display: 'none' }}
              accept="*"
            />
            <div
              ref={inputContainerRef}
              className={`guake-input-container ${isFileDragOver ? 'file-drag-over' : ''}`}
              tabIndex={-1}
              onAuxClick={handleContainerAuxClick}
              onDragEnter={handleInputDragEnter}
              onDragOver={handleInputDragOver}
              onDragLeave={handleInputDragLeave}
              onDrop={handleInputDrop}
            >
              <button
                type="button"
                className={`guake-pin-btn ${isPinned ? 'pinned' : ''}`}
                onClick={() => store.togglePinnedAgent(selectedAgentId)}
                title={isPinned ? 'Unpin this agent from the quick-select bar' : 'Pin this agent to the quick-select bar'}
                aria-pressed={isPinned}
              >
                <Icon name="pin" size={14} />
              </button>
              <button
                className="guake-attach-btn"
                onClick={() => fileInputRef.current?.click()}
                title={t('terminal:input.attachOrPaste')}
              >
                <Icon name="paperclip" size={14} />
              </button>
              {settings.experimentalTTS && (
                <button
                  className={`guake-mic-btn ${recording ? 'recording' : ''} ${transcribing ? 'transcribing' : ''}`}
                  onClick={toggleRecording}
                  title={recording ? t('terminal:input.stopRecording') : transcribing ? t('terminal:input.transcribing') : t('terminal:input.voiceInput')}
                  disabled={transcribing}
                >
                  <Icon name={transcribing ? 'hourglass' : recording ? 'record' : 'microphone'} size={14} color={recording ? '#ef4444' : undefined} />
                </button>
              )}
              {useTextarea ? (
                <textarea
                  ref={textareaRef}
                  placeholder={t('terminal:input.placeholder', { agent: selectedAgent.name })}
                  value={command}
                  onChange={handleChange}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  onMouseDown={handleMouseDown}
                  onFocus={handleInputFocus}
                  onBlur={handleInputBlur}
                  aria-keyshortcuts="Control+Enter"
                />
              ) : (
                <input
                  ref={inputRef}
                  type="text"
                  placeholder={t('terminal:input.placeholder', { agent: selectedAgent.name })}
                  value={command}
                  onChange={handleChange}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  onMouseDown={handleMouseDown}
                  onFocus={handleInputFocus}
                  onBlur={handleInputBlur}
                  aria-keyshortcuts="Control+Enter"
                />
              )}
              <button
                className={`guake-expand-btn ${isInputExpanded ? 'active' : ''}`}
                onClick={handleToggleExpand}
                title={isInputExpanded ? t('terminal:input.collapseInput') : t('terminal:input.expandInput')}
                type="button"
              >
                <Icon name={isInputExpanded ? 'caret-down' : 'caret-up'} size={12} />
              </button>
              <button
                onClick={() => handleSendCommand()}
                disabled={!command.trim() && attachedFiles.length === 0 && fileMentions.length === 0}
                title={`${t('terminal:input.send')} · Ctrl+Enter: schedule`}
              >
                <Icon name="send" size={14} />
              </button>
              {promptBubbleText && (
                <button
                  type="button"
                  className="guake-prompt-bubble"
                  onClick={() => window.dispatchEvent(new CustomEvent('tide:jump-to-last-prompt', { detail: { agentId: selectedAgentId } }))}
                  title={t('terminal:input.jumpToPrompt', 'Go to this prompt in the conversation')}
                >
                  <Icon name="chat" size={10} />
                  <span className="guake-prompt-bubble-text">{promptBubbleText}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
});
