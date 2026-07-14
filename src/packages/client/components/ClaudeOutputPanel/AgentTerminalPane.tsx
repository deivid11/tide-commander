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

const LIVE_DUPLICATE_WINDOW_MS = 10_000;
const HISTORY_OUTPUT_DUPLICATE_WINDOW_MS = 30_000;
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
    || text.startsWith('🔄 [System]')
    || text.startsWith('📋 [System]')
    || text.startsWith('[System]');
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
  const historyRefreshTrigger = useHistoryRefreshTrigger();
  const lastPrompts = useLastPrompts();
  const outputs = useAgentOutputs(agentId);
  const isCompacting = useAgentCompacting(agentId);
  // A freshly-forked agent has no session of its own yet, but it should still
  // show the inherited (source) conversation — the server's history endpoint
  // falls back to forkSourceSessionId until the fork's first run establishes
  // its own session. So treat a pending fork as having loadable history too.
  const hasSessionId = !!(agent?.sessionId || agent?.forkSourceSessionId);

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

  // ── Display outputs ──
  const displayOutputs = outputs;

  // ── History loader ──
  const historyLoader = useHistoryLoader({
    selectedAgentId: agentId,
    hasSessionId,
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
        if (msg.type === 'tool_use' && msg.toolName === 'exec' && msg.toolUseId) {
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
    let lastUserKey: string | null = null;
    let lastUserTs = 0;

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
      const ts = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
      if (lastUserKey === key && Math.abs(ts - lastUserTs) <= LIVE_DUPLICATE_WINDOW_MS) {
        continue;
      }

      result.push(msg);
      if (userUuidKey) {
        seenUserUuidKeys.add(userUuidKey);
      }
      lastUserKey = key;
      lastUserTs = ts;
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
    const latestHistoryUserTsByKey = new Map<string, number>();
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
      if (msg.type === 'user') {
        const key = normalizeUserMessage(msg.content);
        const prev = latestHistoryUserTsByKey.get(key) ?? 0;
        if (ts > prev) latestHistoryUserTsByKey.set(key, ts);
        continue;
      }
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
      latestHistoryUserTsByKey,
      historyKnownUuidSet,
      latestHistoryAssistantTsByKey,
      latestHistoryThinkingTsByKey,
      latestHistoryToolTsByKey,
    };
  }, [dedupedHistory]);

  // Remove live outputs that duplicate history (or each other for tools)
  const dedupedOutputs = useMemo(() => {
    const {
      latestHistoryUserTsByKey,
      historyKnownUuidSet,
      latestHistoryAssistantTsByKey,
      latestHistoryThinkingTsByKey,
      latestHistoryToolTsByKey,
    } = historyDedupIndexes;

    const result: typeof filteredOutputs = [];
    let lastLiveUserKey: string | null = null;
    let lastLiveUserTs = 0;
    // toolKey → last kept live timestamp (collapse early + call-* twins)
    const latestLiveToolTsByKey = new Map<string, number>();

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
          const key = normalizeAssistantMessage(text);
          const historyTs = latestHistoryAssistantTsByKey.get(key);
          if (historyTs && Math.abs(ts - historyTs) <= HISTORY_ASSISTANT_OUTPUT_DUPLICATE_WINDOW_MS) {
            continue;
          }
        }
        result.push(output);
        continue;
      }

      const key = normalizeUserMessage(output.text);
      const ts = output.timestamp || 0;
      const latestHistoryTs = latestHistoryUserTsByKey.get(key);

      if (latestHistoryTs && ts >= latestHistoryTs && ts - latestHistoryTs <= HISTORY_OUTPUT_DUPLICATE_WINDOW_MS) {
        continue;
      }

      if (lastLiveUserKey === key && Math.abs(ts - lastLiveUserTs) <= LIVE_DUPLICATE_WINDOW_MS) {
        continue;
      }

      result.push(output);
      lastLiveUserKey = key;
      lastLiveUserTs = ts;
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

  const handleUserScrollUp = useCallback(() => {
    // No grace-window gate here: VirtualizedOutputList only calls this for
    // scrolls it has already position-verified as user-initiated (moved up
    // AND meaningfully above the bottom — programmatic settle scrolls always
    // land at the bottom). Swallowing them during the post-switch grace made
    // streaming/measurement growth yank the user back down for up to 3s.
    isUserScrolledUpRef.current = true;
    setShouldAutoScroll(false);
  }, []);

  const [pinToBottom, setPinToBottom] = useState(false);
  const handlePinCancel = useCallback(() => setPinToBottom(false), []);

  // Re-pin on EVERY explicit agent selection click — including re-selecting
  // the agent this pane already shows. agentId doesn't change on a same-agent
  // re-click (and neither does selectedAgentIds), so the [agentId] pin effect
  // below can't fire; the selection seq observes the click itself. Clicking an
  // agent must always land the view at the very bottom, even if the user had
  // scrolled up earlier and the pane stayed mounted (held agent on a closed
  // panel, same-agent click on the board/dock/pinned bar).
  const agentSelectionSeq = useAgentSelectionSeq();
  const prevSelectionSeqRef = useRef(agentSelectionSeq);
  useEffect(() => {
    if (agentSelectionSeq === prevSelectionSeqRef.current) return;
    prevSelectionSeqRef.current = agentSelectionSeq;
    // Split layouts mount one pane per agent — only the pane showing the
    // just-clicked agent re-pins; the others keep their scroll position.
    if (!agentId || store.getState().lastSelectedAgentId !== agentId) return;
    isUserScrolledUpRef.current = false;
    setShouldAutoScroll(true);
    setPinToBottom(true);
  }, [agentSelectionSeq, agentId]);

  const handleSendCommand = useCallback(() => {
    isUserScrolledUpRef.current = false;
    setShouldAutoScroll(true);
    // Force the jump: the list's sticky-bottom write gate refuses auto-scroll
    // while the viewport is up — sending your own message must still land the
    // view at the bottom, and the pin loop is the sanctioned force path.
    setPinToBottom(true);
  }, []);

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
    const scrolledUp = scrollTop < prevScrollTop - 1;

    if (scrolledUp && distanceFromBottom > 4) {
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

  // ── History fade-in & agent switching ──
  const [historyFadeIn, setHistoryFadeIn] = useState(false);
  const [isAgentSwitching, setIsAgentSwitching] = useState(false);

  // Hide content immediately on agent change, then fade in after scroll settles
  const prevSelectedAgentIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const prev = prevSelectedAgentIdRef.current;
    const changed = prev !== null && prev !== agentId;

    if (changed) {
      setHistoryFadeIn(false);
      const hasCached = historyLoader.hasCachedHistory(agentId);
      if (!hasCached) {
        setIsAgentSwitching(true);
      }
    } else if (!agentId) {
      setHistoryFadeIn(false);
    }

    prevSelectedAgentIdRef.current = agentId;
  }, [agentId]);

  // Resolve agent switching after history loads
  useEffect(() => {
    if (!isAgentSwitching) return;
    if (historyLoader.fetchingHistory) return;
    setIsAgentSwitching(false);
  }, [isAgentSwitching, historyLoader.fetchingHistory, historyLoader.historyLoadVersion]);

  // ── Pin to bottom (stabilization loop) ──
  const pendingFadeInRef = useRef(false);

  // "Waiting" means we have NOTHING to render yet. When cached history (or
  // live outputs) can already paint, the pin + reveal must not wait for the
  // network refetch — that wait made agent switches feel slow, and any reveal
  // that fires before the pin settles paints the conversation at the wrong
  // scroll position, then visibly snaps to the bottom when the fetch lands.
  const hasRenderedContent = dedupedHistory.length > 0 || dedupedOutputs.length > 0;
  const waitingForFirstContent = historyLoader.fetchingHistory && !hasRenderedContent;

  useEffect(() => {
    pendingFadeInRef.current = true;
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

  useEffect(() => {
    if (historyLoader.fetchingHistory) {
      // fetchingHistory goes true on EVERY background history refresh — the
      // store bumps historyRefreshTrigger on each session-file update while
      // the viewed agent streams. Re-arming the pin unconditionally made each
      // refresh snap toward the bottom mid-scroll (the user's next scroll
      // event cancels it, then the next refresh re-pins — a stutter loop for
      // as long as the agent keeps streaming). Only re-pin while the user is
      // following the bottom; sending a command resets the ref, so their own
      // next message still pins as before.
      if (isUserScrolledUpRef.current) return;
      pendingFadeInRef.current = true;
      setPinToBottom(true);
    }
  }, [historyLoader.fetchingHistory]);

  useEffect(() => {
    if (!pinToBottom) return;
    if (!isOpen) return;
    if (waitingForFirstContent) return;

    const container = outputScrollRef.current;
    if (!container) return;

    let rafId: number | null = null;
    const start = performance.now();
    let stableFrames = 0;
    let lastScrollHeight = -1;

    // Require the content height to hold steady for several consecutive frames
    // before releasing the pin. The virtualizer measures real row heights across
    // many frames after an agent switch; ending on the FIRST coincidentally
    // stable frame let late growth land the view a few lines short of the bottom.
    const REQUIRED_STABLE_FRAMES = 4;

    const isAtBottom = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      return scrollHeight - scrollTop - clientHeight <= 2;
    };

    const endPin = () => {
      // Deterministic final snap to the true bottom before releasing the pin, in
      // case a last measurement frame grew the content past where the per-frame
      // enforce loop left it.
      container.scrollTop = container.scrollHeight;
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

      if (stableFrames >= REQUIRED_STABLE_FRAMES) {
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

  // Fade in after scroll stabilization
  const prevPinToBottomRef = useRef(false);
  useEffect(() => {
    if (prevPinToBottomRef.current && !pinToBottom && pendingFadeInRef.current) {
      pendingFadeInRef.current = false;
      setHistoryFadeIn(true);
    }
    prevPinToBottomRef.current = pinToBottom;
  }, [pinToBottom]);

  // Fallback fade-in
  useEffect(() => {
    if (!isOpen) return;
    if (!pendingFadeInRef.current) return;
    if (pinToBottom) return;
    if (waitingForFirstContent) return;

    const rafId = requestAnimationFrame(() => {
      if (pendingFadeInRef.current) {
        pendingFadeInRef.current = false;
        setHistoryFadeIn(true);
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [historyLoader.historyLoadVersion, isOpen, pinToBottom, waitingForFirstContent]);

  // Last-resort reveal for content that arrives while no pin pass is pending
  // (e.g. the optimistic live prompt on an empty chat). Never preempt an
  // active pin: revealing before the pin settles paints the conversation at
  // the wrong scroll position and the later snap-to-bottom reads as flicker.
  useEffect(() => {
    if (historyFadeIn) return;
    if (isAgentSwitching) return;
    if (pinToBottom) return;
    if (!hasRenderedContent) return;

    pendingFadeInRef.current = false;
    setHistoryFadeIn(true);
  }, [historyFadeIn, isAgentSwitching, pinToBottom, hasRenderedContent]);

  // ── Escape key for search ──
  useEffect(() => {
    if (!search.searchMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        search.closeSearch();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [search.searchMode, search.closeSearch]);

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
          />
          {(search.searchQuery.trim().length >= 2 || search.activeTab === 'files') && (
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
      <div className={`guake-output${hasPinnedAgents ? ' has-pinned-agents' : ''}`} ref={outputScrollRef} onScroll={handleScroll}>
        {/* Loading indicator lives OUTSIDE the fade wrapper (which is opacity:0
            until the pin settles) and sticks to the viewport — inside the
            wrapper it was invisible, so a slow history fetch showed a plain
            black pane. */}
        {(isAgentSwitching || (historyLoader.loadingHistory && historyLoader.history.length === 0 && outputs.length === 0)) && (
          <div className="guake-loading-overlay">
            <div className="guake-empty loading">{t('terminal:empty.loadingConversation')}<span className="loading-dots"><span></span><span></span><span></span></span></div>
          </div>
        )}
        <div className={`guake-history-content ${historyFadeIn ? 'fade-in' : ''}`}>
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
              searchHighlight={search.highlightQuery}
              searchActiveIndex={search.scrollToIndex}
              searchPanelHeight={search.searchMode ? searchPanelHeight : 0}
              selectedMessageIndex={messageNav.selectedIndex}
              isMessageSelected={messageNav.isSelected}
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
              onPinCancel={handlePinCancel}
              isLoadingHistory={waitingForFirstContent}
            />
          )}
          {/* Context compaction indicator */}
          {!isAgentSwitching && isCompacting && (
            <div className="compacting-indicator">
              <div className="compacting-bar">
                <div className="compacting-bar-fill" />
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
