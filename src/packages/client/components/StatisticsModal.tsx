import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchClaudeUsageByAgent,
  fetchClaudeUsageByDay,
  type ClaudeUsageByAgentEntry,
  type ClaudeUsageByAgentSummary,
  type ClaudeUsageByDaySummary,
} from '../api/claude-usage';
import { useModalClose } from '../hooks';
import { formatTokens } from '../utils/formatting';
import { Icon } from './Icon';
import { ModalPortal } from './shared/ModalPortal';

interface StatisticsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const USAGE_CHART_COLORS = [
  '#6ab8c8',
  '#c89a5a',
  '#9a80c0',
  '#5cb88a',
  '#c85a5a',
  '#c87a9a',
  '#c8c87a',
  '#5a8fd4',
  '#d45a5a',
  '#8a6fbf',
];

const DAILY_USAGE_DAYS = 14;
const LINE_CHART_WIDTH = 720;
const LINE_CHART_HEIGHT = 260;
const LINE_CHART_PADDING = {
  top: 16,
  right: 20,
  bottom: 42,
  left: 64,
};

interface UsageLineSeries {
  id: string;
  name: string;
  color: string;
  values: number[];
  total: number;
  peak: number;
  isTotal?: boolean;
}

function getLocalDayStart(): number {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  return dayStart.getTime();
}

function formatIsoDateTime(timestamp: string | null): string {
  if (!timestamp) return 'N/A';
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return 'N/A';
  }
}

function buildUsagePieGradient(entries: ClaudeUsageByAgentEntry[], totalTokens: number): string {
  if (entries.length === 0 || totalTokens <= 0) {
    return 'conic-gradient(rgba(50, 50, 62, 0.95) 0deg 360deg)';
  }

  let current = 0;
  const segments = entries.map((entry, index) => {
    const start = current;
    const degrees = (entry.tokens.total / totalTokens) * 360;
    current += degrees;
    const color = USAGE_CHART_COLORS[index % USAGE_CHART_COLORS.length];
    return `${color} ${start.toFixed(2)}deg ${current.toFixed(2)}deg`;
  });

  return `conic-gradient(${segments.join(', ')})`;
}

function formatChartDate(date: string): string {
  const [, month, day] = date.split('-');
  if (!month || !day) return date;
  return `${month}/${day}`;
}

function buildUsageLineSeries(summary: ClaudeUsageByDaySummary | null): UsageLineSeries[] {
  const days = summary?.days ?? [];
  if (days.length === 0) return [];

  const agentTotals = new Map<string, { agentName: string; total: number }>();
  for (const day of days) {
    for (const agent of day.agents) {
      const existing = agentTotals.get(agent.agentId) ?? { agentName: agent.agentName, total: 0 };
      existing.total += agent.tokens.total;
      agentTotals.set(agent.agentId, existing);
    }
  }

  const totalSeries: UsageLineSeries = {
    id: 'general',
    name: 'General',
    color: '#f1fa8c',
    values: days.map((day) => day.totalTokens),
    total: days.reduce((sum, day) => sum + day.totalTokens, 0),
    peak: Math.max(0, ...days.map((day) => day.totalTokens)),
    isTotal: true,
  };

  const agentSeries = [...agentTotals.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([agentId, agent], index): UsageLineSeries => ({
      id: agentId,
      name: agent.agentName,
      color: USAGE_CHART_COLORS[index % USAGE_CHART_COLORS.length],
      values: days.map((day) => day.agents.find((entry) => entry.agentId === agentId)?.tokens.total ?? 0),
      total: agent.total,
      peak: Math.max(0, ...days.map((day) => day.agents.find((entry) => entry.agentId === agentId)?.tokens.total ?? 0)),
    }));

  return [totalSeries, ...agentSeries].filter((series) => series.total > 0);
}

function getNiceMaxValue(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const niceNormalized = normalized <= 1
    ? 1
    : normalized <= 2
      ? 2
      : normalized <= 5
        ? 5
        : 10;
  return niceNormalized * magnitude;
}

function pointsForSeries(values: number[], maxValue: number): string {
  const plotLeft = LINE_CHART_PADDING.left;
  const plotTop = LINE_CHART_PADDING.top;
  const plotWidth = LINE_CHART_WIDTH - LINE_CHART_PADDING.left - LINE_CHART_PADDING.right;
  const plotHeight = LINE_CHART_HEIGHT - LINE_CHART_PADDING.top - LINE_CHART_PADDING.bottom;

  return values.map((value, index) => {
    const x = values.length <= 1
      ? plotLeft + (plotWidth / 2)
      : plotLeft + ((index / (values.length - 1)) * plotWidth);
    const y = plotTop + plotHeight - ((value / maxValue) * plotHeight);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
}

function DailyUsageLineChart({ summary }: { summary: ClaudeUsageByDaySummary }) {
  const days = summary.days;
  const series = buildUsageLineSeries(summary);
  const maxDataValue = Math.max(1, ...series.flatMap((line) => line.values));
  const maxValue = getNiceMaxValue(maxDataValue);
  const plotLeft = LINE_CHART_PADDING.left;
  const plotTop = LINE_CHART_PADDING.top;
  const plotWidth = LINE_CHART_WIDTH - LINE_CHART_PADDING.left - LINE_CHART_PADDING.right;
  const plotHeight = LINE_CHART_HEIGHT - LINE_CHART_PADDING.top - LINE_CHART_PADDING.bottom;
  const yTicks = [0, 0.5, 1];
  const labelEvery = Math.max(1, Math.ceil(days.length / 5));

  return (
    <div className="statistics-line-chart">
      <svg
        className="statistics-line-chart__svg"
        viewBox={`0 0 ${LINE_CHART_WIDTH} ${LINE_CHART_HEIGHT}`}
        role="img"
        aria-label="Daily Claude token usage by agent"
        preserveAspectRatio="xMidYMid meet"
      >
        {yTicks.map((tick) => {
          const y = plotTop + plotHeight - (tick * plotHeight);
          return (
            <g key={tick}>
              <line className="statistics-line-chart__grid" x1={plotLeft} y1={y} x2={plotLeft + plotWidth} y2={y} />
              <text className="statistics-line-chart__axis-label" x={plotLeft - 10} y={y + 4} textAnchor="end">
                {formatTokens(Math.round(maxValue * tick))}
              </text>
            </g>
          );
        })}

        <line className="statistics-line-chart__axis" x1={plotLeft} y1={plotTop} x2={plotLeft} y2={plotTop + plotHeight} />
        <line className="statistics-line-chart__axis" x1={plotLeft} y1={plotTop + plotHeight} x2={plotLeft + plotWidth} y2={plotTop + plotHeight} />

        {days.map((day, index) => {
          if (index !== 0 && index !== days.length - 1 && index % labelEvery !== 0) return null;
          const x = days.length <= 1
            ? plotLeft + (plotWidth / 2)
            : plotLeft + ((index / (days.length - 1)) * plotWidth);
          return (
            <text key={day.date} className="statistics-line-chart__axis-label" x={x} y={LINE_CHART_HEIGHT - 14} textAnchor="middle">
              {formatChartDate(day.date)}
            </text>
          );
        })}

        {series.map((line) => (
          <polyline
            key={line.id}
            className={line.isTotal ? 'statistics-line-chart__line statistics-line-chart__line--total' : 'statistics-line-chart__line'}
            points={pointsForSeries(line.values, maxValue)}
            fill="none"
            stroke={line.color}
            strokeWidth={line.isTotal ? 3 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <title>{`${line.name}: ${line.peak.toLocaleString()} peak daily tokens`}</title>
          </polyline>
        ))}

        {series.map((line) => line.values.map((value, index) => {
          const x = days.length <= 1
            ? plotLeft + (plotWidth / 2)
            : plotLeft + ((index / (days.length - 1)) * plotWidth);
          const y = plotTop + plotHeight - ((value / maxValue) * plotHeight);
          return (
            <circle
              key={`${line.id}-${days[index]?.date}`}
              className="statistics-line-chart__point"
              cx={x}
              cy={y}
              r={line.isTotal ? 3.4 : 2.6}
              fill={line.color}
            >
              <title>{`${line.name} ${days[index]?.date}: ${value.toLocaleString()} tokens`}</title>
            </circle>
          );
        }))}
      </svg>

      <div className="statistics-line-chart__legend">
        {series.map((line) => (
          <div
            key={line.id}
            className="statistics-line-chart__legend-item"
            title={`${line.name}: peak ${line.peak.toLocaleString()} daily tokens, ${line.total.toLocaleString()} period tokens`}
          >
            <span className="statistics-line-chart__legend-swatch" style={{ backgroundColor: line.color }} />
            <span>{line.name}</span>
            <strong>{formatTokens(line.peak)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatisticsModal({ isOpen, onClose }: StatisticsModalProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);
  const [summary, setSummary] = React.useState<ClaudeUsageByAgentSummary | null>(null);
  const [dailySummary, setDailySummary] = React.useState<ClaudeUsageByDaySummary | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const dayStart = React.useMemo(() => getLocalDayStart(), []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const now = Date.now();
      const [result, dailyResult] = await Promise.all([
        fetchClaudeUsageByAgent({ since: dayStart, until: now }),
        fetchClaudeUsageByDay({ days: DAILY_USAGE_DAYS, until: now }),
      ]);
      setSummary(result);
      setDailySummary(dailyResult);
    } catch (err: any) {
      setError(err?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }, [dayStart]);

  React.useEffect(() => {
    if (isOpen) {
      void load();
    }
  }, [isOpen, load]);

  if (!isOpen) return null;

  const entries = summary?.entries ?? [];
  const totalTokens = summary?.totalTokens ?? 0;
  const pieGradient = buildUsagePieGradient(entries, totalTokens);
  const hasDailyUsage = (dailySummary?.days ?? []).some((day) => day.totalTokens > 0);

  return (
    <ModalPortal>
      <div className="modal-overlay visible" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
        <div className="modal statistics-modal">
          <div className="modal-header statistics-modal__header">
            <div className="statistics-modal__title">
              <span className="statistics-modal__icon"><Icon name="dashboard" size={15} /></span>
              <span>{t('terminal:statistics.title', { defaultValue: 'Statistics' })}</span>
            </div>
            <button className="modal-close statistics-modal__close" onClick={onClose} title={t('common:buttons.close')}>
              &times;
            </button>
          </div>

          <div className="modal-body statistics-modal__body">
            <section className="statistics-panel">
              <div className="statistics-panel__header">
                <div>
                  <h3>{t('terminal:statistics.usageByAgent', { defaultValue: 'Claude usage today' })}</h3>
                  <span className="statistics-panel__subtitle">
                    {t('terminal:statistics.usageByAgentSubtitle', {
                      defaultValue: 'Input + cache creation + cache read + output tokens, deduped by Claude request id',
                    })}
                  </span>
                </div>
                <button
                  type="button"
                  className="statistics-panel__refresh"
                  onClick={load}
                  disabled={loading}
                  title={t('terminal:statistics.refresh', { defaultValue: 'Refresh usage' })}
                >
                  <Icon name="refresh" size={14} />
                </button>
              </div>

              {loading && !summary && (
                <div className="statistics-panel__empty">
                  {t('terminal:statistics.loading', { defaultValue: 'Loading usage...' })}
                </div>
              )}

              {!loading && error && (
                <div className="statistics-panel__empty statistics-panel__empty--error">
                  {t('terminal:statistics.error', { defaultValue: 'Failed to load usage: {{error}}', error })}
                </div>
              )}

              {!error && summary && entries.length === 0 && (
                <div className="statistics-panel__empty">
                  {t('terminal:statistics.empty', { defaultValue: 'No Claude token usage found for today.' })}
                </div>
              )}

              {!error && summary && entries.length > 0 && (
                <>
                  <div className="statistics-panel__layout">
                    <div className="statistics-panel__chart-wrap">
                      <div
                        className="statistics-panel__pie"
                        style={{ background: pieGradient }}
                        role="img"
                        aria-label={t('terminal:statistics.pieLabel', {
                          defaultValue: 'Claude token usage by agent',
                        })}
                      >
                        <div className="statistics-panel__pie-hole">
                          <strong>{formatTokens(totalTokens)}</strong>
                          <span>{t('terminal:statistics.total', { defaultValue: 'total' })}</span>
                        </div>
                      </div>
                    </div>

                    <div className="statistics-panel__list">
                      {entries.map((entry, index) => (
                        <div
                          key={entry.agentId}
                          className="statistics-panel__row"
                          title={`${entry.agentName}: ${entry.tokens.total.toLocaleString()} tokens`}
                        >
                          <span className="statistics-panel__swatch" style={{ backgroundColor: USAGE_CHART_COLORS[index % USAGE_CHART_COLORS.length] }} />
                          <div className="statistics-panel__row-main">
                            <div className="statistics-panel__row-name">{entry.agentName}</div>
                            <div className="statistics-panel__row-meta">
                              {entry.requestCount.toLocaleString()} {t('terminal:statistics.requests', { defaultValue: 'requests' })}
                              {' / '}
                              {entry.percent}%
                            </div>
                          </div>
                          <strong>{formatTokens(entry.tokens.total)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="statistics-panel__footnote">
                    {t('terminal:statistics.window', {
                      defaultValue: 'Window: {{since}} to {{until}}',
                      since: formatIsoDateTime(summary.since),
                      until: formatIsoDateTime(summary.until),
                    })}
                  </div>
                </>
              )}
            </section>

            <section className="statistics-panel">
              <div className="statistics-panel__header">
                <div>
                  <h3>{t('terminal:statistics.dailyUsage', { defaultValue: 'Daily usage by agent' })}</h3>
                  <span className="statistics-panel__subtitle">
                    {t('terminal:statistics.dailyUsageSubtitle', {
                      defaultValue: 'General token usage by day plus one line for each Claude agent.',
                    })}
                  </span>
                </div>
              </div>

              {loading && !dailySummary && (
                <div className="statistics-panel__empty">
                  {t('terminal:statistics.loading', { defaultValue: 'Loading usage...' })}
                </div>
              )}

              {!loading && !error && dailySummary && !hasDailyUsage && (
                <div className="statistics-panel__empty">
                  {t('terminal:statistics.dailyEmpty', { defaultValue: 'No Claude token usage found for recent days.' })}
                </div>
              )}

              {!error && dailySummary && hasDailyUsage && (
                <>
                  <DailyUsageLineChart summary={dailySummary} />
                  <div className="statistics-panel__footnote">
                    {t('terminal:statistics.window', {
                      defaultValue: 'Window: {{since}} to {{until}}',
                      since: formatIsoDateTime(dailySummary.since),
                      until: formatIsoDateTime(dailySummary.until),
                    })}
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
