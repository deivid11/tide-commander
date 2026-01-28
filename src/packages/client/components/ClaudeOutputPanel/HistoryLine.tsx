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
import { TOOL_ICONS, extractToolKeyParam, formatTimestamp } from '../../utils/outputRendering';
import { markdownComponents } from './MarkdownComponents';
import { BossContext, DelegationBlock, parseBossContext, parseDelegationBlock } from './BossContext';
import { EditToolDiff, ReadToolInput, TodoWriteInput } from './ToolRenderers';
import { highlightText, renderContentWithImages } from './contentRendering';
import { useTTS } from '../../hooks/useTTS';
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

      const handleParamClick = () => {
        if (isFileClickable && keyParam) {
          if (toolName === 'Edit' && content) {
            try {
              const parsed = JSON.parse(content);
              if (parsed.old_string !== undefined || parsed.new_string !== undefined) {
                onFileClick(keyParam, { oldString: parsed.old_string || '', newString: parsed.new_string || '' });
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

      return (
        <div
          className={`output-line output-tool-use output-tool-simple ${isBashTool ? 'clickable-bash' : ''}`}
          onClick={isBashTool ? handleBashClick : undefined}
          style={isBashTool ? { cursor: 'pointer' } : undefined}
          title={isBashTool ? 'Click to view output' : undefined}
        >
          {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
          <span className="output-tool-icon">{icon}</span>
          <span className="output-tool-name">{toolName}</span>
          {keyParam && (
            <span
              className={`output-tool-param ${isFileClickable ? 'clickable-path' : ''}`}
              onClick={isFileClickable ? handleParamClick : undefined}
              title={clickTitle}
              style={isFileClickable ? { cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' } : undefined}
            >
              {keyParam}
            </span>
          )}
        </div>
      );
    }

    // Special rendering for Edit tool - show diff view
    if (toolName === 'Edit' && content) {
      return (
        <>
          <div className="output-line output-tool-use">
            {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
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
  const className = isUser ? 'history-line history-user' : 'history-line history-assistant';

  // For user messages, check for boss context
  if (isUser && parsedBoss) {
    const displayMessage = parsedBoss.userMessage;

    return (
      <div className={className}>
        {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
        <span className="history-role">You</span>
        <span className="history-content markdown-content">
          {parsedBoss.hasContext && parsedBoss.context && (
            <BossContext key={`boss-${timestamp || content.slice(0, 50)}`} context={parsedBoss.context} />
          )}
          {highlight ? (
            <div>{highlightText(displayMessage, highlight)}</div>
          ) : (
            renderContentWithImages(displayMessage, onImageClick)
          )}
        </span>
      </div>
    );
  }

  // For assistant messages, check for delegation blocks
  const delegationParsed = parseDelegationBlock(content);
  if (delegationParsed.hasDelegation && delegationParsed.delegations.length > 0) {
    return (
      <div className={className}>
        {timeStr && <span className="output-timestamp" title={`${timestampMs} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#888', fontFamily: 'monospace'}}>[{debugHash}]</span></span>}
        <span className="history-role">Claude</span>
        <span className="history-content markdown-content">
          {highlight ? (
            <div>{highlightText(delegationParsed.contentWithoutBlock, highlight)}</div>
          ) : (
            renderContentWithImages(delegationParsed.contentWithoutBlock, onImageClick)
          )}
          {delegationParsed.delegations.map((delegation, i) => (
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
      <span className="history-role">{isUser ? 'You' : 'Claude'}</span>
      <span className="history-content markdown-content">
        {highlight ? <div>{highlightText(content, highlight)}</div> : renderContentWithImages(content, onImageClick)}
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
