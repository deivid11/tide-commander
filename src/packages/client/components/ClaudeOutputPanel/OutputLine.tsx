/**
 * OutputLine component for rendering live streaming output
 */

import React, { memo, useState, useRef, useCallback, useEffect } from 'react';
import { useHideCost, useSettings, ClaudeOutput, store } from '../../store';
import { filterCostText } from '../../utils/formatting';
import { TOOL_ICONS, formatTimestamp, parseBashNotificationCommand, parseBashSearchCommand } from '../../utils/outputRendering';
import { BossContext, DelegationBlock, parseBossContext, parseDelegationBlock, DelegatedTaskHeader, parseWorkPlanBlock, WorkPlanBlock, parseInjectedInstructions } from './BossContext';
import { EditToolDiff, ReadToolInput, TodoWriteInput } from './ToolRenderers';
import { renderContentWithImages, renderUserPromptContent } from './contentRendering';
import { ansiToHtml } from '../../utils/ansiToHtml';
import { useTTS } from '../../hooks/useTTS';
import type { EditData } from './types';
import type { ExecTask } from '../../../shared/types';

interface OutputLineProps {
  output: ClaudeOutput & { _toolKeyParam?: string; _editData?: EditData; _todoInput?: string; _bashOutput?: string; _bashCommand?: string; _isRunning?: boolean };
  agentId: string | null;
  execTasks?: ExecTask[];
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
        <span>Message Info</span>
        <div className="msg-meta-tooltip__actions">
          <button className="msg-meta-tooltip__copy-all" onClick={copyAll} title="Copy all as JSON">JSON</button>
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
              title="Click to copy"
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
        title="Click for message info"
      >
        {timeStr}
      </span>
      {showMeta && <MessageMetadataTooltip output={output} debugHash={debugHash} agentId={agentId || null} onClose={handleClose} />}
    </span>
  );
}

export const OutputLine = memo(function OutputLine({ output, agentId, execTasks = [], onImageClick, onFileClick, onBashClick, onViewMarkdown }: OutputLineProps) {
  const hideCost = useHideCost();
  const settings = useSettings();
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
    } else {
      toolKeyParamOrFallback = (input.file_path || input.path || input.notebook_path || input.command || input.pattern || input.url || input.query) as string;
    }
  }

  // Resolve agent name for tool attribution (prefer subagent name if present)
  const parentAgentName = agentId ? store.getState().agents.get(agentId)?.name : null;
  const agentName = output.subagentName || parentAgentName;
  const provider = agentId ? store.getState().agents.get(agentId)?.provider : undefined;
  const assistantRoleLabel = provider === 'codex' ? 'Codex' : 'Claude';

  // All hooks must be called before any conditional returns (Rules of Hooks)
  const [sessionExpanded, setSessionExpanded] = useState(false);
  const { toggle: toggleTTS, speaking } = useTTS();

  // Format timestamp for display
  const timeStr = formatTimestamp(timestamp || Date.now());

  // Debug hash for identifying duplicates
  const debugHash = getDebugHash(output);

  // Handle skill update notifications with special rendering
  if (skillUpdate) {
    return (
      <div className="output-line output-skill-update">
        <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
        <span className="skill-update-icon">🔄</span>
        <span className="skill-update-label">Skills updated:</span>
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
  const isSessionContinuation = text.includes('This session is being continued from a previous conversation that ran out of context');
  if (isSessionContinuation) {
    return (
      <div
        className={`output-line output-session-continuation ${sessionExpanded ? 'expanded' : ''}`}
        onClick={() => setSessionExpanded(!sessionExpanded)}
        title="Click to expand/collapse"
      >
        <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
        <span className="session-continuation-icon">🔗</span>
        <span className="session-continuation-label">Session continued from previous context</span>
        <span className="session-continuation-toggle">{sessionExpanded ? '▼' : '▶'}</span>
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

    // Check if this user prompt matches a delegated task (text matches taskCommand)
    const isDelegatedTask = delegation && text.trim() === delegation.taskCommand.trim();

    return (
      <div className="output-line output-user">
        <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
        {isDelegatedTask ? (
          <DelegatedTaskHeader bossName={delegation.bossName} taskCommand={delegation.taskCommand} />
        ) : (
          <>
            <span className="output-role output-role-chip output-role-user-chip">You</span>
            {parsed.hasContext && parsed.context && (
              <BossContext key={`boss-stream-${text.slice(0, 50)}`} context={parsed.context} onFileClick={onFileClick} />
            )}
            {renderUserPromptContent(parsedInjected.userMessage, onImageClick)}
          </>
        )}
      </div>
    );
  }

  // Handle tool usage with nice formatting
  if (text.startsWith('Using tool:')) {
    const toolName = text.replace('Using tool:', '').trim();
    const icon = TOOL_ICONS[toolName] || TOOL_ICONS.default;

    // Special case: TodoWrite shows the task list inline in simple view
    if (toolName === 'TodoWrite' && _todoInput) {
      return (
        <div className={`output-line output-tool-use output-todo-inline ${isStreaming ? 'output-streaming' : ''}`}>
          <TodoWriteInput content={_todoInput} />
        </div>
      );
    }

    // Check if this tool uses file paths that should be clickable
    const fileTools = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'NotebookEdit'];
    const isFileTool = fileTools.includes(toolName);

    const payloadInputRecord = (payloadToolInput && typeof payloadToolInput === 'object')
      ? payloadToolInput as Record<string, unknown>
      : null;

    const payloadFilePath = payloadInputRecord
      ? (
          (typeof payloadInputRecord.file_path === 'string' ? payloadInputRecord.file_path : undefined)
          || (typeof payloadInputRecord.path === 'string' ? payloadInputRecord.path : undefined)
          || (typeof payloadInputRecord.notebook_path === 'string' ? payloadInputRecord.notebook_path : undefined)
        )
      : undefined;

    const resolvedFilePathForClick = _toolKeyParam || payloadFilePath;
    const isFilePath = !!resolvedFilePathForClick && (resolvedFilePathForClick.startsWith('/') || resolvedFilePathForClick.includes('/'));
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
    const isCurlExecCommand = /\bcurl\b[\s\S]*\/api\/exec\b/.test(bashCommand);
    // Show only recently started exec tasks (within last 30 seconds) for this curl command
    const now = Date.now();
    const matchingExecTasks = isCurlExecCommand
      ? execTasks.filter((task) => (now - task.startedAt) < 30000)
      : [];
    const showInlineRunningTasks = Boolean(isBashTool && isCurlExecCommand && matchingExecTasks.length > 0);
    const truncatedTaskCommand = (value: string) => (value.length > 52 ? `${value.slice(0, 52)}...` : value);
    const bashSearchCommand = isBashTool && bashCommand ? parseBashSearchCommand(bashCommand) : null;
    const bashNotificationCommand = isBashTool && bashCommand ? parseBashNotificationCommand(bashCommand) : null;

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
          ? 'Running...'
          : (_bashOutput || '(No output captured)');
        onBashClick(bashCommand, outputMessage);
      }
    };

    return (
      <>
        <div
          className={`output-line output-tool-use ${isStreaming ? 'output-streaming' : ''} ${isBashTool ? 'bash-clickable' : ''} ${bashNotificationCommand ? 'bash-notify-use' : ''}`}
          onClick={isBashTool ? handleBashClick : undefined}
          title={isBashTool ? 'Click to view output' : undefined}
        >
          <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
          {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
          <span className="output-tool-icon">{icon}</span>
          <span className="output-tool-name">{toolName}</span>

          {/* For Bash tools, show the command inline (more useful than file paths) */}
          {isBashTool && bashCommand && (
            bashNotificationCommand ? (
              <span
                className="output-tool-param bash-command bash-notify-param"
                onClick={handleBashClick}
                title={bashNotificationCommand.commandBody}
                style={{ cursor: 'pointer' }}
              >
                {bashNotificationCommand.shellPrefix && (
                  <span className="bash-search-shell">{bashNotificationCommand.shellPrefix}</span>
                )}
                <span className="bash-notify-chip">notify</span>
                {bashNotificationCommand.title && (
                  <span className="bash-notify-title">{bashNotificationCommand.title}</span>
                )}
                {bashNotificationCommand.message && (
                  <span className="bash-notify-message">{bashNotificationCommand.message}</span>
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
            ) : (
              <span
                className="output-tool-param bash-command"
                onClick={handleBashClick}
                title="Click to view full output"
                style={{ cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.9em', color: '#888' }}
              >
                {bashCommand}
              </span>
            )
          )}

          {/* For file tools, show the file path */}
          {!isBashTool && toolKeyParamOrFallback && (
            <span
              className={`output-tool-param ${isFileClickable ? 'clickable-path' : ''}`}
              onClick={isFileClickable ? handleParamClick : undefined}
              title={isFileClickable ? (toolName === 'Edit' && (_editData || editDataFallback) ? 'Click to view diff' : 'Click to view file') : undefined}
              style={isFileClickable ? { cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' } : undefined}
            >
              {toolKeyParamOrFallback}
            </span>
          )}

          {isBashTool && !_isRunning && (
            <span className="bash-output-indicator">
              {execTasks.some(t => t.status === 'completed') ? '✅' : (hasBashOutput ? '📄' : '💻')}
            </span>
          )}
          {isStreaming && <span className="output-tool-loading">...</span>}
        </div>

        {/* Exec task output below bash command line */}
        {showInlineRunningTasks && (
          <div className="exec-task-output-container">
            {matchingExecTasks.map((task) => (
              <div key={task.taskId} className={`exec-task-inline status-${task.status}`}>
                <div className="exec-task-inline-terminal">
                  <pre className="exec-task-inline-output">
                    {task.output.map((line, idx) => (
                      <div key={idx} dangerouslySetInnerHTML={{ __html: ansiToHtml(line) }} />
                    ))}
                    {task.status === 'running' && <span className="exec-task-cursor">▌</span>}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  // Handle tool input with nice formatting
  if (text.startsWith('Tool input:')) {
    const inputText = text.replace('Tool input:', '').trim();

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
        <pre className="output-input-content">{inputText}</pre>
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
        <span className="output-result-icon">{isError ? '❌' : '✓'}</span>
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
            <span className="bash-output-label">Terminal Output</span>
            {isTruncated && <span className="bash-output-truncated">truncated</span>}
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
  const isSystemMessage = /^\s*(?:[\u{1F300}-\u{1FAFF}\u2600-\u27BF]\s*)?\[System\]/u.test(text);

  // Categorize other output types
  let className = 'output-line';
  let useMarkdown = true;
  let isClaudeMessage = false;

  if (text.startsWith('Session started:') || text.startsWith('Session initialized')) {
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
    className += ' output-text output-system markdown-content';
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
          <span className="output-role">{assistantRoleLabel}</span>
          <div className="markdown-content">
            {renderContentWithImages(workPlanParsed.contentWithoutBlock, onImageClick, onFileClick)}
          </div>
          {workPlanParsed.hasWorkPlan && workPlanParsed.workPlan && (
            <WorkPlanBlock workPlan={workPlanParsed.workPlan} />
          )}
          {delegationParsed.hasDelegation && delegationParsed.delegations.map((delegation, i) => (
            <DelegationBlock key={`del-${i}`} delegation={delegation} />
          ))}
          <div className="message-action-btns">
            {settings.experimentalTTS && (
              <button
                className="history-speak-btn"
                onClick={(e) => { e.stopPropagation(); toggleTTS(text); }}
                title={speaking ? 'Stop speaking' : 'Speak (Spanish)'}
              >
                {speaking ? '🔊' : '🔈'}
              </button>
            )}
            {onViewMarkdown && (
              <button
                className="history-view-md-btn"
                onClick={(e) => { e.stopPropagation(); onViewMarkdown(text); }}
                title="View as Markdown"
              >
                📄
              </button>
            )}
          </div>
        </div>
      );
    }
  }

  const outputRoleLabel = isClaudeMessage ? assistantRoleLabel : (isSystemMessage ? 'System' : null);

  return (
    <div className={className}>
      <TimestampWithMeta output={output} timeStr={timeStr} debugHash={debugHash} agentId={agentId} />
      {outputRoleLabel && <span className="output-role">{outputRoleLabel}</span>}
      {useMarkdown ? (
        <div className="markdown-content">
          {renderContentWithImages(text, onImageClick, onFileClick)}
        </div>
      ) : isThinking ? (
        <>
          {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
          <span className="output-tool-name output-thinking-label">
            {provider === 'codex' ? 'Codex Thinking' : 'Thinking'}
          </span>
          <span className="output-tool-param output-thinking-content" title={thinkingInlineText}>
            {thinkingInlineText}
          </span>
        </>
      ) : (
        text
      )}
      {isClaudeMessage && !isStreaming && (
        <div className="message-action-btns">
          {settings.experimentalTTS && (
            <button
              className="history-speak-btn"
              onClick={(e) => { e.stopPropagation(); toggleTTS(text); }}
              title={speaking ? 'Stop speaking' : 'Speak (Spanish)'}
            >
              {speaking ? '🔊' : '🔈'}
            </button>
          )}
          {onViewMarkdown && (
            <button
              className="history-view-md-btn"
              onClick={(e) => { e.stopPropagation(); onViewMarkdown(text); }}
              title="View as Markdown"
            >
              📄
            </button>
          )}
        </div>
      )}
    </div>
  );
});
