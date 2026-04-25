/**
 * OutputLine component for rendering live streaming output
 */

import React, { memo, useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useHideCost, useSettings, ClaudeOutput, store } from '../../store';
import { filterCostText } from '../../utils/formatting';
import { getToolIconName, extractExecWrappedCommand, extractExecPayloadCommand, formatTimestamp, getLocalizedToolName, parseBashNotificationCommand, parseBashSearchCommand, parseBashTaskLabelCommand, parseBashReportTaskCommand, parseBashTrackingStatusCommand, getTrackingStatusIconName, splitCommandForFileLinks } from '../../utils/outputRendering';
import { resolveAgentFileReference } from '../../utils/filePaths';
import { getIconForExtension } from '../FileExplorerPanel/fileUtils';
import { BossContext, DelegationBlock, parseBossContext, parseDelegationBlock, DelegatedTaskHeader, parseWorkPlanBlock, WorkPlanBlock, parseInjectedInstructions, parseDelegatedTaskMessage, DelegatedTaskMessage, parseTaskReportMessage, TaskReportHeader, parseSubagentNotification, SubagentNotificationDisplay } from './BossContext';
import { EditToolDiff, ReadToolInput, TodoWriteInput, AskQuestionInput, ExitPlanModeInput, UnknownToolInput, ToolSearchInput, isToolSearchContent } from './ToolRenderers';
import { parseCurlCommand, looksLikeCurl } from './curlParser';
import { CurlCard } from './CurlCard';
import { renderContentWithImages, renderUserPromptContent } from './contentRendering';
import { ansiToHtml } from '../../utils/ansiToHtml';
import { copyRichContentToClipboard, inlineStylesForRichCopy } from '../../utils/clipboard';
import { highlightCode } from '../FileExplorerPanel/syntaxHighlighting';
import { useTTS } from '../../hooks/useTTS';
import { Icon, type IconName } from '../Icon';
import type { EditData } from './types';
import type { ExecTask, Subagent } from '../../../shared/types';
import { SubagentInline } from './SubagentInline';

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
  subagents?: Map<string, Subagent>;
  onImageClick?: (url: string, name: string) => void;
  onFileClick?: (path: string, editData?: EditData | { highlightRange: { offset: number; limit: number } }) => void;
  onBashClick?: (command: string, output: string) => void;
  onViewMarkdown?: (content: string) => void;
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

export const OutputLine = memo(function OutputLine({ output, agentId, execTasks = [], subagents, onImageClick, onFileClick, onBashClick, onViewMarkdown }: OutputLineProps) {
  const { t } = useTranslation(['tools', 'common']);
  const hideCost = useHideCost();
  const settings = useSettings();
  const [expandedExecTasks, setExpandedExecTasks] = useState<Set<string>>(new Set());
  const { text: rawText, isStreaming, isUserPrompt, timestamp, skillUpdate, _toolKeyParam, _editData, _todoInput, _bashOutput, _bashCommand, _isRunning } = output;
  const text = filterCostText(rawText, hideCost);

  // Extract tool info from payload (for real-time display before look-ahead completes)
  const payloadToolName = output.toolName;
  const payloadToolInput = output.toolInput;
  const payloadToolOutput = output.toolOutput;

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
      toolKeyParamOrFallback = (input.file_path || input.filePath || input.path || input.notebook_path || input.notebookPath || input.command || input.pattern || input.url || input.query || input.description) as string;
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
  const assistantRoleLabel = provider === 'codex' ? 'Codex' : provider === 'opencode' ? 'OpenCode' : 'Claude';

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

    // Check if this user prompt matches a delegated task (text matches taskCommand)
    const isDelegatedTask = delegation && text.trim() === delegation.taskCommand.trim();

    return (
      <div className="output-line output-user">
        <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
        {isDelegatedTask ? (
          <DelegatedTaskHeader bossName={delegation.bossName} taskCommand={delegation.taskCommand} />
        ) : (
          <>
            <span className="output-role output-role-chip output-role-user-chip">{t('common:labels.you')}</span>
            {parsed.hasContext && parsed.context && (
              <BossContext key={`boss-stream-${text.slice(0, 50)}`} context={parsed.context} onFileClick={onFileClick} />
            )}
            {renderUserPromptContent(parsedInjected.userMessage, onImageClick, onFileClick)}
          </>
        )}
      </div>
    );
  }

  // Handle tool usage with nice formatting
  if (text.startsWith('Using tool:')) {
    const toolName = text.replace('Using tool:', '').trim();
    const displayToolName = getLocalizedToolName(toolName, t);
    const iconName = getToolIconName(toolName);

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
      'ToolSearch',
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
    if (toolName === 'TodoWrite' && todoContent) {
      return (
        <div className={`output-line output-tool-use output-todo-inline ${isStreaming ? 'output-streaming' : ''}`}>
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
          <span className="output-tool-icon"><Icon name={iconName} size={14} /></span>
          <span className="output-tool-name">{displayToolName}</span>
          <TodoWriteInput content={todoContent} />
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
          <AskQuestionInput content={askQuestionContent} />
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
          <ExitPlanModeInput content={exitPlanContent} />
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
          || (typeof payloadInputRecord.path === 'string' ? payloadInputRecord.path : undefined)
          || (typeof payloadInputRecord.notebook_path === 'string' ? payloadInputRecord.notebook_path : undefined)
          || (typeof payloadInputRecord.notebookPath === 'string' ? payloadInputRecord.notebookPath : undefined)
        )
      : undefined;

    const resolvedFilePathForClick = _toolKeyParam || payloadFilePath;
    // File tools always have a file path as keyParam (even root-level files like "README.md" without slashes)
    const isFilePath = !!resolvedFilePathForClick && (isFileTool || resolvedFilePathForClick.startsWith('/') || resolvedFilePathForClick.includes('/'));
    const isFileClickable = isFileTool && isFilePath && onFileClick;

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

    // Check if this is a Bash tool that should be clickable (with command or output)
    const isBashTool = toolName === 'Bash' && onBashClick;
    const hasBashOutput = !!_bashOutput || !!payloadToolOutput;
    const bashCommand = _bashCommand || _toolKeyParam || toolKeyParamOrFallback || '';
    const displayCommand = extractExecWrappedCommand(bashCommand);
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
    const bashCurlParsed = (
      isBashTool
      && bashCommand
      && !bashTrackingStatusCommand
      && !bashNotificationCommand
      && !bashTaskLabelCommand
      && !bashReportTaskCommand
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
      if (isBashTool && bashCommand) {
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
          className={`output-line output-tool-use ${isStreaming ? 'output-streaming' : ''} ${isBashTool ? 'bash-clickable' : ''} ${bashNotificationCommand ? 'bash-notify-use' : ''} ${bashTrackingStatusCommand ? 'bash-tracking-use' : ''}`}
          onClick={isBashTool ? handleBashClick : undefined}
          title={isBashTool ? t('tools:display.clickToViewOutput') : undefined}
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
          {isStreaming && <span className="output-tool-loading">...</span>}
        </div>

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
        return (
          <div className="output-line output-tool-input">
            <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
            <TodoWriteInput content={inputText} />
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
    const isError = resultText.toLowerCase().includes('error') || resultText.toLowerCase().includes('failed');
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
  const thinkingText = isThinking ? text.replace(/^\[thinking\]\s*/, '') : '';
  const thinkingInlineText = isThinking
    ? (thinkingText || '(processing)')
      .replace(/\*+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    : '';
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
    className += ' output-thinking output-tool-use';
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
                src={provider === 'codex' ? `${import.meta.env.BASE_URL}assets/codex.png` : provider === 'opencode' ? `${import.meta.env.BASE_URL}assets/opencode.png` : `${import.meta.env.BASE_URL}assets/claude.png`}
                alt=""
                className="output-role-icon"
                title={provider === 'codex' ? 'Codex Agent' : provider === 'opencode' ? 'OpenCode Agent' : 'Claude Agent'}
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

  const outputRoleLabel = isClaudeMessage ? assistantRoleLabel : (isSystemMessage ? t('tools:display.system') : null);

  return (
    <div className={className}>
      <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
      {outputRoleLabel && (
        <span className="output-role">
          {isClaudeMessage && provider && (
            <img
              src={provider === 'codex' ? `${import.meta.env.BASE_URL}assets/codex.png` : provider === 'opencode' ? `${import.meta.env.BASE_URL}assets/opencode.png` : `${import.meta.env.BASE_URL}assets/claude.png`}
              alt=""
              className="output-role-icon"
              title={provider === 'codex' ? 'Codex Agent' : provider === 'opencode' ? 'OpenCode Agent' : 'Claude Agent'}
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
              {renderContentWithImages(subagentDisplayText, onImageClick, onFileClick)}
            </>
          ) : isSystemMessage && systemEmoji ? (
            <>
              <Icon name={systemIconName} size={14} />
              {' '}
              {renderContentWithImages(`[System]${systemRest}`, onImageClick, onFileClick)}
            </>
          ) : (
            renderContentWithImages(text, onImageClick, onFileClick)
          )}
        </div>
      ) : isThinking ? (
        <>
          {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
          <span className="output-tool-name output-thinking-label">
            {provider === 'codex' ? t('tools:display.codexThinking') : t('tools:display.thinking')}
          </span>
          <span className="output-tool-param output-thinking-content" title={thinkingInlineText}>
            {thinkingInlineText}
          </span>
        </>
      ) : (
        text
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
