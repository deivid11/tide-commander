import React from 'react';
import { useTranslation } from 'react-i18next';
import { fetchClaudeUsageByAgent, type ClaudeUsageByAgentEntry, type ClaudeUsageByAgentSummary } from '../api/claude-usage';
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

export function StatisticsModal({ isOpen, onClose }: StatisticsModalProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);
  const [summary, setSummary] = React.useState<ClaudeUsageByAgentSummary | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const dayStart = React.useMemo(() => getLocalDayStart(), []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchClaudeUsageByAgent({ since: dayStart, until: Date.now() });
      setSummary(result);
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
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
