/**
 * OutputLine component for rendering live streaming output
 */

import React, { memo, useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useHideCost, useSettings, ClaudeOutput, store, useAgentPrompts, type TestRunHandle, type HttpRunHandle } from '../../store';
import { filterCostText, isEmptyCodexPayloadText } from '../../utils/formatting';
import { getToolIconName, extractToolKeyParam, extractExecWrappedCommand, extractExecPayloadCommand, formatTimestamp, getLocalizedToolName, parseBashNotificationCommand, parseBashSearchCommand, parseBashTaskLabelCommand, parseBashReportTaskCommand, parseBashTrackingStatusCommand, parseBashMemoryCommand, parseMemoryResponseInfo, getTrackingStatusIconName, splitCommandForFileLinks } from '../../utils/outputRendering';
import { resolveAgentFileReference } from '../../utils/filePaths';
import { getIconForExtension } from '../FileExplorerPanel/fileUtils';
import { BossContext, DelegationBlock, parseBossContext, parseDelegationBlock, DelegatedTaskHeader, parseWorkPlanBlock, WorkPlanBlock, parseInjectedInstructions, parseDelegatedTaskMessage, DelegatedTaskMessage, parseTaskReportMessage, TaskReportHeader, parseSubagentNotification, SubagentNotificationDisplay, parseTaskNotification, TaskNotificationDisplay } from './BossContext';
import { parseWhatsAppMessage, WhatsAppMessageBubble } from './WhatsAppMessageBubble';
import { parseEmailMessage, GmailMessageBubble } from './GmailMessageBubble';
import { parseSlackMessage, SlackMessageBubble } from './SlackMessageBubble';
import { DelegationMessageCard, parseDelegationMessage } from './DelegationMessageCard';
import { AgentChatMessageCard, parseAgentChatMessage } from './AgentChatMessageCard';
import { parseExtensionContext, ExtensionContextCard } from './ExtensionContextCard';
import { EditToolDiff, ReadToolInput, TodoWriteInput, AskQuestionInput, AskQuestionResult, ExitPlanModeInput, UnknownToolInput, ToolSearchInput, TaskCreateInput, TaskUpdateInput, MemoryOpInput, isToolSearchContent, ListFilesInput, TaskOutputWaitInput } from './ToolRenderers';
import { StreamFadeText } from './StreamFadeText';
import { TaskListView } from '../shared/TaskListView';
import { parseCurlCommand, looksLikeCurl } from './curlParser';
import { CurlCard } from './CurlCard';
import { parseTestResults } from './testResultsParser';
import { TestResultsCard } from './TestResultsCard';
import { parseHttpResults } from './httpResultsParser';
import { HttpResultsCard } from './HttpResultsCard';
import { TestRunInline } from './TestRunInline';
import { HttpRunInline, HttpRunLookup, matchHttpRunHandle } from './HttpRunInline';
import { renderContentWithImages, renderUserPromptContent, highlightText, isThumbnailableImagePath, getLocalFileImageUrl } from './contentRendering';
import { ansiToHtml } from '../../utils/ansiToHtml';
import { copyRichContentToClipboard, inlineStylesForRichCopy } from '../../utils/clipboard';
import { highlightCode } from '../FileExplorerPanel/syntaxHighlighting';
import { useTTS } from '../../hooks/useTTS';
import { Icon, type IconName } from '../Icon';
import { BashInlineToggle, BashInlineOutput } from './BashInlineOutput';
import type { EditData } from './types';
import type { ExecTask, Subagent } from '../../../shared/types';
import { SubagentInline } from './SubagentInline';
import { providerAssetUrl, providerAgentTitle, providerLabel } from '../../utils/providerDisplay';
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

interface OutputLineProps {
  output: ClaudeOutput & { _toolKeyParam?: string; _editData?: EditData; _todoInput?: string; _bashOutput?: string; _bashCommand?: string; _isRunning?: boolean };
  agentId: string | null;
  execTasks?: ExecTask[];
  testRunHandles?: TestRunHandle[];
  httpRunHandles?: HttpRunHandle[];
  subagents?: Map<string, Subagent>;
  onImageClick?: (url: string, name: string) => void;
  onFileClick?: (path: string, editData?: EditData | { highlightRange: { offset: number; limit: number } }) => void;
  onBashClick?: (command: string, output: string) => void;
  onViewMarkdown?: (content: string) => void;
  // Active global-find query. When set, assistant content is rendered as plain
  // text with the match highlighted (no markdown), mirroring HistoryLine so find
  // results look identical for live outputs and history (esp. in simple mode).
  highlight?: string;
}

// Generate a short debug hash for an output (for debugging duplicates)
function getDebugHash(output: ClaudeOutput): string {
  const textKey = output.text.slice(0, 50);
  const flags = `${output.isUserPrompt ? 'U' : ''}${output.isStreaming ? 'S' : 'F'}${output.isDelegation ? 'D' : ''}`;
  // Simple hash from text
  let hash = 0;
  for (let i = 0; i < textKey.length; i++) {
    hash = ((hash << 5) - hash) + textKey.charCodeAt(i);
    hash |= 0;
  }
  return `${flags}:${(hash >>> 0).toString(16).slice(0, 6)}`;
}

// Metadata tooltip that appears on timestamp click
function MessageMetadataTooltip({ output, debugHash, agentId, onClose }: { output: ClaudeOutput; debugHash: string; agentId: string | null; onClose: () => void }) {
  const { t } = useTranslation(['tools', 'common']);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const copyField = (value: string) => {
    navigator.clipboard.writeText(value);
  };

  const date = new Date(output.timestamp);
  const fullTime = date.toISOString();

  // Determine message type
  let msgType = 'assistant';
  if (output.isUserPrompt) msgType = 'user';
  else if (output.text.startsWith('Using tool:')) msgType = 'tool_use';
  else if (output.text.startsWith('Tool input:')) msgType = 'tool_input';
  else if (output.text.startsWith('Tool result:')) msgType = 'tool_result';
  else if (output.text.startsWith('Bash output:')) msgType = 'bash_output';
  else if (output.text.startsWith('Tokens:') || output.text.startsWith('Cost:')) msgType = 'stats';
  else if (output.text.startsWith('[thinking]')) msgType = 'thinking';
  else if (output.skillUpdate) msgType = 'skill_update';

  // Determine source - helps debug where duplicates originate
  const source = output.uuid ? 'server' : output.isUserPrompt ? 'client (user)' : 'client/system';

  // Copy all metadata as JSON for pasting into bug reports
  const copyAll = () => {
    const data: Record<string, unknown> = {
      uuid: output.uuid || null,
      hash: debugHash,
      type: msgType,
      timestamp: output.timestamp,
      iso: fullTime,
      agentId: agentId || null,
      isStreaming: output.isStreaming,
      source,
      textLen: output.text.length,
      textPreview: output.text.slice(0, 120),
    };
    if (output.isDelegation) data.isDelegation = true;
    if (output.toolName) data.toolName = output.toolName;
    if (output.toolInput) data.toolInput = output.toolInput;
    if (output.toolOutput) data.toolOutputLen = output.toolOutput.length;
    if (output.subagentName) data.subagentName = output.subagentName;
    if (output.isUserPrompt) data.isUserPrompt = true;
    if (output.skillUpdate) data.skillUpdate = output.skillUpdate;
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  };

  // Find this output's index in the store for positional debugging
  const allOutputs = agentId ? store.getState().agentOutputs.get(agentId) : null;
  const outputIndex = allOutputs ? allOutputs.indexOf(output) : -1;
  const totalOutputs = allOutputs ? allOutputs.length : 0;

  const rows: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: 'UUID', value: output.uuid || '(none)', mono: true },
    { label: 'Hash', value: debugHash, mono: true },
    { label: 'Type', value: msgType },
    { label: 'Source', value: source },
    { label: 'Agent', value: agentId || '(none)', mono: true },
    { label: 'Time', value: fullTime, mono: true },
    { label: 'Epoch', value: String(output.timestamp), mono: true },
    { label: 'Index', value: outputIndex >= 0 ? `${outputIndex} / ${totalOutputs}` : '(unknown)', mono: true },
    { label: 'Text', value: `[${output.text.length} chars] ${output.text.slice(0, 120)}`, mono: true },
  ];

  if (output.isStreaming) rows.push({ label: 'State', value: 'streaming' });
  if (output.isDelegation) rows.push({ label: 'Flag', value: 'delegation' });
  if (output.toolName) rows.push({ label: 'Tool', value: output.toolName });
  if (output.toolInput) rows.push({ label: 'ToolIn', value: JSON.stringify(output.toolInput).slice(0, 200), mono: true });
  if (output.toolOutput) rows.push({ label: 'ToolOut', value: `[${output.toolOutput.length} chars] ${output.toolOutput.slice(0, 120)}`, mono: true });
  if (output.subagentName) rows.push({ label: 'Subagent', value: output.subagentName });

  return (
    <div className="msg-meta-tooltip" ref={tooltipRef}>
      <div className="msg-meta-tooltip__header">
        <span>{t('tools:metadata.messageInfo')}</span>
        <div className="msg-meta-tooltip__actions">
          <button className="msg-meta-tooltip__copy-all" onClick={copyAll} title={t('tools:metadata.copyAllAsJSON')}>JSON</button>
          <button className="msg-meta-tooltip__close" onClick={onClose}>&times;</button>
        </div>
      </div>
      <div className="msg-meta-tooltip__body">
        {rows.map(({ label, value, mono }) => (
          <div key={label} className="msg-meta-tooltip__row">
            <span className="msg-meta-tooltip__label">{label}</span>
            <span
              className={`msg-meta-tooltip__value ${mono ? 'mono' : ''}`}
              onClick={() => copyField(value)}
              title={t('tools:metadata.clickToCopy')}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Timestamp that opens metadata tooltip on click
function TimestampWithMeta({ output, timeStr, debugHash, agentId }: { output: ClaudeOutput; timeStr: string; debugHash: string; agentId?: string | null }) {
  const { t } = useTranslation(['tools']);
  const [showMeta, setShowMeta] = useState(false);
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMeta(prev => !prev);
  }, []);
  const handleClose = useCallback(() => setShowMeta(false), []);

  return (
    <span className="output-timestamp-wrapper">
      <span
        className="output-timestamp output-timestamp--clickable"
        onClick={handleClick}
        title={t('tools:metadata.clickForMessageInfo')}
      >
        {timeStr}
      </span>
      {showMeta && <MessageMetadataTooltip output={output} debugHash={debugHash} agentId={agentId || null} onClose={handleClose} />}
    </span>
  );
}

export const OutputLine = memo(function OutputLine({ output, agentId, execTasks = [], testRunHandles = [], httpRunHandles = [], subagents, onImageClick, onFileClick, onBashClick, onViewMarkdown, highlight }: OutputLineProps) {
  const { t } = useTranslation(['tools', 'common', 'terminal']);
  const hideCost = useHideCost();
  const settings = useSettings();
  const [expandedExecTasks, setExpandedExecTasks] = useState<Set<string>>(new Set());
  const { text: rawText, isStreaming, isUserPrompt, timestamp, skillUpdate, _toolKeyParam, _editData, _todoInput, _bashOutput, _bashCommand, _isRunning } = output;
  const text = filterCostText(rawText, hideCost);

  // Extract tool info from payload (for real-time display before look-ahead completes)
  const payloadToolName = output.toolName;
  const payloadToolInput = output.toolInput;
  const payloadToolOutput = output.toolOutput;

  // Pending agent-prompts for this agent (AskUserQuestion / ExitPlanMode that
  // need a human response). Matched to this output line via toolUseId (= output.uuid).
  const pendingAgentPrompts = useAgentPrompts(agentId);
  const matchingPendingPrompt = output.uuid
    ? pendingAgentPrompts.find((p) => p.id === output.uuid)
    : undefined;

  // Fallback to extracted key param if available, otherwise try to extract from payload
  let toolKeyParamOrFallback = _toolKeyParam;
  if (!toolKeyParamOrFallback && payloadToolInput && typeof payloadToolInput === 'object') {
    const input = payloadToolInput as Record<string, unknown>;
    // For search tools, combine pattern + path for better context
    if (payloadToolName === 'Glob' && input.pattern) {
      toolKeyParamOrFallback = input.path ? `${input.pattern} in ${input.path}` : input.pattern as string;
    } else if (payloadToolName === 'Grep' && input.pattern) {
      toolKeyParamOrFallback = input.path ? `"${input.pattern}" in ${input.path}` : `"${input.pattern}"` as string;
    } else if ((payloadToolName === 'AskUserQuestion' || payloadToolName === 'AskFollowupQuestion') && input.questions) {
      const questions = input.questions as Array<{ question?: string }>;
      if (Array.isArray(questions) && questions[0]?.question) {
        toolKeyParamOrFallback = questions[0].question;
      }
    } else if ((payloadToolName === 'Task' || payloadToolName === 'Agent') && typeof input.description === 'string') {
      const desc = input.description as string;
      const agentType = input.subagent_type as string | undefined;
      toolKeyParamOrFallback = agentType ? `[${agentType}] ${desc}` : desc;
    } else if (payloadToolName === 'ExitPlanMode' || payloadToolName === 'EnterPlanMode') {
      const prompts = input.allowedPrompts as Array<{ tool?: string; prompt?: string }> | undefined;
      if (Array.isArray(prompts) && prompts.length > 0) {
        toolKeyParamOrFallback = prompts.map(p => p.prompt || p.tool || '').filter(Boolean).join(', ');
      } else if (payloadToolName === 'ExitPlanMode' && typeof input.plan === 'string' && input.plan.trim().length > 0) {
        toolKeyParamOrFallback = input.plan.trim();
      } else {
        toolKeyParamOrFallback = payloadToolName === 'ExitPlanMode' ? 'Plan ready' : 'Entering plan mode';
      }
    } else if (payloadToolName === 'spawn_agent' || payloadToolName === 'send_input' || payloadToolName === 'wait') {
      const prompt = input.prompt as string | undefined;
      const receiverIds = input.receiver_thread_ids as string[] | undefined;
      if (prompt) {
        toolKeyParamOrFallback = prompt.length > 100 ? prompt.slice(0, 97) + '...' : prompt;
      } else if (receiverIds && receiverIds.length > 0) {
        toolKeyParamOrFallback = `waiting on ${receiverIds.length} thread(s)`;
      } else if (payloadToolName === 'wait') {
        toolKeyParamOrFallback = 'waiting for subagents';
      }
    } else if (payloadToolName === 'TodoWrite' && Array.isArray(input.todos)) {
      const todos = input.todos as Array<{ status?: string }>;
      const done = todos.filter(t => t.status === 'completed').length;
      const active = todos.filter(t => t.status === 'in_progress').length;
      const pending = todos.filter(t => t.status === 'pending').length;
      const parts: string[] = [];
      if (done > 0) parts.push(`${done} done`);
      if (active > 0) parts.push(`${active} active`);
      if (pending > 0) parts.push(`${pending} pending`);
      toolKeyParamOrFallback = `${todos.length} items (${parts.join(', ')})`;
    } else {
      // Prefer extractToolKeyParam so Grok fields (target_file, target_directory)
      // resolve the same way as history tool_use rows.
      try {
        const extracted = extractToolKeyParam(
          payloadToolName || '',
          JSON.stringify(input)
        );
        if (extracted) {
          toolKeyParamOrFallback = extracted;
        }
      } catch { /* ignore */ }
      if (!toolKeyParamOrFallback) {
        toolKeyParamOrFallback = (
          input.file_path
          || input.filePath
          || input.target_file
          || input.targetFile
          || input.target_directory
          || input.targetDirectory
          || input.path
          || input.notebook_path
          || input.notebookPath
          || input.command
          || input.pattern
          || input.url
          || input.query
          || input.description
        ) as string;
      }
      // Fallback: JSON serialize for any unrecognized tool inputs
      if (!toolKeyParamOrFallback) {
        try {
          const serialized = JSON.stringify(input);
          if (serialized && serialized !== '{}') {
            toolKeyParamOrFallback = serialized.length > 200 ? serialized.slice(0, 197) + '...' : serialized;
          }
        } catch { /* ignore */ }
      }
    }
  }

  // Resolve agent name for tool attribution (prefer subagent name if present)
  const parentAgentName = agentId ? store.getState().agents.get(agentId)?.name : null;
  const agentName = output.subagentName || parentAgentName;
  const provider = agentId ? store.getState().agents.get(agentId)?.provider : undefined;
  const assistantRoleLabel = providerLabel(provider);

  // All hooks must be called before any conditional returns (Rules of Hooks)
  const [sessionExpanded, setSessionExpanded] = useState(false);
  const [subagentResultExpanded, setSubagentResultExpanded] = useState(false);
  const { toggle: toggleTTS, speaking } = useTTS();
  const markdownContentRef = useRef<HTMLDivElement>(null);
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

  // Format timestamp for display
  const timeStr = formatTimestamp(timestamp || Date.now());

  // Debug hash for identifying duplicates
  const debugHash = getDebugHash(output);

  // Handle skill update notifications with special rendering
  if (skillUpdate) {
    return (
      <div className="output-line output-skill-update">
        <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
        <span className="skill-update-icon"><Icon name="refresh" size={14} /></span>
        <span className="skill-update-label">{t('tools:skills.skillsUpdated')}</span>
        <span className="skill-update-list">
          {skillUpdate.skills.map((skill, i) => (
            <span key={skill.name} className="skill-update-item" title={skill.description}>
              {skill.name}{i < skillUpdate.skills.length - 1 ? ', ' : ''}
            </span>
          ))}
        </span>
      </div>
    );
  }

  // Handle session continuation message with special rendering
  // Use startsWith to avoid false positives when the agent's response merely mentions the phrase
  const isSessionContinuation = text.startsWith('This session is being continued from a previous conversation that ran out of context');
  if (isSessionContinuation) {
    return (
      <div
        className={`output-line output-session-continuation ${sessionExpanded ? 'expanded' : ''}`}
        onClick={() => setSessionExpanded(!sessionExpanded)}
        title="Click to expand/collapse"
      >
        <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
        <span className="session-continuation-icon"><Icon name="link" size={14} /></span>
        <span className="session-continuation-label">{t('tools:display.sessionContinued')}</span>
        <span className="session-continuation-toggle"><Icon name={sessionExpanded ? 'caret-down' : 'caret-right'} size={10} /></span>
        {sessionExpanded && (
          <div className="session-continuation-content">
            {renderContentWithImages(text, onImageClick, onFileClick)}
          </div>
        )}
      </div>
    );
  }

  // Check if this agent has a pending delegated task
  const delegation = agentId ? store.getLastDelegationReceived(agentId) : null;

  // Handle user prompts separately
  if (isUserPrompt) {
    // Hide utility slash commands like /context, /cost, /compact
    const trimmedText = text.trim();
    if (trimmedText === '/context' || trimmedText === '/cost' || trimmedText === '/compact') {
      return null;
    }

    const parsed = parseBossContext(text);
    const parsedInjected = parseInjectedInstructions(parsed.userMessage);
    const userMessage = parsedInjected.userMessage;

    // Check for [DELEGATED TASK ...] message (subordinate receiving a task)
    const delegatedTaskParsed = parseDelegatedTaskMessage(userMessage.trim());
    if (delegatedTaskParsed.isDelegatedTask) {
      return (
        <div className="output-line output-user">
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          <DelegatedTaskMessage bossName={delegatedTaskParsed.bossName} bossId={delegatedTaskParsed.bossId} taskCommand={delegatedTaskParsed.taskCommand} />
        </div>
      );
    }

    // Check for [TASK REPORT ...] message (boss receiving completion report)
    const taskReportParsed = parseTaskReportMessage(userMessage.trim());
    if (taskReportParsed.isTaskReport) {
      return (
        <div className="output-line output-user">
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          {parsed.hasContext && parsed.context && (
            <BossContext key={`boss-stream-${text.slice(0, 50)}`} context={parsed.context} onFileClick={onFileClick} />
          )}
          <TaskReportHeader
            agentName={taskReportParsed.agentName}
            agentId={taskReportParsed.agentId}
            status={taskReportParsed.status}
            summary={taskReportParsed.summary}
          />
        </div>
      );
    }

    // Check for <task-notification> blocks (background task / async subagent completion)
    const taskNotif = parseTaskNotification(userMessage.trim());
    if (taskNotif.hasNotification) {
      return (
        <div className="output-line output-user">
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
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
            <span className="history-content user-prompt-text">
              {renderUserPromptContent(taskNotif.contentWithoutNotification, onImageClick, onFileClick)}
            </span>
          )}
        </div>
      );
    }

    // Check for <subagent_notification> tags (Codex collab)
    const subagentNotif = parseSubagentNotification(userMessage.trim());
    if (subagentNotif.hasNotification) {
      return (
        <div className="output-line output-user">
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          <SubagentNotificationDisplay agentId={subagentNotif.agentId} status={subagentNotif.status} />
          {subagentNotif.contentWithoutNotification && (
            <span className="history-content user-prompt-text">
              {renderUserPromptContent(subagentNotif.contentWithoutNotification, onImageClick, onFileClick)}
            </span>
          )}
        </div>
      );
    }

    // Browser-extension context blocks (picked element / network / error /
    // attached files) → pretty cards, mirroring the extension's renderers.
    const extCtx = parseExtensionContext(userMessage);
    if (extCtx) {
      return (
        <div className="output-line output-user output-user-ext-ctx">
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          <ExtensionContextCard ctx={extCtx} onImageClick={onImageClick} />
        </div>
      );
    }

    // Agent-to-agent chat: "Message from agent <name> (<id>): <body>"
    // — sender lookup + line-clamped body with Show more toggle.
    const agentChatMsg = parseAgentChatMessage(userMessage);
    if (agentChatMsg) {
      return (
        <div className="output-line output-user output-user-agent-chat">
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          <AgentChatMessageCard
            senderName={agentChatMsg.senderName}
            senderId={agentChatMsg.senderId}
            body={agentChatMsg.body}
          />
        </div>
      );
    }

    // WhatsApp trigger payloads land as user prompts; render them as a chat bubble.
    const whatsAppMsg = parseWhatsAppMessage(userMessage);
    if (whatsAppMsg) {
      return (
        <div className="output-line output-user output-user-whatsapp">
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          <WhatsAppMessageBubble msg={whatsAppMsg} />
        </div>
      );
    }

    const slackMsg = parseSlackMessage(userMessage);
    if (slackMsg) {
      return (
        <div className="output-line output-user output-user-slack">
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          <SlackMessageBubble msg={slackMsg} />
        </div>
      );
    }

    const emailMsg = parseEmailMessage(userMessage);
    if (emailMsg) {
      return (
        <div className="output-line output-user output-user-gmail">
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          <GmailMessageBubble msg={emailMsg} />
        </div>
      );
    }

    // Check if this user prompt matches a delegated task (text matches taskCommand)
    const isDelegatedTask = delegation && text.trim() === delegation.taskCommand.trim();

    return (
      <div className={`output-line output-user${output.pendingEcho ? ' output-user-pending' : ''}`}>
        <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
        {isDelegatedTask ? (
          <DelegatedTaskHeader bossName={delegation.bossName} taskCommand={delegation.taskCommand} />
        ) : (
          <>
            <span className="output-role output-role-chip output-role-user-chip">{t('common:labels.you')}</span>
            {output.pendingEcho && (
              <span className="output-pending-echo" title="Sending…">
                <Icon name="hourglass" size={10} />
              </span>
            )}
            {parsed.hasContext && parsed.context && (
              <BossContext key={`boss-stream-${text.slice(0, 50)}`} context={parsed.context} onFileClick={onFileClick} />
            )}
            {renderUserPromptContent(parsedInjected.userMessage, onImageClick, onFileClick)}
          </>
        )}
      </div>
    );
  }

  // Compact card for boss-broadcast delegation messages ("📋 Task delegated from X:")
  // — header always visible, body line-clamps to 5 with a Show more toggle.
  if (output.isDelegation || text.startsWith('📋')) {
    const delegationParsed = parseDelegationMessage(text);
    if (delegationParsed) {
      return (
        <div className="output-line output-delegation-broadcast">
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          <DelegationMessageCard bossName={delegationParsed.bossName} body={delegationParsed.body} />
        </div>
      );
    }
  }

  // Handle tool usage with nice formatting
  if (text.startsWith('Using tool:')) {
    const toolName = text.replace('Using tool:', '').trim();
    const displayToolName = getLocalizedToolName(toolName, t);
    const iconName = getToolIconName(toolName);

    // Grok emits early tool_started with empty toolInput {}. Those cards would
    // render as bare "LIST FILES" / "TASK OUTPUT" / "READ" with no params —
    // hide until args upgrade arrives (same uuid, merge in store) OR look-ahead
    // finds a sibling "Tool input:" row (_toolKeyParam / _bashCommand / …).
    const earlyEmptyInput =
      !payloadToolInput
      || (typeof payloadToolInput === 'object'
        && !Array.isArray(payloadToolInput)
        && Object.keys(payloadToolInput as object).length === 0);
    const hasLookAheadArgs = !!(
      _toolKeyParam
      || _bashCommand
      || _editData
      || _todoInput
    );
    // Any recognized tool with no args yet should stay hidden. Empty `{}` is
    // truthy in JS, so special-case renderers below must not paint bare labels.
    if (earlyEmptyInput && !hasLookAheadArgs) {
      return null;
    }

    const recognizedTools = new Set([
      'Bash',
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'NotebookEdit',
      'Task',
      'Agent',
      'TodoWrite',
      'AskUserQuestion',
      'AskFollowupQuestion',
      'ExitPlanMode',
      'EnterPlanMode',
      'web_search',
      'WebSearch',
      'WebFetch',
      'ToolSearch',
      'ListFiles',
      'list_dir',
      'SearchFiles',
      // Grok / Tide runtime tools (have dedicated chips below)
      'get_command_or_subagent_output',
      'get_task_output',
      'spawn_subagent',
      'send_message_to_agent',
      'open_page',
      'open_page_with_find',
      // Codex subagent collab tools
      'spawn_agent',
      'send_input',
      'wait',
    ]);

    // Special case: TodoWrite shows the task list inline
    // Try _todoInput (look-ahead), then payloadToolInput (real-time WebSocket payload)
    const todoContent = _todoInput || (
      toolName === 'TodoWrite' && payloadToolInput && typeof payloadToolInput === 'object' && Array.isArray((payloadToolInput as Record<string, unknown>).todos)
        ? JSON.stringify(payloadToolInput)
        : undefined
    );
    if (toolName === 'TodoWrite') {
      // Grok early tool_started has empty toolInput — hide bare TODOWRITE chip
      // until args upgrade (or look-ahead) arrives. Same idea as Read/Edit/Bash.
      if (!todoContent) {
        return null;
      }
      // Prefer agent.latestTodos as prior snapshot so Grok merge:true status-only
      // updates still show content from the last full TodoWrite.
      const priorTodos = agentId
        ? (store.getState().agents.get(agentId)?.latestTodos || [])
        : [];
      return (
        <div className={`output-line output-tool-use output-todo-inline ${isStreaming ? 'output-streaming' : ''}`}>
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
          <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
          <span className="output-tool-name">{displayToolName}</span>
          <TodoWriteInput content={todoContent} priorTodos={priorTodos} />
        </div>
      );
    }

    // Special case: AskUserQuestion shows questions with options inline
    const askQuestionContent = (
      (toolName === 'AskUserQuestion' || toolName === 'AskFollowupQuestion') && payloadToolInput && typeof payloadToolInput === 'object' && Array.isArray((payloadToolInput as Record<string, unknown>).questions)
        ? JSON.stringify(payloadToolInput)
        : undefined
    );
    if ((toolName === 'AskUserQuestion' || toolName === 'AskFollowupQuestion') && askQuestionContent) {
      return (
        <div className={`output-line output-tool-use output-ask-question-inline ${isStreaming ? 'output-streaming' : ''}`}>
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
          <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
          <span className="output-tool-name">{displayToolName}</span>
          <AskQuestionInput content={askQuestionContent} pendingPromptId={matchingPendingPrompt?.id} />
        </div>
      );
    }

    // Special case: ExitPlanMode renders plan markdown inline
    const exitPlanContent = (
      toolName === 'ExitPlanMode' && payloadToolInput && typeof payloadToolInput === 'object' && typeof (payloadToolInput as Record<string, unknown>).plan === 'string'
        ? JSON.stringify(payloadToolInput)
        : undefined
    );
    if (toolName === 'ExitPlanMode' && exitPlanContent) {
      return (
        <div className={`output-line output-tool-use output-plan-inline ${isStreaming ? 'output-streaming' : ''}`}>
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
          <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
          <span className="output-tool-name">{displayToolName}</span>
          <ExitPlanModeInput content={exitPlanContent} pendingPromptId={matchingPendingPrompt?.id} onViewMarkdown={onViewMarkdown} />
        </div>
      );
    }

    const taskCreateContent = (
      toolName === 'TaskCreate' && payloadToolInput !== undefined
        ? (typeof payloadToolInput === 'string' ? payloadToolInput : JSON.stringify(payloadToolInput))
        : undefined
    );
    if (toolName === 'TaskCreate' && taskCreateContent) {
      return (
        <div className={`output-line output-tool-use output-task-inline ${isStreaming ? 'output-streaming' : ''}`}>
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
          <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
          <span className="output-tool-name">{displayToolName}</span>
          <TaskCreateInput content={taskCreateContent} />
        </div>
      );
    }

    const taskUpdateContent = (
      toolName === 'TaskUpdate' && payloadToolInput && typeof payloadToolInput === 'object'
        ? JSON.stringify(payloadToolInput)
        : undefined
    );
    if (toolName === 'TaskUpdate' && taskUpdateContent) {
      // Prefer the server-maintained task snapshot (agent.latestTodos mirrors
      // TaskCreate/TaskUpdate state) so the line renders the same consolidated
      // Task List card as TodoWrite. Overlay this update's status locally in
      // case the agent-store broadcast hasn't landed yet.
      const ti = payloadToolInput as Record<string, unknown>;
      const rawId = ti.taskId ?? ti.task_id ?? ti.id;
      const updId = (typeof rawId === 'string' || typeof rawId === 'number') ? String(rawId) : undefined;
      const updStatus: 'pending' | 'in_progress' | 'completed' | undefined =
        ti.status === 'pending' || ti.status === 'in_progress' || ti.status === 'completed'
          ? ti.status
          : undefined;
      const snapshot = (agentId ? (store.getState().agents.get(agentId)?.latestTodos || []) : [])
        .filter((t) => !(ti.status === 'deleted' && t.id === updId))
        .map((t) => (updId && updStatus && t.id === updId ? { ...t, status: updStatus } : t));
      return (
        <div className={`output-line output-tool-use output-task-inline ${isStreaming ? 'output-streaming' : ''}`}>
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
          <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
          <span className="output-tool-name">{displayToolName}</span>
          {snapshot.length > 0
            ? <TaskListView todos={snapshot} />
            : <TaskUpdateInput content={taskUpdateContent} />}
        </div>
      );
    }
    // Special case: ToolSearch renders formatted params instead of raw JSON
    const toolSearchContent = (
      toolName === 'ToolSearch' && payloadToolInput && typeof payloadToolInput === 'object'
        ? JSON.stringify(payloadToolInput)
        : undefined
    );
    if (toolName === 'ToolSearch' && toolSearchContent) {
      return (
        <div className={`output-line output-tool-use output-toolsearch-inline ${isStreaming ? 'output-streaming' : ''}`}>
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          <span className="output-tool-icon"><Icon name="bolt" size={14} /></span>
          <span className="output-tool-name">ToolSearch</span>
          <ToolSearchInput content={toolSearchContent} agentName={agentName} />
        </div>
      );
    }

    // ListFiles / list_dir — folder path chip (no raw JSON dump)
    if (toolName === 'ListFiles' || toolName === 'list_dir') {
      const listInput = payloadToolInput && typeof payloadToolInput === 'object' && !Array.isArray(payloadToolInput)
        ? payloadToolInput as Record<string, unknown>
        : null;
      // Empty early `{}` is truthy — must still fall through to look-ahead keyParam.
      const fromInput = listInput
        ? String(listInput.target_directory || listInput.targetDirectory || listInput.path || listInput.directory || '')
        : '';
      const listDir = fromInput || _toolKeyParam || '';
      if (!listDir) {
        return null;
      }
      const listContent = fromInput && listInput
        ? JSON.stringify(listInput)
        : JSON.stringify({ target_directory: listDir });
      return (
        <div className={`output-line output-tool-use output-list-files-inline ${isStreaming ? 'output-streaming' : ''}`}>
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
          <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
          <span className="output-tool-name">{displayToolName}</span>
          <ListFilesInput
            content={listContent}
            onFileClick={onFileClick ? (p) => onFileClick(p) : undefined}
          />
        </div>
      );
    }

    // get_command_or_subagent_output — task wait chips
    if (toolName === 'get_command_or_subagent_output' || toolName === 'get_task_output') {
      const waitInput = payloadToolInput && typeof payloadToolInput === 'object' && !Array.isArray(payloadToolInput)
        ? payloadToolInput as Record<string, unknown>
        : null;
      const idsRaw = waitInput
        ? (waitInput.task_ids ?? waitInput.taskIds ?? waitInput.task_id ?? waitInput.taskId)
        : undefined;
      const hasIds = Array.isArray(idsRaw)
        ? idsRaw.length > 0
        : typeof idsRaw === 'string' && idsRaw.length > 0;
      // Prefer payload; if early `{}`, use look-ahead keyParam (task id summary).
      if (!hasIds && !_toolKeyParam) {
        return null;
      }
      const waitContent = hasIds && waitInput
        ? JSON.stringify(waitInput)
        : JSON.stringify({ task_ids: _toolKeyParam ? [_toolKeyParam] : [] });
      return (
        <div className={`output-line output-tool-use output-task-wait-inline ${isStreaming ? 'output-streaming' : ''}`}>
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
          <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
          <span className="output-tool-name">{displayToolName}</span>
          <TaskOutputWaitInput content={waitContent} />
        </div>
      );
    }

    // Codex subagent collab tools: spawn_agent, send_input, wait
    const collabTools = ['spawn_agent', 'send_input', 'wait'];
    if (collabTools.includes(toolName)) {
      const collabInput = payloadToolInput as Record<string, unknown> | undefined;
      const prompt = collabInput?.prompt as string | undefined;
      const receiverIds = collabInput?.receiver_thread_ids as string[] | undefined;
      const promptPreview = prompt
        ? (prompt.length > 120 ? prompt.slice(0, 117) + '...' : prompt)
        : undefined;

      const collabLabel = toolName === 'spawn_agent' ? 'Spawn Agent'
        : toolName === 'send_input' ? 'Send Input'
        : 'Wait';

      return (
        <div className={`output-line output-tool-use output-collab-tool output-collab-${toolName} ${isStreaming ? 'output-streaming' : ''}`}>
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
          <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
          <span className="output-tool-name collab-tool-name">{collabLabel}</span>
          {receiverIds && receiverIds.length > 0 && (
            <span className="collab-thread-ids">
              {receiverIds.map(id => id.slice(-8)).join(', ')}
            </span>
          )}
          {promptPreview && (
            <span className="collab-prompt-preview" title={prompt}>{promptPreview}</span>
          )}
        </div>
      );
    }

    const unknownToolContent = payloadToolInput && typeof payloadToolInput === 'object'
      ? JSON.stringify(payloadToolInput, null, 2)
      : undefined;

    // Check if this tool uses file paths that should be clickable
    const fileTools = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'NotebookEdit'];
    const isFileTool = fileTools.includes(toolName);

    const payloadInputRecord = (payloadToolInput && typeof payloadToolInput === 'object')
      ? payloadToolInput as Record<string, unknown>
      : null;

    const payloadFilePath = payloadInputRecord
      ? (
          (typeof payloadInputRecord.file_path === 'string' ? payloadInputRecord.file_path : undefined)
          || (typeof payloadInputRecord.filePath === 'string' ? payloadInputRecord.filePath : undefined)
          || (typeof payloadInputRecord.target_file === 'string' ? payloadInputRecord.target_file : undefined)
          || (typeof payloadInputRecord.targetFile === 'string' ? payloadInputRecord.targetFile : undefined)
          || (typeof payloadInputRecord.path === 'string' ? payloadInputRecord.path : undefined)
          || (typeof payloadInputRecord.notebook_path === 'string' ? payloadInputRecord.notebook_path : undefined)
          || (typeof payloadInputRecord.notebookPath === 'string' ? payloadInputRecord.notebookPath : undefined)
          || (typeof payloadInputRecord.target_directory === 'string' ? payloadInputRecord.target_directory : undefined)
          || (typeof payloadInputRecord.targetDirectory === 'string' ? payloadInputRecord.targetDirectory : undefined)
        )
      : undefined;

    const resolvedFilePathForClick = _toolKeyParam || payloadFilePath;
    // File tools always have a file path as keyParam (even root-level files like "README.md" without slashes)
    const isFilePath = !!resolvedFilePathForClick && (isFileTool || resolvedFilePathForClick.startsWith('/') || resolvedFilePathForClick.includes('/'));
    const isFileClickable = isFileTool && isFilePath && onFileClick;

    // When Read targets an image, show an inline thumbnail preview below the line.
    const readImageThumb = (toolName === 'Read' && isFilePath && resolvedFilePathForClick && isThumbnailableImagePath(resolvedFilePathForClick))
      ? { url: getLocalFileImageUrl(resolvedFilePathForClick), name: getBasenameFromPath(resolvedFilePathForClick) }
      : null;

    const editDataFallback = (toolName === 'Edit' && payloadInputRecord)
      ? {
          oldString: String(payloadInputRecord.old_string ?? ''),
          newString: String(payloadInputRecord.new_string ?? ''),
          operation: typeof payloadInputRecord.operation === 'string' ? payloadInputRecord.operation : undefined,
        }
      : undefined;

    const readRangeFallback = (toolName === 'Read' && payloadInputRecord && typeof payloadInputRecord.offset === 'number' && typeof payloadInputRecord.limit === 'number')
      ? { highlightRange: { offset: payloadInputRecord.offset, limit: payloadInputRecord.limit } }
      : undefined;

    // Bash is identified by tool name; click handler is optional for display.
    const isBashTool = toolName === 'Bash';
    const hasBashOutput = !!_bashOutput || !!payloadToolOutput;
    const bashDescription =
      payloadInputRecord && typeof payloadInputRecord.description === 'string'
        ? payloadInputRecord.description.trim()
        : '';
    const bashCommand = _bashCommand || _toolKeyParam || toolKeyParamOrFallback || bashDescription || '';
    const displayCommand = bashCommand ? extractExecWrappedCommand(bashCommand) : '';
    // Empty Bash chip (no command/description) — don't render a blank row.
    if (isBashTool && !bashCommand) {
      return null;
    }
    const isCurlExecCommand = /\bcurl\b[\s\S]*\/api\/exec\b/.test(bashCommand);


    // Show only the MOST RECENT exec task that started shortly after this bash command
    const bashTimestampMs = timestamp ? new Date(timestamp).getTime() : 0;
    // Extract the inner command from the curl payload for accurate matching
    const execInnerCommand = isCurlExecCommand ? extractExecPayloadCommand(bashCommand) : null;
    const matchingExecTasks = isCurlExecCommand && execTasks.length > 0
      ? (() => {
          // Primary: match by command name (most reliable, avoids cross-task duplication)
          if (execInnerCommand) {
            const commandMatches = execTasks.filter((task) => task.command === execInnerCommand);
            if (commandMatches.length > 0) {
              // Return only the most recent command match
              const mostRecent = commandMatches.reduce((latest, current) =>
                current.startedAt > latest.startedAt ? current : latest
              );
              return [mostRecent];
            }
          }
          // Fallback: time-window matching (within 5 seconds after bash command)
          const tasksAfterBash = execTasks.filter(
            (task) => task.startedAt >= bashTimestampMs && task.startedAt <= bashTimestampMs + 5000
          );
          if (tasksAfterBash.length > 0) {
            // Return only the most recent one
            const mostRecent = tasksAfterBash.reduce((latest, current) =>
              current.startedAt > latest.startedAt ? current : latest
            );
            return [mostRecent];
          }
          return [];
        })()
      : [];
    const showInlineRunningTasks = Boolean(isBashTool && isCurlExecCommand && matchingExecTasks.length > 0);
    const _truncatedTaskCommand = (value: string) => (value.length > 52 ? `${value.slice(0, 52)}...` : value);

    // A `curl … POST /api/tests/run` line → stream the matching test run inline
    // (like an exec task). Match by time window since the runId isn't in the command.
    // `/api/tests/run` but not `/api/tests/runs/` (the poll endpoint).
    const isTestRunCurl = Boolean(
      isBashTool && bashCommand && looksLikeCurl(bashCommand) && /\/api\/tests\/run(?!s)/.test(bashCommand)
    );
    const matchingTestRunId = isTestRunCurl && testRunHandles.length > 0
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

    // A `curl … POST /api/http-requests/run` line → live inline result card.
    // `/run` but not `/runs/` (the stored-run endpoint).
    const isHttpRunCurl = Boolean(
      isBashTool && bashCommand && looksLikeCurl(bashCommand) && /\/api\/http-requests\/run(?!s)/.test(bashCommand)
    );
    const matchingHttpRunId = isHttpRunCurl && bashCommand
      ? matchHttpRunHandle(httpRunHandles, bashCommand, bashTimestampMs)
      : null;

    // Match Task/Agent tool line to its subagent via uuid (which equals toolUseId)
    const matchingSubagent = (toolName === 'Task' || toolName === 'Agent') && subagents && output.uuid
      ? (() => {
          for (const [, sub] of subagents) {
            if (sub.toolUseId === output.uuid) return sub;
          }
          return undefined;
        })()
      : undefined;
    const bashSearchCommand = isBashTool && bashCommand ? parseBashSearchCommand(bashCommand) : null;
    const bashNotificationCommand = isBashTool && bashCommand ? parseBashNotificationCommand(bashCommand) : null;
    const bashTrackingStatusCommand = isBashTool && bashCommand ? parseBashTrackingStatusCommand(bashCommand) : null;
    const bashTaskLabelCommand = !bashTrackingStatusCommand && isBashTool && bashCommand ? parseBashTaskLabelCommand(bashCommand) : null;
    const bashReportTaskCommand = isBashTool && bashCommand ? parseBashReportTaskCommand(bashCommand) : null;
    const bashMemoryCommand = isBashTool && bashCommand && !bashTrackingStatusCommand && !bashTaskLabelCommand && !bashReportTaskCommand ? parseBashMemoryCommand(bashCommand) : null;
    const bashMemoryResponse = bashMemoryCommand ? parseMemoryResponseInfo(_bashOutput || (typeof payloadToolOutput === 'string' ? payloadToolOutput : undefined)) : undefined;
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

    const handleParamClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isFileClickable && resolvedFilePathForClick) {
        const editData = _editData || editDataFallback;
        if (toolName === 'Edit' && editData) {
          onFileClick(resolvedFilePathForClick, editData);
        } else if (toolName === 'Read' && readRangeFallback) {
          onFileClick(resolvedFilePathForClick, readRangeFallback);
        } else {
          onFileClick(resolvedFilePathForClick);
        }
      }
    };

    const handleBashClick = () => {
      if (isBashTool && bashCommand && onBashClick) {
        // If command is still running (no output yet), show loading message
        const outputMessage = _isRunning
          ? t('tools:display.running')
          : (_bashOutput || t('tools:display.noOutputCaptured'));
        onBashClick(bashCommand, outputMessage);
      }
    };

    const renderBashCommandWithFileLinks = () => {
      if (!displayCommand) return null;
      if (!onFileClick) {
        return <span dangerouslySetInnerHTML={{ __html: highlightCode(displayCommand, 'bash') }} />;
      }

      const agentCwd = agentId ? store.getState().agents.get(agentId)?.cwd : undefined;
      const segments = splitCommandForFileLinks(displayCommand);

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

    return (
      <>
        <div
          className={`output-line output-tool-use ${isStreaming ? 'output-streaming' : ''} ${isBashTool && onBashClick ? 'bash-clickable' : ''} ${bashNotificationCommand ? 'bash-notify-use' : ''} ${bashTrackingStatusCommand ? 'bash-tracking-use' : ''}`}
          onClick={isBashTool && onBashClick ? handleBashClick : undefined}
          title={isBashTool && onBashClick ? t('tools:display.clickToViewOutput') : undefined}
        >
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
          <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
          <span className="output-tool-name">{displayToolName}</span>

          {/* For Bash tools, show the command inline (more useful than file paths) */}
          {isBashTool && bashCommand && (
            bashTrackingStatusCommand ? (() => {
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
            })() : bashNotificationCommand ? (
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
            ) : bashTaskLabelCommand ? (
              <span
                className="output-tool-param bash-command bash-task-label-param"
                onClick={handleBashClick}
                title={bashTaskLabelCommand.commandBody}
                style={{ cursor: 'pointer' }}
              >
                <span className="bash-task-label-chip"><Icon name="task" size={12} /> task</span>
                <span className="bash-task-label-value">{bashTaskLabelCommand.taskLabel}</span>
              </span>
            ) : bashReportTaskCommand ? (
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
            ) : bashMemoryCommand ? (
              <span
                className="output-tool-param bash-command bash-memory-param"
                onClick={handleBashClick}
                style={{ cursor: 'pointer' }}
              >
                <MemoryOpInput info={bashMemoryCommand} response={bashMemoryResponse} />
              </span>
            ) : bashSearchCommand ? (
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
            ) : bashCurlParsed ? (
              <div className="output-tool-param bash-curl-param">
                <CurlCard parsed={bashCurlParsed} rawCommand={bashCommand} />
              </div>
            ) : (
              <span
                className="output-tool-param bash-command"
                onClick={handleBashClick}
                title={t('tools:display.clickToViewOutput')}
                style={{ cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.9em', color: '#888' }}
              >
                {renderBashCommandWithFileLinks()}
              </span>
            )
          )}

          {/* For file tools, show the file path with SVG file icon */}
          {!isBashTool && toolKeyParamOrFallback && (
            <span
              className={`output-tool-param ${isFileClickable ? 'clickable-path' : ''}`}
              onClick={isFileClickable ? handleParamClick : undefined}
              title={isFileClickable ? (toolName === 'Edit' && (_editData || editDataFallback) ? t('tools:display.clickToViewDiff') : t('tools:display.clickToViewFile')) : toolKeyParamOrFallback}
              style={isFileClickable ? { cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' } : undefined}
            >
              {isFileTool && isFilePath && (() => {
                const ext = getExtFromPath(resolvedFilePathForClick!);
                const iconPath = ext ? getIconForExtension(ext) : '';
                return iconPath ? <img className="output-tool-file-icon" src={iconPath} alt="" /> : null;
              })()}
              {['Read', 'Write', 'Edit', 'NotebookEdit'].includes(toolName) && isFilePath ? getBasenameFromPath(toolKeyParamOrFallback) : toolKeyParamOrFallback}
            </span>
          )}

          {isBashTool && _isRunning && (
            <span className="bash-output-indicator bash-output-indicator--running">
              <span className="bash-spinner" />
            </span>
          )}
          {isBashTool && !_isRunning && (
            <span className="bash-output-indicator">
              <Icon name={execTasks.some(t => t.status === 'completed') ? 'success' : (hasBashOutput ? 'file-text' : 'terminal')} size={12} />
            </span>
          )}
          {isBashTool && <BashInlineToggle enabled={settings.inlineBashOutputs} />}
          {isStreaming && <span className="output-tool-loading">...</span>}
        </div>

        {/* Global inline-output mode: show the captured output right below the
            command. Skipped for rows that already stream their result inline
            (exec tasks, test runs, HTTP run cards). */}
        {isBashTool && settings.inlineBashOutputs && !_isRunning
          && !showInlineRunningTasks && !matchingTestRunId && !matchingHttpRunId && (
          <BashInlineOutput text={_bashOutput || (typeof payloadToolOutput === 'string' ? payloadToolOutput : '')} />
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

        {!recognizedTools.has(toolName) && unknownToolContent && (
          <div className="output-line output-tool-input output-tool-input-fallback">
            <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
            <UnknownToolInput toolName={toolName} content={unknownToolContent} />
          </div>
        )}

        {/* Exec task output below bash command line */}
        {showInlineRunningTasks && (
          <div className="exec-task-output-container">
            {matchingExecTasks.map((task) => {
              const isExpanded = expandedExecTasks.has(task.taskId);
              const lastLines = task.output.slice(-6);
              const isCollapsed = task.output.length > 6;
              const displayLines = isExpanded ? task.output : lastLines;

              return (
                <div key={task.taskId} className={`exec-task-inline status-${task.status}`}>
                  {/* Collapse/expand toggle */}
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

                  {/* Output lines */}
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

        {/* Live test-run suite/test tree below the `curl /api/tests/run` line */}
        {matchingTestRunId && (
          <div className="exec-task-output-container">
            <TestRunInline runId={matchingTestRunId} />
          </div>
        )}

        {/* Live HTTP-request result card below the `curl /api/http-requests/run`
            line; without an in-store run (reload / no agentId) reconstruct it
            from the persisted history. */}
        {matchingHttpRunId ? (
          <div className="exec-task-output-container">
            <HttpRunInline runId={matchingHttpRunId} />
          </div>
        ) : isHttpRunCurl && bashCommand ? (
          <div className="exec-task-output-container">
            <HttpRunLookup command={bashCommand} timestampMs={bashTimestampMs} />
          </div>
        ) : null}

        {/* Inline subagent activity panel below Task tool line */}
        {matchingSubagent && <SubagentInline subagent={matchingSubagent} />}
      </>
    );
  }

  // Handle tool input with nice formatting
  if (text.startsWith('Tool input:')) {
    const inputText = text.replace('Tool input:', '').trim();

    if (isToolSearchContent(inputText)) {
      return (
        <div className="output-line output-tool-input">
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          <ToolSearchInput content={inputText} agentName={agentName} />
        </div>
      );
    }

    // Check if it's an Edit tool input
    try {
      const parsed = JSON.parse(inputText);
      if (parsed.file_path && (parsed.old_string !== undefined || parsed.new_string !== undefined)) {
        return (
          <div className="output-line output-tool-input">
            <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
            <EditToolDiff content={inputText} onFileClick={onFileClick} />
          </div>
        );
      }
      if (parsed.file_path && parsed.old_string === undefined && parsed.new_string === undefined) {
        return (
          <div className="output-line output-tool-input">
            <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
            <ReadToolInput content={inputText} onFileClick={onFileClick} />
          </div>
        );
      }
      if (Array.isArray(parsed.todos)) {
        const priorTodos = agentId
          ? (store.getState().agents.get(agentId)?.latestTodos || [])
          : [];
        return (
          <div className="output-line output-tool-input">
            <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
            <TodoWriteInput content={inputText} priorTodos={priorTodos} />
          </div>
        );
      }
    } catch {
      /* Not JSON */
    }

    return (
      <div className="output-line output-tool-input">
        <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
        <UnknownToolInput toolName={payloadToolName || 'UnknownTool'} content={inputText} />
      </div>
    );
  }

  // Handle tool result with nice formatting
  if (text.startsWith('Tool result:')) {
    const resultText = text.replace('Tool result:', '').trim();
    const testCard = parseTestResults(resultText);
    if (testCard) {
      return (
        <div className="output-line output-tool-result">
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          <TestResultsCard data={testCard} />
        </div>
      );
    }
    const httpCard = parseHttpResults(resultText);
    if (httpCard) {
      return (
        <div className="output-line output-tool-result">
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          <HttpResultsCard data={httpCard} />
        </div>
      );
    }
    const isError = resultText.toLowerCase().includes('error') || resultText.toLowerCase().includes('failed');
    if (output.toolName === 'AskUserQuestion' || output.toolName === 'AskFollowupQuestion') {
      return (
        <div className={`output-line output-tool-result ${isError ? 'is-error' : ''}`}>
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          <AskQuestionResult content={resultText} />
        </div>
      );
    }
    return (
      <div className={`output-line output-tool-result ${isError ? 'is-error' : ''}`}>
        <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
        <span className="output-result-icon"><Icon name={isError ? 'failure' : 'check'} size={12} /></span>
        <pre className="output-result-content">{resultText}</pre>
      </div>
    );
  }

  // Handle Bash command output with terminal-like styling
  if (text.startsWith('Bash output:')) {
    const bashOutput = text.replace('Bash output:', '').trim();
    const testCard = parseTestResults(bashOutput);
    if (testCard) {
      return (
        <div className="output-line output-tool-result">
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          <TestResultsCard data={testCard} />
        </div>
      );
    }
    const httpCard = parseHttpResults(bashOutput);
    if (httpCard) {
      return (
        <div className="output-line output-tool-result">
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          <HttpResultsCard data={httpCard} />
        </div>
      );
    }
    const isError = bashOutput.toLowerCase().includes('error') ||
                    bashOutput.toLowerCase().includes('failed') ||
                    bashOutput.toLowerCase().includes('command not found') ||
                    bashOutput.toLowerCase().includes('permission denied');
    const isTruncated = bashOutput.includes('... (truncated,');
    return (
      <div className={`output-line output-bash-result ${isError ? 'is-error' : ''}`}>
        <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
        <div className="bash-output-container">
          <div className="bash-output-header">
            <span className="bash-output-icon">$</span>
            <span className="bash-output-label">{t('tools:display.terminalOutput')}</span>
            {isTruncated && <span className="bash-output-truncated">{t('tools:display.truncated')}</span>}
          </div>
          <pre className="bash-output-content" dangerouslySetInnerHTML={{ __html: ansiToHtml(bashOutput) }} />
        </div>
      </div>
    );
  }

  // Hide /context command output - context is now shown in the status bar
  const isContextOutput =
    text.includes('## Context Usage') ||
    (text.includes('Context Usage') && text.includes('Tokens:') && text.includes('Free space'));

  if (isContextOutput) {
    return null;
  }

  // Render the /compact command stdout as a small "Context compacted" pill
  if (text.includes('<local-command-stdout>')) {
    const stdoutMatch = text.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
    if (stdoutMatch) {
      const stripped = stdoutMatch[1].replace(/\x1b?\[\d+m/g, '').trim();
      if (stripped === 'Compacted') {
        return (
          <div className="output-line output-compacted-notice">
            <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
            <span className="compacted-icon"><Icon name="archive" size={14} /></span>
            <span className="compacted-label">{t('terminal:history.compactedLabel')}</span>
          </div>
        );
      }
    }
  }

  // Hide local-command tags for utility commands
  if (
    text.includes('<local-command-caveat>') ||
    text.includes('<command-name>/context</command-name>') ||
    text.includes('<command-name>/cost</command-name>') ||
    text.includes('<command-name>/compact</command-name>')
  ) {
    return null;
  }

  const isThinking = text.startsWith('[thinking]');
  const systemMessageMatch = text.match(/^\s*([\u{1F300}-\u{1FAFF}\u2600-\u27BF])?\s*\[System\]([\s\S]*)$/u);
  const isSystemMessage = Boolean(systemMessageMatch);
  const systemEmoji = systemMessageMatch?.[1];
  const systemRest = systemMessageMatch?.[2] ?? '';
  const systemIconName: IconName =
    systemEmoji === '🔄' ? 'refresh'
      : systemEmoji === '📋' ? 'task'
        : systemEmoji === '🛑' ? 'warn'
          : systemEmoji === '⚠' || systemEmoji === '⚠️' ? 'warn'
            : systemEmoji === '❌' ? 'cross'
              : systemEmoji === '✅' ? 'check'
                : 'info';
  const systemVariantClass =
    systemEmoji === '🛑' ? ' output-system--interrupt'
      : systemEmoji === '❌' ? ' output-system--error'
        : systemEmoji === '⚠' || systemEmoji === '⚠️' ? ' output-system--warn'
          : systemEmoji === '✅' ? ' output-system--success'
            : '';

  // Detect subagent completion messages with full result content
  const subagentCompletionMatch = output.subagentName && payloadToolOutput ? text.match(/^([✅❌])\s*(Subagent\s[\s\S]*)$/) : null;
  const isSubagentCompletion = Boolean(subagentCompletionMatch);
  const subagentSuccess = subagentCompletionMatch?.[1] === '✅';
  const subagentDisplayText = subagentCompletionMatch?.[2] ?? text;

  // Categorize other output types
  let className = 'output-line';
  let useMarkdown = true;
  let isClaudeMessage = false;

  if (output.isError) {
    className += ' output-text output-error';
    useMarkdown = false;
  } else if (text.startsWith('Session started:') || text.startsWith('Session initialized')) {
    className += ' output-session';
    useMarkdown = false;
  } else if (text.startsWith('Tokens:') || text.startsWith('Cost:')) {
    className += ' output-stats';
    useMarkdown = false;
  } else if (isThinking) {
    // Rendered via ThinkingBlock below (early return)
    useMarkdown = false;
  } else if (text.startsWith('[raw]')) {
    className += ' output-raw';
    useMarkdown = false;
  } else if (isSystemMessage) {
    className += ' output-text output-system' + systemVariantClass;
  } else {
    className += ' output-text output-claude markdown-content';
    isClaudeMessage = true;
  }

  if (isStreaming) {
    className += ' output-streaming';
  }

  // For assistant messages, check for delegation blocks and work-plan blocks
  if (isClaudeMessage && !isStreaming) {
    const delegationParsed = parseDelegationBlock(text);
    const workPlanParsed = parseWorkPlanBlock(delegationParsed.contentWithoutBlock);

    if (delegationParsed.hasDelegation || workPlanParsed.hasWorkPlan) {
      return (
        <div className={className}>
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          <span className="output-role">
            {provider && (
              <img
                src={providerAssetUrl(provider, import.meta.env.BASE_URL)}
                alt=""
                className="output-role-icon"
                title={providerAgentTitle(provider)}
              />
            )}
            {assistantRoleLabel}
          </span>
          <div ref={markdownContentRef} className="markdown-content">
            {renderContentWithImages(workPlanParsed.contentWithoutBlock, onImageClick, onFileClick)}
          </div>
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
          <div className="message-action-btns">
            {settings.experimentalTTS && (
              <button
                className="history-speak-btn"
                onClick={(e) => { e.stopPropagation(); toggleTTS(text); }}
                title={speaking ? 'Stop speaking' : 'Speak (Spanish)'}
              >
                <Icon name={speaking ? 'speaker-on' : 'speaker-off'} size={14} />
              </button>
            )}
            {onViewMarkdown && (
              <button
                className="history-view-md-btn"
                onClick={(e) => { e.stopPropagation(); onViewMarkdown(payloadToolOutput || text); }}
                title="View as Markdown"
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
  }

  // Defensive net: a Codex assistant message whose body is an empty content
  // payload (e.g. [{"type":"output_text","text":""}]) should never render as
  // raw JSON. The server normally strips these, so drop the line entirely.
  if (isClaudeMessage && !isStreaming && isEmptyCodexPayloadText(text)) {
    return null;
  }

  if (isThinking) {
    return (
      <ThinkingBlock
        text={text}
        isStreaming={isStreaming}
        agentId={agentId ?? undefined}
        agentName={agentName}
        provider={provider}
        timeStr={timeStr}
        timestampTitle={`${timestamp || Date.now()} | ${debugHash}`}
        onImageClick={onImageClick}
        onFileClick={onFileClick}
      />
    );
  }

  const outputRoleLabel = isClaudeMessage ? assistantRoleLabel : (isSystemMessage ? t('tools:display.system') : null);

  return (
    <div className={className}>
      <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
      {outputRoleLabel && (
        <span className="output-role">
          {isClaudeMessage && provider && (
            <img
              src={providerAssetUrl(provider, import.meta.env.BASE_URL)}
              alt=""
              className="output-role-icon"
              title={providerAgentTitle(provider)}
            />
          )}
          {outputRoleLabel}
        </span>
      )}
      {useMarkdown ? (
        <div ref={markdownContentRef} className="markdown-content">
          {isSubagentCompletion ? (
            <>
              <Icon name={subagentSuccess ? 'status-success' : 'status-error'} size={14} weight="fill" color={subagentSuccess ? '#4ade80' : '#f87171'} />
              {' '}
              {highlight ? highlightText(subagentDisplayText, highlight) : renderContentWithImages(subagentDisplayText, onImageClick, onFileClick)}
            </>
          ) : isSystemMessage && systemEmoji ? (
            <>
              <Icon name={systemIconName} size={14} />
              {' '}
              {highlight ? highlightText(`[System]${systemRest}`, highlight) : renderContentWithImages(`[System]${systemRest}`, onImageClick, onFileClick)}
            </>
          ) : highlight ? (
            <div>{highlightText(text, highlight)}</div>
          ) : (
            // Streaming: word fade. Final/complete: soft block fade when the
            // answer never word-streamed (e.g. streamTextLive off, or a single
            // isStreaming:false payload after tools). fadeId keeps the fade to
            // one play per row per session — virtualizer remounts stay static.
            <StreamFadeText
              text={text}
              isStreaming={!!isStreaming}
              fadeId={output.uuid ? `${agentId ?? ''}:${output.uuid}` : undefined}
              renderComplete={(t) => renderContentWithImages(t, onImageClick, onFileClick)}
            />
          )}
        </div>
      ) : (
        <StreamFadeText
          text={text}
          isStreaming={!!isStreaming}
          fadeId={output.uuid ? `${agentId ?? ''}:${output.uuid}` : undefined}
        />
      )}
      {isSubagentCompletion && payloadToolOutput && (
        <div className="subagent-result-section">
          <button
            className="subagent-result-toggle"
            onClick={(e) => { e.stopPropagation(); setSubagentResultExpanded(!subagentResultExpanded); }}
          >
            <span className="subagent-result-arrow"><Icon name={subagentResultExpanded ? 'caret-down' : 'caret-right'} size={10} /></span>
            {subagentResultExpanded ? 'Hide result' : 'Show result'}
          </button>
          {subagentResultExpanded && (
            <div className="subagent-result-content markdown-content">
              {renderContentWithImages(payloadToolOutput, onImageClick, onFileClick)}
            </div>
          )}
        </div>
      )}
      {isClaudeMessage && !isStreaming && (
        <div className="message-action-btns">
          {settings.experimentalTTS && (
            <button
              className="history-speak-btn"
              onClick={(e) => { e.stopPropagation(); toggleTTS(text); }}
              title={speaking ? 'Stop speaking' : 'Speak (Spanish)'}
            >
              <Icon name={speaking ? 'speaker-on' : 'speaker-off'} size={14} />
            </button>
          )}
          {onViewMarkdown && (
            <button
              className="history-view-md-btn"
              onClick={(e) => { e.stopPropagation(); onViewMarkdown(payloadToolOutput || text); }}
              title="View as Markdown"
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
