import React, { useMemo } from 'react';
import { store, useAgents, useSelectedAgentIds } from '../store';
import { formatTokens, formatTimeAgo } from '../utils/formatting';
import { AGENT_STATUS_COLORS } from '../utils/colors';
import { ModelPreview } from './ModelPreview';

interface BottomToolbarProps {
  onFocusAgent: (agentId: string) => void;
  onKillAgent: (agentId: string) => void;
}

export function BottomToolbar({ onFocusAgent, onKillAgent }: BottomToolbarProps) {
  const agents = useAgents();
  const selectedAgentIds = useSelectedAgentIds();

  // Get the first selected agent (for single selection display)
  const selectedAgentId = useMemo(() =>
    selectedAgentIds.size === 1 ? Array.from(selectedAgentIds)[0] : null,
    [selectedAgentIds]
  );
  const selectedAgent = selectedAgentId ? agents.get(selectedAgentId) : null;

  // Calculate context usage from actual contextUsed/contextLimit
  const contextPercent = selectedAgent
    ? Math.min(100, ((selectedAgent.contextUsed || 0) / (selectedAgent.contextLimit || 200000)) * 100)
    : 0;

  // Get assigned area for this agent
  const assignedArea = selectedAgent ? store.getAreaForAgent(selectedAgent.id) : null;

  // Don't render if no agent selected
  if (!selectedAgent) {
    return null;
  }

  return (
    <div className="bottom-toolbar">
      {/* Left: Agent Portrait with 3D Preview */}
      <div className="bt-portrait-section">
        <div className="bt-model-container">
          <ModelPreview
            agentClass={selectedAgent.class}
            status={selectedAgent.status}
            width={100}
            height={115}
          />
        </div>
        <div className="bt-portrait-info">
          <div className="bt-agent-name">{selectedAgent.name}</div>
          <div className="bt-agent-class">{selectedAgent.class}</div>
          {assignedArea && (
            <div className="bt-agent-area">
              <span
                className="bt-area-dot"
                style={{ background: assignedArea.color }}
              />
              <span className="bt-area-name">{assignedArea.name}</span>
            </div>
          )}
        </div>
      </div>

      {/* Center: Stats & Activity */}
      <div className="bt-center-section">
        {/* Top bar with stats */}
        <div className="bt-stats-bar">
          <div className="bt-stat">
            <span className="bt-stat-label">STATUS</span>
            <span
              className="bt-stat-value"
              style={{ color: AGENT_STATUS_COLORS[selectedAgent.status] || AGENT_STATUS_COLORS.default }}
            >
              {selectedAgent.status.toUpperCase()}
            </span>
          </div>
          <div className="bt-stat">
            <span className="bt-stat-label">TOKENS</span>
            <span className="bt-stat-value">{formatTokens(selectedAgent.tokensUsed)}</span>
          </div>
          <div className="bt-stat">
            <span className="bt-stat-label">CTX</span>
            <div className="bt-context-bar">
              <div
                className="bt-context-fill"
                style={{
                  width: `${contextPercent}%`,
                  background:
                    contextPercent > 80
                      ? '#ff4a4a'
                      : contextPercent > 50
                        ? '#ff9e4a'
                        : '#4aff9e',
                }}
              />
            </div>
            <span className="bt-stat-value">{Math.round(contextPercent)}%</span>
          </div>
          <div className="bt-stat">
            <span className="bt-stat-label">UPTIME</span>
            <span className="bt-stat-value">{formatTimeAgo(selectedAgent.createdAt)}</span>
          </div>
        </div>

        {/* Working directory */}
        <div className="bt-cwd">
          <span className="bt-cwd-label">CWD:</span>
          <span className="bt-cwd-path">{selectedAgent.cwd}</span>
        </div>
      </div>

      {/* Right: Action Buttons */}
      <div className="bt-actions-section">
        <button
          className="bt-action-btn"
          onClick={() => onFocusAgent(selectedAgent.id)}
          title="Focus camera on agent"
        >
          <span className="bt-action-icon">👁️</span>
          <span className="bt-action-label">Focus</span>
          <span className="bt-action-hotkey">F</span>
        </button>
        <button
          className="bt-action-btn"
          onClick={() => {
            /* TODO: Implement pause */
          }}
          title="Pause agent"
        >
          <span className="bt-action-icon">⏸️</span>
          <span className="bt-action-label">Pause</span>
          <span className="bt-action-hotkey">P</span>
        </button>
        <button
          className="bt-action-btn bt-action-danger"
          onClick={() => onKillAgent(selectedAgent.id)}
          title="Terminate agent"
        >
          <span className="bt-action-icon">💀</span>
          <span className="bt-action-label">Kill</span>
          <span className="bt-action-hotkey">K</span>
        </button>
      </div>
    </div>
  );
}
