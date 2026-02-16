import React from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, store, useGlobalUsage, useRefreshingUsage } from '../store';
import type { AgentAnalysis, SupervisorReport, GlobalUsageStats } from '../../shared/types';

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
  const { t } = useTranslation(['terminal', 'common']);
  const state = useStore();
  const { lastReport, enabled, lastReportTime, generatingReport, autoReportOnComplete } = state.supervisor;
  const globalUsage = useGlobalUsage();
  const refreshingUsage = useRefreshingUsage();

  const handleRefresh = () => {
    store.requestSupervisorReport();
  };

  const handleToggle = () => {
    store.setSupervisorConfig({ enabled: !enabled });
  };

  const handleAutoReportToggle = () => {
    store.setSupervisorConfig({ autoReportOnComplete: !autoReportOnComplete });
  };

  const handleUsageRefresh = () => {
    store.requestGlobalUsage();
  };

  if (!isOpen) return null;

  return (
    <div className="supervisor-panel-overlay" onClick={onClose}>
      <div className="supervisor-panel" onClick={(e) => e.stopPropagation()}>
        <div className="supervisor-header">
          <h2 className="supervisor-title">
            <span className="supervisor-icon">🎖️</span>
            {t('terminal:supervisor.overview')}
          </h2>
          <div className="supervisor-controls">
            <button
              className={`supervisor-toggle ${enabled ? 'active' : ''}`}
              onClick={handleToggle}
              title={enabled ? 'Disable supervisor' : 'Enable supervisor'}
            >
              {enabled ? `● ${t('terminal:supervisor.active')}` : `○ ${t('terminal:supervisor.paused')}`}
            </button>
            <button
              className={`supervisor-toggle auto-report ${autoReportOnComplete ? 'active' : ''}`}
              onClick={handleAutoReportToggle}
              title={autoReportOnComplete ? 'Disable auto-report on task complete' : 'Enable auto-report on task complete'}
            >
              {autoReportOnComplete ? `⚡ ${t('terminal:supervisor.auto')}` : `◇ ${t('terminal:supervisor.manual')}`}
            </button>
            <button
              className="supervisor-refresh"
              onClick={handleRefresh}
              disabled={generatingReport}
            >
              {generatingReport ? t('terminal:supervisor.generating') : `↻ ${t('common:buttons.refresh')}`}
            </button>
            <button className="supervisor-close" onClick={onClose}>
              ×
            </button>
          </div>
        </div>

        {/* Global Usage Section */}
        <GlobalUsageSection
          usage={globalUsage}
          refreshing={refreshingUsage}
          onRefresh={handleUsageRefresh}
        />

        {generatingReport ? (
          <div className="supervisor-loading">
            <div className="supervisor-loading-spinner"></div>
            <p>{t('terminal:supervisor.generatingReport')}</p>
          </div>
        ) : lastReport ? (
          <SupervisorReportView report={lastReport} />
        ) : (
          <div className="supervisor-empty">
            <p>{t('terminal:supervisor.noReportYet')}</p>
            <button onClick={handleRefresh}>
              {t('terminal:supervisor.generateFirstReport')}
            </button>
          </div>
        )}

        <div className="supervisor-footer">
          {lastReportTime && <span>{t('terminal:supervisor.lastReport', { time: formatTimeAgo(lastReportTime) })}</span>}
          {enabled && autoReportOnComplete && <span>{t('terminal:supervisor.autoUpdatesOnComplete')}</span>}
          {enabled && !autoReportOnComplete && <span>{t('terminal:supervisor.manualUpdatesOnly')}</span>}
        </div>
      </div>
    </div>
  );
}

function SupervisorReportView({ report }: { report: SupervisorReport }) {
  const { t } = useTranslation(['terminal']);
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
            ? t('terminal:supervisor.allSystemsHealthy')
            : report.overallStatus === 'attention_needed'
              ? t('terminal:supervisor.attentionNeeded')
              : t('terminal:supervisor.criticalIssues')}
        </span>
      </div>

      {/* Insights Section */}
      {report.insights.length > 0 && (
        <div className="supervisor-section">
          <h3>{t('terminal:supervisor.keyInsights')}</h3>
          <ul className="supervisor-insights">
            {report.insights.map((insight, i) => (
              <li key={i}>{insight}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Agent Summaries */}
      <div className="supervisor-section">
        <h3>{t('terminal:supervisor.agentStatus')}</h3>
        <div className="supervisor-agents">
          {report.agentSummaries.map((agent) => (
            <AgentSummaryCard key={agent.agentId} agent={agent} />
          ))}
        </div>
      </div>

      {/* Recommendations */}
      {report.recommendations.length > 0 && (
        <div className="supervisor-section">
          <h3>{t('terminal:supervisor.recommendations')}</h3>
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

interface GlobalUsageSectionProps {
  usage: GlobalUsageStats | null;
  refreshing: boolean;
  onRefresh: () => void;
}

function getUsageColor(percent: number): string {
  if (percent < 50) return '#4aff9e';
  if (percent < 75) return '#ff9e4a';
  return '#ff4a4a';
}

function GlobalUsageSection({ usage, refreshing, onRefresh }: GlobalUsageSectionProps) {
  const { t } = useTranslation(['terminal', 'common']);
  return (
    <div className="supervisor-section usage-section">
      <div className="usage-header">
        <h3>{t('terminal:supervisor.claudeApiUsage')}</h3>
        <button
          className="usage-refresh-btn"
          onClick={onRefresh}
          disabled={refreshing}
          title="Refresh usage stats"
        >
          {refreshing ? '...' : '↻'}
        </button>
      </div>
      {usage ? (
        <div className="usage-grid">
          <UsageBar
            label={t('terminal:supervisor.session')}
            percent={usage.session.percentUsed}
            resetTime={usage.session.resetTime}
          />
          <UsageBar
            label={t('terminal:supervisor.weeklyAll')}
            percent={usage.weeklyAllModels.percentUsed}
            resetTime={usage.weeklyAllModels.resetTime}
          />
          <UsageBar
            label={t('terminal:supervisor.weeklySonnet')}
            percent={usage.weeklySonnet.percentUsed}
            resetTime={usage.weeklySonnet.resetTime}
          />
          <div className="usage-source">
            via {usage.sourceAgentName} · {formatTimeAgo(usage.lastUpdated)}
          </div>
        </div>
      ) : (
        <div className="usage-empty">
          <p>{t('terminal:supervisor.noUsageData')}</p>
          <button onClick={onRefresh} disabled={refreshing}>
            {refreshing ? t('terminal:supervisor.fetching') : t('common:buttons2.fetchUsage')}
          </button>
        </div>
      )}
    </div>
  );
}

interface UsageBarProps {
  label: string;
  percent: number;
  resetTime: string;
}

function UsageBar({ label, percent, resetTime }: UsageBarProps) {
  const { t } = useTranslation(['terminal']);
  const color = getUsageColor(percent);
  const displayPercent = Math.min(percent, 100);

  return (
    <div className="usage-bar-container">
      <div className="usage-bar-label">
        <span>{label}</span>
        <span className="usage-percent" style={{ color }}>{percent.toFixed(1)}%</span>
      </div>
      <div className="usage-bar-track">
        <div
          className="usage-bar-fill"
          style={{ width: `${displayPercent}%`, backgroundColor: color }}
        />
      </div>
      <div className="usage-bar-reset">{t('terminal:supervisor.resets', { time: resetTime })}</div>
    </div>
  );
}
