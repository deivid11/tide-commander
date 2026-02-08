/**
 * AgentsPiPView Component
 * Displays working agents in a compact view for the PiP window
 * Reuses Guake terminal components for consistent conversation rendering
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useAgentsArray, useAgent, useAgentOutputs, useReconnectCount, useLastPrompts } from '../../store/selectors';
import { store } from '../../store';
import { BUILT_IN_AGENT_CLASSES, type Agent, type AgentStatus } from '../../../shared/types';

// Reuse Guake terminal components
import { useHistoryLoader } from '../ClaudeOutputPanel/useHistoryLoader';
import { useFilteredOutputsWithLogging } from '../shared/useFilteredOutputs';
import { HistoryLine } from '../ClaudeOutputPanel/HistoryLine';
import { OutputLine } from '../ClaudeOutputPanel/OutputLine';
import type { EnrichedHistoryMessage, ViewMode } from '../ClaudeOutputPanel/types';

// Reuse UnitPanel components
import { ContextBar } from '../UnitPanel/AgentStatsRow';
import { calculateContextInfo } from '../UnitPanel/agentUtils';

import './pip-styles.scss';

interface AgentCardProps {
  agent: Agent;
  onClick: (agentId: string) => void;
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

function AgentCard({ agent, onClick }: AgentCardProps) {
  const statusColor = getStatusColor(agent.status);
  const statusIcon = getStatusIcon(agent.status);
  const agentIcon = getAgentIcon(agent);

  return (
    <div
      className={`pip-agent-card pip-status-${agent.status}`}
      onClick={() => onClick(agent.id)}
      title="Click to view conversation"
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
 * Conversation view using Guake terminal components
 */
interface ConversationViewProps {
  agentId: string;
  onBack: () => void;
}

function ConversationView({ agentId, onBack }: ConversationViewProps) {
  const agent = useAgent(agentId);
  const outputs = useAgentOutputs(agentId);
  const reconnectCount = useReconnectCount();
  const lastPrompts = useLastPrompts();
  const outputScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState('');
  const [showContextStats, setShowContextStats] = useState(false);
  const [viewMode] = useState<ViewMode>('simple'); // PiP always uses simple view

  const hasSessionId = !!agent?.sessionId;

  // Use the same history loader as Guake terminal
  const historyLoader = useHistoryLoader({
    selectedAgentId: agentId,
    hasSessionId,
    reconnectCount,
    lastPrompts,
    outputScrollRef,
  });

  // Use the same filtered outputs as Guake terminal
  const filteredOutputs = useFilteredOutputsWithLogging({ outputs, viewMode });

  // Memoized filtered history (same logic as Guake terminal)
  const filteredHistory = useMemo((): EnrichedHistoryMessage[] => {
    const { history } = historyLoader;
    const toolResultMap = new Map<string, string>();
    for (const msg of history) {
      if (msg.type === 'tool_result' && msg.toolUseId) {
        toolResultMap.set(msg.toolUseId, msg.content);
      }
    }

    const enrichHistory = (messages: typeof history): EnrichedHistoryMessage[] => {
      return messages.map((msg) => {
        if (msg.type === 'tool_use' && msg.toolName === 'Bash' && msg.toolUseId) {
          const bashOutput = toolResultMap.get(msg.toolUseId);
          let bashCommand: string | undefined;
          try {
            const input = msg.toolInput || (msg.content ? JSON.parse(msg.content) : {});
            bashCommand = input.command;
          } catch { /* ignore */ }
          return { ...msg, _bashOutput: bashOutput, _bashCommand: bashCommand };
        }
        return msg as EnrichedHistoryMessage;
      });
    };

    // Simple view filtering (same as Guake)
    return enrichHistory(history.filter((msg) => msg.type === 'user' || msg.type === 'assistant' || msg.type === 'tool_use'));
  }, [historyLoader.history]);

  // Scroll button visibility state
  const [showScrollButtons, setShowScrollButtons] = useState({ top: false, bottom: true });

  // Update scroll button visibility based on scroll position
  const updateScrollButtons = useCallback(() => {
    if (!outputScrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = outputScrollRef.current;
    setShowScrollButtons({
      top: scrollTop > 20,
      bottom: scrollTop < scrollHeight - clientHeight - 20,
    });
  }, []);

  // Auto-scroll to bottom when new outputs arrive
  useEffect(() => {
    if (outputScrollRef.current) {
      outputScrollRef.current.scrollTop = outputScrollRef.current.scrollHeight;
      updateScrollButtons();
    }
  }, [outputs.length, filteredHistory.length, updateScrollButtons]);

  // Scroll handlers for buttons
  const scrollUp = useCallback(() => {
    if (!outputScrollRef.current) return;
    outputScrollRef.current.scrollBy({ top: -200, behavior: 'smooth' });
  }, []);

  const scrollDown = useCallback(() => {
    if (!outputScrollRef.current) return;
    outputScrollRef.current.scrollBy({ top: 200, behavior: 'smooth' });
  }, []);

  // Send message handler - using store.sendCommand like Guake
  // Always allow sending, even when agent is working (will queue/interrupt)
  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || !agent) return;

    store.sendCommand(agentId, trimmed);
    setInputValue('');
    // Re-focus input after sending (with delay for PiP window)
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [inputValue, agentId, agent]);

  // Handle input change
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  }, []);

  // Handle Enter key
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // Focus input on mount and when switching agents
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [agentId]);

  // File click handler (open file viewer)
  const handleFileClick = useCallback((path: string, editData?: { oldString?: string; newString?: string; operation?: string; highlightRange?: { offset: number; limit: number } }) => {
    store.setFileViewerPath(path, editData);
  }, []);

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

      {/* Context bar - reusing UnitPanel component */}
      <div className="pip-context-section">
        <ContextBar
          contextInfo={calculateContextInfo(agent)}
          onClick={() => setShowContextStats(true)}
        />
      </div>

      <div className="pip-conversation-wrapper">
        <div
          className="pip-conversation guake-output"
          ref={outputScrollRef}
          onScroll={updateScrollButtons}
        >
          {/* Load more button - only when we have history */}
          {!historyLoader.loadingHistory && historyLoader.hasMore && (
            <div className="guake-load-more pip-load-more">
              {historyLoader.loadingMore ? (
                <span>Loading older messages...</span>
              ) : (
                <button onClick={historyLoader.loadMoreHistory}>
                  Load more ({historyLoader.totalCount - historyLoader.history.length} older)
                </button>
              )}
            </div>
          )}

          {/* Loading indicator */}
          {historyLoader.loadingHistory && (
            <div className="pip-loading-indicator">
              <span className="loading-dots"><span>.</span><span>.</span><span>.</span></span>
            </div>
          )}

          {/* History messages using Guake's HistoryLine component */}
          {filteredHistory.map((msg, index) => (
            <HistoryLine
              key={`h-${index}`}
              message={msg}
              agentId={agentId}
              simpleView={true}
              onFileClick={handleFileClick}
            />
          ))}

          {/* Live outputs using Guake's OutputLine component */}
          {filteredOutputs.map((output, index) => (
            <OutputLine
              key={`o-${index}`}
              output={output}
              agentId={agentId}
              onFileClick={handleFileClick}
            />
          ))}

          {/* Empty state - only when not loading and no messages */}
          {!historyLoader.loadingHistory && filteredHistory.length === 0 && filteredOutputs.length === 0 && agent.status !== 'working' && (
            <div className="pip-empty">
              <p>No conversation yet</p>
            </div>
          )}
        </div>

        {/* Scroll control buttons */}
        <div className="pip-scroll-controls">
          {showScrollButtons.top && (
            <button className="pip-scroll-btn pip-scroll-up" onClick={scrollUp} title="Scroll up">↑</button>
          )}
          {showScrollButtons.bottom && (
            <button className="pip-scroll-btn pip-scroll-down" onClick={scrollDown} title="Scroll down">↓</button>
          )}
        </div>
      </div>

      {/* Current tool indicator */}
      {agent.currentTool && (
        <div className="pip-current-tool">
          <span className="pip-tool-indicator">Using: {agent.currentTool}</span>
        </div>
      )}

      {/* Input area - always visible and always enabled */}
      <div className="pip-input-area">
        <input
          ref={inputRef}
          type="text"
          className="pip-input"
          placeholder={`Message ${agent.name}...`}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button
          className="pip-send-btn"
          onClick={handleSend}
          disabled={!inputValue.trim()}
          title="Send message"
        >
          ➤
        </button>
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
              <AgentCard key={agent.id} agent={agent} onClick={onSelectAgent} />
            ))}
          </div>
        )}

        {waitingAgents.length > 0 && (
          <div className="pip-section">
            <div className="pip-section-title">Waiting ({waitingAgents.length})</div>
            {waitingAgents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} onClick={onSelectAgent} />
            ))}
          </div>
        )}

        {otherAgents.length > 0 && (
          <div className="pip-section">
            <div className="pip-section-title">Idle ({otherAgents.length})</div>
            {otherAgents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} onClick={onSelectAgent} />
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
