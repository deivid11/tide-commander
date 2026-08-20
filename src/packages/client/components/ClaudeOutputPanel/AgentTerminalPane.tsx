/**
 * AgentTerminalPane - Self-contained terminal pane for a single agent.
 *
 * Encapsulates history loading, output rendering (VirtualizedOutputList),
 * input area (TerminalInputArea), search, scroll management, and all
 * per-agent state. Can be instantiated multiple times with different
 * agentId props for split terminal views.
 *
 * Extracted from GuakeOutputPanel to enable multi-pane layouts.
 */

import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  memo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  useLastPrompts,
  useAgentOutputs,
  useAgentCompacting,
  useReconnectCount,
  useHistoryRefreshTrigger,
  useExecTasks,
  useAgentTestRunHandles,
  useAgentHttpRunHandles,
  useSubagentsMapForAgent,
  usePermissionRequests,
  useAgentPrompts,
  usePinnedAgentIds,
  useAgentSelectionSeq,
  store,
  type ClaudeOutput,
} from '../../store';
import { apiUrl, authFetch } from '../../utils/storage';
import type { Agent, AgentPrompt } from '../../../shared/types';
import type { AttachedFile } from '../shared/outputTypes';

// Types
import type { ViewMode, EnrichedHistoryMessage, TodoItem } from './types';
import { resolveTodoWriteDisplay, type MergeableTodo } from '../../utils/todoMerge';

// Hooks
import { useHistoryLoader } from './useHistoryLoader';
import { usePinnedSwipeNavigation } from './usePinnedSwipeNavigation';
import { useSearchHistory, type UseSearchHistoryReturn } from './useSearchHistory';
import { useSearchDomHighlight } from './searchDomHighlight';
import { useModalStackRegistration } from '../../hooks/useModalStack';
import { highlightText } from './contentRendering';
import { Icon } from '../Icon';
import { useTerminalInput } from './useTerminalInput';
import { useMessageNavigation } from './useMessageNavigation';
import { useFilteredOutputsWithLogging } from '../shared/useFilteredOutputs';
import { parseBossContext, parseInjectedInstructions } from './BossContext';
import {
  parseBashTrackingStatusCommand,
  parseBashTaskLabelCommand,
  parseBashNotificationCommand,
  parseBashReportTaskCommand,
  parseBashMemoryCommand,
  extractToolKeyParam,
  isCodexExecWrapper,
  getCodexExecCommand,
  getCodexExecEditPaths,
  getCodexExecPresentation,
  getShellCommandPresentation,
  normalizeShellCommand,
} from '../../utils/outputRendering';

// Components
import { SearchBar } from './TerminalHeader';
import { SearchResultsPanel } from './SearchResultsPanel';
import { TerminalInputArea } from './TerminalInputArea';
import { PinnedAgentsBar } from './PinnedAgentsBar';
import { useAgentDockPosition } from './agentDockPosition';
import { VirtualizedOutputList } from './VirtualizedOutputList';
// AgentPromptCard import removed — interactive prompt UI now renders inline
// in the matching tool_use chip via AskQuestionInput / ExitPlanModeInput
// when a pending agent-prompt is present.

// ─── Constants ──────────────────────────────────────────────────────────────

// The source emits stream-final and result fallback synchronously. Keeping this
// identity fallback window tiny prevents two real, identical turns from ever
// being mistaken for the observed uuid-bearing/uuid-less twin.
const LIVE_RESULT_FALLBACK_DUPLICATE_WINDOW_MS = 250;
const HISTORY_ASSISTANT_OUTPUT_DUPLICATE_WINDOW_MS = 120_000;
/**
 * Live thinking rows vs persisted reasoning entries: uuids never match (live
 * mints grok-thinking-* / claude-stream-*; history has the entry id), so dedup
 * is content-based. Wide window — a long reasoning block can stream minutes
 * before the entry is flushed, and identical reasoning twice in 10min = same turn.
 */
const HISTORY_THINKING_OUTPUT_DUPLICATE_WINDOW_MS = 600_000;
/** Live tool chip vs history tool_use: Grok early uuid ≠ call id, so uuid dedup misses. */
const HISTORY_TOOL_OUTPUT_DUPLICATE_WINDOW_MS = 180_000;
/** Two live rows for the same tool call (early + call-* dual emit). */
const LIVE_TOOL_DUPLICATE_WINDOW_MS = 15_000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeUserMessage(text: string): string {
  const parsedBoss = parseBossContext(text);
  const parsedInjected = parseInjectedInstructions(parsedBoss.userMessage);
  return parsedInjected.userMessage.trim().replace(/\r\n/g, '\n');
}

function normalizeAssistantMessage(text: string): string {
  return text.trim().replace(/\r\n/g, '\n');
}

/**
 * Dedup key for thinking rows. Live rows accumulate streamed chunks while
 * session history joins reasoning summary parts with '\n' — the same reasoning
 * can differ in internal whitespace between the two, so collapse it.
 */
function normalizeThinkingMessage(text: string): string {
  return text
    .replace(/^\s*\[thinking\]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Mirrors the `[System]` notice shape OutputLine/HistoryLine render specially. */
const SYSTEM_NOTICE_PREFIX = /^\s*[\u{1F300}-\u{1FAFF}☀-➿]?\s*\[System\]/u;

function isToolOrSystemOutput(text: string): boolean {
  return text.startsWith('Using tool:')
    || text.startsWith('Tool input:')
    || text.startsWith('Tool result:')
    || text.startsWith('Bash output:')
    || text.startsWith('Session started:')
    || text.startsWith('[thinking]')
    || text.startsWith('Tokens:')
    || text.startsWith('Cost:')
    || text.startsWith('Context (estimated from Codex turn usage):')
    // Any `[System]` notice, with or without its leading status emoji
    // (🔄 reattach, 📋 resume, 🛑 interrupt, ⚠ model fallback, …).
    || SYSTEM_NOTICE_PREFIX.test(text);
}

/**
 * Stable key for a tool invocation: toolName + primary param (command, path, …).
 * Used to collapse live `grok-early-*` chips against history `call-*` rows and
 * dual live emissions of the same call.
 */
function makeToolInvocationKey(
  toolName: string | undefined,
  toolInput: Record<string, unknown> | undefined,
  textFallback?: string,
): string | null {
  const name = (toolName || '').trim();
  if (!name && textFallback?.startsWith('Using tool:')) {
    return makeToolInvocationKey(textFallback.replace('Using tool:', '').trim(), toolInput);
  }
  if (!name) return null;
  if (toolInput && isCodexExecWrapper(toolInput)) {
    const command = getCodexExecCommand(toolInput);
    if (command) {
      const semantic = getCodexExecPresentation(toolInput);
      return `${semantic.toolName}::${normalizeShellCommand(command)}`;
    }
  }
  if (name === 'Bash' && toolInput) {
    const command = typeof toolInput.command === 'string'
      ? toolInput.command
      : typeof toolInput.cmd === 'string' ? toolInput.cmd : '';
    if (command) {
      const semantic = getShellCommandPresentation(command);
      if (semantic.toolName !== 'Bash') {
        return `${semantic.toolName}::${normalizeShellCommand(command)}`;
      }
    }
  }
  let keyParam: string | null = null;
  if (toolInput && typeof toolInput === 'object' && Object.keys(toolInput).length > 0) {
    try {
      keyParam = extractToolKeyParam(name, JSON.stringify(toolInput));
    } catch { /* ignore */ }
  }
  // Prefer a real param so two Reads of different files stay distinct.
  // Empty early cards (no input yet) use name-only and dedupe carefully by time.
  return keyParam ? `${name}::${keyParam}` : `${name}::`;
}

function historyToolInvocationKey(msg: {
  toolName?: string;
  toolInput?: Record<string, unknown>;
  content?: string;
}): string | null {
  let input = msg.toolInput;
  if ((!input || Object.keys(input).length === 0) && msg.content) {
    try {
      const parsed = JSON.parse(msg.content);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        input = parsed as Record<string, unknown>;
      }
    } catch { /* ignore */ }
  }
  return makeToolInvocationKey(msg.toolName, input);
}

// ─── Props & Handle ─────────────────────────────────────────────────────────

export interface AgentTerminalPaneProps {
  /** The agent ID this pane displays */
  agentId: string;
  /** The agent object (resolved by parent) */
  agent: Agent;
  /** View mode (simple/chat/advanced) */
  viewMode: ViewMode;
  /** Whether the terminal is open/visible */
  isOpen: boolean;

  // ── Modal callbacks (parent owns modals) ──
  onImageClick: (url: string, name: string) => void;
  onFileClick: (path: string, editData?: { oldString?: string; newString?: string; operation?: string; unifiedDiff?: string; highlightRange?: { offset: number; limit: number }; targetLine?: number }) => void;
  onBashClick: (command: string, output: string) => void;
  onViewMarkdown: (content: string) => void;
  /**
   * Fired when a Bash tool_use in dedupedHistory becomes linked to its
   * tool_result for the first time. The parent uses this to resolve a
   * currently-open "Running..." bash modal whose live look-ahead window
   * has already passed by the time the tool_result lands in the JSONL.
   */
  onLiveBashResultLinked?: (command: string, output: string) => void;

  // ── Keyboard height handler (parent owns, shared) ──
  keyboard: {
    handleInputFocus: () => void;
    handleInputBlur: () => void;
    keyboardScrollLockRef: React.MutableRefObject<boolean>;
    cleanup: () => void;
  };

  // ── Mobile swipe close (for TerminalInputArea) ──
  canSwipeClose?: boolean;
  onSwipeCloseOffsetChange?: (offset: number) => void;
  onSwipeClose?: () => void;

  /** Whether any modal is open in the parent (disables message navigation) */
  hasModalOpen?: boolean;
}

/**
 * Imperative handle exposed to parent for cross-component interactions
 * (swipe navigation, search-from-header, file drag-drop, etc.)
 */
export interface AgentTerminalPaneHandle {
  /** Scroll container ref — used by parent for swipe navigation */
  outputScrollRef: React.RefObject<HTMLDivElement | null>;
  /** Input refs — used by parent for focus management */
  inputRef: React.RefObject<HTMLInputElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** History loader — used by parent header for load-more button */
  historyLoader: {
    loadingHistory: boolean;
    fetchingHistory: boolean;
    historyLoadVersion: number;
    loadingMore: boolean;
    hasMore: boolean;
    totalCount: number;
    loadMoreHistory: () => Promise<void>;
    clearHistory: () => void;
    hasCachedHistory: (agentId: string) => boolean;
    history: Array<{ type: string; content: string; timestamp: string }>;
  };
  /** Search state — used by parent header for SearchBar */
  search: UseSearchHistoryReturn;
  /** Terminal input — used by parent for file drag-drop */
  terminalInput: {
    uploadFile: (file: File | Blob, filename?: string) => Promise<AttachedFile | null>;
    setAttachedFiles: (value: AttachedFile[] | ((prev: AttachedFile[]) => AttachedFile[])) => void;
    useTextarea: boolean;
  };
  /** Combined deduped data — used by parent for search all items */
  getDedupedHistory: () => EnrichedHistoryMessage[];
  getDedupedOutputs: () => ClaudeOutput[];
  /** Output count for header display */
  outputsLength: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const AgentTerminalPane = memo(forwardRef<AgentTerminalPaneHandle, AgentTerminalPaneProps>(function AgentTerminalPane(
  {
    agentId,
    agent,
    viewMode,
    isOpen,
    onImageClick,
    onFileClick,
    onBashClick,
    onViewMarkdown,
    onLiveBashResultLinked,
    keyboard,
    canSwipeClose,
    onSwipeCloseOffsetChange,
    onSwipeClose,
    hasModalOpen,
  },
  ref,
) {
  const { t } = useTranslation(['terminal', 'common']);

  // ── Per-agent store subscriptions ──
  const reconnectCount = useReconnectCount();
  const historyRefreshTrigger = useHistoryRefreshTrigger(agentId);
  const lastPrompts = useLastPrompts();
  const outputs = useAgentOutputs(agentId);
  const isCompacting = useAgentCompacting(agentId);
  // A freshly-forked agent has no session of its own yet, but it should still
  // show the inherited (source) conversation — the server's history endpoint
  // falls back to forkSourceSessionId until the fork's first run establishes
  // its own session. So treat a pending fork as having loadable history too.
  const sessionId = agent?.sessionId || agent?.forkSourceSessionId || null;
  const hasSessionId = !!sessionId;

  // Exec tasks, test runs & subagents
  const execTasks = useExecTasks(agentId);
  // Stable handles only (avoids re-rendering the whole list on every output line;
  // TestRunInline subscribes to the live run itself).
  const testRunHandles = useAgentTestRunHandles(agentId);
  const httpRunHandles = useAgentHttpRunHandles(agentId);
  const subagents = useSubagentsMapForAgent(agentId);

  // Pending permission requests
  const permissionRequests = usePermissionRequests();
  const pendingPermissions = useMemo(() => {
    if (!agentId) return [];
    return Array.from(permissionRequests.values()).filter(
      (r) => r.agentId === agentId && r.status === 'pending'
    );
  }, [agentId, permissionRequests]);

  // Pending interactive prompts are now consumed by OutputLine itself (it
  // calls useAgentPrompts directly to find the prompt matching its tool_use
  // chip). We keep the import here only because removing it would also
  // require touching imports across many call sites.

  // ── Refs ──
  const outputScrollRef = useRef<HTMLDivElement>(null);
  const terminalInputRef = useRef<HTMLInputElement>(null);
  const terminalTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Red flash on the output area when this agent's run is killed via Ctrl+C
  // (dispatched by useCtrlCStopAgent). Cleared on animation end.
  const [stopFlash, setStopFlash] = useState(false);
  useEffect(() => {
    const onStopFlash = (e: Event) => {
      const detail = (e as CustomEvent<{ agentId?: string }>).detail;
      if (detail?.agentId === agentId) setStopFlash(true);
    };
    window.addEventListener('tide:agent-stop-flash', onStopFlash);
    return () => window.removeEventListener('tide:agent-stop-flash', onStopFlash);
  }, [agentId]);

  // ── Display outputs ──
  const displayOutputs = outputs;

  // ── History loader ──
  const historyLoader = useHistoryLoader({
    selectedAgentId: agentId,
    sessionId,
    reconnectCount,
    historyRefreshTrigger,
    lastPrompts,
    outputScrollRef,
  });

  // ── Terminal input ──
  const terminalInput = useTerminalInput({ selectedAgentId: agentId });

  // Touch swipe on the chat area cycles the PINNED agents (>= 2 pinned). Shared
  // by 3D/normal and Flat modes since both render this pane. In normal mode the
  // all-agent useSwipeNavigation yields to this when >= 2 agents are pinned.
  usePinnedSwipeNavigation({ outputRef: outputScrollRef, enabled: isOpen });

  // When agents are pinned, the floating pinned-bar (mobile) overlays the bottom
  // of the chat — flag the output so the mobile stylesheet reserves extra bottom
  // scroll clearance (`.guake-output.has-pinned-agents`), keeping text uncovered.
  const hasPinnedAgents = usePinnedAgentIds().length > 0;

  // Pending agent-prompts (AskUserQuestion / ExitPlanMode awaiting human input).
  // Read here at the pane level so enrichHistory can attach _pendingPromptId to
  // matching tool_use messages — far more reliable than each HistoryLine
  // subscribing to the agent-prompts map individually.
  const pendingAgentPrompts = useAgentPrompts(agentId);

  // ── Filtered & deduped history ──
  const filteredHistory = useMemo((): EnrichedHistoryMessage[] => {
    const { history } = historyLoader;
    const toolResultMap = new Map<string, string>();
    const wrappedCommandsBySecond = new Map<number, Set<string>>();
    const wrappedEditPathsBySecond = new Map<number, Set<string>>();
    const duplicateBashToolIds = new Set<string>();
    // Collect tool_use_ids whose bash command was a self-invoked Tide Commander
    // API curl (tracking/taskLabel/notification/report-task). The tool_use itself
    // renders as a styled chip (HistoryLine resolves these via the bash*Command
    // parsers); only the tool_result is suppressed, since it's a raw JSON dump
    // that would otherwise render as a noisy `$ Terminal output` block.
    const suppressedToolResultIds = new Set<string>();
    for (const msg of history) {
      if (msg.type === 'tool_result' && msg.toolUseId) {
        toolResultMap.set(msg.toolUseId, msg.content);
      }
      if (msg.type === 'tool_use' && msg.toolName === 'Bash' && msg.toolUseId) {
        let bashCommand: string | undefined;
        try {
          const input = msg.toolInput || (msg.content ? JSON.parse(msg.content) : {});
          bashCommand = input.command;
        } catch { /* ignore */ }
        if (bashCommand && (
          parseBashTrackingStatusCommand(bashCommand)
          || parseBashTaskLabelCommand(bashCommand)
          || parseBashNotificationCommand(bashCommand)
          || parseBashReportTaskCommand(bashCommand)
          || parseBashMemoryCommand(bashCommand)
        )) {
          suppressedToolResultIds.add(msg.toolUseId);
        }
      }
      if (msg.type === 'tool_use' && msg.toolName === 'Bash') {
        const input = msg.toolInput || (() => { try { return msg.content ? JSON.parse(msg.content) : {}; } catch { return {}; } })();
        if (isCodexExecWrapper(input)) {
          const inner = getCodexExecCommand(input);
          if (inner) {
            const second = Math.floor(new Date(msg.timestamp).getTime() / 1000);
            const commands = wrappedCommandsBySecond.get(second) || new Set<string>();
            commands.add(normalizeShellCommand(inner));
            wrappedCommandsBySecond.set(second, commands);
          }
          const editPaths = getCodexExecEditPaths(input);
          if (editPaths.length > 0) {
            const second = Math.floor(new Date(msg.timestamp).getTime() / 1000);
            const paths = wrappedEditPathsBySecond.get(second) || new Set<string>();
            editPaths.forEach((path) => paths.add(path));
            wrappedEditPathsBySecond.set(second, paths);
          }
        }
      }
    }

    // Codex may persist both the JS exec wrapper and its native command_execution
    // item. Mark the native twin so only the semantic wrapper card is rendered.
    for (const msg of history) {
      if (msg.type !== 'tool_use' || (msg.toolName !== 'Bash' && msg.toolName !== 'Edit')) continue;
      const input = msg.toolInput || (() => { try { return msg.content ? JSON.parse(msg.content) : {}; } catch { return {}; } })();
      if (isCodexExecWrapper(input)) continue;
      const second = Math.floor(new Date(msg.timestamp).getTime() / 1000);
      if (msg.toolName === 'Bash') {
        const command = typeof input.command === 'string' ? input.command : typeof input.cmd === 'string' ? input.cmd : '';
        if (command && wrappedCommandsBySecond.get(second)?.has(normalizeShellCommand(command)) && msg.toolUseId) {
          duplicateBashToolIds.add(msg.toolUseId);
        }
      }
      if (msg.toolName === 'Edit') {
        const path = typeof input.file_path === 'string' ? input.file_path : typeof input.filePath === 'string' ? input.filePath : '';
        const wrappedPaths = wrappedEditPathsBySecond.get(second);
        const pathMatches = path && wrappedPaths && [...wrappedPaths].some((wrappedPath) =>
          wrappedPath === path || wrappedPath.endsWith(`/${path}`) || path.endsWith(`/${wrappedPath}`)
        );
        if (pathMatches && msg.toolUseId) {
          duplicateBashToolIds.add(msg.toolUseId);
        }
      }
    }

    // Parse the CLI's AskUserQuestion result string ("Q1"="A1", "Q2"="A2, A3")
    // into a question→answer map so the tool_use block can highlight picks.
    function parseAskAnswers(resultText: string): Record<string, string> {
      const out: Record<string, string> = {};
      const re = /"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(resultText)) !== null) {
        if (m[1] !== undefined && m[2] !== undefined) out[m[1]] = m[2];
      }
      return out;
    }

    // Build a Task #N → subject index from prior TaskCreate results. The CLI
    // returns content like: "Task #3 created successfully: Wire Tailwind ...".
    // We use this to render TaskUpdate chips with the task subject instead of
    // a meaningless "status: completed" string.
    const taskIdToSubject = new Map<string, string>();
    const TASK_CREATE_RE = /^Task\s+#(\d+)\s+created\s+successfully:\s*(.+)$/m;
    for (const msg of history) {
      if (msg.type === 'tool_result' && msg.toolName === 'TaskCreate') {
        const text = typeof msg.content === 'string' ? msg.content : '';
        const m = TASK_CREATE_RE.exec(text);
        if (m && m[1] && m[2]) {
          taskIdToSubject.set(m[1], m[2].trim());
        }
      }
    }

    // Index pending agent-prompts by their toolUseId so the matching tool_use
    // chip can advertise its `_pendingPromptId` and flip into interactive mode.
    const pendingPromptByToolUseId = new Map<string, string>();
    for (const p of pendingAgentPrompts) {
      pendingPromptByToolUseId.set(p.id, p.id);
    }

    const enrichHistory = (messages: typeof history): EnrichedHistoryMessage[] => {
      const out: EnrichedHistoryMessage[] = [];
      // Running TodoWrite snapshot so Grok merge:true status-only updates can
      // re-attach content from earlier full lists when rendering history.
      let runningTodos: MergeableTodo[] = [];
      // Running harness Task-tool state (TaskCreate/TaskUpdate) so each
      // TaskUpdate line can render the full consolidated task list — same
      // presentation as TodoWrite — instead of a lone status chip.
      const runningTasks = new Map<string, { subject?: string; status: TodoItem['status'] }>();
      const taskSnapshot = (): TodoItem[] =>
        [...runningTasks.entries()]
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([id, t]) => ({ id, content: t.subject || `Task #${id}`, status: t.status }));
      for (const msg of messages) {
        if (msg.toolUseId && duplicateBashToolIds.has(msg.toolUseId)) continue;
        if (msg.type === 'tool_result' && msg.toolUseId && suppressedToolResultIds.has(msg.toolUseId)) {
          continue;
        }
        // AskUserQuestion tool_result is now folded into the tool_use chip
        // (the question block shows the user's pick highlighted) — suppress
        // the standalone result row so we don't render the answers twice.
        if (msg.type === 'tool_result' && (msg.toolName === 'AskUserQuestion' || msg.toolName === 'AskFollowupQuestion')) {
          continue;
        }
        if (msg.type === 'tool_use' && msg.toolName === 'Bash' && msg.toolUseId) {
          const bashOutput = toolResultMap.get(msg.toolUseId);
          let bashCommand: string | undefined;
          try {
            const input = msg.toolInput || (msg.content ? JSON.parse(msg.content) : {});
            bashCommand = input.command;
          } catch { /* ignore */ }
          out.push({ ...msg, _bashOutput: bashOutput, _bashCommand: bashCommand });
          continue;
        }
        // exec: the result is the command output shown in the expanded card.
        // web_search: Codex's tool_use fires before the query/action are known,
        // so the result holds the ONLY label-worthy data.
        if (
          msg.type === 'tool_use'
          && (msg.toolName === 'exec' || msg.toolName === 'web_search' || msg.toolName === 'WebSearch')
          && msg.toolUseId
        ) {
          out.push({ ...msg, _toolOutput: toolResultMap.get(msg.toolUseId) });
          continue;
        }
        if (msg.type === 'tool_use' && msg.toolName === 'TodoWrite') {
          const prior: TodoItem[] = runningTodos.map((t) => ({
            id: t.id,
            content: t.content,
            status: t.status,
            activeForm: t.activeForm,
          }));
          const rawInput = msg.toolInput
            ? JSON.stringify(msg.toolInput)
            : (msg.content || '{}');
          runningTodos = resolveTodoWriteDisplay(rawInput, runningTodos);
          out.push({ ...msg, _priorTodos: prior });
          continue;
        }
        if (msg.type === 'tool_use' && (msg.toolName === 'AskUserQuestion' || msg.toolName === 'AskFollowupQuestion') && msg.toolUseId) {
          const resultText = toolResultMap.get(msg.toolUseId);
          const answers = resultText ? parseAskAnswers(resultText) : undefined;
          const pendingPromptId = pendingPromptByToolUseId.get(msg.toolUseId);
          out.push({ ...msg, _askQuestionAnswers: answers, _pendingPromptId: pendingPromptId });
          continue;
        }
        if (msg.type === 'tool_use' && msg.toolName === 'ExitPlanMode' && msg.toolUseId) {
          const pendingPromptId = pendingPromptByToolUseId.get(msg.toolUseId);
          out.push({ ...msg, _pendingPromptId: pendingPromptId });
          continue;
        }
        if (msg.type === 'tool_result' && msg.toolName === 'TaskCreate') {
          const text = typeof msg.content === 'string' ? msg.content : '';
          const m = TASK_CREATE_RE.exec(text);
          if (m && m[1]) {
            const prev = runningTasks.get(m[1]);
            runningTasks.set(m[1], { subject: m[2]?.trim() || prev?.subject, status: prev?.status ?? 'pending' });
          }
          out.push(msg as EnrichedHistoryMessage);
          continue;
        }
        if (msg.type === 'tool_use' && msg.toolName === 'TaskUpdate') {
          const ti = (msg.toolInput || {}) as Record<string, unknown>;
          const rawId = ti.taskId ?? ti.task_id ?? ti.id;
          const id = (typeof rawId === 'string' || typeof rawId === 'number') ? String(rawId) : undefined;
          const subject = id ? taskIdToSubject.get(id) : undefined;
          if (id) {
            if (ti.status === 'deleted') {
              runningTasks.delete(id);
            } else {
              const prev = runningTasks.get(id);
              const status = ti.status === 'pending' || ti.status === 'in_progress' || ti.status === 'completed'
                ? ti.status
                : prev?.status ?? 'pending';
              runningTasks.set(id, { subject: subject ?? prev?.subject, status });
            }
          }
          const snapshot = taskSnapshot();
          out.push({ ...msg, _taskSubject: subject, _taskSnapshot: snapshot.length > 0 ? snapshot : undefined });
          continue;
        }
        out.push(msg as EnrichedHistoryMessage);
      }
      return out;
    };

    return enrichHistory(history);
  }, [historyLoader.history, pendingAgentPrompts]);

  const filteredOutputs = useFilteredOutputsWithLogging({ outputs: displayOutputs, viewMode });

  // ── History freeze while reading scrolled-up ──
  // Mid-turn session refreshes swap live rows for their persisted twins
  // (different row keys, fresh height estimates) exactly where the user is
  // reading — the virtualizer treats that as remove+insert and the viewport
  // jumps. While auto-scroll is off, hold the APPLIED history constant; the
  // pending refresh lands when the user returns to the very bottom (where
  // auto-scroll immediately re-anchors), on send, or on agent switch.
  // Exception: a changed FIRST entry means load-more prepended an older page —
  // apply it (the list's prepend anchoring compensates scrollTop).
  const dockPosition = useAgentDockPosition();

  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const frozenHistoryRef = useRef<{
    items: EnrichedHistoryMessage[];
    headUuid: string | undefined;
  } | null>(null);
  useEffect(() => {
    frozenHistoryRef.current = null;
  }, [agentId]);
  const displayHistory = useMemo((): EnrichedHistoryMessage[] => {
    if (shouldAutoScroll) {
      frozenHistoryRef.current = null;
      return filteredHistory;
    }
    const headUuid = filteredHistory[0]?.uuid;
    const frozen = frozenHistoryRef.current;
    if (!frozen || frozen.headUuid !== headUuid) {
      frozenHistoryRef.current = { items: filteredHistory, headUuid };
      return filteredHistory;
    }
    return frozen.items;
  }, [filteredHistory, shouldAutoScroll]);

  // Remove duplicate user prompts from history
  const dedupedHistory = useMemo((): EnrichedHistoryMessage[] => {
    const result: EnrichedHistoryMessage[] = [];
    const seenAssistantKeys = new Set<string>();
    const seenUserUuidKeys = new Set<string>();
    const seenToolUseKeys = new Set<string>();

    for (const msg of displayHistory) {
      if (msg.type === 'assistant') {
        const assistantKey = msg.uuid
          ? `uuid:${msg.uuid}:${normalizeAssistantMessage(msg.content)}`
          : `sig:${msg.timestamp}:${normalizeAssistantMessage(msg.content)}`;
        if (seenAssistantKeys.has(assistantKey)) {
          continue;
        }
        seenAssistantKeys.add(assistantKey);
        result.push(msg);
        continue;
      }

      if (msg.type !== 'user') {
        if (msg.type === 'tool_use') {
          const toolUseKey = msg.uuid || msg.toolUseId;
          if (toolUseKey) {
            if (seenToolUseKeys.has(toolUseKey)) {
              continue;
            }
            seenToolUseKeys.add(toolUseKey);
          }
        }
        result.push(msg);
        continue;
      }

      const key = normalizeUserMessage(msg.content);
      const userUuidKey = msg.uuid ? `uuid:${msg.uuid}:${key}` : null;
      if (userUuidKey && seenUserUuidKeys.has(userUuidKey)) {
        continue;
      }
      result.push(msg);
      if (userUuidKey) {
        seenUserUuidKeys.add(userUuidKey);
      }
    }

    return result;
  }, [displayHistory]);

  // Notify the parent the first time a Bash tool_use in dedupedHistory gains
  // its tool_result link (_bashOutput). Lets the parent close out a still-open
  // "Running..." bash modal whose live look-ahead window already passed by
  // the time the JSONL session refresh delivers the matching tool_result.
  const reportedBashToolUseIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    reportedBashToolUseIdsRef.current = new Set();
  }, [agentId]);
  useEffect(() => {
    if (!onLiveBashResultLinked) return;
    for (const msg of dedupedHistory) {
      if (msg.type !== 'tool_use' || msg.toolName !== 'Bash') continue;
      if (!msg.toolUseId || !msg._bashCommand || !msg._bashOutput) continue;
      if (reportedBashToolUseIdsRef.current.has(msg.toolUseId)) continue;
      reportedBashToolUseIdsRef.current.add(msg.toolUseId);
      onLiveBashResultLinked(msg._bashCommand, msg._bashOutput);
    }
  }, [dedupedHistory, onLiveBashResultLinked]);

  // History-derived dedup indexes, keyed only on dedupedHistory: rebuilding
  // them per live chunk (dedupedOutputs recomputes ~20x/s while streaming)
  // meant a Date parse + normalize pass over the whole history every time.
  const historyDedupIndexes = useMemo(() => {
    // Covers any non-user history uuid (assistant, tool_use, tool_result) so
    // that bash/tool live outputs replaying a persisted turn get deduped too.
    const historyKnownUuidSet = new Set<string>();
    const latestHistoryAssistantTsByKey = new Map<string, number>();
    // Normalized reasoning text → latest history ts ([thinking] assistant lines)
    const latestHistoryThinkingTsByKey = new Map<string, number>();
    // toolName::keyParam → latest history timestamp (Grok early≠call uuid)
    const latestHistoryToolTsByKey = new Map<string, number>();
    for (const msg of dedupedHistory) {
      const ts = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
      if (msg.type === 'user') continue;
      if (msg.uuid) {
        historyKnownUuidSet.add(msg.uuid);
      }
      // Also index by toolUseId (Anthropic tool_use_id like "toolu_01..."): live
      // outputs for tool_start/tool_result events are broadcast with uuid=tool_use_id,
      // which is different from the JSONL entry uuid — without this, tool outputs
      // duplicate in the panel until a history refresh flushes them.
      if (msg.toolUseId) {
        historyKnownUuidSet.add(msg.toolUseId);
      }
      if (msg.type === 'tool_use') {
        const toolKey = historyToolInvocationKey(msg);
        if (toolKey) {
          const prev = latestHistoryToolTsByKey.get(toolKey) ?? 0;
          if (ts > prev) latestHistoryToolTsByKey.set(toolKey, ts);
        }
        continue;
      }
      if (msg.type !== 'assistant') continue;
      // Reasoning entries load as assistant lines with a [thinking] prefix
      // (session-loader) — index them under the thinking key so live thinking
      // rows (whose uuids never match) can dedup by content.
      if (/^\s*\[thinking\]/i.test(msg.content)) {
        const thinkingKey = normalizeThinkingMessage(msg.content);
        if (thinkingKey) {
          const prevThinking = latestHistoryThinkingTsByKey.get(thinkingKey) ?? 0;
          if (ts > prevThinking) latestHistoryThinkingTsByKey.set(thinkingKey, ts);
        }
        continue;
      }
      const key = normalizeAssistantMessage(msg.content);
      const prev = latestHistoryAssistantTsByKey.get(key) ?? 0;
      if (ts > prev) latestHistoryAssistantTsByKey.set(key, ts);
    }
    return {
      historyKnownUuidSet,
      latestHistoryAssistantTsByKey,
      latestHistoryThinkingTsByKey,
      latestHistoryToolTsByKey,
    };
  }, [dedupedHistory]);

  // Remove live outputs that duplicate history (or each other for tools)
  const dedupedOutputs = useMemo(() => {
    const {
      historyKnownUuidSet,
      latestHistoryAssistantTsByKey,
      latestHistoryThinkingTsByKey,
      latestHistoryToolTsByKey,
    } = historyDedupIndexes;

    const result: typeof filteredOutputs = [];
    // toolKey → last kept live timestamp (collapse early + call-* twins)
    const latestLiveToolTsByKey = new Map<string, number>();
    // Claude normally finalizes a streamed row with the same uuid. Its result
    // fallback can occasionally repeat the full text without a uuid, though;
    // retain the canonical uuid-bearing row and hide that exact live twin.
    const latestLiveAssistantByKey = new Map<string, { ts: number; resultIndex: number }>();

    for (const output of filteredOutputs) {
      if (!output.isUserPrompt) {
        // Internal-API bookkeeping curls (tracking PATCH, notify, taskLabel,
        // report-task) are NOT suppressed here — OutputLine renders them as
        // styled chips via the bash*Command parsers. Mirrors the JSONL-side
        // behavior in `enrichHistory` above (only tool_result is hidden).
        // Apply uuid dedup unconditionally — a live output whose uuid matches a
        // persisted history entry is the same turn, regardless of whether the
        // text is classified as tool/system output.
        if (output.uuid && historyKnownUuidSet.has(output.uuid)) {
          continue;
        }

        const text = output.text || '';
        const ts = output.timestamp || 0;

        // Tool chips: Grok live uses grok-early-* uuids; history uses call-*.
        // Match by tool name + key param so history wins after refresh, and so
        // dual live emits (early + call-*) of the same invocation collapse.
        if (text.startsWith('Using tool:')) {
          const toolKey = makeToolInvocationKey(output.toolName, output.toolInput, text);
          // Require a real key param (not bare "Bash::") so unrelated empty
          // early cards of the same tool name are not collapsed together.
          if (toolKey && !toolKey.endsWith('::')) {
            const historyTs = latestHistoryToolTsByKey.get(toolKey);
            if (
              historyTs !== undefined
              && Math.abs(ts - historyTs) <= HISTORY_TOOL_OUTPUT_DUPLICATE_WINDOW_MS
            ) {
              continue;
            }
            const liveTs = latestLiveToolTsByKey.get(toolKey);
            if (
              liveTs !== undefined
              && Math.abs(ts - liveTs) <= LIVE_TOOL_DUPLICATE_WINDOW_MS
            ) {
              continue;
            }
            latestLiveToolTsByKey.set(toolKey, ts);
          }
        }

        // Thinking rows: the live uuid (grok-thinking-*/claude-stream-*) never
        // matches the persisted reasoning entry's uuid, so once the mid-turn
        // history refresh delivers the same reasoning as a [thinking] assistant
        // line, dedup by normalized content — otherwise every thinking block
        // renders twice (live streamed row + history row).
        if (!output.isStreaming && text.startsWith('[thinking]')) {
          const thinkingKey = normalizeThinkingMessage(text);
          const historyTs = thinkingKey ? latestHistoryThinkingTsByKey.get(thinkingKey) : undefined;
          if (historyTs && Math.abs(ts - historyTs) <= HISTORY_THINKING_OUTPUT_DUPLICATE_WINDOW_MS) {
            continue;
          }
        }

        if (!output.isStreaming && !isToolOrSystemOutput(text)) {
          const normalized = normalizeAssistantMessage(text);
          const historyTs = latestHistoryAssistantTsByKey.get(normalized);
          if (historyTs && Math.abs(ts - historyTs) <= HISTORY_ASSISTANT_OUTPUT_DUPLICATE_WINDOW_MS) {
            continue;
          }

          // Keep attribution boundaries: identical replies from two subagents
          // are separate messages, while the stream-final/result fallback pair
          // has the same attribution and lands within milliseconds.
          const liveKey = `${output.subagentName || ''}:${output.isDelegation ? 'delegated' : 'direct'}:${normalized}`;
          const prior = latestLiveAssistantByKey.get(liveKey);
          if (prior && Math.abs(ts - prior.ts) <= LIVE_RESULT_FALLBACK_DUPLICATE_WINDOW_MS) {
            const priorOutput = result[prior.resultIndex];
            // The confirmed failure shape is one stream-final with a uuid and
            // one result fallback without it. Do not collapse two uuid-bearing
            // messages: identical short replies in distinct turns are valid.
            const isResultFallbackTwin = Boolean(priorOutput.uuid) !== Boolean(output.uuid);
            if (isResultFallbackTwin) {
              // Prefer a stable uuid if events arrived in the opposite order.
              if (!priorOutput.uuid && output.uuid) {
                result[prior.resultIndex] = output;
                latestLiveAssistantByKey.set(liveKey, { ts, resultIndex: prior.resultIndex });
              }
              continue;
            }
          }
          latestLiveAssistantByKey.set(liveKey, { ts, resultIndex: result.length });
        }
        result.push(output);
        continue;
      }

      // User history/live reconciliation happens atomically in
      // useHistoryLoader before history is published. Do not content-dedupe
      // again here: without shared ids, a second identical prompt is valid.
      result.push(output);
    }

    return result;
  }, [filteredOutputs, historyDedupIndexes]);

  // ── Search ──
  const allSearchItems = useMemo(
    () => [...dedupedHistory, ...dedupedOutputs],
    [dedupedHistory, dedupedOutputs]
  );

  const search = useSearchHistory({
    selectedAgentId: agentId,
    isOpen,
    allItems: allSearchItems,
    viewMode,
    hasMoreHistory: historyLoader.hasMore,
    loadAllHistory: historyLoader.loadAllHistory,
    loadingMore: historyLoader.loadingMore,
  });

  // Height of the search results dropdown, so scrolled-to matches clear it.
  const [searchPanelHeight, setSearchPanelHeight] = useState(0);

  // True when the current match's hit text is invisible in the rendered row
  // (truncated tool preview, collapsed section, unmounted bash output…). The
  // row gets a dashed marker via CSS and the search bar shows the matched
  // source snippet so the content is still readable.
  const [activeMatchHidden, setActiveMatchHidden] = useState(false);
  const handleActiveMatchHidden = useCallback((hidden: boolean) => {
    setActiveMatchHidden(hidden);
  }, []);

  // Paint find matches over the rendered output (CSS Custom Highlight API) —
  // messages keep their normal markdown rendering while searching.
  useSearchDomHighlight(outputScrollRef, search.highlightQuery, search.scrollToIndex, handleActiveMatchHidden);

  // Source-text snippet around the current match, for the hidden-match note.
  const activeMatchSnippet = useMemo(() => {
    if (search.scrollToIndex === null) return undefined;
    return search.contentResults.find((r) => r.itemIndex === search.scrollToIndex)?.snippet;
  }, [search.contentResults, search.scrollToIndex]);

  // Rendered inside the active match's row when its hit text is invisible.
  // data-search-skip keeps the note (which contains the query term) out of the
  // highlighter's row scan — without it the note would dismiss itself.
  const searchHiddenNote = useMemo(() => {
    if (!activeMatchHidden || !activeMatchSnippet) return undefined;
    return (
      <div className="guake-search-hidden-note" data-search-skip="true" title={activeMatchSnippet}>
        <Icon name="eye" size={12} />
        <span className="guake-search-hidden-label">
          {t('terminal:header.searchHiddenMatch', 'Hidden match:')}
        </span>
        <span className="guake-search-hidden-snippet">
          {highlightText(activeMatchSnippet, search.searchQuery.trim())}
        </span>
      </div>
    );
  }, [activeMatchHidden, activeMatchSnippet, search.searchQuery, t]);

  // ── Message navigation ──
  const totalNavigableMessages = dedupedHistory.length + dedupedOutputs.length;
  const messageNav = useMessageNavigation({
    totalMessages: totalNavigableMessages,
    isOpen,
    hasModalOpen: hasModalOpen || search.searchMode,
    scrollContainerRef: outputScrollRef,
    selectedAgentId: agentId,
    inputRef: terminalInputRef,
    textareaRef: terminalTextareaRef,
    useTextarea: terminalInput.useTextarea,
  });

  // ── Completion indicator ──
  const [showCompletion, setShowCompletion] = useState(false);
  const [completionElapsed, setCompletionElapsed] = useState<number | null>(null);
  const prevStatusRef = useRef<string | null>(null);
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const currentStatus = agent?.status;
    const prevStatus = prevStatusRef.current;

    if (prevStatus === 'working' && currentStatus === 'idle') {
      if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
      const prompt = lastPrompts.get(agentId);
      setCompletionElapsed(prompt?.timestamp ? Date.now() - prompt.timestamp : null);
      setShowCompletion(true);
      completionTimerRef.current = setTimeout(() => {
        setShowCompletion(false);
        setCompletionElapsed(null);
        completionTimerRef.current = null;
      }, 4000);
    } else if (currentStatus === 'working') {
      if (completionTimerRef.current) {
        clearTimeout(completionTimerRef.current);
        completionTimerRef.current = null;
      }
      setShowCompletion(false);
      setCompletionElapsed(null);
    }

    prevStatusRef.current = currentStatus || null;

    return () => {
      if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
    };
  }, [agent?.status]);

  // ── Auto-update bash modal state from parent ──
  // (Bash modal is owned by parent; this effect was previously in GuakeOutputPanel.
  //  We expose dedupedOutputs via ref so parent can do this if needed.)

  // ── Scroll management ──
  // (shouldAutoScroll state is declared above the history-freeze memo, which
  // depends on it to decide whether refreshes apply.)
  const isUserScrolledUpRef = useRef(false);
  const agentSwitchGraceRef = useRef(false);
  // Last observed scrollTop, so we can tell a genuine upward user scroll from
  // the bottom drifting away because new content grew under the viewport.
  const lastScrollTopRef = useRef(0);
  // Cumulative scrollTop movement applied by virtual-core anchor corrections,
  // written by VirtualizedOutputList (shared via prop). Corrections shift
  // scrollTop without user input; both classifiers must subtract them or a
  // correction coalesced with content growth reads as a user up-scroll and
  // kills auto-follow right after open. Never reset — this pane's classifier
  // diffs against its own baseline.
  const anchorCorrectionsRef = useRef(0);
  const anchorCorrectionsBaselineRef = useRef(0);
  // Raw scroll events also fire for virtualizer corrections, browser clamps,
  // and late row measurements. Track an explicit input deadline so only real
  // wheel/touch/scrollbar movement can disable bottom-follow during a switch.
  const userScrollIntentUntilRef = useRef(0);
  const markOutputScrollIntent = useCallback(() => {
    userScrollIntentUntilRef.current = performance.now() + 750;
  }, []);
  const handleOutputPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // A scrollbar press targets the scroll container itself. Child clicks do
    // not represent scrolling and must not make layout movement look manual.
    if (e.target === e.currentTarget) markOutputScrollIntent();
  }, [markOutputScrollIntent]);
  const handleOutputScrollKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) {
      markOutputScrollIntent();
    }
  }, [markOutputScrollIntent]);

  const handleUserScrollUp = useCallback(() => {
    // No grace-window gate here: VirtualizedOutputList only calls this for
    // scrolls it has already position-verified as user-initiated (moved up
    // AND meaningfully above the bottom — programmatic settle scrolls always
    // land at the bottom). Swallowing them during the post-switch grace made
    // streaming/measurement growth yank the user back down for up to 3s.
    isUserScrolledUpRef.current = true;
    setShouldAutoScroll(false);
  }, []);

  // Keyed panes always open at the latest message. Starting pinned lets the
  // virtualizer perform its first bottom jump in a layout effect before paint;
  // arming this from a normal effect exposed one top-of-list frame.
  const [pinToBottom, setPinToBottom] = useState(true);
  // A boolean alone cannot retrigger the virtualizer when another bottom
  // request arrives while a previous pin is still active. This generation is
  // forwarded to the list so every explicit open/selection gets its own
  // pre-paint bottom write — important for delayed mobile taps and viewport
  // changes while the software keyboard is settling.
  const [bottomRequestToken, setBottomRequestToken] = useState(0);
  const handlePinCancel = useCallback(() => setPinToBottom(false), []);

  const armBottomPin = useCallback(() => {
    isUserScrolledUpRef.current = false;
    setShouldAutoScroll(true);
    setPinToBottom(true);
    setBottomRequestToken((token) => token + 1);

    // If this pane is already mounted (same-agent re-click / collapsed Guake
    // reopening), move its real DOM viewport immediately. Layout effects call
    // this before paint; the virtualizer token then owns continued settling as
    // rows measure and as the mobile viewport changes size.
    const container = outputScrollRef.current;
    if (container) {
      const bottomOffset = Math.max(0, container.scrollHeight - container.clientHeight);
      container.scrollTop = bottomOffset;
      lastScrollTopRef.current = bottomOffset;
    }
  }, [outputScrollRef]);

  // Re-pin on EVERY explicit agent selection click — including re-selecting
  // the agent this pane already shows. agentId doesn't change on a same-agent
  // re-click (and neither does selectedAgentIds), so the [agentId] pin effect
  // below can't fire; the selection seq observes the click itself. Clicking an
  // agent must always land the view at the very bottom, even if the user had
  // scrolled up earlier and the pane stayed mounted (held agent on a closed
  // panel, same-agent click on the board/dock/pinned bar).
  const agentSelectionSeq = useAgentSelectionSeq();
  const prevSelectionSeqRef = useRef(agentSelectionSeq);
  useLayoutEffect(() => {
    if (agentSelectionSeq === prevSelectionSeqRef.current) return;
    prevSelectionSeqRef.current = agentSelectionSeq;
    // Split layouts mount one pane per agent — only the pane showing the
    // just-clicked agent re-pins; the others keep their scroll position.
    if (!agentId || store.getState().lastSelectedAgentId !== agentId) return;
    armBottomPin();
  }, [agentSelectionSeq, agentId, armBottomPin]);

  // Re-pin when the panel reopens on the SAME agent. toggleTerminal /
  // setTerminalOpen write selectedAgentIds directly — no selection-seq bump,
  // no agentId change — so neither pin path above fires, and the guake keeps
  // this pane mounted (held agent) while collapsed. Opening the chat must
  // always land at the very bottom: arm the pin on the closed→open
  // transition. Always-open hosts (Flat view) never transition — no-op there.
  const prevIsOpenRef = useRef(isOpen);
  useLayoutEffect(() => {
    const wasOpen = prevIsOpenRef.current;
    prevIsOpenRef.current = isOpen;
    if (wasOpen || !isOpen) return;
    armBottomPin();
  }, [isOpen, armBottomPin]);

  const handleSendCommand = useCallback(() => {
    // Force the jump: the list's sticky-bottom write gate refuses auto-scroll
    // while the viewport is up — sending your own message must still land the
    // view at the bottom, and the pin loop is the sanctioned force path.
    armBottomPin();
  }, [armBottomPin]);

  // Reset auto-scroll on agent change
  useEffect(() => {
    setShouldAutoScroll(true);
    isUserScrolledUpRef.current = false;
    agentSwitchGraceRef.current = true;
    const timeout = setTimeout(() => {
      agentSwitchGraceRef.current = false;
    }, 3000);
    return () => clearTimeout(timeout);
  }, [agentId]);

  // Keep historyLoader.handleScroll in a ref so handleScroll callback stays stable
  const historyLoaderHandleScrollRef = useRef(historyLoader.handleScroll);
  historyLoaderHandleScrollRef.current = historyLoader.handleScroll;

  const handleScroll = useCallback(() => {
    if (!outputScrollRef.current) return;
    if (keyboard.keyboardScrollLockRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = outputScrollRef.current;
    const prevScrollTop = lastScrollTopRef.current;
    lastScrollTopRef.current = scrollTop;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    // A genuine upward move (scrollTop decreased) means the user left the
    // bottom. Content growing under the viewport (a new agent message or
    // reasoning completion) grows distanceFromBottom WITHOUT scrollTop
    // decreasing — that must NOT disable auto-scroll, else the view jumps up.
    // Correction-adjusted: anchor corrections also decrease scrollTop without
    // user input (a row above the viewport re-measuring smaller) — subtract
    // the movement they applied since the last event before classifying.
    const correctionDelta = anchorCorrectionsRef.current - anchorCorrectionsBaselineRef.current;
    anchorCorrectionsBaselineRef.current = anchorCorrectionsRef.current;
    const scrolledUp = scrollTop - prevScrollTop - correctionDelta < -1;
    const hasUserScrollIntent = performance.now() <= userScrollIntentUntilRef.current;

    if (scrolledUp && distanceFromBottom > 4 && hasUserScrollIntent) {
      // ANY genuine upward move disables auto-scroll — even inside the 150px
      // "at bottom" zone. Programmatic settle scrolls land AT the bottom
      // (shrink-clamps included) and content growth never decreases scrollTop,
      // so up-and-meaningfully-above-bottom can only be the user. The old
      // >150px requirement made escape impossible during word streaming: each
      // ~100px wheel tick was re-classified "at bottom", auto-scroll re-armed,
      // and the next chunk (≤80ms) yanked the view down before a second tick.
      // Deliberately NOT gated on the post-switch grace window (see below).
      isUserScrolledUpRef.current = true;
      setShouldAutoScroll(false);
    } else if (distanceFromBottom <= 8 && !scrolledUp) {
      // Re-arm ONLY at the very bottom moving DOWN (or stationary). The old
      // 150px zone re-armed while the user was still reading just above the
      // stream and the next chunk yanked them; "very bottom" is the contract.
      if (!agentSwitchGraceRef.current) {
        isUserScrolledUpRef.current = false;
        setShouldAutoScroll(true);
      }
    }

    historyLoaderHandleScrollRef.current(keyboard.keyboardScrollLockRef);
  }, [outputScrollRef, keyboard.keyboardScrollLockRef]);

  // Auto-scroll is owned by VirtualizedOutputList (item-count + totalSize
  // effects + pin loop). A second per-chunk scrollTop writer here raced those
  // during word streaming: its in-flight rAF writes landed AFTER the user's
  // upward scroll, re-classifying them as "at bottom" and yanking the view.
  // ONE writer only — do not re-add a scroll effect keyed on output length.

  // ── Initial history readiness ──
  // AgentTerminalPane is keyed by agent id, so its old "previous agent" ref
  // always started empty and never detected a cold switch. The live tail then
  // painted alone, disappeared when history arrived, and reappeared as a full
  // virtual list. Capture cache state on this keyed mount instead: warm panes
  // paint immediately; cold panes keep the loading overlay until the first
  // history request completes.
  const openedFromHistoryCacheRef = useRef(historyLoader.hasCachedHistory(agentId));
  const initialHistoryVersionRef = useRef(historyLoader.historyLoadVersion);
  const [isAgentSwitching, setIsAgentSwitching] = useState(
    () => hasSessionId && !openedFromHistoryCacheRef.current,
  );
  const coldOpenRef = useRef(!openedFromHistoryCacheRef.current);

  useEffect(() => {
    if (!isAgentSwitching) return;
    if (historyLoader.fetchingHistory) return;
    if (historyLoader.historyLoadVersion <= initialHistoryVersionRef.current) return;
    setIsAgentSwitching(false);
  }, [isAgentSwitching, historyLoader.fetchingHistory, historyLoader.historyLoadVersion]);

  // ── Pin to bottom (stabilization loop) ──
  // "Waiting" means we have NOTHING to render yet. Warm history is available
  // synchronously; a cold mount remains behind isAgentSwitching's loading
  // overlay until its first complete page is available.
  const hasRenderedContent = dedupedHistory.length > 0 || dedupedOutputs.length > 0;
  const waitingForFirstContent = isAgentSwitching
    || (historyLoader.fetchingHistory && !hasRenderedContent);
  // Cold histories need one measurement pass after their first page arrives.
  // Keep the loading overlay over that pass so estimated row heights never
  // become visible as a short shake before the bottom position stabilizes.
  const preparingColdContent = isAgentSwitching || (coldOpenRef.current && pinToBottom);

  useEffect(() => {
    setPinToBottom(true);
  }, [agentId, reconnectCount]);

  // Hydrate pending agent-prompts (AskUserQuestion / ExitPlanMode awaiting a
  // human response) on mount and WS reconnect. The server holds these in
  // memory and re-broadcasts on new events, but a fresh page load has an
  // empty client store — without this fetch the inline interactive UI is
  // missing after refresh and the user can't answer the question.
  // Re-run when history finishes loading so newly-mounted chips get hydrated.
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    (async () => {
      try {
        const url = apiUrl(`/api/agent-prompt/pending?agentId=${encodeURIComponent(agentId)}`);
        const res = await authFetch(url);
        if (!res.ok) {
          console.warn('[agent-prompt hydrate] non-ok', res.status, url);
          return;
        }
        const prompts = await res.json() as AgentPrompt[];
        if (cancelled) return;
        console.log('[agent-prompt hydrate]', { agentId, count: prompts.length, ids: prompts.map((p) => p.id) });
        for (const p of prompts) store.addAgentPrompt(p);
      } catch (err) {
        console.error('[agent-prompt hydrate] failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, [agentId, reconnectCount, historyLoader.historyLoadVersion]);

  // A network refresh can take seconds. Pinning when it STARTS may settle and
  // release long before the fresh rows are committed, leaving a revisited
  // conversation above the bottom when those rows finally arrive. Re-arm on
  // completion instead, in a layout effect so the fresh commit cannot paint at
  // the old offset. Respect readers who deliberately scrolled upward.
  const completedHistoryVersionRef = useRef(historyLoader.historyLoadVersion);
  useLayoutEffect(() => {
    if (historyLoader.historyLoadVersion === completedHistoryVersionRef.current) return;
    completedHistoryVersionRef.current = historyLoader.historyLoadVersion;
    if (isUserScrolledUpRef.current) return;
    armBottomPin();
  }, [historyLoader.historyLoadVersion, armBottomPin]);

  useEffect(() => {
    if (!pinToBottom) return;
    if (!isOpen) return;
    if (waitingForFirstContent) return;

    const container = outputScrollRef.current;
    if (!container) return;

    let rafId: number | null = null;
    const start = performance.now();
    const minimumPinDuration = coldOpenRef.current ? 220 : 0;
    let stableFrames = 0;
    let lastScrollHeight = -1;

    // Require the content height to hold steady for several consecutive frames
    // before releasing the pin. The virtualizer measures real row heights across
    // many frames after an agent switch; ending on the FIRST coincidentally
    // stable frame let late growth land the view a few lines short of the bottom.
    // A cold open measures all its rows for the first time, in bursts with
    // idle gaps between them — 4 quiet frames is easily satisfied *between*
    // bursts, which revealed the conversation mid-settle and let the remaining
    // growth visibly push the text around. Warm switches genuinely settle in a
    // few frames, so they keep the short window and stay snappy. The 3s cap
    // below still bounds both.
    const REQUIRED_STABLE_FRAMES = coldOpenRef.current ? 12 : 4;

    const isAtBottom = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      return scrollHeight - scrollTop - clientHeight <= 2;
    };

    const endPin = () => {
      // Deterministic final snap to the true bottom before releasing the pin, in
      // case a last measurement frame grew the content past where the per-frame
      // enforce loop left it.
      container.scrollTop = container.scrollHeight;
      // The rows are measured now, so later re-pins for this same agent (a
      // history refresh while it streams) settle fast and take the short window.
      coldOpenRef.current = false;
      setPinToBottom(false);
      rafId = null;
    };

    const tick = () => {
      const now = performance.now();
      const currentScrollHeight = container.scrollHeight;
      const heightStable = Math.abs(currentScrollHeight - lastScrollHeight) <= 1;
      const atBottom = isAtBottom();

      if (heightStable && atBottom) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
      }

      lastScrollHeight = currentScrollHeight;

      if (stableFrames >= REQUIRED_STABLE_FRAMES && now - start >= minimumPinDuration) {
        endPin();
        return;
      }

      // Safety cap: don't pin forever for content that keeps growing (e.g. async
      // images/markdown). Post-pin streaming auto-scroll then follows further
      // growth as long as the user hasn't scrolled up.
      if (now - start > 3000) {
        endPin();
        return;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [pinToBottom, isOpen, waitingForFirstContent, historyLoader.historyLoadVersion]);

  // ── Escape / Android-back closes search ──
  // On the shared modal stack so the global Escape handler (useKeyboardShortcuts
  // → closeTopModal) closes the search bar BEFORE falling through to closing
  // the terminal / deselecting the agent. A local capture-phase listener can't
  // do this reliably: the app-level handler registered first and wins the race.
  useModalStackRegistration(`guake-search-${agentId ?? 'none'}`, search.searchMode, search.closeSearch);

  // ── Clean up keyboard styles on agent change ──
  useEffect(() => {
    return () => keyboard.cleanup();
  }, [agentId, keyboard]);

  // ── Imperative handle ──
  useImperativeHandle(ref, () => ({
    outputScrollRef,
    inputRef: terminalInputRef,
    textareaRef: terminalTextareaRef,
    historyLoader: {
      loadingHistory: historyLoader.loadingHistory,
      fetchingHistory: historyLoader.fetchingHistory,
      historyLoadVersion: historyLoader.historyLoadVersion,
      loadingMore: historyLoader.loadingMore,
      hasMore: historyLoader.hasMore,
      totalCount: historyLoader.totalCount,
      loadMoreHistory: historyLoader.loadMoreHistory,
      clearHistory: historyLoader.clearHistory,
      hasCachedHistory: historyLoader.hasCachedHistory,
      history: historyLoader.history,
    },
    search,
    terminalInput: {
      uploadFile: terminalInput.uploadFile,
      setAttachedFiles: terminalInput.setAttachedFiles,
      useTextarea: terminalInput.useTextarea,
    },
    getDedupedHistory: () => dedupedHistory,
    getDedupedOutputs: () => dedupedOutputs,
    outputsLength: dedupedHistory.length + dedupedOutputs.length,
  }), [
    historyLoader, search, terminalInput, dedupedHistory, dedupedOutputs,
  ]);

  // ── Render ──
  return (
    <>
      {/* Search bar + tabbed results dropdown (per-pane) */}
      {search.searchMode && (
        <div className="guake-search-container">
          <SearchBar
            searchInputRef={search.searchInputRef}
            searchQuery={search.searchQuery}
            setSearchQuery={search.setSearchQuery}
            closeSearch={search.closeSearch}
            matchCount={search.matchIndices.length}
            currentMatch={search.currentMatch}
            navigateNext={search.navigateNext}
            navigatePrev={search.navigatePrev}
            loadingFullHistory={search.loadingFullHistory}
            resultsOpen={search.resultsOpen}
            toggleResults={search.toggleResults}
          />
          {search.resultsOpen && (
            <SearchResultsPanel
              activeTab={search.activeTab}
              setActiveTab={search.setActiveTab}
              contentResults={search.contentResults}
              fileResults={search.fileResults}
              query={search.searchQuery}
              loadingFullHistory={search.loadingFullHistory}
              onSelectContent={search.selectResult}
              onSelectFile={(f) => onFileClick(f.path)}
              onGoToFileMessage={(f) => {
                const last = f.itemIndices[f.itemIndices.length - 1];
                if (last !== undefined) search.selectResult(last);
              }}
              onHeightChange={setSearchPanelHeight}
            />
          )}
        </div>
      )}

      {/* Output area */}
      <div
        className={`guake-output${hasPinnedAgents ? ' has-pinned-agents' : ''}${stopFlash ? ' stop-flash' : ''}`}
        ref={outputScrollRef}
        onScroll={handleScroll}
        onWheelCapture={markOutputScrollIntent}
        onTouchMoveCapture={markOutputScrollIntent}
        onPointerDownCapture={handleOutputPointerDown}
        onKeyDownCapture={handleOutputScrollKey}
        onAnimationEnd={(e) => {
          // Child animations bubble here too — only clear on our own flash.
          if (e.animationName === 'guake-stop-flash') setStopFlash(false);
        }}
      >
        {/* Loading indicator lives OUTSIDE the fade wrapper (which is opacity:0
            until the pin settles) and sticks to the viewport — inside the
            wrapper it was invisible, so a slow history fetch showed a plain
            black pane. */}
        {(preparingColdContent || (historyLoader.loadingHistory && historyLoader.history.length === 0 && outputs.length === 0)) && (
          <div className="guake-loading-overlay">
            <div className="guake-empty loading">{t('terminal:empty.loadingConversation')}<span className="loading-dots"><span></span><span></span><span></span></span></div>
          </div>
        )}
        <div className={`guake-history-content${preparingColdContent ? ' is-preparing' : ''}`}>
          {!isAgentSwitching && !historyLoader.loadingHistory && historyLoader.history.length === 0 && displayOutputs.length === 0 && agent.status !== 'working' && (
            <div className="guake-empty">{t('terminal:empty.noOutput')}</div>
          )}
          {!isAgentSwitching && historyLoader.hasMore && !search.searchMode && (
            <div className="guake-load-more">
              {historyLoader.loadingMore ? (
                <span>{t('terminal:empty.loadingOlder')}</span>
              ) : (
                <button onClick={historyLoader.loadMoreHistory}>
                  {t('terminal:empty.loadMore', { count: historyLoader.totalCount - historyLoader.history.length })}
                </button>
              )}
            </div>
          )}
          {/* Virtualized rendering */}
          {!isAgentSwitching && (
            <VirtualizedOutputList
              key={agentId}
              historyMessages={dedupedHistory}
              liveOutputs={dedupedOutputs}
              agentId={agentId}
              execTasks={execTasks}
              testRunHandles={testRunHandles}
              httpRunHandles={httpRunHandles}
              subagents={subagents}
              viewMode={viewMode}
              searchActiveIndex={search.scrollToIndex}
              searchHiddenNote={searchHiddenNote}
              searchPanelHeight={search.searchMode ? searchPanelHeight : 0}
              selectedMessageIndex={messageNav.selectedIndex}
              isMessageSelected={messageNav.isSelected}
              onPromptMarkerJump={messageNav.setSelectedIndex}
              onImageClick={onImageClick}
              onFileClick={onFileClick}
              onBashClick={onBashClick}
              onViewMarkdown={onViewMarkdown}
              scrollContainerRef={outputScrollRef}
              onScrollTopReached={historyLoader.loadMoreHistory}
              isLoadingMore={historyLoader.loadingMore}
              hasMore={historyLoader.hasMore}
              shouldAutoScroll={shouldAutoScroll}
              onUserScroll={handleUserScrollUp}
              pinToBottom={pinToBottom}
              bottomRequestToken={bottomRequestToken}
              onPinCancel={handlePinCancel}
              isLoadingHistory={waitingForFirstContent}
              anchorCorrectionsRef={anchorCorrectionsRef}
              userScrollIntentUntilRef={userScrollIntentUntilRef}
            />
          )}
          {/* Context compaction indicator */}
          {!isAgentSwitching && isCompacting && (
            <div className="compacting-indicator">
              <div className="compacting-bar">
                <img
                  className="compacting-bar-fill"
                  src="/assets/compacting-bar.webp?v=2"
                  alt=""
                  draggable={false}
                />
              </div>
              <span className="compacting-label">Compacting context...</span>
            </div>
          )}
          {/* Subordinate progress indicators now render inline within each DelegationBlock */}
        </div>
      </div>

      {/* Interactive agent prompts (AskUserQuestion / ExitPlanMode) now render
          inline inside the matching tool_use chip in the output stream — see
          OutputLine.tsx + AskQuestionInput/ExitPlanModeInput's interactive mode.
          We keep the lookup wired (pendingAgentPrompts) so it stays referenced
          if we ever need a fallback panel. */}

      {/* Composer stack: pinned bar + input share one fixed bottom unit on mobile
          so the pin pill never floats over chat messages. */}
      <div className="guake-composer-stack">
      {/* Agent quick-select strip, directly above the composer. When the activity
          dock is parked here (Settings → General → Agent activity dock) the
          working / recently-active agents join this same row instead of stacking
          a second strip of the same avatars on top of the composer. */}
      <PinnedAgentsBar activeAgentId={agentId} includeActiveAgents={dockPosition === 'composer'} />

      {/* Terminal input */}
      <TerminalInputArea
        selectedAgent={agent}
        selectedAgentId={agentId}
        isOpen={isOpen}
        command={terminalInput.command}
        setCommand={terminalInput.setCommand}
        forceTextarea={terminalInput.forceTextarea}
        setForceTextarea={terminalInput.setForceTextarea}
        useTextarea={terminalInput.useTextarea}
        attachedFiles={terminalInput.attachedFiles}
        setAttachedFiles={terminalInput.setAttachedFiles}
        removeAttachedFile={terminalInput.removeAttachedFile}
        uploadFile={terminalInput.uploadFile}
        pastedTexts={terminalInput.pastedTexts}
        expandPastedTexts={terminalInput.expandPastedTexts}
        incrementPastedCount={terminalInput.incrementPastedCount}
        setPastedTexts={terminalInput.setPastedTexts}
        resetPastedCount={terminalInput.resetPastedCount}
        handleInputFocus={keyboard.handleInputFocus}
        handleInputBlur={keyboard.handleInputBlur}
        pendingPermissions={pendingPermissions}
        showCompletion={showCompletion}
        completionElapsed={completionElapsed}
        onImageClick={onImageClick}
        inputRef={terminalInputRef}
        textareaRef={terminalTextareaRef}
        onClearHistory={historyLoader.clearHistory}
        onSendCommand={handleSendCommand}
        canSwipeClose={canSwipeClose}
        onSwipeCloseOffsetChange={onSwipeCloseOffsetChange}
        onSwipeClose={onSwipeClose}
      />
      </div>
    </>
  );
}));
