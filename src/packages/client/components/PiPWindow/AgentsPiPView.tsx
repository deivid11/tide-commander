/**
 * AgentsPiPView Component
 * Displays working agents in a compact view for the PiP window
 * Supports navigation to agent conversation on double-click
 */

import React, { useState, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAgentsArray, useAgent, useAgentOutputs } from '../../store/selectors';
import { sendMessage } from '../../websocket';
import { BUILT_IN_AGENT_CLASSES, BOSS_CONTEXT_START, BOSS_CONTEXT_END, type Agent, type AgentStatus } from '../../../shared/types';
import type { ClaudeOutput } from '../../store/types';
import './pip-styles.scss';

interface AgentCardProps {
  agent: Agent;
  onDoubleClick: (agentId: string) => void;
}

function getStatusIcon(status: AgentStatus): string {
  switch (status) {
    case 'working':
      return '⚡';
    case 'waiting':
      return '⏳';
    case 'waiting_permission':
      return '🔐';
    case 'error':
      return '❌';
    case 'offline':
      return '💤';
    case 'orphaned':
      return '👻';
    case 'idle':
    default:
      return '●';
  }
}

function getStatusColor(status: AgentStatus): string {
  switch (status) {
    case 'working':
      return '#4aff9e';
    case 'waiting':
      return '#ff9e4a';
    case 'waiting_permission':
      return '#ff4a9e';
    case 'error':
      return '#ff4a4a';
    case 'offline':
      return '#666';
    case 'orphaned':
      return '#9e4aff';
    case 'idle':
    default:
      return '#888';
  }
}

function getAgentIcon(agent: Agent): string {
  const builtInClass = BUILT_IN_AGENT_CLASSES[agent.class as keyof typeof BUILT_IN_AGENT_CLASSES];
  return builtInClass?.icon || '🤖';
}

function AgentCard({ agent, onDoubleClick }: AgentCardProps) {
  const statusColor = getStatusColor(agent.status);
  const statusIcon = getStatusIcon(agent.status);
  const agentIcon = getAgentIcon(agent);

  return (
    <div
      className={`pip-agent-card pip-status-${agent.status}`}
      onDoubleClick={() => onDoubleClick(agent.id)}
      title="Double-click to view conversation"
    >
      <div className="pip-agent-header">
        <span className="pip-agent-icon">{agentIcon}</span>
        <span className="pip-agent-name">{agent.name}</span>
        <span className="pip-agent-status" style={{ color: statusColor }}>
          {statusIcon}
        </span>
      </div>

      {agent.status === 'working' && agent.currentTask && (
        <div className="pip-agent-task">
          {agent.currentTask.length > 60
            ? agent.currentTask.slice(0, 60) + '...'
            : agent.currentTask}
        </div>
      )}

      {agent.currentTool && (
        <div className="pip-agent-tool">
          <span className="pip-tool-label">Tool:</span> {agent.currentTool}
        </div>
      )}

      <div className="pip-agent-context">
        <div className="pip-context-bar">
          <div
            className="pip-context-fill"
            style={{
              width: `${Math.min(Math.round((agent.contextUsed / agent.contextLimit) * 100), 100)}%`,
              backgroundColor:
                (agent.contextUsed / agent.contextLimit) * 100 > 80
                  ? '#ff4a4a'
                  : (agent.contextUsed / agent.contextLimit) * 100 > 50
                    ? '#ff9e4a'
                    : '#4aff9e',
            }}
          />
        </div>
        <span className="pip-context-percent">{Math.round((agent.contextUsed / agent.contextLimit) * 100)}%</span>
      </div>
    </div>
  );
}

/**
 * Context statistics view - shows detailed context usage info
 */
interface ContextStatsViewProps {
  agent: Agent;
  onBack: () => void;
}

// Format token count with K/M suffixes
function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
}

// Category colors matching ContextViewModal
const CATEGORY_COLORS: Record<string, string> = {
  systemPrompt: '#4a9eff',      // Blue
  systemTools: '#9e4aff',       // Purple
  messages: '#4aff9e',          // Green
  freeSpace: 'rgba(255,255,255,0.1)', // Transparent
  autocompactBuffer: '#ff9e4a', // Orange
};

const CATEGORY_LABELS: Record<string, string> = {
  systemPrompt: 'System Prompt',
  systemTools: 'System Tools',
  messages: 'Messages',
  freeSpace: 'Free Space',
  autocompactBuffer: 'Autocompact Buffer',
};

function ContextStatsView({ agent, onBack }: ContextStatsViewProps) {
  const agentIcon = getAgentIcon(agent);
  const statusColor = getStatusColor(agent.status);
  const stats = agent.contextStats;

  // Calculate context color based on usage
  const contextUsedPercent = Math.round((agent.contextUsed / agent.contextLimit) * 100);
  const contextColor =
    (agent.contextUsed / agent.contextLimit) * 100 > 80
      ? '#ff4a4a'
      : (agent.contextUsed / agent.contextLimit) * 100 > 50
        ? '#ff9e4a'
        : '#4aff9e';

  // Category order for display
  const categoryOrder = ['systemPrompt', 'systemTools', 'messages', 'autocompactBuffer', 'freeSpace'] as const;

  return (
    <div className="pip-container pip-stats-container">
      <div className="pip-header pip-header-conversation">
        <button className="pip-back-btn" onClick={onBack} title="Back to conversation">
          ←
        </button>
        <span className="pip-agent-icon">{agentIcon}</span>
        <span className="pip-title">{agent.name}</span>
        <span className="pip-agent-status-small" style={{ color: statusColor }}>
          {getStatusIcon(agent.status)}
        </span>
      </div>

      <div className="pip-stats-content">
        {!stats ? (
          // No detailed stats available - show simple view
          <div className="pip-stats-section">
            <h3 className="pip-stats-title">Context Usage</h3>

            <div className="pip-stats-bar-container">
              <div className="pip-stats-bar">
                <div
                  className="pip-stats-bar-fill"
                  style={{
                    width: `${Math.min(contextUsedPercent, 100)}%`,
                    backgroundColor: contextColor,
                  }}
                />
              </div>
              <span className="pip-stats-percent" style={{ color: contextColor }}>
                {contextUsedPercent}%
              </span>
            </div>

            <div className="pip-stats-info">
              <p className="pip-stats-info-text">
                Context usage represents how much of the conversation window is filled.
                Detailed breakdown not available yet.
              </p>
            </div>
          </div>
        ) : (
          // Detailed stats available - show breakdown
          <>
            {/* Model info */}
            <div className="pip-model-info">
              <div className="pip-model-info-item">
                <div className="pip-model-info-label">Model</div>
                <div className="pip-model-info-value">{stats.model}</div>
              </div>
              <div className="pip-model-info-item">
                <div className="pip-model-info-label">Window</div>
                <div className="pip-model-info-value">{formatTokens(stats.contextWindow)}</div>
              </div>
            </div>

            {/* Overall usage bar */}
            <div className="pip-stats-section">
              <div className="pip-usage-header">
                <span className="pip-usage-label">Context Usage</span>
                <span className="pip-usage-value" style={{ color: contextColor }}>
                  {formatTokens(stats.totalTokens)} / {formatTokens(stats.contextWindow)} ({stats.usedPercent}%)
                </span>
              </div>

              {/* Stacked bar */}
              <div className="pip-stacked-bar">
                {categoryOrder.map((key) => {
                  const category = stats.categories[key];
                  if (!category || category.percent <= 0) return null;
                  return (
                    <div
                      key={key}
                      className="pip-stacked-bar-segment"
                      style={{
                        width: `${category.percent}%`,
                        backgroundColor: CATEGORY_COLORS[key],
                      }}
                      title={`${CATEGORY_LABELS[key]}: ${formatTokens(category.tokens)}`}
                    />
                  );
                })}
              </div>
            </div>

            {/* Category breakdown */}
            <div className="pip-stats-section">
              <h3 className="pip-stats-title">Token Breakdown</h3>
              <div className="pip-category-list">
                {categoryOrder.map((key) => {
                  const category = stats.categories[key];
                  if (!category) return null;

                  const isFreeSpace = key === 'freeSpace';
                  return (
                    <div
                      key={key}
                      className={`pip-category-item ${isFreeSpace ? 'free-space' : ''}`}
                    >
                      <div
                        className="pip-category-color"
                        style={{ backgroundColor: CATEGORY_COLORS[key] }}
                      />
                      <div className="pip-category-info">
                        <div className="pip-category-name">{CATEGORY_LABELS[key]}</div>
                        <div className="pip-category-tokens">
                          {formatTokens(category.tokens)} ({category.percent.toFixed(1)}%)
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Last updated */}
            <div className="pip-stats-updated">
              Updated: {new Date(stats.lastUpdated).toLocaleTimeString()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Simplified conversation view for PiP window
 */
interface ConversationViewProps {
  agentId: string;
  onBack: () => void;
}

function ConversationView({ agentId, onBack }: ConversationViewProps) {
  const agent = useAgent(agentId);
  const outputs = useAgentOutputs(agentId);
  const outputsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState('');
  const [showContextStats, setShowContextStats] = useState(false);

  // Drag-to-scroll state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, scrollTop: 0 });
  const [showScrollButtons, setShowScrollButtons] = useState({ top: false, bottom: true });

  // Update scroll button visibility based on scroll position
  const updateScrollButtons = useCallback(() => {
    if (!outputsRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = outputsRef.current;
    setShowScrollButtons({
      top: scrollTop > 20,
      bottom: scrollTop < scrollHeight - clientHeight - 20,
    });
  }, []);

  // Auto-scroll to bottom when new outputs arrive
  React.useEffect(() => {
    if (outputsRef.current) {
      outputsRef.current.scrollTop = outputsRef.current.scrollHeight;
      updateScrollButtons();
    }
  }, [outputs.length, updateScrollButtons]);

  // Scroll handlers for buttons
  const scrollUp = useCallback(() => {
    if (!outputsRef.current) return;
    outputsRef.current.scrollBy({ top: -200, behavior: 'smooth' });
  }, []);

  const scrollDown = useCallback(() => {
    if (!outputsRef.current) return;
    outputsRef.current.scrollBy({ top: 200, behavior: 'smooth' });
  }, []);

  // Drag-to-scroll handlers - only activate with middle mouse button or when shift is held
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!outputsRef.current) return;

    // Check if click is on the scrollbar (approximate detection)
    const target = e.currentTarget;
    const isScrollbarClick =
      e.clientX > target.clientWidth - 10 || // Scrollbar area (rough estimate)
      e.clientY > target.clientHeight - 10;

    // Don't interfere with scrollbar clicks
    if (isScrollbarClick) return;

    // Only start drag with middle mouse button (button 1) or shift + left click
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      e.preventDefault();
      setIsDragging(true);
      setDragStart({
        x: e.clientX,
        y: e.clientY,
        scrollTop: outputsRef.current.scrollTop,
      });
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !outputsRef.current) return;
    e.preventDefault();
    const deltaY = e.clientY - dragStart.y;
    outputsRef.current.scrollTop = dragStart.scrollTop - deltaY;
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Send message handler
  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || !agent) return;

    // Don't send if agent is working (could interrupt)
    if (agent.status === 'working') return;

    sendMessage({
      type: 'send_command',
      payload: {
        agentId,
        command: trimmed,
      },
    });

    setInputValue('');
    inputRef.current?.focus();
  }, [inputValue, agentId, agent]);

  // Handle Enter key
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  if (!agent) {
    return (
      <div className="pip-container">
        <div className="pip-header pip-header-conversation">
          <button className="pip-back-btn" onClick={onBack} title="Back to agents list">
            ←
          </button>
          <span className="pip-title">Agent not found</span>
        </div>
      </div>
    );
  }

  const agentIcon = getAgentIcon(agent);
  const statusColor = getStatusColor(agent.status);
  const isWorking = agent.status === 'working';

  // If showing context stats, render that view instead
  if (showContextStats) {
    return (
      <ContextStatsView
        agent={agent}
        onBack={() => setShowContextStats(false)}
      />
    );
  }

  return (
    <div className="pip-container pip-conversation-container">
      <div className="pip-header pip-header-conversation">
        <button className="pip-back-btn" onClick={onBack} title="Back to agents list">
          ←
        </button>
        <span className="pip-agent-icon">{agentIcon}</span>
        <span className="pip-title">{agent.name}</span>
        <span className="pip-agent-status-small" style={{ color: statusColor }}>
          {getStatusIcon(agent.status)}
        </span>
      </div>

      {/* Context stats button below header */}
      <div className="pip-context-stats-btn" onClick={() => setShowContextStats(true)}>
        <span className="pip-context-bar-mini">
          <span
            className="pip-context-fill-mini"
            style={{
              width: `${Math.min(Math.round((agent.contextUsed / agent.contextLimit) * 100), 100)}%`,
              backgroundColor:
                (agent.contextUsed / agent.contextLimit) * 100 > 80
                  ? '#ff4a4a'
                  : (agent.contextUsed / agent.contextLimit) * 100 > 50
                    ? '#ff9e4a'
                    : '#4aff9e',
            }}
          />
        </span>
        <span className="pip-context-text">
          {Math.round((agent.contextUsed / agent.contextLimit) * 100)}% context used
        </span>
        <span className="pip-context-arrow">›</span>
      </div>

      <div className="pip-conversation-wrapper">
        <div
          className="pip-conversation"
          ref={outputsRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onScroll={updateScrollButtons}
          style={{
            cursor: isDragging ? 'grabbing' : 'default',
            userSelect: isDragging ? 'none' : 'auto',
          }}
        >
          {outputs.length === 0 ? (
            <div className="pip-empty">
              <p>No conversation yet</p>
            </div>
          ) : (
            outputs.map((output, index) => (
              <PiPOutputLine key={`${output.timestamp}-${index}`} output={output} />
            ))
          )}
        </div>

        {/* Scroll control buttons */}
        <div className="pip-scroll-controls">
          {showScrollButtons.top && (
            <button
              className="pip-scroll-btn pip-scroll-up"
              onClick={scrollUp}
              title="Scroll up"
            >
              ↑
            </button>
          )}
          {showScrollButtons.bottom && (
            <button
              className="pip-scroll-btn pip-scroll-down"
              onClick={scrollDown}
              title="Scroll down"
            >
              ↓
            </button>
          )}
        </div>
      </div>

      {agent.currentTool && (
        <div className="pip-current-tool">
          <span className="pip-tool-indicator">Using: {agent.currentTool}</span>
        </div>
      )}

      {/* Input area - using inline styles since PiP window may not have all CSS */}
      <div
        className="pip-input-area"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px',
          background: 'rgba(68, 71, 90, 0.6)',
          borderTop: '1px solid rgba(98, 114, 164, 0.3)',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          className="pip-input"
          placeholder={isWorking ? 'Agent is working...' : 'Send a message...'}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isWorking}
          style={{
            flex: 1,
            background: isWorking ? 'rgba(68, 71, 90, 0.4)' : 'rgba(40, 42, 54, 0.8)',
            border: '1px solid rgba(98, 114, 164, 0.4)',
            borderRadius: '4px',
            padding: '6px 10px',
            fontSize: '11px',
            color: '#f8f8f2',
            outline: 'none',
            opacity: isWorking ? 0.5 : 1,
            cursor: isWorking ? 'not-allowed' : 'text',
          }}
        />
        <button
          className="pip-send-btn"
          onClick={handleSend}
          disabled={isWorking || !inputValue.trim()}
          title="Send message"
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '4px',
            background: isWorking || !inputValue.trim() ? '#6272a4' : '#8be9fd',
            border: 'none',
            color: '#282a36',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: isWorking || !inputValue.trim() ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: isWorking || !inputValue.trim() ? 0.4 : 1,
          }}
        >
          ↑
        </button>
      </div>
    </div>
  );
}

/**
 * Collapsible Tool Input component - styled like the main panel's tool history
 */
interface ToolInputDisplayProps {
  toolName: string;
  input: string;
  timeStr: string;
}

const TOOL_ICONS: Record<string, string> = {
  Read: '📖',
  Edit: '✏️',
  Write: '📝',
  Bash: '💻',
  Grep: '🔍',
  Glob: '📁',
  Task: '🤖',
  WebFetch: '🌐',
  WebSearch: '🔎',
  TodoWrite: '📋',
  AskUserQuestion: '❓',
};

function getToolIcon(tool: string): string {
  return TOOL_ICONS[tool] || '🔧';
}

/**
 * Format tool input for inline display (single line summary)
 */
function formatToolInputInline(toolName: string, data: Record<string, unknown>): string {
  switch (toolName) {
    case 'Read': {
      const filePath = String(data.file_path || data.path || '');
      if (filePath.length > 40) {
        const parts = filePath.split(/[/\\]/);
        return '.../' + parts.slice(-2).join('/');
      }
      return filePath || toolName;
    }
    case 'Write': {
      const filePath = String(data.file_path || data.path || '');
      if (filePath.length > 40) {
        const parts = filePath.split(/[/\\]/);
        return '.../' + parts.slice(-2).join('/');
      }
      return filePath || toolName;
    }
    case 'Edit': {
      const filePath = String(data.file_path || data.path || '');
      const oldStr = String(data.old_string || '');
      const newStr = String(data.new_string || '');

      // Show file path with change indicator
      let displayPath = filePath;
      if (filePath.length > 30) {
        const parts = filePath.split(/[/\\]/);
        displayPath = '.../' + parts.slice(-2).join('/');
      }

      // Add change size info
      const changeInfo = oldStr && newStr
        ? ` (${oldStr.length}→${newStr.length} chars)`
        : '';

      return `${displayPath}${changeInfo}`;
    }
    case 'Bash': {
      const cmd = String(data.command || '');
      return cmd.length > 50 ? cmd.slice(0, 47) + '...' : cmd || toolName;
    }
    case 'Grep':
      return data.pattern ? `"${data.pattern}"` : toolName;
    case 'Glob':
      return String(data.pattern || '') || toolName;
    case 'Task': {
      const desc = String(data.description || '');
      return desc ? (desc.length > 40 ? desc.slice(0, 37) + '...' : desc) : toolName;
    }
    case 'WebFetch': {
      const url = String(data.url || '');
      return url.length > 50 ? url.slice(0, 47) + '...' : url || toolName;
    }
    case 'WebSearch':
      return String(data.query || '') || toolName;
    case 'TodoWrite': {
      const todos = data.todos as unknown[];
      return todos?.length ? `${todos.length} item${todos.length > 1 ? 's' : ''}` : toolName;
    }
    default:
      return toolName;
  }
}

/**
 * Format expanded tool details (shown when expanded)
 */
function formatExpandedToolInput(toolName: string, data: Record<string, unknown>): string {
  switch (toolName) {
    case 'Write': {
      const content = String(data.content || '');
      const filePath = String(data.file_path || data.path || '');
      const truncated = content.length > 1000 ? content.slice(0, 1000) + '\n\n... (truncated)' : content;
      return `file: ${filePath}\n\n${truncated}`;
    }
    case 'Edit': {
      const lines: string[] = [];
      if (data.file_path) lines.push(`file: ${data.file_path}`);
      if (data.old_string) {
        const old = String(data.old_string);
        lines.push(`\n- old:\n${old.slice(0, 400)}${old.length > 400 ? '...' : ''}`);
      }
      if (data.new_string) {
        const newStr = String(data.new_string);
        lines.push(`\n+ new:\n${newStr.slice(0, 400)}${newStr.length > 400 ? '...' : ''}`);
      }
      return lines.join('\n');
    }
    case 'Bash':
      return String(data.command || '');
    case 'TodoWrite': {
      const todos = data.todos as Array<{ content: string; status: string }> | undefined;
      if (!todos) return JSON.stringify(data, null, 2);
      return todos.map((t) => {
        const icon = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '→' : '○';
        return `${icon} ${t.content}`;
      }).join('\n');
    }
    default:
      return JSON.stringify(data, null, 2);
  }
}

function ToolInputDisplay({ toolName, input, timeStr }: ToolInputDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Parse input
  let parsedData: Record<string, unknown> | null = null;
  try {
    parsedData = JSON.parse(input);
  } catch {
    // Not JSON, use raw input
  }

  const inlineDisplay = parsedData ? formatToolInputInline(toolName, parsedData) : input.slice(0, 50);
  const hasDetails = parsedData && Object.keys(parsedData).length > 0;

  return (
    <div className={`pip-tool-item ${isExpanded ? 'expanded' : ''} ${hasDetails ? 'clickable' : ''}`}>
      <div
        className="pip-tool-row"
        onClick={hasDetails ? () => setIsExpanded(!isExpanded) : undefined}
      >
        <span className="pip-tool-expand">{hasDetails ? (isExpanded ? '▼' : '▶') : ' '}</span>
        <span className="pip-tool-icon">{getToolIcon(toolName)}</span>
        <span className="pip-tool-input-inline" title={inlineDisplay}>{inlineDisplay}</span>
        <span className="pip-tool-time">{timeStr}</span>
      </div>
      {isExpanded && parsedData && (
        <div className="pip-tool-expanded">
          <div className="pip-tool-expanded-header">
            <span className="pip-tool-expanded-name">{toolName}</span>
          </div>
          <pre className="pip-tool-expanded-content">
            {formatExpandedToolInput(toolName, parsedData)}
          </pre>
        </div>
      )}
    </div>
  );
}

/**
 * Parse boss context from user prompt
 */
function parseBossContext(content: string): { hasContext: boolean; context: string | null; userMessage: string } {
  const trimmedContent = content.trimStart();

  if (!trimmedContent.startsWith(BOSS_CONTEXT_START)) {
    return { hasContext: false, context: null, userMessage: content };
  }

  const endIdx = trimmedContent.lastIndexOf(BOSS_CONTEXT_END);

  if (endIdx === -1) {
    return { hasContext: false, context: null, userMessage: content };
  }

  const context = trimmedContent.slice(BOSS_CONTEXT_START.length, endIdx).trim();
  const userMessage = trimmedContent.slice(endIdx + BOSS_CONTEXT_END.length).trim();

  return { hasContext: true, context, userMessage };
}

/**
 * Boss Context Component for PiP
 */
interface PipBossContextProps {
  context: string;
}

function PipBossContext({ context }: PipBossContextProps) {
  const [collapsed, setCollapsed] = useState(true);

  // Extract agent count from the "# YOUR TEAM (N agents)" header
  const teamMatch = context.match(/# YOUR TEAM \((\d+) agents?\)/);
  const agentCount = teamMatch ? parseInt(teamMatch[1], 10) : 0;

  return (
    <div className={`pip-boss-context ${collapsed ? 'collapsed' : 'expanded'}`}>
      <div className="pip-boss-context-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="pip-boss-context-icon">👑</span>
        <span className="pip-boss-context-label">
          Team Context ({agentCount} agent{agentCount !== 1 ? 's' : ''})
        </span>
        <span className="pip-boss-context-toggle">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && (
        <div className="pip-boss-context-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{context}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

/**
 * Simplified output line for PiP conversation view
 */
interface PiPOutputLineProps {
  output: ClaudeOutput;
}

// Patterns to filter out system/noise messages
const FILTER_PATTERNS = [
  /^Context usage:/i,
  /^Context Usage$/i,
  /^## Context Usage$/i,
  /^Tokens:/i,
  /^\d+k?\s*\/\s*\d+k?\s*tokens/i,
  /^Cost:/i,
  /^\$[\d.]+\s*(USD)?/i,
  /^Session started/i,
  /^Session resumed/i,
  /^Autocompact/i,
  /^╭─+╮/,
  /^│.*│$/,
  /^╰─+╯/,
  /^Model:/i,
  /^Total cost/i,
  /^Duration:/i,
  /^\*\*Model:\*\*/i,
  /^\*\*Tokens:\*\*/i,
  /^### Estimated usage by category$/i,
  /^\| Category \| Tokens \| Percentage \|$/i,
  /^\|[-\s|]+\|$/i,  // Table separator lines
  /^\| .+ \| .+k? \| .+% \|$/i,  // Table content lines
  /^System prompt\s+\d/i,
  /^System tools\s+\d/i,
  /^Messages\s+\d/i,
  /^Free space\s+\d/i,
  /^Autocompact buffer\s+\d/i,
];

function shouldFilterMessage(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  // Check if the ENTIRE message contains context usage blocks
  // This catches multi-line context output that comes as a single message
  const lowerText = trimmed.toLowerCase();

  // Strong indicators that this is a context usage message
  if (lowerText.includes('context usage') && lowerText.includes('estimated usage by category')) {
    return true;
  }

  if (lowerText.includes('| category | tokens | percentage |')) {
    return true;
  }

  // Check if message is primarily a context stats table
  const lines = trimmed.split('\n');
  const tableLines = lines.filter(line => /^\|.+\|.+\|.+\|$/.test(line.trim()));
  if (tableLines.length > 3) {
    // If more than 3 lines are table format, it's likely a context table
    return true;
  }

  // Filter individual lines against patterns
  for (const line of lines) {
    const lineTrimmed = line.trim();

    // Skip empty lines
    if (!lineTrimmed) continue;

    // Check against filter patterns
    for (const pattern of FILTER_PATTERNS) {
      if (pattern.test(lineTrimmed)) {
        // If this line matches a filter pattern, check if it's a significant portion
        // of the message (not just one line out of many)
        if (lines.length <= 3) {
          // Short message, filter it
          return true;
        }
      }
    }
  }

  // Filter short technical lines
  if (trimmed.length < 5 && /^[─│╭╮╰╯\s]+$/.test(trimmed)) return true;

  return false;
}

// Track the last used tool name to associate with tool inputs
let lastToolName = 'Tool';

function PiPOutputLine({ output }: PiPOutputLineProps) {
  const { text, isUserPrompt, isStreaming, isDelegation, timestamp } = output;

  // Format timestamp
  const date = new Date(timestamp || Date.now());
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Filter out system messages
  if (shouldFilterMessage(text)) {
    return null;
  }

  // Handle "Using tool:" lines - capture tool name for next input
  if (text.startsWith('Using tool:')) {
    const toolName = text.replace('Using tool:', '').trim();
    lastToolName = toolName; // Store for next Tool input line
    return (
      <div className="pip-output-line pip-output-tool">
        <span className="pip-output-time">{timeStr}</span>
        <span className="pip-output-tool-name">🔧 {toolName}</span>
      </div>
    );
  }

  // Handle "Tool input:" lines - show inline with collapsible details
  if (text.startsWith('Tool input:')) {
    const inputContent = text.replace('Tool input:', '').trim();

    // Use the last captured tool name
    const toolName = lastToolName;

    return (
      <ToolInputDisplay
        toolName={toolName}
        input={inputContent}
        timeStr={timeStr}
      />
    );
  }

  // Handle delegation messages
  if (isDelegation) {
    const displayText = text.length > 1000 ? text.slice(0, 1000) + '...' : text;
    return (
      <div className="pip-output-line pip-output-delegation">
        <span className="pip-output-time">{timeStr}</span>
        <span className="pip-output-delegation-icon">📤</span>
        <div className="pip-output-text pip-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayText}</ReactMarkdown>
        </div>
      </div>
    );
  }

  // User prompts
  if (isUserPrompt) {
    // Hide utility commands
    const trimmed = text.trim();
    if (trimmed === '/context' || trimmed === '/cost' || trimmed === '/compact') {
      return null;
    }

    // Parse boss context if present
    const parsed = parseBossContext(text);

    return (
      <div className="pip-output-line pip-output-user">
        <span className="pip-output-time">{timeStr}</span>
        <span className="pip-output-role">You:</span>
        <div className="pip-output-text pip-markdown">
          {parsed.hasContext && parsed.context && (
            <PipBossContext context={parsed.context} />
          )}
          {parsed.userMessage && (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {parsed.userMessage.length > 1000 ? parsed.userMessage.slice(0, 1000) + '...' : parsed.userMessage}
            </ReactMarkdown>
          )}
        </div>
      </div>
    );
  }

  // Claude responses
  const displayText = text.length > 1000 ? text.slice(0, 1000) + '...' : text;
  return (
    <div className={`pip-output-line pip-output-claude ${isStreaming ? 'pip-streaming' : ''}`}>
      <span className="pip-output-time">{timeStr}</span>
      <div className="pip-output-text pip-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayText}</ReactMarkdown>
      </div>
    </div>
  );
}

/**
 * Agents list view
 */
interface AgentsListProps {
  onSelectAgent: (agentId: string) => void;
}

function AgentsList({ onSelectAgent }: AgentsListProps) {
  const agents = useAgentsArray();

  // Filter to show working agents first, then others
  const workingAgents = agents.filter((a) => a.status === 'working');
  const waitingAgents = agents.filter(
    (a) => a.status === 'waiting' || a.status === 'waiting_permission'
  );
  const otherAgents = agents.filter(
    (a) =>
      a.status !== 'working' &&
      a.status !== 'waiting' &&
      a.status !== 'waiting_permission'
  );

  const totalAgents = agents.length;
  const activeCount = workingAgents.length + waitingAgents.length;

  return (
    <div className="pip-container">
      <div className="pip-header">
        <span className="pip-title">Tide Commander</span>
        <span className="pip-stats">
          {activeCount}/{totalAgents} active
        </span>
      </div>

      <div className="pip-agents-list">
        {workingAgents.length > 0 && (
          <div className="pip-section">
            <div className="pip-section-title">Working ({workingAgents.length})</div>
            {workingAgents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} onDoubleClick={onSelectAgent} />
            ))}
          </div>
        )}

        {waitingAgents.length > 0 && (
          <div className="pip-section">
            <div className="pip-section-title">Waiting ({waitingAgents.length})</div>
            {waitingAgents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} onDoubleClick={onSelectAgent} />
            ))}
          </div>
        )}

        {otherAgents.length > 0 && (
          <div className="pip-section">
            <div className="pip-section-title">Idle ({otherAgents.length})</div>
            {otherAgents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} onDoubleClick={onSelectAgent} />
            ))}
          </div>
        )}

        {agents.length === 0 && (
          <div className="pip-empty">
            <p>No agents spawned yet</p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Main view for the PiP window with navigation support
 */
export function AgentsPiPView() {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const handleSelectAgent = (agentId: string) => {
    setSelectedAgentId(agentId);
  };

  const handleBack = () => {
    setSelectedAgentId(null);
  };

  if (selectedAgentId) {
    return <ConversationView agentId={selectedAgentId} onBack={handleBack} />;
  }

  return <AgentsList onSelectAgent={handleSelectAgent} />;
}

export default AgentsPiPView;
