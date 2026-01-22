/**
 * OutputLine component for rendering live streaming output
 */

import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useHideCost, ClaudeOutput, store } from '../../store';
import { filterCostText } from '../../utils/formatting';
import { TOOL_ICONS, formatTimestamp } from '../../utils/outputRendering';
import { markdownComponents } from './MarkdownComponents';
import { BossContext, DelegationBlock, parseBossContext, parseDelegationBlock, DelegatedTaskHeader } from './BossContext';
import { EditToolDiff, ReadToolInput, TodoWriteInput } from './ToolRenderers';
import { renderContentWithImages } from './contentRendering';
import type { EditData } from './types';

interface OutputLineProps {
  output: ClaudeOutput & { _toolKeyParam?: string; _editData?: EditData; _todoInput?: string; _bashOutput?: string; _bashCommand?: string; _isRunning?: boolean };
  agentId: string | null;
  onImageClick?: (url: string, name: string) => void;
  onFileClick?: (path: string, editData?: EditData) => void;
  onBashClick?: (command: string, output: string) => void;
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

export const OutputLine = memo(function OutputLine({ output, agentId, onImageClick, onFileClick, onBashClick }: OutputLineProps) {
  const hideCost = useHideCost();
  const { text: rawText, isStreaming, isUserPrompt, timestamp, _toolKeyParam, _editData, _todoInput, _bashOutput, _bashCommand, _isRunning } = output;
  const text = filterCostText(rawText, hideCost);

  // Format timestamp for display
  const timeStr = formatTimestamp(timestamp || Date.now());

  // Debug hash for identifying duplicates
  const debugHash = getDebugHash(output);

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

    // Check if this user prompt matches a delegated task (text matches taskCommand)
    const isDelegatedTask = delegation && text.trim() === delegation.taskCommand.trim();

    return (
      <div className="output-line output-user">
        <span className="output-timestamp" title={`${timestamp} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#666', fontFamily: 'monospace'}}>[{debugHash}]</span></span>
        {isDelegatedTask ? (
          <DelegatedTaskHeader bossName={delegation.bossName} taskCommand={delegation.taskCommand} />
        ) : (
          <>
            <span className="output-role">You</span>
            {parsed.hasContext && parsed.context && (
              <BossContext key={`boss-stream-${text.slice(0, 50)}`} context={parsed.context} />
            )}
            {renderContentWithImages(parsed.userMessage, onImageClick)}
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
    const isFilePath = _toolKeyParam && (_toolKeyParam.startsWith('/') || _toolKeyParam.includes('/'));
    const isFileClickable = isFileTool && isFilePath && onFileClick;

    // Check if this is a Bash tool that should be clickable (with command or output)
    const isBashTool = toolName === 'Bash' && onBashClick;
    const hasBashOutput = !!_bashOutput;
    const bashCommand = _bashCommand || _toolKeyParam || '';

    const handleParamClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isFileClickable && _toolKeyParam) {
        if (toolName === 'Edit' && _editData) {
          onFileClick(_toolKeyParam, _editData);
        } else {
          onFileClick(_toolKeyParam);
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

    const isClickable = isFileClickable || isBashTool;

    return (
      <div
        className={`output-line output-tool-use ${isStreaming ? 'output-streaming' : ''} ${isBashTool ? 'bash-clickable' : ''}`}
        onClick={isBashTool ? handleBashClick : undefined}
        title={isBashTool ? 'Click to view output' : undefined}
      >
        <span className="output-timestamp" title={`${timestamp} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#666', fontFamily: 'monospace'}}>[{debugHash}]</span></span>
        <span className="output-tool-icon">{icon}</span>
        <span className="output-tool-name">{toolName}</span>
        {_toolKeyParam && (
          <span
            className={`output-tool-param ${isFileClickable ? 'clickable-path' : ''}`}
            onClick={isFileClickable ? handleParamClick : undefined}
            title={isFileClickable ? (toolName === 'Edit' && _editData ? 'Click to view diff' : 'Click to view file') : undefined}
            style={isFileClickable ? { cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' } : undefined}
          >
            {_toolKeyParam}
          </span>
        )}
        {isBashTool && !_isRunning && <span className="bash-output-indicator">{hasBashOutput ? '📄' : '💻'}</span>}
        {isStreaming && <span className="output-tool-loading">...</span>}
      </div>
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
            <span className="output-timestamp" title={`${timestamp} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#666', fontFamily: 'monospace'}}>[{debugHash}]</span></span>
            <EditToolDiff content={inputText} onFileClick={onFileClick} />
          </div>
        );
      }
      if (parsed.file_path && parsed.old_string === undefined && parsed.new_string === undefined) {
        return (
          <div className="output-line output-tool-input">
            <span className="output-timestamp" title={`${timestamp} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#666', fontFamily: 'monospace'}}>[{debugHash}]</span></span>
            <ReadToolInput content={inputText} onFileClick={onFileClick} />
          </div>
        );
      }
      if (Array.isArray(parsed.todos)) {
        return (
          <div className="output-line output-tool-input">
            <span className="output-timestamp" title={`${timestamp} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#666', fontFamily: 'monospace'}}>[{debugHash}]</span></span>
            <TodoWriteInput content={inputText} />
          </div>
        );
      }
    } catch {
      /* Not JSON */
    }

    return (
      <div className="output-line output-tool-input">
        <span className="output-timestamp" title={`${timestamp} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#666', fontFamily: 'monospace'}}>[{debugHash}]</span></span>
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
        <span className="output-timestamp" title={`${timestamp} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#666', fontFamily: 'monospace'}}>[{debugHash}]</span></span>
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
        <span className="output-timestamp" title={`${timestamp} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#666', fontFamily: 'monospace'}}>[{debugHash}]</span></span>
        <div className="bash-output-container">
          <div className="bash-output-header">
            <span className="bash-output-icon">$</span>
            <span className="bash-output-label">Terminal Output</span>
            {isTruncated && <span className="bash-output-truncated">truncated</span>}
          </div>
          <pre className="bash-output-content">{bashOutput}</pre>
        </div>
      </div>
    );
  }

  // Handle /context command output with special rendering
  const isContextOutput =
    text.includes('## Context Usage') ||
    (text.includes('Context Usage') && text.includes('Tokens:') && text.includes('Free space'));

  if (isContextOutput) {
    const tagMatch = text.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
    const contextOutput = tagMatch ? tagMatch[1] : text;

    const tokensMatch = contextOutput.match(/\*?\*?Tokens:\*?\*?\s*([\d.]+)k?\s*\/\s*([\d.]+)k?\s*\((\d+)%\)/);

    const parseCategory = (name: string): { tokens: string; percent: string } | null => {
      const tableRegex = new RegExp(`\\|\\s*${name}\\s*\\|\\s*([\\d.]+)k?\\s*\\|\\s*([\\d.]+)%`, 'i');
      const tableMatch = contextOutput.match(tableRegex);
      if (tableMatch) {
        return { tokens: tableMatch[1] + 'k', percent: tableMatch[2] + '%' };
      }
      const plainRegex = new RegExp(`${name}\\s+([\\d.]+)k?\\s+([\\d.]+)%`, 'i');
      const plainMatch = contextOutput.match(plainRegex);
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
        <span className="output-timestamp" title={`${timestamp} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#666', fontFamily: 'monospace'}}>[{debugHash}]</span></span>
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

  // Hide local-command tags for utility commands
  if (
    text.includes('<local-command-caveat>') ||
    text.includes('<command-name>/context</command-name>') ||
    text.includes('<command-name>/cost</command-name>') ||
    text.includes('<command-name>/compact</command-name>')
  ) {
    return null;
  }

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
  } else if (text.startsWith('[thinking]')) {
    className += ' output-thinking';
    useMarkdown = false;
  } else if (text.startsWith('[raw]')) {
    className += ' output-raw';
    useMarkdown = false;
  } else {
    className += ' output-text output-claude markdown-content';
    isClaudeMessage = true;
  }

  if (isStreaming) {
    className += ' output-streaming';
  }

  // For Claude messages, check for delegation blocks
  if (isClaudeMessage && !isStreaming) {
    const parsed = parseDelegationBlock(text);
    if (parsed.hasDelegation && parsed.delegations.length > 0) {
      return (
        <div className={className}>
          <span className="output-timestamp" title={`${timestamp} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#666', fontFamily: 'monospace'}}>[{debugHash}]</span></span>
          <span className="output-role">Claude</span>
          <div className="markdown-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {parsed.contentWithoutBlock}
            </ReactMarkdown>
          </div>
          {parsed.delegations.map((delegation, i) => (
            <DelegationBlock key={`del-${i}`} delegation={delegation} />
          ))}
        </div>
      );
    }
  }

  return (
    <div className={className}>
      <span className="output-timestamp" title={`${timestamp} | ${debugHash}`}>{timeStr} <span style={{fontSize: '9px', color: '#666', fontFamily: 'monospace'}}>[{debugHash}]</span></span>
      {isClaudeMessage && <span className="output-role">Claude</span>}
      {useMarkdown ? (
        <div className="markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {text}
          </ReactMarkdown>
        </div>
      ) : (
        text
      )}
    </div>
  );
});
