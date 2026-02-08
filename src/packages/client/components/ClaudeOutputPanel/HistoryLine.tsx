/**
 * HistoryLine component for rendering conversation history messages
 */

import React, { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useHideCost, useSettings } from '../../store';
import { store } from '../../store';
import { BOSS_CONTEXT_START } from '../../../shared/types';
import { filterCostText } from '../../utils/formatting';
import { TOOL_ICONS, extractToolKeyParam, formatTimestamp, parseBashNotificationCommand, parseBashSearchCommand } from '../../utils/outputRendering';
import { createMarkdownComponents } from './MarkdownComponents';
import { BossContext, DelegationBlock, parseBossContext, parseDelegationBlock, parseWorkPlanBlock, WorkPlanBlock, parseInjectedInstructions } from './BossContext';
import { EditToolDiff, ReadToolInput, TodoWriteInput } from './ToolRenderers';
import { highlightText, renderContentWithImages, renderUserPromptContent } from './contentRendering';
import { useTTS } from '../../hooks/useTTS';
import { ansiToHtml } from '../../utils/ansiToHtml';
import type { EnrichedHistoryMessage, EditData } from './types';

interface HistoryLineProps {
  message: EnrichedHistoryMessage;
  agentId?: string | null;
  highlight?: string;
  simpleView?: boolean;
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
  onImageClick,
  onFileClick,
  onBashClick,
  onViewMarkdown,
}: HistoryLineProps) {
  const hideCost = useHideCost();
  const settings = useSettings();
  const { type, content: rawContent, toolName, timestamp, _bashOutput, _bashCommand } = message;
  const content = filterCostText(rawContent, hideCost);
  const { toggle: toggleTTS, speaking } = useTTS();
  const markdownComponents = createMarkdownComponents({ onFileClick: onFileClick ? (path) => onFileClick(path) : undefined });

  // Resolve agent name for tool attribution badge
  // For Task tool_use messages, show the subagent name instead of parent agent
  const parentAgentName = agentId ? store.getState().agents.get(agentId)?.name : null;
  const provider = agentId ? store.getState().agents.get(agentId)?.provider : undefined;
  const assistantRoleLabel = provider === 'codex' ? 'Codex' : 'Claude';
  const subagentNameFromInput = (type === 'tool_use' && toolName === 'Task' && message.toolInput)
    ? ((message.toolInput.name as string) || (message.toolInput.description as string) || null)
    : null;
  const agentName = subagentNameFromInput || parentAgentName;

  // Format timestamp for display (HistoryMessage has ISO string timestamp)
  const timeStr = timestamp ? formatTimestamp(new Date(timestamp).getTime()) : '';
  const timestampMs = timestamp ? new Date(timestamp).getTime() : 0;

  // Debug hash for identifying duplicates
  const debugHash = getHistoryDebugHash(message);

  // Hide utility slash commands like /context, /cost, /compact
  if (type === 'user') {
    const trimmedContent = content.trim();
    if (trimmedContent === '/context' || trimmedContent === '/cost' || trimmedContent === '/compact') {
      return null;
    }
  }

  // Handle session continuation message with special rendering
  const isSessionContinuation = content.includes('This session is being continued from a previous conversation that ran out of context');
  const [sessionExpanded, setSessionExpanded] = useState(false);
  if (isSessionContinuation) {
    return (
      <div
        className={`output-line output-session-continuation ${sessionExpanded ? 'expanded' : ''}`}
        onClick={() => setSessionExpanded(!sessionExpanded)}
        title="Click to expand/collapse"
      >
        {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr}</span>}
        <span className="session-continuation-icon">🔗</span>
        <span className="session-continuation-label">Session continued from previous context</span>
        <span className="session-continuation-toggle">{sessionExpanded ? '▼' : '▶'}</span>
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
        title={agentId ? 'Click to view detailed context stats' : undefined}
      >
        {timeStr && <span className="output-timestamp context-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span className="context-debug-hash">[{debugHash}]</span></span>}
        <span className="context-icon">📊</span>
        <span className="context-label">Context:</span>
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
        <span className="context-free">({freePercent.toFixed(0)}% free)</span>
        {messages && (
          <span className="context-msgs">msgs: {messages.tokens}</span>
        )}
      </div>
    );
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

  if (type === 'tool_use') {
    const icon = TOOL_ICONS[toolName || ''] || TOOL_ICONS.default;

    // Simple view: show icon, tool name, and key parameter
    if (simpleView) {
      let keyParam = toolName && content ? extractToolKeyParam(toolName, content) : null;
      if (toolName === 'Bash' && keyParam && keyParam.length > 300) {
        keyParam = keyParam.substring(0, 297) + '...';
      }

      const fileTools = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'NotebookEdit'];
      const isFileTool = fileTools.includes(toolName || '');
      const isFilePath = keyParam && (keyParam.startsWith('/') || keyParam.includes('/'));
      const isFileClickable = isFileTool && isFilePath && onFileClick;

      // Bash tools are clickable if we have onBashClick handler
      const isBashTool = toolName === 'Bash' && onBashClick;
      const bashCommand = _bashCommand || keyParam || '';
      const bashSearchCommand = isBashTool && bashCommand ? parseBashSearchCommand(bashCommand) : null;
      const bashNotificationCommand = isBashTool && bashCommand ? parseBashNotificationCommand(bashCommand) : null;

      const handleParamClick = () => {
        if (isFileClickable && keyParam) {
          if (toolName === 'Edit' && content) {
            try {
              const parsed = JSON.parse(content);
              if (parsed.old_string !== undefined || parsed.new_string !== undefined) {
                onFileClick(keyParam, {
                  oldString: parsed.old_string || '',
                  newString: parsed.new_string || '',
                  operation: typeof parsed.operation === 'string' ? parsed.operation : undefined,
                });
                return;
              }
            } catch {
              /* ignore */
            }
          }
          // Handle Read tool with offset/limit
          if (toolName === 'Read' && content) {
            try {
              const parsed = JSON.parse(content);
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
        if (isBashTool && bashCommand) {
          onBashClick(bashCommand, _bashOutput || '(No output available)');
        }
      };

      const clickTitle = isBashTool
        ? 'Click to view output'
        : (isFileClickable ? 'Click to view file' : undefined);

      // Check if this is a curl exec command and try to parse the exec output
      const isCurlExecCommand = /\bcurl\b[\s\S]*\/api\/exec\b/.test(bashCommand);
      let execTaskOutput: { output: string[] } | null = null;

      if (isCurlExecCommand && _bashOutput) {
        try {
          const parsed = JSON.parse(_bashOutput);
          if (parsed.output && typeof parsed.output === 'string') {
            // Convert the output string to an array of lines
            execTaskOutput = {
              output: parsed.output.split('\n').filter((line: string) => line.length > 0),
            };
          }
        } catch {
          // If parsing fails, just show the bash output normally
        }
      }

      return (
        <>
          <div
            className={`output-line output-tool-use output-tool-simple ${isBashTool ? 'clickable-bash' : ''} ${bashNotificationCommand ? 'bash-notify-use' : ''}`}
            onClick={isBashTool ? handleBashClick : undefined}
            style={isBashTool ? { cursor: 'pointer' } : undefined}
            title={isBashTool ? 'Click to view output' : undefined}
          >
            {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
            {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
            <span className="output-tool-icon">{icon}</span>
            <span className="output-tool-name">{toolName}</span>
            {isBashTool && bashNotificationCommand ? (
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
            ) : (
              keyParam && (
                <span
                  className={`output-tool-param ${isFileClickable ? 'clickable-path' : ''}`}
                  onClick={isFileClickable ? handleParamClick : undefined}
                  title={clickTitle}
                  style={isFileClickable ? { cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' } : undefined}
                >
                  {keyParam}
                </span>
              )
            )}
          </div>
          {/* Render exec task output for curl exec commands */}
          {isCurlExecCommand && execTaskOutput && (
            <div className="exec-task-output-container">
              <div className="exec-task-inline status-completed">
                <div className="exec-task-inline-terminal">
                  <pre className="exec-task-inline-output">
                    {execTaskOutput.output.map((line, idx) => (
                      <div key={idx} dangerouslySetInnerHTML={{ __html: ansiToHtml(line) }} />
                    ))}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </>
      );
    }

    // Special rendering for Edit tool - show diff view
    if (toolName === 'Edit' && content) {
      return (
        <>
          <div className="output-line output-tool-use">
            {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
            {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
            <span className="output-tool-icon">{icon}</span>
            <span className="output-tool-name">{toolName}</span>
          </div>
          <div className="output-line output-tool-input">
            <EditToolDiff content={content} onFileClick={onFileClick} />
          </div>
        </>
      );
    }

    // Special rendering for Read tool - show file link
    if (toolName === 'Read' && content) {
      return (
        <>
          <div className="output-line output-tool-use">
            {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
            {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
            <span className="output-tool-icon">{icon}</span>
            <span className="output-tool-name">{toolName}</span>
          </div>
          <div className="output-line output-tool-input">
            <ReadToolInput content={content} onFileClick={onFileClick} />
          </div>
        </>
      );
    }

    // Special rendering for TodoWrite tool - show checklist
    if (toolName === 'TodoWrite' && content) {
      return (
        <>
          <div className="output-line output-tool-use">
            {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
            {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
            <span className="output-tool-icon">{icon}</span>
            <span className="output-tool-name">{toolName}</span>
          </div>
          <div className="output-line output-tool-input">
            <TodoWriteInput content={content} />
          </div>
        </>
      );
    }

    // Default tool rendering
    return (
      <>
        <div className="output-line output-tool-use">
          {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
          {agentName && <span className="output-agent-badge" title={`Agent: ${agentName}`}>{agentName}</span>}
          <span className="output-tool-icon">{icon}</span>
          <span className="output-tool-name">{toolName}</span>
        </div>
        {content && (
          <div className="output-line output-tool-input">
            <pre className="output-input-content">{highlightText(content, highlight)}</pre>
          </div>
        )}
      </>
    );
  }

  if (type === 'tool_result') {
    // Simple view: hide tool results entirely (tool_use already shows the action)
    if (simpleView) {
      return null;
    }

    const isError = content.toLowerCase().includes('error') || content.toLowerCase().includes('failed');
    return (
      <div className={`output-line output-tool-result ${isError ? 'is-error' : ''}`}>
        {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
        <span className="output-result-icon">{isError ? '❌' : '✓'}</span>
        <pre className="output-result-content">{highlightText(content, highlight)}</pre>
      </div>
    );
  }

  const isUser = type === 'user';
  const isSystemMessage = !isUser && /^\s*(?:[\u{1F300}-\u{1FAFF}\u2600-\u27BF]\s*)?\[System\]/u.test(content);
  const className = isUser ? 'history-line history-user' : (isSystemMessage ? 'history-line history-system' : 'history-line history-assistant');
  const assistantOrSystemRoleLabel = isSystemMessage ? 'System' : assistantRoleLabel;

  // For user messages, check for boss context
  if (isUser && parsedBoss) {
    const parsedInjected = parseInjectedInstructions(parsedBoss.userMessage);
    const displayMessage = parsedInjected.userMessage;

    return (
      <div className={className}>
        {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
        <span className="history-role history-role-chip">You</span>
        <span className="history-content user-prompt-text">
          {parsedBoss.hasContext && parsedBoss.context && (
            <BossContext key={`boss-${timestamp || content.slice(0, 50)}`} context={parsedBoss.context} onFileClick={onFileClick ? (path) => onFileClick(path) : undefined} />
          )}
          {highlight ? (
            <div>{highlightText(displayMessage, highlight)}</div>
          ) : (
            renderUserPromptContent(displayMessage, onImageClick)
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
        <span className="history-role">{assistantOrSystemRoleLabel}</span>
        <span className="history-content markdown-content">
          {highlight ? (
            <div>{highlightText(workPlanParsed.contentWithoutBlock, highlight)}</div>
          ) : (
            renderContentWithImages(workPlanParsed.contentWithoutBlock, onImageClick, onFileClick)
          )}
          {workPlanParsed.hasWorkPlan && workPlanParsed.workPlan && (
            <WorkPlanBlock workPlan={workPlanParsed.workPlan} />
          )}
          {delegationParsed.hasDelegation && delegationParsed.delegations.map((delegation, i) => (
            <DelegationBlock key={`del-${i}`} delegation={delegation} />
          ))}
        </span>
        <div className="message-action-btns">
          {settings.experimentalTTS && (
            <button
              className="history-speak-btn"
              onClick={(e) => { e.stopPropagation(); toggleTTS(content); }}
              title={speaking ? 'Stop speaking' : 'Speak (Spanish)'}
            >
              {speaking ? '🔊' : '🔈'}
            </button>
          )}
          {onViewMarkdown && (
            <button
              className="history-view-md-btn"
              onClick={(e) => { e.stopPropagation(); onViewMarkdown(content); }}
              title="View as Markdown"
            >
              📄
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
      <span className={`history-role ${isUser ? 'history-role-chip' : ''}`}>{isUser ? 'You' : assistantOrSystemRoleLabel}</span>
      <span className={`history-content ${isUser ? 'user-prompt-text' : 'markdown-content'}`}>
        {highlight ? <div>{highlightText(content, highlight)}</div> : (
          isUser ? renderUserPromptContent(content, onImageClick) : renderContentWithImages(content, onImageClick, onFileClick)
        )}
      </span>
      {!isUser && (
        <div className="message-action-btns">
          {settings.experimentalTTS && (
            <button
              className="history-speak-btn"
              onClick={(e) => { e.stopPropagation(); toggleTTS(content); }}
              title={speaking ? 'Stop speaking' : 'Speak (Spanish)'}
            >
              {speaking ? '🔊' : '🔈'}
            </button>
          )}
          {onViewMarkdown && (
            <button
              className="history-view-md-btn"
              onClick={(e) => { e.stopPropagation(); onViewMarkdown(content); }}
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
