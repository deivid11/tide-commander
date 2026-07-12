/**
 * HistoryLine component for rendering conversation history messages
 */

import React, { memo, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useHideCost, useSettings, useAgentPrompts } from '../../store';
import { store, type TestRunHandle, type HttpRunHandle } from '../../store';
import { BOSS_CONTEXT_START } from '../../../shared/types';
import { filterCostText, isEmptyCodexPayloadText } from '../../utils/formatting';
import { getToolIconName, extractToolKeyParam, extractExecPayloadCommand, formatTimestamp, getLocalizedToolName, getCodexExecPresentation, getCodexExecEditPaths, getCodexExecFileTarget, parseBashNotificationCommand, parseBashSearchCommand, parseBashTaskLabelCommand, parseBashReportTaskCommand, parseBashTrackingStatusCommand, parseBashMemoryCommand, parseMemoryResponseInfo, getTrackingStatusIconName, splitCommandForFileLinks } from '../../utils/outputRendering';
import { resolveAgentFileReference } from '../../utils/filePaths';
import { getIconForExtension } from '../FileExplorerPanel/fileUtils';
import { highlightCode } from '../FileExplorerPanel/syntaxHighlighting';
import { createMarkdownComponents } from './MarkdownComponents';
import { BossContext, DelegationBlock, parseBossContext, parseDelegationBlock, parseWorkPlanBlock, WorkPlanBlock, parseInjectedInstructions, parseDelegatedTaskMessage, DelegatedTaskMessage, parseTaskReportMessage, TaskReportHeader, parseSubagentNotification, SubagentNotificationDisplay, parseTaskNotification, TaskNotificationDisplay } from './BossContext';
import { parseWhatsAppMessage, WhatsAppMessageBubble } from './WhatsAppMessageBubble';
import { parseEmailMessage, GmailMessageBubble } from './GmailMessageBubble';
import { parseSlackMessage, SlackMessageBubble } from './SlackMessageBubble';
import { AgentChatMessageCard, parseAgentChatMessage } from './AgentChatMessageCard';
import { parseExtensionContext, ExtensionContextCard } from './ExtensionContextCard';
import { EditToolDiff, ReadToolInput, TodoWriteInput, AskQuestionInput, AskQuestionResult, ExitPlanModeInput, ToolSearchInput, TaskCreateInput, TaskUpdateInput, MemoryOpInput, isToolSearchContent, ListFilesInput, TaskOutputWaitInput, UnknownToolInput } from './ToolRenderers';
import { TaskListView } from '../shared/TaskListView';
import { parseCurlCommand, looksLikeCurl } from './curlParser';
import { CurlCard } from './CurlCard';
import { parseTestResults } from './testResultsParser';
import { TestResultsCard } from './TestResultsCard';
import { parseHttpResults } from './httpResultsParser';
import { HttpResultsCard } from './HttpResultsCard';
import { HttpRunInline, HttpRunLookup, matchHttpRunHandle } from './HttpRunInline';
import { TestRunInline } from './TestRunInline';
import { highlightText, renderContentWithImages, renderUserPromptContent, isThumbnailableImagePath, getLocalFileImageUrl } from './contentRendering';
import { useTTS } from '../../hooks/useTTS';
import { ansiToHtml } from '../../utils/ansiToHtml';
import { Icon } from '../Icon';
import { BashInlineToggle, BashInlineOutput } from './BashInlineOutput';
import { copyRichContentToClipboard, inlineStylesForRichCopy } from '../../utils/clipboard';
import type { EnrichedHistoryMessage, EditData } from './types';
import type { ExecTask, Subagent } from '../../../shared/types';
import { SubagentInline } from './SubagentInline';
import { providerAssetUrl, providerLabel } from '../../utils/providerDisplay';
import { ThinkingBlock } from './ThinkingBlock';

/** Extract file extension (with dot) from a path, e.g. '/foo/bar.tsx' → '.tsx' */
function getExtFromPath(filePath: string): string {
  const basename = filePath.split('/').pop() || filePath;
  const dotIdx = basename.lastIndexOf('.');
  if (dotIdx <= 0) return '';
  return basename.slice(dotIdx).toLowerCase();
}

/** Extract basename from a path, e.g. '/foo/bar.tsx' → 'bar.tsx' */
function getBasenameFromPath(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

interface HistoryLineProps {
  message: EnrichedHistoryMessage;
  agentId?: string | null;
  highlight?: string;
  simpleView?: boolean;
  /**
   * Subagents map keyed by subagent id. Needed so that persisted Task/Agent
   * tool_use rows can render the inline activity + stream panel — the live
   * tool_use chip gets deduped against the JSONL once it flushes, leaving
   * HistoryLine as the sole renderer of the Task chip.
   */
  subagents?: Map<string, Subagent>;
  execTasks?: ExecTask[];
  testRunHandles?: TestRunHandle[];
  httpRunHandles?: HttpRunHandle[];
  onImageClick?: (url: string, name: string) => void;
  onFileClick?: (path: string, editData?: EditData | { highlightRange: { offset: number; limit: number } }) => void;
  onBashClick?: (command: string, output: string) => void;
  onViewMarkdown?: (content: string) => void;
}

// Generate a short debug hash for a history message (for debugging duplicates)
function getHistoryDebugHash(message: EnrichedHistoryMessage): string {
  const textKey = message.content.slice(0, 50);
  const flags = `H${message.type[0].toUpperCase()}`; // H for History, then type initial
  // Simple hash from text
  let hash = 0;
  for (let i = 0; i < textKey.length; i++) {
    hash = ((hash << 5) - hash) + textKey.charCodeAt(i);
    hash |= 0;
  }
  return `${flags}:${(hash >>> 0).toString(16).slice(0, 6)}`;
}

export const HistoryLine = memo(function HistoryLine({
  message,
  agentId,
  highlight,
  simpleView,
  subagents,
  execTasks = [],
  testRunHandles = [],
  httpRunHandles = [],
  onImageClick,
  onFileClick,
  onBashClick,
  onViewMarkdown,
}: HistoryLineProps) {
  const { t } = useTranslation(['tools', 'common', 'terminal']);
  const [expandedExecTasks, setExpandedExecTasks] = useState<Set<string>>(new Set());
  const [execDetailExpanded, setExecDetailExpanded] = useState(false);
  const [sessionExpanded, setSessionExpanded] = useState(false);
  const hideCost = useHideCost();
  const settings = useSettings();
  const { type, content: rawContent, toolName, toolUseId, timestamp, _bashOutput, _bashCommand, _toolOutput, _askQuestionAnswers, _taskSubject, _taskSnapshot, _pendingPromptId, _priorTodos } = message;
  // `_pendingPromptId` is enriched by AgentTerminalPane.enrichHistory from the
  // pending agent-prompts map. We still keep a defensive fallback via the
  // store hook here in case a future call site renders HistoryLine outside the
  // pane's enrichment path.
  const pendingAgentPrompts = useAgentPrompts(agentId);
  const matchingPendingPrompt = _pendingPromptId
    ? { id: _pendingPromptId }
    : (toolUseId ? pendingAgentPrompts.find((p) => p.id === toolUseId) : undefined);
  const content = filterCostText(rawContent, hideCost);
  const { toggle: toggleTTS, speaking } = useTTS();
  const markdownComponents = createMarkdownComponents({ onFileClick: onFileClick ? (path) => onFileClick(path) : undefined });
  const markdownContentRef = useRef<HTMLSpanElement>(null);
  const [copyRichStatus, setCopyRichStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const handleCopyRichText = useCallback(async () => {
    if (!markdownContentRef.current) return;
    try {
      const html = inlineStylesForRichCopy(markdownContentRef.current.innerHTML);
      const plainText = markdownContentRef.current.innerText;
      await copyRichContentToClipboard(html, plainText);
      setCopyRichStatus('copied');
      setTimeout(() => setCopyRichStatus('idle'), 2000);
    } catch {
      setCopyRichStatus('error');
      setTimeout(() => setCopyRichStatus('idle'), 2000);
    }
  }, []);

  // Tool attribution badge: only subagent names (from Task/Agent tool_use)
  // add information — the parent agent's own name is redundant inside its own
  // chat, so it's not shown.
  const provider = agentId ? store.getState().agents.get(agentId)?.provider : undefined;
  const assistantRoleLabel = providerLabel(provider);
  const subagentNameFromInput = (type === 'tool_use' && (toolName === 'Task' || toolName === 'Agent') && message.toolInput)
    ? ((message.toolInput.name as string) || (message.toolInput.description as string) || null)
    : null;
  const agentName = subagentNameFromInput;

  // Format timestamp for display (HistoryMessage has ISO string timestamp)
  const timeStr = timestamp ? formatTimestamp(new Date(timestamp).getTime()) : '';
  const timestampMs = timestamp ? new Date(timestamp).getTime() : 0;

  // Debug hash for identifying duplicates
  const debugHash = getHistoryDebugHash(message);

  // Show all messages including utility slash commands

  // Empty assistant message placeholder. Also treat empty Codex content
  // payloads (e.g. [{"type":"output_text","text":""}]) as empty so they render
  // as a clean placeholder instead of raw JSON.
  if (type === 'assistant' && (!content.trim() || isEmptyCodexPayloadText(content))) {
    return (
      <div className="output-line output-empty-message">
        {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr}</span>}
        <span className="history-role">
          {provider && (
            <img
              src={providerAssetUrl(provider, import.meta.env.BASE_URL)}
              alt=""
              className="history-role-icon"
            />
          )}
          {assistantRoleLabel}
        </span>
        <span className="empty-message-label">{t('terminal:history.emptyMessage', 'empty message')}</span>
      </div>
    );
  }

  // History loads Grok/Codex reasoning as assistant lines with a `[thinking]`
  // prefix (session-loader). Render the same ThinkingBlock as live stream rows
  // instead of "Grok [thinking] …" plain assistant markdown.
  if (type === 'assistant' && /^\s*\[thinking\]/i.test(content)) {
    return (
      <ThinkingBlock
        text={content}
        isStreaming={false}
        agentId={agentId ?? undefined}
        provider={provider}
        timeStr={timeStr}
        timestampTitle={`${timestampMs} | ${debugHash}`}
        streamId={toolUseId || message.uuid || (timestampMs ? `hist-${timestampMs}` : undefined)}
        onImageClick={onImageClick}
        onFileClick={onFileClick}
      />
    );
  }

  // Handle session continuation message with special rendering
  // Use startsWith to avoid false positives when the agent's response merely mentions the phrase
  const isSessionContinuation = content.startsWith('This session is being continued from a previous conversation that ran out of context');
  if (isSessionContinuation) {
    return (
      <div
        className={`output-line output-session-continuation ${sessionExpanded ? 'expanded' : ''}`}
        onClick={() => setSessionExpanded(!sessionExpanded)}
        title={t('terminal:history.clickToExpandCollapse')}
      >
        {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr}</span>}
        <span className="session-continuation-icon"><Icon name="link" size={14} /></span>
        <span className="session-continuation-label">{t('tools:display.sessionContinued')}</span>
        <span className="session-continuation-toggle"><Icon name={sessionExpanded ? 'caret-down' : 'caret-right'} size={10} /></span>
        {sessionExpanded && (
          <div className="session-continuation-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    );
  }

  // Check for boss context FIRST (before context output check)
  const hasBossContext = content.trimStart().startsWith(BOSS_CONTEXT_START);

  // Check if this is context stats output (from /context command)
  const hasContextStdout = !hasBossContext && content.includes('<local-command-stdout>') && content.includes('Context Usage');
  const isContextOutput =
    !hasBossContext &&
    (content.includes('## Context Usage') ||
      (content.includes('Context Usage') && content.includes('Tokens:') && content.includes('Free space')) ||
      hasContextStdout);

  if (isContextOutput) {
    // Extract content from tags if present
    const tagMatch = content.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
    const contextContent = tagMatch ? tagMatch[1] : content;

    // Parse and render compact context stats
    const tokensMatch = contextContent.match(/\*?\*?Tokens:\*?\*?\s*([\d.]+)k?\s*\/\s*([\d.]+)k?\s*\((\d+)%\)/);

    const parseCategory = (name: string): { tokens: string; percent: string } | null => {
      const tableRegex = new RegExp(`\\|\\s*${name}\\s*\\|\\s*([\\d.]+)k?\\s*\\|\\s*([\\d.]+)%`, 'i');
      const tableMatch = contextContent.match(tableRegex);
      if (tableMatch) {
        return { tokens: tableMatch[1] + 'k', percent: tableMatch[2] + '%' };
      }
      const plainRegex = new RegExp(`${name}\\s+([\\d.]+)k?\\s+([\\d.]+)%`, 'i');
      const plainMatch = contextContent.match(plainRegex);
      if (plainMatch) {
        return { tokens: plainMatch[1] + 'k', percent: plainMatch[2] + '%' };
      }
      return null;
    };

    const messages = parseCategory('Messages');
    const usedPercent = tokensMatch ? parseInt(tokensMatch[3]) : 0;
    const freePercent = 100 - usedPercent;

    const handleContextClick = () => {
      if (agentId) {
        store.setContextModalAgentId(agentId);
      }
    };

    return (
      <div
        className="output-line output-context-stats"
        style={{
          cursor: agentId ? 'pointer' : 'default',
        }}
        onClick={handleContextClick}
        title={agentId ? t('terminal:history.clickForContextStats') : undefined}
      >
        {timeStr && <span className="output-timestamp context-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span className="context-debug-hash">[{debugHash}]</span></span>}
        <span className="context-icon"><Icon name="dashboard" size={14} /></span>
        <span className="context-label">{t('terminal:history.contextLabel')}</span>
        <div className="context-bar">
          <div
            className="context-bar-fill"
            style={{
              width: `${usedPercent}%`,
            }}
          />
        </div>
        <span className="context-tokens">
          {tokensMatch ? `${tokensMatch[1]}k/${tokensMatch[2]}k` : '?'}
        </span>
        <span className="context-free">({t('terminal:history.percentFree', { percent: freePercent.toFixed(0) })})</span>
        {messages && (
          <span className="context-msgs">{t('terminal:history.msgsLabel', { tokens: messages.tokens })}</span>
        )}
      </div>
    );
  }

  // Render the /compact command stdout as a small "Context compacted" pill
  // The /compact stdout arrives separately from <command-name>/compact</command-name>,
  // wrapped in <local-command-stdout> with ANSI dim codes around the word "Compacted".
  if (!hasBossContext && content.includes('<local-command-stdout>')) {
    const stdoutMatch = content.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
    if (stdoutMatch) {
      // Strip ANSI codes (both \x1b[..m and bare [..m forms) and trim
      const stripped = stdoutMatch[1].replace(/\x1b?\[\d+m/g, '').trim();
      if (stripped === 'Compacted') {
        return (
          <div className="output-line output-compacted-notice">
            {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr}</span>}
            <span className="compacted-icon"><Icon name="archive" size={14} /></span>
            <span className="compacted-label">{t('terminal:history.compactedLabel')}</span>
          </div>
        );
      }
    }
  }

  // Hide local-command tags for utility commands in history
  if (
    !hasBossContext &&
    (content.includes('<local-command-caveat>') ||
      content.includes('<command-name>/context</command-name>') ||
      content.includes('<command-name>/cost</command-name>') ||
      content.includes('<command-name>/compact</command-name>'))
  ) {
    return null;
  }

  // For user messages, parse boss context
  const parsedBoss = type === 'user' ? parseBossContext(content) : null;

  const extractExecTaskOutputLines = (raw: string): string[] | null => {
    if (!raw) return null;

    // Strip <persisted-output> wrapper tags from Claude Code's large output storage
    let content = raw;
    if (content.includes('<persisted-output>')) {
      content = content.replace(/<\/?persisted-output>/g, '').trim();
      // Extract just the JSON portion after "Preview (first NKB):" header
      const previewMatch = content.match(/Preview \(first [^)]+\):\s*([\s\S]*)/);
      if (previewMatch) {
        content = previewMatch[1].trim();
      } else {
        // Try to find JSON start directly (skip the "Output too large..." header)
        const jsonStart = content.indexOf('{');
        if (jsonStart !== -1) {
          content = content.slice(jsonStart);
        }
      }
    }

    const tryParse = (value: string): string[] | null => {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && typeof (parsed as any).output === 'string') {
          return (parsed as any).output.split('\n').filter((line: string) => line.length > 0);
        }
      } catch {
        // ignore parse errors and fall through
      }
      return null;
    };

    const direct = tryParse(content);
    if (direct) return direct;

    // Some stored history payloads include wrappers around the JSON response.
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const extracted = tryParse(content.slice(firstBrace, lastBrace + 1));
      if (extracted) return extracted;
    }

    // Handle truncated JSON (large outputs get truncated by Claude Code).
    // Try to extract the "output" field value even from broken JSON.
    const outputFieldMatch = content.match(/"output"\s*:\s*"([\s\S]*)/);
    if (outputFieldMatch) {
      let outputStr = outputFieldMatch[1];
      // Remove trailing JSON structure if present (e.g. `","duration":123}`)
      const trailingMatch = outputStr.match(/","(?:duration|exitCode|taskId|success)":/);
      if (trailingMatch && trailingMatch.index !== undefined) {
        outputStr = outputStr.slice(0, trailingMatch.index);
      }
      // Remove trailing truncation markers (e.g. `...\n`)
      outputStr = outputStr.replace(/\.\.\.\s*$/, '');
      // Unescape JSON string escapes
      try {
        outputStr = JSON.parse(`"${outputStr}"`);
      } catch {
        // If unescape fails, do basic unescaping including \uXXXX unicode sequences (e.g. \u001b for ANSI ESC)
        outputStr = outputStr
          .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      }
      const lines = outputStr.split('\n').filter((line: string) => line.length > 0);
      if (lines.length > 0) return lines;
    }

    return null;
  };

  if (type === 'tool_use') {
    const toolInputContent = message.toolInput ? JSON.stringify(message.toolInput) : content;
    const execPresentation = toolName === 'exec'
      ? getCodexExecPresentation(message.toolInput || content)
      : null;
    const renderedToolName = execPresentation?.toolName || toolName || '';
    const iconName = getToolIconName(renderedToolName);
    const displayToolName = renderedToolName ? getLocalizedToolName(renderedToolName, t) : '';

    // Match Task/Agent tool_use to its subagent so the inline activity + stream
    // panel survives the JSONL re-fetch that drops the live tool_use chip.
    const matchingSubagent = (toolName === 'Task' || toolName === 'Agent') && subagents && message.toolUseId
      ? (() => {
          for (const [, sub] of subagents) {
            if (sub.toolUseId === message.toolUseId) return sub;
          }
          return undefined;
        })()
      : undefined;

    if (execPresentation) {
      const execScript = message.toolInput && typeof message.toolInput === 'object'
        ? String(message.toolInput.input || message.toolInput.code || message.toolInput.script || JSON.stringify(message.toolInput, null, 2))
        : content;
      const execEditPaths = execPresentation.toolName === 'Edit' ? getCodexExecEditPaths(message.toolInput || content) : [];
      const opensDiffModal = execEditPaths.length > 0 && !!onFileClick;
      const execFileTarget = (execPresentation.toolName === 'Read' || execPresentation.toolName === 'Grep')
        ? getCodexExecFileTarget(message.toolInput || content, _toolOutput)
        : null;
      const opensFileModal = !!execFileTarget && !!onFileClick;
      const handleExecActivate = () => {
        if (opensDiffModal) {
          onFileClick(execEditPaths[0], { oldString: '', newString: '', operation: 'codex-patch' });
          return;
        }
        if (opensFileModal && execFileTarget) {
          onFileClick(execFileTarget.path, execFileTarget.highlightRange
            ? { highlightRange: execFileTarget.highlightRange }
            : undefined);
          return;
        }
        setExecDetailExpanded((value) => !value);
      };
      return (
        <>
          <div
            className={`output-line output-tool-use output-tool-simple codex-exec-row ${execDetailExpanded ? 'is-expanded' : ''}`}
            onClick={handleExecActivate}
            role="button"
            tabIndex={0}
            aria-expanded={execDetailExpanded}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleExecActivate();
              }
            }}
          >
            {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr}</span>}
            {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
            <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
            <span className="output-tool-name">{displayToolName}</span>
            {execPresentation.filePaths?.slice(0, 2).map((path) => (
              <span key={path} className="codex-file-chip" title={path}>
                <Icon name="file-code" size={11} />
                <span>{path.split('/').pop() || path}</span>
              </span>
            ))}
            {(execPresentation.filePaths?.length || 0) > 2 && (
              <span className="codex-file-chip codex-file-chip-more">+{execPresentation.filePaths!.length - 2}</span>
            )}
            <span className="output-tool-param">{execPresentation.detail}</span>
            <span className="codex-exec-chevron"><Icon name={opensDiffModal || opensFileModal ? 'open-external' : execDetailExpanded ? 'caret-up' : 'caret-down'} size={13} /></span>
          </div>
          {execDetailExpanded && (
            <div className="codex-exec-detail">
              <div className="codex-exec-detail-label">Command details</div>
              <pre>{execScript}</pre>
              {_toolOutput && <><div className="codex-exec-detail-label">Result</div><pre>{_toolOutput}</pre></>}
            </div>
          )}
        </>
      );
    }

    // Simple view: show icon, tool name, and key parameter
    if (simpleView) {
      let keyParam = toolName && toolInputContent ? extractToolKeyParam(toolName, toolInputContent) : null;
      if (toolName === 'Bash' && keyParam && keyParam.length > 300) {
        keyParam = keyParam.substring(0, 297) + '...';
      }

      const fileTools = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'NotebookEdit'];
      const isFileTool = fileTools.includes(toolName || '');
      // File tools always have a file path as keyParam (even root-level files like "README.md" without slashes)
      const isFilePath = keyParam && (isFileTool || keyParam.startsWith('/') || keyParam.includes('/'));
      const isFileClickable = isFileTool && isFilePath && onFileClick;

      // When Read targets an image, show an inline thumbnail preview below the line.
      const readImageThumb = (toolName === 'Read' && isFilePath && keyParam && isThumbnailableImagePath(keyParam))
        ? { url: getLocalFileImageUrl(keyParam), name: getBasenameFromPath(keyParam) }
        : null;

      // Bash is identified by tool name. Clickability is separate so we still
      // render the command when onBashClick is not wired for some reason.
      const isBashTool = toolName === 'Bash';
      // Prefer enrichment → key param → description field (Grok often sends both).
      let bashDescription: string | undefined;
      try {
        const parsed = toolInputContent ? JSON.parse(toolInputContent) : null;
        if (parsed && typeof parsed.description === 'string' && parsed.description.trim()) {
          bashDescription = parsed.description.trim();
        }
      } catch { /* ignore */ }
      const bashCommand = _bashCommand || keyParam || bashDescription || '';
      // Grok early tool_started cards arrive with empty toolInput {}. Hide them
      // rather than rendering a bare "BASH" chip with no command.
      if (isBashTool && !bashCommand) {
        return null;
      }
      const bashSearchCommand = isBashTool && bashCommand ? parseBashSearchCommand(bashCommand) : null;
      const bashNotificationCommand = isBashTool && bashCommand ? parseBashNotificationCommand(bashCommand) : null;
      const bashTrackingStatusCommand = isBashTool && bashCommand ? parseBashTrackingStatusCommand(bashCommand) : null;
      const bashTaskLabelCommand = !bashTrackingStatusCommand && isBashTool && bashCommand ? parseBashTaskLabelCommand(bashCommand) : null;
      const bashReportTaskCommand = isBashTool && bashCommand ? parseBashReportTaskCommand(bashCommand) : null;
      const bashMemoryCommand = isBashTool && bashCommand && !bashTrackingStatusCommand && !bashTaskLabelCommand && !bashReportTaskCommand ? parseBashMemoryCommand(bashCommand) : null;
      const bashMemoryResponse = bashMemoryCommand ? parseMemoryResponseInfo(_bashOutput) : undefined;
      const isCurlExecCommand = /\bcurl\b[\s\S]*\/api\/exec\b/.test(bashCommand);
      const bashTimestampMs = timestamp ? new Date(timestamp).getTime() : 0;
      const execInnerCommand = isCurlExecCommand ? extractExecPayloadCommand(bashCommand) : null;
      const matchingExecTasks = isCurlExecCommand && execTasks.length > 0
        ? (() => {
            if (execInnerCommand) {
              const commandMatches = execTasks.filter((task) => task.command === execInnerCommand);
              if (commandMatches.length > 0) {
                const mostRecent = commandMatches.reduce((latest, current) =>
                  current.startedAt > latest.startedAt ? current : latest
                );
                return [mostRecent];
              }
            }

            const tasksAfterBash = execTasks.filter(
              (task) => task.startedAt >= bashTimestampMs && task.startedAt <= bashTimestampMs + 5000
            );
            if (tasksAfterBash.length > 0) {
              const mostRecent = tasksAfterBash.reduce((latest, current) =>
                current.startedAt > latest.startedAt ? current : latest
              );
              return [mostRecent];
            }

            return [];
          })()
        : [];
      // A persisted `curl … /api/tests/run` line → re-attach the in-store run so
      // the inline test component shows on refresh (parity with live OutputLine).
      const isCurlTestRunCommand = /\bcurl\b[\s\S]*\/api\/tests\/run(?!s)/.test(bashCommand);
      const matchingTestRunId = isCurlTestRunCommand && testRunHandles.length > 0
        ? (() => {
            const near = testRunHandles.filter(
              (r) => r.startedAt >= bashTimestampMs - 3000 && r.startedAt <= bashTimestampMs + 20000
            );
            if (near.length > 0) {
              return near.reduce((latest, cur) => (cur.startedAt > latest.startedAt ? cur : latest)).runId;
            }
            return null;
          })()
        : null;
      // A persisted `curl … /api/http-requests/run` line → re-attach the in-store
      // run so the inline HTTP card shows on refresh (parity with OutputLine).
      const isCurlHttpRunCommand = /\bcurl\b[\s\S]*\/api\/http-requests\/run(?!s)/.test(bashCommand);
      const matchingHttpRunId = isCurlHttpRunCommand
        ? matchHttpRunHandle(httpRunHandles, bashCommand, bashTimestampMs)
        : null;
      const bashCurlParsed = (
        isBashTool
        && bashCommand
        && !bashTrackingStatusCommand
        && !bashNotificationCommand
        && !bashTaskLabelCommand
        && !bashReportTaskCommand
        && !bashMemoryCommand
        && !bashSearchCommand
        && !isCurlExecCommand
        && looksLikeCurl(bashCommand)
      ) ? (() => { try { return parseCurlCommand(bashCommand); } catch { return null; } })() : null;

      const handleParamClick = () => {
        if (isFileClickable && keyParam) {
          if (toolName === 'Edit' && toolInputContent) {
            try {
              const parsed = JSON.parse(toolInputContent);
              if (parsed.old_string !== undefined || parsed.new_string !== undefined || parsed.unified_diff !== undefined) {
                onFileClick(keyParam, {
                  oldString: parsed.old_string || '',
                  newString: parsed.new_string || '',
                  operation: typeof parsed.operation === 'string' ? parsed.operation : undefined,
                  unifiedDiff: typeof parsed.unified_diff === 'string' ? parsed.unified_diff : undefined,
                });
                return;
              }
            } catch {
              /* ignore */
            }
          }
          // Handle Read tool with offset/limit
          if (toolName === 'Read' && toolInputContent) {
            try {
              const parsed = JSON.parse(toolInputContent);
              if (parsed.offset !== undefined && parsed.limit !== undefined) {
                onFileClick(keyParam, { highlightRange: { offset: parsed.offset, limit: parsed.limit } });
                return;
              }
            } catch {
              /* ignore */
            }
          }
          onFileClick(keyParam);
        }
      };

      const handleBashClick = () => {
        if (isBashTool && bashCommand && onBashClick) {
          onBashClick(bashCommand, _bashOutput || t('tools:display.noOutputAvailable'));
        }
      };

      const renderBashCommandWithFileLinks = () => {
        const cmd = bashCommand || keyParam;
        if (!cmd) return null;
        if (!onFileClick) {
          return <span dangerouslySetInnerHTML={{ __html: highlightCode(cmd, 'bash') }} />;
        }

        const agentCwd = agentId ? store.getState().agents.get(agentId)?.cwd : undefined;
        const segments = splitCommandForFileLinks(cmd);

        return segments.map((segment, idx) => {
          if (!segment.fileRef) {
            return <span key={`cmd-${idx}`} dangerouslySetInnerHTML={{ __html: highlightCode(segment.text, 'bash') }} />;
          }
          const resolved = resolveAgentFileReference(segment.fileRef, agentCwd);
          return (
            <span
              key={`cmd-file-${idx}`}
              className="clickable-path"
              onClick={(e) => {
                e.stopPropagation();
                onFileClick(resolved.path);
              }}
              title={t('tools:display.clickToViewFile')}
              style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
            >
              {segment.text}
            </span>
          );
        });
      };

      const clickTitle = isBashTool
        ? t('tools:display.clickToViewOutput')
        : (isFileClickable ? t('tools:display.clickToViewFile') : undefined);

      // Check if this is a curl exec command and try to parse the exec output
      let execTaskOutput: { output: string[] } | null = null;

      if (isCurlExecCommand && matchingExecTasks.length === 0 && _bashOutput) {
        const outputLines = extractExecTaskOutputLines(_bashOutput);
        if (outputLines && outputLines.length > 0) {
          execTaskOutput = {
            output: outputLines,
          };
        }
      }

      // Special case: TodoWrite renders the formatted checklist inline
      if (toolName === 'TodoWrite') {
        let hasTodos = false;
        try {
          const parsed = toolInputContent ? JSON.parse(toolInputContent) : null;
          hasTodos = Array.isArray(parsed?.todos) && parsed.todos.length > 0;
        } catch { /* ignore */ }
        // Empty / early cards without todos would render a bare TODOWRITE label.
        if (!hasTodos) {
          return null;
        }
        return (
          <div className={`output-line output-tool-use output-tool-simple output-todo-inline`}>
            {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
            {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
            <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
            <span className="output-tool-name">{displayToolName}</span>
            <TodoWriteInput content={toolInputContent} priorTodos={_priorTodos} />
          </div>
        );
      }

      // Special case: AskUserQuestion renders the questions with options inline
      if ((toolName === 'AskUserQuestion' || toolName === 'AskFollowupQuestion') && toolInputContent) {
        // Verify it has valid questions data
        let hasQuestions = false;
        try {
          const parsed = JSON.parse(toolInputContent);
          hasQuestions = Array.isArray(parsed.questions) && parsed.questions.length > 0;
        } catch { /* not valid JSON */ }

        if (hasQuestions) {
          return (
            <div className={`output-line output-tool-use output-tool-simple output-ask-question-inline`}>
              {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
              {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
              <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
              <span className="output-tool-name">{displayToolName}</span>
              <AskQuestionInput
                content={toolInputContent}
                answers={_askQuestionAnswers}
                pendingPromptId={matchingPendingPrompt?.id}
              />
            </div>
          );
        }
      }

      // Special case: ExitPlanMode renders markdown plan inline
      if (toolName === 'ExitPlanMode' && toolInputContent) {
        return (
          <div className={`output-line output-tool-use output-tool-simple output-plan-inline`}>
            {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
            {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
            <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
            <span className="output-tool-name">{displayToolName}</span>
            <ExitPlanModeInput content={toolInputContent} pendingPromptId={matchingPendingPrompt?.id} onViewMarkdown={onViewMarkdown} />
          </div>
        );
      }

      if (toolName === 'TaskCreate' && toolInputContent) {
        return (
          <div className={`output-line output-tool-use output-tool-simple output-task-inline`}>
            {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
            {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
            <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
            <span className="output-tool-name">{displayToolName}</span>
            <TaskCreateInput content={toolInputContent} />
          </div>
        );
      }

      if (toolName === 'TaskUpdate' && toolInputContent) {
        return (
          <div className={`output-line output-tool-use output-tool-simple output-task-inline`}>
            {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
            {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
            <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
            <span className="output-tool-name">{displayToolName}</span>
            {_taskSnapshot && _taskSnapshot.length > 0
              ? <TaskListView todos={_taskSnapshot} />
              : <TaskUpdateInput content={toolInputContent} subject={_taskSubject} />}
          </div>
        );
      }

      // ListFiles / list_dir — folder chip instead of raw JSON
      if (toolName === 'ListFiles' || toolName === 'list_dir') {
        let fromInput = '';
        try {
          const parsed = toolInputContent ? JSON.parse(toolInputContent) : null;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            fromInput = String(parsed.target_directory || parsed.targetDirectory || parsed.path || parsed.directory || '');
          }
        } catch { /* ignore */ }
        // Empty `{}` must not block keyParam / extractToolKeyParam fallback.
        const listDir = fromInput || keyParam || '';
        if (!listDir) return null;
        return (
          <div className={`output-line output-tool-use output-tool-simple output-list-files-inline`}>
            {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
            {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
            <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
            <span className="output-tool-name">{displayToolName}</span>
            <ListFilesInput
              content={fromInput && toolInputContent
                ? toolInputContent
                : JSON.stringify({ target_directory: listDir })}
              onFileClick={onFileClick ? (p) => onFileClick(p) : undefined}
            />
          </div>
        );
      }

      // get_command_or_subagent_output — task wait chips
      if (toolName === 'get_command_or_subagent_output' || toolName === 'get_task_output') {
        let hasIds = false;
        try {
          const parsed = toolInputContent ? JSON.parse(toolInputContent) : null;
          const idsRaw = parsed?.task_ids ?? parsed?.taskIds ?? parsed?.task_id ?? parsed?.taskId;
          hasIds = Array.isArray(idsRaw)
            ? idsRaw.length > 0
            : typeof idsRaw === 'string' && idsRaw.length > 0;
        } catch { /* ignore */ }
        if (!hasIds && !keyParam) return null;
        return (
          <div className={`output-line output-tool-use output-tool-simple output-task-wait-inline`}>
            {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
            {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
            <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
            <span className="output-tool-name">{displayToolName}</span>
            <TaskOutputWaitInput
              content={hasIds && toolInputContent
                ? toolInputContent
                : JSON.stringify({ task_ids: keyParam ? [keyParam] : [] })}
            />
          </div>
        );
      }

      // Other structured JSON tools (web_search, etc.) — chips instead of raw dump
      if (
        toolInputContent
        && toolInputContent.trim().startsWith('{')
        && !isBashTool
        && !['Read', 'Write', 'Edit', 'Grep', 'Glob', 'NotebookEdit'].includes(toolName || '')
      ) {
        try {
          const parsed = JSON.parse(toolInputContent);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
            // If we already have a one-line keyParam, show chip row only when it adds more than one field
            const keys = Object.keys(parsed);
            if (keys.length > 1 || !keyParam) {
              return (
                <div className={`output-line output-tool-use output-tool-simple output-structured-tool-inline`}>
                  {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
                  {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
                  <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
                  <span className="output-tool-name">{displayToolName}</span>
                  <UnknownToolInput toolName={toolName || 'tool'} content={toolInputContent} chipsOnly />
                </div>
              );
            }
          }
        } catch { /* fall through */ }
      }

      return (
        <>
          <div
            className={`output-line output-tool-use output-tool-simple ${isBashTool && onBashClick ? 'clickable-bash' : ''} ${bashNotificationCommand ? 'bash-notify-use' : ''} ${bashTrackingStatusCommand ? 'bash-tracking-use' : ''}`}
            onClick={isBashTool && onBashClick ? handleBashClick : undefined}
            style={isBashTool && onBashClick ? { cursor: 'pointer' } : undefined}
            title={isBashTool && onBashClick ? t('tools:display.clickToViewOutput') : undefined}
          >
            {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
            {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
            <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
            <span className="output-tool-name">{displayToolName}</span>
            {isBashTool && bashTrackingStatusCommand ? (() => {
              const status = bashTrackingStatusCommand.trackingStatus;
              const detail = bashTrackingStatusCommand.trackingStatusDetail;
              const description = t(`terminal:trackingStatus.${status}`, { defaultValue: '' }) as string;
              const tooltipParts = [description || t('terminal:trackingStatus.label', { defaultValue: 'Tracking status' }), detail].filter(Boolean) as string[];
              return (
                <span
                  className={`output-tool-param bash-command bash-tracking-param status-${status}`}
                  onClick={handleBashClick}
                  title={tooltipParts.join(' — ')}
                  style={{ cursor: 'pointer' }}
                >
                  <span className={`bash-tracking-chip status-${status}`}>
                    <span className="bash-tracking-icon"><Icon name={getTrackingStatusIconName(status)} size={13} /></span>
                    <span className="bash-tracking-status">{status}</span>
                  </span>
                  {detail && (
                    <span className="bash-tracking-detail">{detail}</span>
                  )}
                </span>
              );
            })() : isBashTool && bashNotificationCommand ? (
              <span
                className="output-tool-param bash-command bash-notify-param"
                onClick={handleBashClick}
                title={bashNotificationCommand.commandBody}
                style={{ cursor: 'pointer' }}
              >
                <span className="bash-notify-chip">
                  <span className="bash-notify-icon"><Icon name="bell" size={12} /></span>
                  <span className="bash-notify-label">notify</span>
                </span>
                {bashNotificationCommand.title && (
                  <span className="bash-notify-title">{bashNotificationCommand.title}</span>
                )}
                {bashNotificationCommand.message && (
                  <span className="bash-notify-message">{bashNotificationCommand.message}</span>
                )}
              </span>
            ) : isBashTool && bashTaskLabelCommand ? (
              <span
                className="output-tool-param bash-command bash-task-label-param"
                onClick={handleBashClick}
                title={bashTaskLabelCommand.commandBody}
                style={{ cursor: 'pointer' }}
              >
                <span className="bash-task-label-chip"><Icon name="task" size={12} /> task</span>
                <span className="bash-task-label-value">{bashTaskLabelCommand.taskLabel}</span>
              </span>
            ) : isBashTool && bashReportTaskCommand ? (
              <span
                className="output-tool-param bash-command bash-report-task-param"
                onClick={handleBashClick}
                title={bashReportTaskCommand.commandBody}
                style={{ cursor: 'pointer' }}
              >
                <span className={`bash-report-task-chip ${bashReportTaskCommand.status === 'failed' ? 'status-failed' : 'status-completed'}`}>
                  <Icon name={bashReportTaskCommand.status === 'failed' ? 'failure' : 'success'} size={12} /> report
                </span>
                {bashReportTaskCommand.summary && (
                  <span className="bash-report-task-summary">{bashReportTaskCommand.summary}</span>
                )}
              </span>
            ) : isBashTool && bashMemoryCommand ? (
              <span
                className="output-tool-param bash-command bash-memory-param"
                onClick={handleBashClick}
                style={{ cursor: 'pointer' }}
              >
                <MemoryOpInput info={bashMemoryCommand} response={bashMemoryResponse} />
              </span>
            ) : isBashTool && bashSearchCommand ? (
              <span
                className="output-tool-param bash-command bash-search-param"
                onClick={handleBashClick}
                title={bashSearchCommand.commandBody}
                style={{ cursor: 'pointer' }}
              >
                {bashSearchCommand.shellPrefix && (
                  <span className="bash-search-shell">{bashSearchCommand.shellPrefix}</span>
                )}
                <span className="bash-search-chip">search</span>
                <span className="bash-search-term">{bashSearchCommand.searchTerm}</span>
              </span>
            ) : isBashTool && bashCurlParsed ? (
              <div className="output-tool-param bash-curl-param">
                <CurlCard parsed={bashCurlParsed} rawCommand={bashCommand} />
              </div>
            ) : isBashTool && bashCommand ? (
              <span
                className="output-tool-param bash-command"
                onClick={onBashClick ? handleBashClick : undefined}
                title={onBashClick ? t('tools:display.clickToViewOutput') : bashCommand}
                style={onBashClick ? { cursor: 'pointer' } : undefined}
              >
                {renderBashCommandWithFileLinks()}
              </span>
            ) : (
              keyParam && (
                <span
                  className={`output-tool-param ${isFileClickable ? 'clickable-path' : ''}`}
                  onClick={isFileClickable ? handleParamClick : undefined}
                  title={isFileClickable ? clickTitle : keyParam}
                  style={isFileClickable ? { cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' } : undefined}
                >
                  {isFileTool && isFilePath && (() => {
                    const ext = getExtFromPath(keyParam);
                    const iconPath = ext ? getIconForExtension(ext) : '';
                    return iconPath ? <img className="output-tool-file-icon" src={iconPath} alt="" /> : null;
                  })()}
                  {(['Read', 'Write', 'Edit', 'NotebookEdit'].includes(toolName || '') && isFilePath ? getBasenameFromPath(keyParam) : keyParam)}
                </span>
              )
            )}
            {isBashTool && <BashInlineToggle enabled={settings.inlineBashOutputs} />}
          </div>
          {/* Global inline-output mode: show the captured output right below the
              command. Skipped when the row already renders its result inline
              (exec tasks, exec output, test runs, HTTP run cards). */}
          {isBashTool && settings.inlineBashOutputs && _bashOutput
            && matchingExecTasks.length === 0 && !execTaskOutput && !matchingTestRunId && !matchingHttpRunId && (
            <BashInlineOutput text={_bashOutput} />
          )}
          {/* Inline image thumbnail when a Read targets an image file */}
          {readImageThumb && (
            <div className="output-read-image-preview">
              <img
                src={readImageThumb.url}
                alt={readImageThumb.name}
                className="read-image-thumb"
                loading="lazy"
                title={t('terminal:content.clickToViewImage')}
                onClick={(e) => { e.stopPropagation(); onImageClick?.(readImageThumb.url, readImageThumb.name); }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            </div>
          )}
          {matchingExecTasks.length > 0 && (
            <div className="exec-task-output-container">
              {matchingExecTasks.map((task) => {
                const isExpanded = expandedExecTasks.has(task.taskId);
                const lastLines = task.output.slice(-6);
                const isCollapsed = task.output.length > 6;
                const displayLines = isExpanded ? task.output : lastLines;

                return (
                  <div key={task.taskId} className={`exec-task-inline status-${task.status}`}>
                    {isCollapsed && (
                      <div
                        className="exec-task-toggle"
                        onClick={() =>
                          setExpandedExecTasks((prev) => {
                            const next = new Set(prev);
                            if (next.has(task.taskId)) {
                              next.delete(task.taskId);
                            } else {
                              next.add(task.taskId);
                            }
                            return next;
                          })
                        }
                      >
                        <span className="exec-task-toggle-arrow"><Icon name={isExpanded ? 'caret-down' : 'caret-right'} size={10} /></span>
                        <span className="exec-task-toggle-text">
                          {isExpanded ? t('tools:skills.hide') : t('tools:skills.showAll', { count: task.output.length })}
                        </span>
                      </div>
                    )}

                    <div className="exec-task-inline-terminal">
                      <pre className="exec-task-inline-output">
                        {displayLines.map((line, idx) => (
                          <div key={idx} dangerouslySetInnerHTML={{ __html: ansiToHtml(line) }} />
                        ))}
                        {task.status === 'running' && <span className="exec-task-cursor">▌</span>}
                      </pre>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* Live/persisted test-run suite/test tree below the `curl /api/tests/run` line */}
          {matchingTestRunId && (
            <div className="exec-task-output-container">
              <TestRunInline runId={matchingTestRunId} />
            </div>
          )}
          {/* Live/persisted HTTP-request card below the `curl /api/http-requests/run`
              line; with no in-store run (page reload / run without agentId) it is
              reconstructed from the persisted history. */}
          {matchingHttpRunId ? (
            <div className="exec-task-output-container">
              <HttpRunInline runId={matchingHttpRunId} />
            </div>
          ) : isCurlHttpRunCommand ? (
            <div className="exec-task-output-container">
              <HttpRunLookup command={bashCommand} timestampMs={bashTimestampMs} />
            </div>
          ) : null}
          {/* Render exec task output for curl exec commands */}
          {isCurlExecCommand && execTaskOutput && (
            <div className="exec-task-output-container">
              <div className="exec-task-inline status-completed">
                {(() => {
                  const taskId = `history-curl-${timestamp}`;
                  const isExpanded = expandedExecTasks.has(taskId);
                  const lastLines = execTaskOutput.output.slice(-6);
                  const isCollapsed = execTaskOutput.output.length > 6;
                  const displayLines = isExpanded ? execTaskOutput.output : lastLines;

                  return (
                    <>
                      {/* Collapse/expand toggle */}
                      {isCollapsed && (
                        <div
                          className="exec-task-toggle"
                          onClick={() =>
                            setExpandedExecTasks((prev) => {
                              const next = new Set(prev);
                              if (next.has(taskId)) {
                                next.delete(taskId);
                              } else {
                                next.add(taskId);
                              }
                              return next;
                            })
                          }
                        >
                          <span className="exec-task-toggle-arrow"><Icon name={isExpanded ? 'caret-down' : 'caret-right'} size={10} /></span>
                          <span className="exec-task-toggle-text">
                            {isExpanded ? t('tools:skills.hide') : t('tools:skills.showAll', { count: execTaskOutput.output.length })}
                          </span>
                        </div>
                      )}

                      {/* Output lines */}
                      <div className="exec-task-inline-terminal">
                        <pre className="exec-task-inline-output">
                          {displayLines.map((line, idx) => (
                            <div key={idx} dangerouslySetInnerHTML={{ __html: ansiToHtml(line) }} />
                          ))}
                        </pre>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}
          {matchingSubagent && <SubagentInline subagent={matchingSubagent} />}
        </>
      );
    }

    // Special rendering for Edit tool - show diff view
    if (toolName === 'Edit' && toolInputContent) {
      return (
        <>
          <div className="output-line output-tool-use">
            {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
            {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
            <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
            <span className="output-tool-name">{displayToolName}</span>
          </div>
          <div className="output-line output-tool-input">
            <EditToolDiff content={toolInputContent} onFileClick={onFileClick} />
          </div>
        </>
      );
    }

    // Special rendering for Read tool - show file link
    if (toolName === 'Read' && toolInputContent) {
      return (
        <>
          <div className="output-line output-tool-use">
            {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
            {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
            <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
            <span className="output-tool-name">{displayToolName}</span>
          </div>
          <div className="output-line output-tool-input">
            <ReadToolInput content={toolInputContent} onFileClick={onFileClick} />
          </div>
        </>
      );
    }

    // Special rendering for TodoWrite tool - show checklist
    if (toolName === 'TodoWrite' && toolInputContent) {
      return (
        <>
          <div className="output-line output-tool-use">
            {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
            {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
            <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
            <span className="output-tool-name">{displayToolName}</span>
          </div>
          <div className="output-line output-tool-input">
            <TodoWriteInput content={toolInputContent} priorTodos={_priorTodos} />
          </div>
        </>
      );
    }

    if (toolName === 'TaskCreate' && toolInputContent) {
      return (
        <>
          <div className="output-line output-tool-use">
            {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
            {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
            <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
            <span className="output-tool-name">{displayToolName}</span>
          </div>
          <div className="output-line output-tool-input">
            <TaskCreateInput content={toolInputContent} />
          </div>
        </>
      );
    }

    if (toolName === 'TaskUpdate' && toolInputContent) {
      return (
        <>
          <div className="output-line output-tool-use">
            {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
            {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
            <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
            <span className="output-tool-name">{displayToolName}</span>
          </div>
          <div className="output-line output-tool-input">
            {_taskSnapshot && _taskSnapshot.length > 0
              ? <TaskListView todos={_taskSnapshot} />
              : <TaskUpdateInput content={toolInputContent} subject={_taskSubject} />}
          </div>
        </>
      );
    }

    // Special rendering for ExitPlanMode tool - render markdown plan
    if (toolName === 'ExitPlanMode' && toolInputContent) {
      return (
        <>
          <div className="output-line output-tool-use">
            {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
            {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
            <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
            <span className="output-tool-name">{displayToolName}</span>
          </div>
          <div className="output-line output-tool-input">
            <ExitPlanModeInput content={toolInputContent} pendingPromptId={matchingPendingPrompt?.id} onViewMarkdown={onViewMarkdown} />
          </div>
        </>
      );
    }

    // Special rendering for AskUserQuestion / AskFollowupQuestion - render the
    // question card in advanced mode too. Without this, the input falls through
    // to the default raw-JSON `<pre>` which is unreadable when the question
    // includes long descriptions and previews. We reuse the same component used
    // by simple mode for visual parity.
    if ((toolName === 'AskUserQuestion' || toolName === 'AskFollowupQuestion') && toolInputContent) {
      let hasQuestions = false;
      try {
        const parsed = JSON.parse(toolInputContent);
        hasQuestions = Array.isArray(parsed.questions) && parsed.questions.length > 0;
      } catch { /* not valid JSON */ }

      if (hasQuestions) {
        return (
          <>
            <div className="output-line output-tool-use">
              {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
              {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
              <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
              <span className="output-tool-name">{displayToolName}</span>
            </div>
            <div className="output-line output-tool-input">
              <AskQuestionInput
                content={toolInputContent}
                answers={_askQuestionAnswers}
                pendingPromptId={matchingPendingPrompt?.id}
              />
            </div>
          </>
        );
      }
    }

    // Special rendering for ToolSearch - formatted query/selection display
    if (toolName === 'ToolSearch' && toolInputContent) {
      return (
        <>
          <div className="output-line output-tool-use">
            {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
            {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
            <span className="output-tool-icon"><Icon name="bolt" size={14} /></span>
            <span className="output-tool-name">ToolSearch</span>
          </div>
          <div className="output-line output-tool-input">
            <ToolSearchInput content={toolInputContent} agentName={agentName} />
          </div>
        </>
      );
    }

    if (toolInputContent && isToolSearchContent(toolInputContent)) {
      return (
        <>
          <div className="output-line output-tool-use">
            {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
            {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
            <span className="output-tool-icon"><Icon name="bolt" size={14} /></span>
            <span className="output-tool-name">ToolSearch</span>
          </div>
          <div className="output-line output-tool-input">
            <ToolSearchInput content={toolInputContent} agentName={agentName} />
          </div>
        </>
      );
    }

    // Special rendering for Bash - show the same parsed chips (tracking, notify,
    // task-label, report-task, memory, search, curl) and a syntax-highlighted
    // command line in advanced mode. Falls back to raw JSON only when there is
    // no command we can pull out — the default rendering below handles that.
    if (toolName === 'Bash' && toolInputContent) {
      const bashKeyParam = extractToolKeyParam('Bash', toolInputContent);
      let bashDescription: string | undefined;
      try {
        const parsed = JSON.parse(toolInputContent);
        if (parsed && typeof parsed.description === 'string' && parsed.description.trim()) {
          bashDescription = parsed.description.trim();
        }
      } catch { /* ignore */ }
      const bashCommand = _bashCommand || bashKeyParam || bashDescription || '';
      if (bashCommand) {
        const bashSearchCommand = parseBashSearchCommand(bashCommand);
        const bashNotificationCommand = parseBashNotificationCommand(bashCommand);
        const bashTrackingStatusCommand = parseBashTrackingStatusCommand(bashCommand);
        const bashTaskLabelCommand = !bashTrackingStatusCommand ? parseBashTaskLabelCommand(bashCommand) : null;
        const bashReportTaskCommand = parseBashReportTaskCommand(bashCommand);
        const bashMemoryCommand = !bashTrackingStatusCommand && !bashTaskLabelCommand && !bashReportTaskCommand
          ? parseBashMemoryCommand(bashCommand)
          : null;
        const bashMemoryResponse = bashMemoryCommand ? parseMemoryResponseInfo(_bashOutput) : undefined;
        const isCurlExecCommand = /\bcurl\b[\s\S]*\/api\/exec\b/.test(bashCommand);
        const bashCurlParsed = (
          !bashTrackingStatusCommand
          && !bashNotificationCommand
          && !bashTaskLabelCommand
          && !bashReportTaskCommand
          && !bashMemoryCommand
          && !bashSearchCommand
          && !isCurlExecCommand
          && looksLikeCurl(bashCommand)
        ) ? (() => { try { return parseCurlCommand(bashCommand); } catch { return null; } })() : null;

        const handleBashClick = onBashClick
          ? () => onBashClick(bashCommand, _bashOutput || t('tools:display.noOutputAvailable'))
          : undefined;

        const chip = bashTrackingStatusCommand ? (() => {
          const status = bashTrackingStatusCommand.trackingStatus;
          const detail = bashTrackingStatusCommand.trackingStatusDetail;
          const description = t(`terminal:trackingStatus.${status}`, { defaultValue: '' }) as string;
          const tooltipParts = [description || t('terminal:trackingStatus.label', { defaultValue: 'Tracking status' }), detail].filter(Boolean) as string[];
          return (
            <span
              className={`output-tool-param bash-command bash-tracking-param status-${status}`}
              onClick={handleBashClick}
              title={tooltipParts.join(' — ')}
              style={handleBashClick ? { cursor: 'pointer' } : undefined}
            >
              <span className={`bash-tracking-chip status-${status}`}>
                <span className="bash-tracking-icon"><Icon name={getTrackingStatusIconName(status)} size={13} /></span>
                <span className="bash-tracking-status">{status}</span>
              </span>
              {detail && <span className="bash-tracking-detail">{detail}</span>}
            </span>
          );
        })() : bashNotificationCommand ? (
          <span
            className="output-tool-param bash-command bash-notify-param"
            onClick={handleBashClick}
            title={bashNotificationCommand.commandBody}
            style={handleBashClick ? { cursor: 'pointer' } : undefined}
          >
            <span className="bash-notify-chip">
              <span className="bash-notify-icon"><Icon name="bell" size={12} /></span>
              <span className="bash-notify-label">notify</span>
            </span>
            {bashNotificationCommand.title && <span className="bash-notify-title">{bashNotificationCommand.title}</span>}
            {bashNotificationCommand.message && <span className="bash-notify-message">{bashNotificationCommand.message}</span>}
          </span>
        ) : bashTaskLabelCommand ? (
          <span
            className="output-tool-param bash-command bash-task-label-param"
            onClick={handleBashClick}
            title={bashTaskLabelCommand.commandBody}
            style={handleBashClick ? { cursor: 'pointer' } : undefined}
          >
            <span className="bash-task-label-chip"><Icon name="task" size={12} /> task</span>
            <span className="bash-task-label-value">{bashTaskLabelCommand.taskLabel}</span>
          </span>
        ) : bashReportTaskCommand ? (
          <span
            className="output-tool-param bash-command bash-report-task-param"
            onClick={handleBashClick}
            title={bashReportTaskCommand.commandBody}
            style={handleBashClick ? { cursor: 'pointer' } : undefined}
          >
            <span className={`bash-report-task-chip ${bashReportTaskCommand.status === 'failed' ? 'status-failed' : 'status-completed'}`}>
              <Icon name={bashReportTaskCommand.status === 'failed' ? 'failure' : 'success'} size={12} /> report
            </span>
            {bashReportTaskCommand.summary && <span className="bash-report-task-summary">{bashReportTaskCommand.summary}</span>}
          </span>
        ) : bashMemoryCommand ? (
          <span
            className="output-tool-param bash-command bash-memory-param"
            onClick={handleBashClick}
            style={handleBashClick ? { cursor: 'pointer' } : undefined}
          >
            <MemoryOpInput info={bashMemoryCommand} response={bashMemoryResponse} />
          </span>
        ) : bashSearchCommand ? (
          <span
            className="output-tool-param bash-command bash-search-param"
            onClick={handleBashClick}
            title={bashSearchCommand.commandBody}
            style={handleBashClick ? { cursor: 'pointer' } : undefined}
          >
            {bashSearchCommand.shellPrefix && <span className="bash-search-shell">{bashSearchCommand.shellPrefix}</span>}
            <span className="bash-search-chip">search</span>
            <span className="bash-search-term">{bashSearchCommand.searchTerm}</span>
          </span>
        ) : bashCurlParsed ? (
          <div className="output-tool-param bash-curl-param">
            <CurlCard parsed={bashCurlParsed} rawCommand={bashCommand} />
          </div>
        ) : (
          <pre
            className="output-input-content bash-command"
            onClick={handleBashClick}
            style={handleBashClick ? { cursor: 'pointer' } : undefined}
            title={handleBashClick ? t('tools:display.clickToViewOutput') : undefined}
            dangerouslySetInnerHTML={{ __html: highlightCode(bashCommand, 'bash') }}
          />
        );

        return (
          <>
            <div className="output-line output-tool-use">
              {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
              {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
              <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
              <span className="output-tool-name">{displayToolName}</span>
              <BashInlineToggle enabled={settings.inlineBashOutputs} />
            </div>
            <div className="output-line output-tool-input">
              {chip}
            </div>
            {settings.inlineBashOutputs && _bashOutput && (
              <BashInlineOutput text={_bashOutput} />
            )}
          </>
        );
      }
    }

    // Default tool rendering
    return (
      <>
        <div className="output-line output-tool-use">
          {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
          {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
          <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
          <span className="output-tool-name">{displayToolName}</span>
        </div>
        {toolInputContent && (
          <div className="output-line output-tool-input">
            <pre className="output-input-content">{highlightText(toolInputContent, highlight)}</pre>
          </div>
        )}
        {matchingSubagent && <SubagentInline subagent={matchingSubagent} />}
      </>
    );
  }

  if (type === 'tool_result') {
    // Hide tool results in simple view (matches live output filtering).
    // AskUserQuestion tool_results are now folded into the tool_use block
    // (see AgentTerminalPane.enrichHistory) so we don't render them
    // standalone here either.
    if (simpleView) return null;

    // Test-run result JSON → render a compact card (parity with live OutputLine).
    const testCard = parseTestResults(content);
    if (testCard) {
      return (
        <div className="output-line output-tool-result">
          {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
          <TestResultsCard data={testCard} />
        </div>
      );
    }

    // HTTP-request result JSON → compact card (parity with live OutputLine).
    const httpCard = parseHttpResults(content);
    if (httpCard) {
      return (
        <div className="output-line output-tool-result">
          {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
          <HttpResultsCard data={httpCard} />
        </div>
      );
    }

    const isError = content.toLowerCase().includes('error') || content.toLowerCase().includes('failed');

    // Bash tool results get terminal-style rendering (matching real-time OutputLine)
    if (toolName === 'Bash') {
      const isBashError = isError ||
        content.toLowerCase().includes('command not found') ||
        content.toLowerCase().includes('permission denied');
      const isTruncated = content.includes('... (truncated,');
      return (
        <div className={`output-line output-bash-result ${isBashError ? 'is-error' : ''}`}>
          {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
          <div className="bash-output-container">
            <div className="bash-output-header">
              <span className="bash-output-icon">$</span>
              <span className="bash-output-label">{t('tools:display.terminalOutput')}</span>
              {isTruncated && <span className="bash-output-truncated">{t('tools:display.truncated')}</span>}
            </div>
            <pre className="bash-output-content" dangerouslySetInnerHTML={{ __html: ansiToHtml(content) }} />
          </div>
        </div>
      );
    }

    // AskUserQuestion tool_result: render the picked answers as styled Q → A rows.
    if (toolName === 'AskUserQuestion' || toolName === 'AskFollowupQuestion') {
      return (
        <div className={`output-line output-tool-result ${isError ? 'is-error' : ''}`}>
          {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
          <AskQuestionResult content={content} />
        </div>
      );
    }

    return (
      <div className={`output-line output-tool-result ${isError ? 'is-error' : ''}`}>
        {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
        <span className="output-result-icon"><Icon name={isError ? 'failure' : 'check'} size={12} /></span>
        <pre className="output-result-content">{highlightText(content, highlight)}</pre>
      </div>
    );
  }

  const isUser = type === 'user';
  const isSystemMessage = !isUser && /^\s*(?:[\u{1F300}-\u{1FAFF}\u2600-\u27BF]\s*)?\[System\]/u.test(content);
  const className = isUser ? 'history-line history-user' : (isSystemMessage ? 'history-line history-system' : 'history-line history-assistant');
  const assistantOrSystemRoleLabel = isSystemMessage ? t('tools:display.system') : assistantRoleLabel;

  // For user messages, check for boss context
  if (isUser && parsedBoss) {
    const parsedInjected = parseInjectedInstructions(parsedBoss.userMessage);
    const displayMessage = parsedInjected.userMessage;

    // Check for [DELEGATED TASK ...] message (subordinate receiving a task)
    const delegatedTaskParsed = parseDelegatedTaskMessage(displayMessage.trim());
    if (delegatedTaskParsed.isDelegatedTask) {
      return (
        <div className={className}>
          {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
          <span className="history-content">
            <DelegatedTaskMessage bossName={delegatedTaskParsed.bossName} bossId={delegatedTaskParsed.bossId} taskCommand={delegatedTaskParsed.taskCommand} />
          </span>
        </div>
      );
    }

    // Check for [TASK REPORT ...] message (boss receiving completion report)
    const taskReportParsed = parseTaskReportMessage(displayMessage.trim());
    if (taskReportParsed.isTaskReport) {
      return (
        <div className={className}>
          {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
          <span className="history-content">
            {parsedBoss.hasContext && parsedBoss.context && (
              <BossContext key={`boss-${timestamp || content.slice(0, 50)}`} context={parsedBoss.context} onFileClick={onFileClick ? (path) => onFileClick(path) : undefined} />
            )}
            <TaskReportHeader
              agentName={taskReportParsed.agentName}
              agentId={taskReportParsed.agentId}
              status={taskReportParsed.status}
              summary={taskReportParsed.summary}
            />
          </span>
        </div>
      );
    }

    // Check for <task-notification> blocks (background task / async subagent completion)
    const taskNotif = parseTaskNotification(displayMessage.trim());
    if (taskNotif.hasNotification) {
      return (
        <div className={className}>
          {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
          <span className="history-content">
            <TaskNotificationDisplay
              taskId={taskNotif.taskId}
              status={taskNotif.status}
              summary={taskNotif.summary}
              result={taskNotif.result}
              tokens={taskNotif.tokens}
              toolUses={taskNotif.toolUses}
              durationMs={taskNotif.durationMs}
            />
            {taskNotif.contentWithoutNotification && (
              <span className="user-prompt-text">
                {highlight ? (
                  <div>{highlightText(taskNotif.contentWithoutNotification, highlight)}</div>
                ) : (
                  renderUserPromptContent(taskNotif.contentWithoutNotification, onImageClick, onFileClick)
                )}
              </span>
            )}
          </span>
        </div>
      );
    }

    // Check for <subagent_notification> tags (Codex collab)
    const subagentNotif = parseSubagentNotification(displayMessage.trim());
    if (subagentNotif.hasNotification) {
      return (
        <div className={className}>
          {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
          <span className="history-content">
            <SubagentNotificationDisplay agentId={subagentNotif.agentId} status={subagentNotif.status} />
            {subagentNotif.contentWithoutNotification && (
              <span className="user-prompt-text">
                {highlight ? (
                  <div>{highlightText(subagentNotif.contentWithoutNotification, highlight)}</div>
                ) : (
                  renderUserPromptContent(subagentNotif.contentWithoutNotification, onImageClick, onFileClick)
                )}
              </span>
            )}
          </span>
        </div>
      );
    }

    const extCtx = parseExtensionContext(displayMessage);
    if (extCtx) {
      return (
        <div className={`${className} history-user-ext-ctx`}>
          {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
          <span className="history-content">
            <ExtensionContextCard ctx={extCtx} onImageClick={onImageClick} />
          </span>
        </div>
      );
    }

    const agentChatMsg = parseAgentChatMessage(displayMessage);
    if (agentChatMsg) {
      return (
        <div className={`${className} history-user-agent-chat`}>
          {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
          <span className="history-content">
            <AgentChatMessageCard
              senderName={agentChatMsg.senderName}
              senderId={agentChatMsg.senderId}
              body={agentChatMsg.body}
            />
          </span>
        </div>
      );
    }

    const whatsAppMsg = parseWhatsAppMessage(displayMessage);
    if (whatsAppMsg) {
      return (
        <div className={`${className} history-user-whatsapp`}>
          {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
          <span className="history-content">
            <WhatsAppMessageBubble msg={whatsAppMsg} />
          </span>
        </div>
      );
    }

    const slackMsg = parseSlackMessage(displayMessage);
    if (slackMsg) {
      return (
        <div className={`${className} history-user-slack`}>
          {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
          <span className="history-content">
            <SlackMessageBubble msg={slackMsg} />
          </span>
        </div>
      );
    }

    const emailMsg = parseEmailMessage(displayMessage);
    if (emailMsg) {
      return (
        <div className={`${className} history-user-gmail`}>
          {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
          <span className="history-content">
            <GmailMessageBubble msg={emailMsg} />
          </span>
        </div>
      );
    }

    return (
      <div className={className}>
        {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
        <span className="history-role history-role-chip">{t('common:labels.you')}</span>
        <span className="history-content user-prompt-text">
          {parsedBoss.hasContext && parsedBoss.context && (
            <BossContext key={`boss-${timestamp || content.slice(0, 50)}`} context={parsedBoss.context} onFileClick={onFileClick ? (path) => onFileClick(path) : undefined} />
          )}
          {highlight ? (
            <div>{highlightText(displayMessage, highlight)}</div>
          ) : (
            renderUserPromptContent(displayMessage, onImageClick, onFileClick)
          )}
        </span>
      </div>
    );
  }

  // For assistant messages, check for delegation blocks and work-plan blocks
  const delegationParsed = parseDelegationBlock(content);
  const workPlanParsed = parseWorkPlanBlock(delegationParsed.contentWithoutBlock);

  if (delegationParsed.hasDelegation || workPlanParsed.hasWorkPlan) {
    return (
      <div className={className}>
        {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
        <span className="history-role">
          {!isSystemMessage && provider && (
            <img
              src={providerAssetUrl(provider, import.meta.env.BASE_URL)}
              alt=""
              className="history-role-icon"
              title={provider === 'codex' ? t('terminal:history.codexAgent') : provider === 'opencode' ? 'OpenCode Agent' : provider === 'grok' ? 'Grok Agent' : t('terminal:history.claudeAgent')}
            />
          )}
          {assistantOrSystemRoleLabel}
        </span>
        <span ref={markdownContentRef} className="history-content markdown-content">
          {highlight ? (
            <div>{highlightText(workPlanParsed.contentWithoutBlock, highlight)}</div>
          ) : (
            renderContentWithImages(workPlanParsed.contentWithoutBlock, onImageClick, onFileClick)
          )}
          {workPlanParsed.hasWorkPlan && workPlanParsed.workPlan && (
            <WorkPlanBlock workPlan={workPlanParsed.workPlan} />
          )}
          {delegationParsed.hasDelegation && delegationParsed.delegations.map((delegation, i) => (
            <DelegationBlock
              key={`del-${i}`}
              delegation={delegation}
              bossId={agentId}
              onFileClick={onFileClick}
              onBashClick={onBashClick}
            />
          ))}
        </span>
        <div className="message-action-btns">
          {settings.experimentalTTS && (
            <button
              className="history-speak-btn"
              onClick={(e) => { e.stopPropagation(); toggleTTS(content); }}
              title={speaking ? t('terminal:history.stopSpeaking') : t('terminal:history.speakSpanish')}
            >
              <Icon name={speaking ? 'speaker-on' : 'speaker-off'} size={14} />
            </button>
          )}
          {onViewMarkdown && (
            <button
              className="history-view-md-btn"
              onClick={(e) => { e.stopPropagation(); onViewMarkdown(content); }}
              title={t('terminal:history.viewAsMarkdown')}
            >
              <Icon name="file-text" size={14} />
            </button>
          )}
          <button
            className="history-view-md-btn"
            onClick={(e) => { e.stopPropagation(); handleCopyRichText(); }}
            title="Copy as rich text"
          >
            <Icon name={copyRichStatus === 'copied' ? 'check' : copyRichStatus === 'error' ? 'cross' : 'copy'} size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
      <span className={`history-role ${isUser ? 'history-role-chip' : ''}`}>
        {!isUser && !isSystemMessage && provider && (
          <img
            src={providerAssetUrl(provider, import.meta.env.BASE_URL)}
            alt=""
            className="history-role-icon"
            title={provider === 'codex' ? t('terminal:history.codexAgent') : provider === 'opencode' ? 'OpenCode Agent' : provider === 'grok' ? 'Grok Agent' : t('terminal:history.claudeAgent')}
          />
        )}
        {isUser ? t('common:labels.you') : assistantOrSystemRoleLabel}
      </span>
      <span ref={markdownContentRef} className={`history-content ${isUser ? 'user-prompt-text' : 'markdown-content'}`}>
        {highlight ? <div>{highlightText(content, highlight)}</div> : (
          isUser ? renderUserPromptContent(content, onImageClick, onFileClick) : renderContentWithImages(content, onImageClick, onFileClick)
        )}
      </span>
      {!isUser && (
        <div className="message-action-btns">
          {settings.experimentalTTS && (
            <button
              className="history-speak-btn"
              onClick={(e) => { e.stopPropagation(); toggleTTS(content); }}
              title={speaking ? t('terminal:history.stopSpeaking') : t('terminal:history.speakSpanish')}
            >
              <Icon name={speaking ? 'speaker-on' : 'speaker-off'} size={14} />
            </button>
          )}
          {onViewMarkdown && (
            <button
              className="history-view-md-btn"
              onClick={(e) => { e.stopPropagation(); onViewMarkdown(content); }}
              title={t('terminal:history.viewAsMarkdown')}
            >
              <Icon name="file-text" size={14} />
            </button>
          )}
          <button
            className="history-view-md-btn"
            onClick={(e) => { e.stopPropagation(); handleCopyRichText(); }}
            title="Copy as rich text"
          >
            <Icon name={copyRichStatus === 'copied' ? 'check' : copyRichStatus === 'error' ? 'cross' : 'copy'} size={14} />
          </button>
        </div>
      )}
    </div>
  );
});
