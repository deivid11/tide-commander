/**
 * TabContent - Placeholder content for each right panel tab
 *
 * Each tab renders its own content area. The "Chat" tab is the primary
 * integration point for ClaudeOutputPanel's existing terminal output.
 */

import React from 'react';
import type { RightPanelTab } from './types';
import type { Agent } from '../../../shared/types';

interface TabContentProps {
  tab: RightPanelTab;
  agent: Agent | null;
  agentId: string | null;
  /** Render prop: the Chat tab renders ClaudeOutputPanel content passed in here */
  chatContent?: React.ReactNode;
}

export const TabContent = React.memo(function TabContent({
  tab,
  agent,
  agentId,
  chatContent,
}: TabContentProps) {
  switch (tab) {
    case 'details':
      return <DetailsTab agent={agent} />;
    case 'chat':
      return <>{chatContent}</>;
    case 'logs':
      return <LogsTab agent={agent} agentId={agentId} />;
    case 'snapshot':
      return <SnapshotTab agent={agent} agentId={agentId} />;
    default:
      return null;
  }
});

// --- Details Tab ---

const DetailsTab = React.memo(function DetailsTab({ agent }: { agent: Agent | null }) {
  if (!agent) {
    return (
      <div className="right-panel-empty">
        <span className="empty-icon">📋</span>
        <span>Select an agent to view details</span>
      </div>
    );
  }

  const statusColor =
    agent.status === 'working' ? 'var(--accent-orange)' :
    agent.status === 'error' ? 'var(--accent-red)' :
    'var(--accent-green)';

  const contextUsed = agent.contextUsed || 0;
  const contextLimit = agent.contextLimit || 200000;
  const contextPercent = Math.round((contextUsed / contextLimit) * 100);

  return (
    <div className="right-panel-details">
      <div className="details-section">
        <div className="details-header">Agent Info</div>
        <div className="details-row">
          <span className="details-label">Name</span>
          <span className="details-value">{agent.name}</span>
        </div>
        <div className="details-row">
          <span className="details-label">Class</span>
          <span className="details-value details-class">{agent.class}</span>
        </div>
        <div className="details-row">
          <span className="details-label">Status</span>
          <span className="details-value" style={{ color: statusColor }}>{agent.status}</span>
        </div>
        {agent.cwd && (
          <div className="details-row">
            <span className="details-label">CWD</span>
            <span className="details-value details-mono">{agent.cwd}</span>
          </div>
        )}
      </div>

      <div className="details-section">
        <div className="details-header">Context</div>
        <div className="details-context-bar">
          <div className="details-context-fill" style={{ width: `${Math.min(100, contextPercent)}%` }} />
        </div>
        <div className="details-row">
          <span className="details-label">Usage</span>
          <span className="details-value">{(contextUsed / 1000).toFixed(1)}k / {(contextLimit / 1000).toFixed(1)}k ({contextPercent}%)</span>
        </div>
        <div className="details-row">
          <span className="details-label">Tasks</span>
          <span className="details-value">{agent.taskCount || 0}</span>
        </div>
        <div className="details-row">
          <span className="details-label">Tokens</span>
          <span className="details-value">{(agent.tokensUsed || 0).toLocaleString()}</span>
        </div>
      </div>

      {agent.permissionMode && (
        <div className="details-section">
          <div className="details-header">Configuration</div>
          <div className="details-row">
            <span className="details-label">Runtime</span>
            <span className="details-value details-mono">{agent.provider}</span>
          </div>
          <div className="details-row">
            <span className="details-label">Permission</span>
            <span className="details-value">{agent.permissionMode}</span>
          </div>
          {agent.provider === 'claude' && agent.model && (
            <div className="details-row">
              <span className="details-label">Model</span>
              <span className="details-value details-mono">{agent.model}</span>
            </div>
          )}
          {agent.provider === 'codex' && agent.codexModel && (
            <div className="details-row">
              <span className="details-label">Model</span>
              <span className="details-value details-mono">{agent.codexModel}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// --- Logs Tab ---

const LogsTab = React.memo(function LogsTab({ agent, agentId: _agentId }: { agent: Agent | null; agentId: string | null }) {
  if (!agent) {
    return (
      <div className="right-panel-empty">
        <span className="empty-icon">📜</span>
        <span>Select an agent to view logs</span>
      </div>
    );
  }

  return (
    <div className="right-panel-empty">
      <span className="empty-icon">📜</span>
      <span>Agent logs will appear here</span>
      <span className="empty-hint">Use the debug panel (🐛) for detailed message logs</span>
    </div>
  );
});

// --- Snapshot Tab ---

const SnapshotTab = React.memo(function SnapshotTab({ agent, agentId: _agentId }: { agent: Agent | null; agentId: string | null }) {
  if (!agent) {
    return (
      <div className="right-panel-empty">
        <span className="empty-icon">📸</span>
        <span>Select an agent to view snapshots</span>
      </div>
    );
  }

  return (
    <div className="right-panel-empty">
      <span className="empty-icon">📸</span>
      <span>Snapshots for {agent.name}</span>
      <span className="empty-hint">Save snapshots using the star button (⭐) in the terminal header</span>
    </div>
  );
});
