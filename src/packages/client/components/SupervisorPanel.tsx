import React from 'react';
import { useStore, store } from '../store';
import type { AgentAnalysis, SupervisorReport } from '../../shared/types';

interface SupervisorPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function SupervisorPanel({ isOpen, onClose }: SupervisorPanelProps) {
  const state = useStore();
  const { lastReport, enabled, lastReportTime, generatingReport, autoReportOnComplete } = state.supervisor;

  const handleRefresh = () => {
    store.requestSupervisorReport();
  };

  const handleToggle = () => {
    store.setSupervisorConfig({ enabled: !enabled });
  };

  const handleAutoReportToggle = () => {
    store.setSupervisorConfig({ autoReportOnComplete: !autoReportOnComplete });
  };

  if (!isOpen) return null;

  return (
    <div className="supervisor-panel-overlay" onClick={onClose}>
      <div className="supervisor-panel" onClick={(e) => e.stopPropagation()}>
        <div className="supervisor-header">
          <h2 className="supervisor-title">
            <span className="supervisor-icon">🎖️</span>
            Supervisor Overview
          </h2>
          <div className="supervisor-controls">
            <button
              className={`supervisor-toggle ${enabled ? 'active' : ''}`}
              onClick={handleToggle}
              title={enabled ? 'Disable supervisor' : 'Enable supervisor'}
            >
              {enabled ? '● Active' : '○ Paused'}
            </button>
            <button
              className={`supervisor-toggle auto-report ${autoReportOnComplete !== false ? 'active' : ''}`}
              onClick={handleAutoReportToggle}
              title={autoReportOnComplete !== false ? 'Disable auto-report on task complete' : 'Enable auto-report on task complete'}
            >
              {autoReportOnComplete !== false ? '⚡ Auto' : '◇ Manual'}
            </button>
            <button
              className="supervisor-refresh"
              onClick={handleRefresh}
              disabled={generatingReport}
            >
              {generatingReport ? 'Generating...' : '↻ Refresh'}
            </button>
            <button className="supervisor-close" onClick={onClose}>
              ×
            </button>
          </div>
        </div>

        {generatingReport ? (
          <div className="supervisor-loading">
            <div className="supervisor-loading-spinner"></div>
            <p>Generating supervisor report...</p>
          </div>
        ) : lastReport ? (
          <SupervisorReportView report={lastReport} />
        ) : (
          <div className="supervisor-empty">
            <p>No supervisor report available yet.</p>
            <button onClick={handleRefresh}>
              Generate First Report
            </button>
          </div>
        )}

        <div className="supervisor-footer">
          {lastReportTime && <span>Last report: {formatTimeAgo(lastReportTime)}</span>}
          {enabled && autoReportOnComplete !== false && <span>Auto-updates on task complete</span>}
          {enabled && autoReportOnComplete === false && <span>Manual updates only</span>}
        </div>
      </div>
    </div>
  );
}

function SupervisorReportView({ report }: { report: SupervisorReport }) {
  return (
    <div className="supervisor-report">
      {/* Overall Status Banner */}
      <div className={`supervisor-status-banner ${report.overallStatus}`}>
        <span className="status-icon">
          {report.overallStatus === 'healthy'
            ? '✓'
            : report.overallStatus === 'attention_needed'
              ? '⚠'
              : '!'}
        </span>
        <span className="status-text">
          {report.overallStatus === 'healthy'
            ? 'All Systems Healthy'
            : report.overallStatus === 'attention_needed'
              ? 'Attention Needed'
              : 'Critical Issues Detected'}
        </span>
      </div>

      {/* Insights Section */}
      {report.insights.length > 0 && (
        <div className="supervisor-section">
          <h3>Key Insights</h3>
          <ul className="supervisor-insights">
            {report.insights.map((insight, i) => (
              <li key={i}>{insight}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Agent Summaries */}
      <div className="supervisor-section">
        <h3>Agent Status</h3>
        <div className="supervisor-agents">
          {report.agentSummaries.map((agent) => (
            <AgentSummaryCard key={agent.agentId} agent={agent} />
          ))}
        </div>
      </div>

      {/* Recommendations */}
      {report.recommendations.length > 0 && (
        <div className="supervisor-section">
          <h3>Recommendations</h3>
          <ul className="supervisor-recommendations">
            {report.recommendations.map((rec, i) => (
              <li key={i}>{rec}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AgentSummaryCard({ agent }: { agent: AgentAnalysis }) {
  const progressColors: Record<string, string> = {
    on_track: '#4aff9e',
    stalled: '#ff9e4a',
    blocked: '#ff4a4a',
    completed: '#4a9eff',
    idle: '#888',
  };

  return (
    <div className="agent-summary-card">
      <div className="agent-summary-header">
        <span className="agent-summary-name">{agent.agentName}</span>
        <span
          className="agent-summary-progress"
          style={{ color: progressColors[agent.progress] || '#888' }}
        >
          {agent.progress.replace('_', ' ')}
        </span>
      </div>
      <p className="agent-summary-status">{agent.statusDescription}</p>
      <p className="agent-summary-work">{agent.recentWorkSummary}</p>
      {agent.concerns && agent.concerns.length > 0 && (
        <div className="agent-summary-concerns">
          {agent.concerns.map((concern, i) => (
            <span key={i} className="concern-tag">
              ⚠ {concern}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
