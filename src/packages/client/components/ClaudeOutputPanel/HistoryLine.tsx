/**
 * HistoryLine component for rendering conversation history messages
 */

import React, { memo } from 'react';
import { useHideCost } from '../../store';
import { store } from '../../store';
import { BOSS_CONTEXT_START, BOSS_CONTEXT_END } from '../../../shared/types';
import { filterCostText } from '../../utils/formatting';
import { TOOL_ICONS, extractToolKeyParam, formatTimestamp } from '../../utils/outputRendering';
import { BossContext, DelegationBlock, parseBossContext, parseDelegationBlock } from './BossContext';
import { EditToolDiff, ReadToolInput, TodoWriteInput } from './ToolRenderers';
import { highlightText, renderContentWithImages } from './contentRendering';
import type { HistoryMessage, EditData } from './types';

interface HistoryLineProps {
  message: HistoryMessage;
  agentId?: string | null;
  highlight?: string;
  simpleView?: boolean;
  onImageClick?: (url: string, name: string) => void;
  onFileClick?: (path: string, editData?: EditData) => void;
}

export const HistoryLine = memo(function HistoryLine({
  message,
  agentId,
  highlight,
  simpleView,
  onImageClick,
  onFileClick,
}: HistoryLineProps) {
  const hideCost = useHideCost();
  const { type, content: rawContent, toolName, timestamp } = message;
  const content = filterCostText(rawContent, hideCost);

  // Format timestamp for display (HistoryMessage has ISO string timestamp)
  const timeStr = timestamp ? formatTimestamp(new Date(timestamp).getTime()) : '';

  // Hide utility slash commands like /context, /cost, /compact
  if (type === 'user') {
    const trimmedContent = content.trim();
    if (trimmedContent === '/context' || trimmedContent === '/cost' || trimmedContent === '/compact') {
      return null;
    }
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
    const percentColor = usedPercent >= 80 ? '#ff4a4a' : usedPercent >= 60 ? '#ff9e4a' : usedPercent >= 40 ? '#ffd700' : '#4aff9e';

    const handleContextClick = () => {
      if (agentId) {
        store.setContextModalAgentId(agentId);
      }
    };

    return (
      <div
        className="output-line output-context-stats"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '4px 0',
          cursor: agentId ? 'pointer' : 'default',
        }}
        onClick={handleContextClick}
        title={agentId ? 'Click to view detailed context stats' : undefined}
      >
        {timeStr && <span className="output-timestamp">{timeStr}</span>}
        <span style={{ color: '#bd93f9', fontSize: '12px' }}>📊</span>
        <span style={{ fontSize: '11px', color: '#6272a4' }}>Context:</span>
        <div
          style={{
            width: '80px',
            height: '6px',
            background: 'rgba(98, 114, 164, 0.3)',
            borderRadius: '3px',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${usedPercent}%`,
              background: percentColor,
              borderRadius: '3px',
            }}
          />
        </div>
        <span style={{ fontSize: '11px', color: percentColor, fontWeight: 600 }}>
          {tokensMatch ? `${tokensMatch[1]}k/${tokensMatch[2]}k` : '?'}
        </span>
        <span style={{ fontSize: '11px', color: '#6272a4' }}>({freePercent.toFixed(0)}% free)</span>
        {messages && (
          <span style={{ fontSize: '10px', color: '#4aff9e', opacity: 0.7 }}>msgs: {messages.tokens}</span>
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
      const isClickable = isFileTool && isFilePath && onFileClick;

      const handleParamClick = () => {
        if (isClickable && keyParam) {
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
          onFileClick(keyParam);
        }
      };

      return (
        <div className="output-line output-tool-use output-tool-simple">
          {timeStr && <span className="output-timestamp">{timeStr}</span>}
          <span className="output-tool-icon">{icon}</span>
          <span className="output-tool-name">{toolName}</span>
          {keyParam && (
            <span
              className={`output-tool-param ${isClickable ? 'clickable-path' : ''}`}
              onClick={isClickable ? handleParamClick : undefined}
              title={isClickable ? 'Click to view file' : undefined}
              style={isClickable ? { cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' } : undefined}
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
            {timeStr && <span className="output-timestamp">{timeStr}</span>}
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
            {timeStr && <span className="output-timestamp">{timeStr}</span>}
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
            {timeStr && <span className="output-timestamp">{timeStr}</span>}
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
          {timeStr && <span className="output-timestamp">{timeStr}</span>}
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
    const isError = content.toLowerCase().includes('error') || content.toLowerCase().includes('failed');
    return (
      <div className={`output-line output-tool-result ${isError ? 'is-error' : ''}`}>
        {timeStr && <span className="output-timestamp">{timeStr}</span>}
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
        {timeStr && <span className="output-timestamp">{timeStr}</span>}
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
        {timeStr && <span className="output-timestamp">{timeStr}</span>}
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
      </div>
    );
  }

  return (
    <div className={className}>
      {timeStr && <span className="output-timestamp">{timeStr}</span>}
      <span className="history-role">Claude</span>
      <span className="history-content markdown-content">
        {highlight ? <div>{highlightText(content, highlight)}</div> : renderContentWithImages(content, onImageClick)}
      </span>
    </div>
  );
});
