/**
 * Context View Modal
 * Advanced view showing detailed context usage breakdown from Claude's /context command
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Agent, ContextStats } from '../../shared/types';
import { useModalClose } from '../hooks';
import { ModalPortal } from './shared/ModalPortal';
import { Icon } from './Icon';
import {
  fetchProviderUsage,
  type ClaudeRateLimitWindow,
  type ClaudeUsageSnapshot,
  type GrokUsageSnapshot,
  type ProviderUsageSnapshot,
} from '../api/claude-usage';
import { getUsedPercentColor, formatResetTime } from '../utils/claude-usage-format';
import { ClaudeCredentialsPanel } from './ClaudeCredentialsPanel';

interface ContextViewModalProps {
  agent: Agent;
  isOpen: boolean;
  onClose: () => void;
  onRefresh?: () => void;
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

// Format percentage for display
function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

// Category colors
const CATEGORY_COLORS = {
  systemPrompt: '#4a9eff',      // Blue
  systemTools: '#9e4aff',       // Purple
  messages: '#4aff9e',          // Green
  freeSpace: 'rgba(255,255,255,0.1)', // Transparent
  autocompactBuffer: '#ff9e4a', // Orange
};

const CATEGORY_LABEL_KEYS = {
  systemPrompt: 'terminal:context.systemPrompt',
  systemTools: 'terminal:context.systemTools',
  messages: 'terminal:context.messagesCategory',
  freeSpace: 'terminal:context.freeSpace',
  autocompactBuffer: 'terminal:context.autocompactBuffer',
};

const CATEGORY_DESCRIPTION_KEYS = {
  systemPrompt: 'terminal:context.systemPromptDesc',
  systemTools: 'terminal:context.systemToolsDesc',
  messages: 'terminal:context.messagesDesc',
  freeSpace: 'terminal:context.freeSpaceDesc',
  autocompactBuffer: 'terminal:context.autocompactBufferDesc',
};

export function ContextViewModal({ agent, isOpen, onClose, onRefresh }: ContextViewModalProps) {
  const { t } = useTranslation(['terminal', 'common']);
  // Prefer authoritative contextStats; fall back to live tracked fields so Grok
  // (and others) still show a bar while stats are seeding from signals/usage.
  const stats: ContextStats | null = useMemo(() => {
    if (agent.contextStats) return agent.contextStats;
    const limit = Math.max(1, Math.round(agent.contextLimit || 0));
    const used = Math.max(0, Math.round(agent.contextUsed || 0));
    if (limit <= 0 || used <= 0) return null;
    const usedPercent = Math.min(100, Math.round((used / limit) * 100));
    const free = Math.max(0, limit - used);
    return {
      model: agent.grokModel || agent.opencodeModel || agent.codexModel || agent.model || agent.provider || 'unknown',
      contextWindow: limit,
      totalTokens: used,
      usedPercent,
      categories: {
        systemPrompt: { tokens: 0, percent: 0 },
        systemTools: { tokens: 0, percent: 0 },
        messages: { tokens: used, percent: Number(((used / limit) * 100).toFixed(1)) },
        freeSpace: { tokens: free, percent: Number(((free / limit) * 100).toFixed(1)) },
        autocompactBuffer: { tokens: 0, percent: 0 },
      },
      lastUpdated: Date.now(),
    };
  }, [agent.contextStats, agent.contextUsed, agent.contextLimit, agent.model, agent.grokModel, agent.opencodeModel, agent.codexModel, agent.provider]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Claude/Grok usage snapshot. Populated lazily when the modal opens —
  // codex/opencode agents skip this entirely.
  const [usage, setUsage] = useState<ProviderUsageSnapshot | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const usageReqRef = useRef(0);

  const showUsageSection = agent.provider === 'claude' || agent.provider === 'grok';

  const loadUsage = useMemo(() => {
    return () => {
      if (!showUsageSection) return;
      const reqId = ++usageReqRef.current;
      setUsageLoading(true);
      setUsageError(null);
      fetchProviderUsage(agent.id)
        .then((snapshot) => {
          if (reqId !== usageReqRef.current) return; // stale
          setUsage(snapshot);
          setUsageLoading(false);
        })
        .catch((err: Error) => {
          if (reqId !== usageReqRef.current) return;
          setUsage(null);
          setUsageError(err.message || 'Failed to load usage');
          setUsageLoading(false);
        });
    };
  }, [agent.id, showUsageSection]);

  // Fire the initial fetch when the modal opens (or the agent changes while open).
  useEffect(() => {
    if (isOpen && showUsageSection) {
      loadUsage();
    }
  }, [isOpen, showUsageSection, loadUsage]);

  const handleRefresh = () => {
    if (onRefresh && !isRefreshing) {
      setIsRefreshing(true);
      onRefresh();
      // Reset after a delay (the actual update comes via websocket)
      setTimeout(() => setIsRefreshing(false), 3000);
    }
    // Always re-pull the usage snapshot — it's cheap and the user clicked refresh.
    if (showUsageSection) loadUsage();
  };

  // Calculate category order for display (excluding free space for the bar)
  const categoryOrder: (keyof ContextStats['categories'])[] = [
    'systemPrompt',
    'systemTools',
    'messages',
    'autocompactBuffer',
    'freeSpace',
  ];

  // Get categories as ordered array
  const orderedCategories = useMemo(() => {
    if (!stats) return [];
    return categoryOrder.map(key => ({
      key,
      ...stats.categories[key],
      label: t(CATEGORY_LABEL_KEYS[key]),
      description: t(CATEGORY_DESCRIPTION_KEYS[key]),
      color: CATEGORY_COLORS[key],
    }));
  }, [stats]);

  // Categories for the stacked bar (excluding free space)
  const barCategories = useMemo(() => {
    return orderedCategories.filter(c => c.key !== 'freeSpace');
  }, [orderedCategories]);

  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div className="modal-overlay visible" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
        <div className="modal context-view-modal">
        <div className="modal-header" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ flex: 1 }}>{t('terminal:context.contextWindow', { name: agent.name })}</span>
          {onRefresh && (
            <button
              className="btn btn-primary"
              onClick={handleRefresh}
              disabled={isRefreshing || agent.status !== 'idle'}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              title={agent.status !== 'idle' ? t('terminal:context.agentMustBeIdle') : t('terminal:context.fetchContextStats')}
            >
              <span style={{
                display: 'inline-block',
                animation: isRefreshing ? 'spin 1s linear infinite' : 'none',
              }}>
                <Icon name="refresh" size={14} />
              </span>
              {isRefreshing ? t('common:status.loading') : t('common:buttons.refresh')}
            </button>
          )}
        </div>

        <div className="modal-body" style={{ padding: '16px' }}>
          {!stats ? (
            <div style={{
              textAlign: 'center',
              color: 'var(--text-secondary)',
              padding: '32px',
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.5 }}><Icon name="dashboard" size={48} /></div>
              <div style={{ fontSize: '14px', marginBottom: '8px' }}>{t('terminal:context.noContextData')}</div>
              <div style={{ fontSize: '12px', marginBottom: '20px', opacity: 0.7 }}>
                {t('terminal:context.clickRefresh')}
              </div>
              {onRefresh && (
                <button
                  className="btn btn-primary"
                  onClick={handleRefresh}
                  disabled={isRefreshing || agent.status !== 'idle'}
                  style={{
                    padding: '10px 24px',
                    fontSize: '14px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <span style={{
                    display: 'inline-block',
                    animation: isRefreshing ? 'spin 1s linear infinite' : 'none',
                  }}>
                    <Icon name="refresh" size={14} />
                  </span>
                  {isRefreshing ? t('terminal:context.fetchingStats') : t('terminal:context.fetchContextStats')}
                </button>
              )}
              {agent.status !== 'idle' && (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px' }}>
                  {t('terminal:context.agentMustBeIdle')}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Model Info */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
                padding: '8px 12px',
                background: 'var(--bg-secondary)',
                borderRadius: '6px',
              }}>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{t('terminal:context.model')}</div>
                  <div style={{ fontSize: '13px', fontWeight: 500 }}>{stats.model}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{t('terminal:context.contextWindowLabel')}</div>
                  <div style={{ fontSize: '13px', fontWeight: 500 }}>{formatTokens(stats.contextWindow)}</div>
                </div>
              </div>

              {/* Overview Bar */}
              <div style={{ marginBottom: '24px' }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '8px',
                  fontSize: '13px',
                }}>
                  <span>{t('terminal:context.contextUsage')}</span>
                  <span style={{ color: getUsedPercentColor(stats.usedPercent) }}>
                    {formatTokens(stats.totalTokens)} / {formatTokens(stats.contextWindow)} ({stats.usedPercent}%)
                  </span>
                </div>

                {/* Stacked Bar */}
                <div style={{
                  height: '28px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '6px',
                  overflow: 'hidden',
                  display: 'flex',
                }}>
                  {barCategories.map((category) => (
                    category.percent > 0 && (
                      <div
                        key={category.key}
                        style={{
                          width: `${category.percent}%`,
                          background: category.color,
                          height: '100%',
                          minWidth: category.percent > 0.5 ? '2px' : '0',
                          transition: 'width 0.3s ease',
                        }}
                        title={`${category.label}: ${formatTokens(category.tokens)} (${formatPercent(category.percent)})`}
                      />
                    )
                  ))}
                </div>
              </div>

              {/* Category Breakdown */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{
                  fontSize: '12px',
                  color: 'var(--text-secondary)',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  {t('terminal:context.tokenBreakdown')}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {orderedCategories.map((category) => (
                    <div
                      key={category.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '10px 12px',
                        background: category.key === 'freeSpace' ? 'transparent' : 'var(--bg-secondary)',
                        borderRadius: '6px',
                        borderLeft: category.key === 'freeSpace' ? '3px dashed rgba(255,255,255,0.2)' : `3px solid ${category.color}`,
                        opacity: category.key === 'freeSpace' ? 0.7 : 1,
                      }}
                    >
                      <div style={{
                        width: '12px',
                        height: '12px',
                        borderRadius: '3px',
                        background: category.color,
                        flexShrink: 0,
                        border: category.key === 'freeSpace' ? '1px dashed rgba(255,255,255,0.3)' : 'none',
                      }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 500 }}>{category.label}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                          {category.description}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '13px', fontWeight: 500 }}>
                          {formatTokens(category.tokens)}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                          {formatPercent(category.percent)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Last Updated */}
              <div style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                textAlign: 'center',
              }}>
                {t('terminal:context.lastUpdated', { time: new Date(stats.lastUpdated).toLocaleTimeString() })}
              </div>
            </>
          )}

          {showUsageSection && (
            <ProviderUsageSection
              snapshot={usage}
              loading={usageLoading}
              error={usageError}
              onRefresh={loadUsage}
              showClaudeAccounts={agent.provider === 'claude'}
            />
          )}
        </div>

        <div className="modal-footer" style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '12px 16px',
          borderTop: '1px solid var(--border-color)',
        }}>
          <button className="btn btn-secondary" onClick={onClose}>
            {t('common:buttons.close')}
          </button>
        </div>
        </div>
      </div>
    </ModalPortal>
  );
}

// ---------------------------------------------------------------------------
// Provider Usage section (Claude plan limits + Grok credit/week limits)
// ---------------------------------------------------------------------------

interface ProviderUsageSectionProps {
  snapshot: ProviderUsageSnapshot | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  /** When true, render the Claude OAuth account switcher under the gauges. */
  showClaudeAccounts?: boolean;
}

function formatActivityDate(isoDate: string): string {
  // isoDate is YYYY-MM-DD; build a Date in local TZ at midday so DST shifts
  // can't bump the rendered weekday backward.
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  const date = new Date(y, m - 1, d, 12, 0, 0);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatCreditAmount(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function buildRateLimitWindows(
  snapshot: ProviderUsageSnapshot,
  t: (key: string) => string,
): Array<{ key: string; label: string; window: ClaudeRateLimitWindow | null }> {
  const windows: Array<{ key: string; label: string; window: ClaudeRateLimitWindow | null }> = [];
  if (!snapshot.rateLimits) return windows;

  if (snapshot.provider === 'claude') {
    const candidates = [
      { key: 'fiveHour', label: t('terminal:usage.currentSession'), window: snapshot.rateLimits.fiveHour },
      { key: 'sevenDay', label: t('terminal:usage.currentWeekAll'), window: snapshot.rateLimits.sevenDay },
      { key: 'sevenDayOpus', label: t('terminal:usage.currentWeekOpus'), window: snapshot.rateLimits.sevenDayOpus },
      { key: 'sevenDayFable', label: t('terminal:usage.currentWeekFable'), window: snapshot.rateLimits.sevenDayFable },
    ];
    for (const candidate of candidates) {
      if (candidate.window || candidate.key === 'sevenDayFable') windows.push(candidate);
    }
    return windows;
  }

  // Grok — same dual gauges as the CLI `/usage` panel (weekly + monthly).
  const grok = snapshot as GrokUsageSnapshot;
  if (grok.rateLimits?.weekly) {
    windows.push({
      key: 'weekly',
      label: t('terminal:usage.weeklyLimit'),
      window: grok.rateLimits.weekly,
    });
  }
  if (grok.rateLimits?.monthly) {
    windows.push({
      key: 'monthly',
      label: t('terminal:usage.monthlyLimit'),
      window: grok.rateLimits.monthly,
    });
  }
  if (grok.rateLimits?.onDemand) {
    windows.push({
      key: 'onDemand',
      label: t('terminal:usage.onDemandLimit'),
      window: grok.rateLimits.onDemand,
    });
  }
  return windows;
}

function ProviderUsageSection({ snapshot, loading, error, onRefresh, showClaudeAccounts = false }: ProviderUsageSectionProps) {
  const { t } = useTranslation(['terminal', 'common']);

  const claudeSnapshot = snapshot?.provider === 'claude' ? (snapshot as ClaudeUsageSnapshot) : null;

  // Compute peak so the day bars share a stable scale across the range.
  const peakMessages = claudeSnapshot
    ? claudeSnapshot.recentDays.reduce((max, d) => Math.max(max, d.messageCount), 0)
    : 0;

  const rateLimitWindows = snapshot ? buildRateLimitWindows(snapshot, t) : [];
  const titleKey = snapshot?.provider === 'grok' ? 'terminal:usage.titleGrok' : 'terminal:usage.title';

  return (
    <div
      className="claude-usage-section"
      style={{
        marginTop: '24px',
        paddingTop: '16px',
        borderTop: '1px solid var(--border-color)',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '12px',
      }}>
        <div style={{
          fontSize: '12px',
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          {t(titleKey)}
        </div>
        <button
          className="btn btn-secondary"
          onClick={onRefresh}
          disabled={loading}
          style={{
            padding: '4px 10px',
            fontSize: '11px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
          title={t('terminal:usage.refresh')}
        >
          <span style={{
            display: 'inline-block',
            animation: loading ? 'spin 1s linear infinite' : 'none',
          }}>
            <Icon name="refresh" size={12} />
          </span>
          {loading ? t('common:status.loading') : t('common:buttons.refresh')}
        </button>
      </div>

      {error && (
        <div style={{
          padding: '12px',
          background: 'rgba(255, 74, 74, 0.08)',
          border: '1px solid rgba(255, 74, 74, 0.3)',
          borderRadius: '6px',
          color: '#ff8a8a',
          fontSize: '12px',
          marginBottom: '12px',
        }}>
          {t('terminal:usage.error', { message: error })}
        </div>
      )}

      {loading && !snapshot && (
        <div style={{
          padding: '20px',
          textAlign: 'center',
          color: 'var(--text-secondary)',
          fontSize: '12px',
        }}>
          {t('common:status.loading')}…
        </div>
      )}

      {snapshot && (
        <>
          {/* Session — totals tracked by Tide for this specific agent */}
          <div style={{
            marginBottom: '12px',
            padding: '10px 12px',
            background: 'var(--bg-secondary)',
            borderRadius: '6px',
          }}>
            <div style={{
              fontSize: '11px',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: '6px',
            }}>
              {t('terminal:usage.session')}
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
              fontSize: '12px',
            }}>
              <div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
                  {t('terminal:usage.tokensUsed')}
                </div>
                <div style={{ fontWeight: 500 }}>{formatTokens(snapshot.session.tokensUsed)}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
                  {t('terminal:usage.taskCount')}
                </div>
                <div style={{ fontWeight: 500 }}>{snapshot.session.taskCount}</div>
              </div>
            </div>
          </div>

          {/* Rate-limit gauges — same data the CLI's /usage tab renders */}
          {rateLimitWindows.length > 0 && (
            <div style={{
              marginBottom: '12px',
              padding: '10px 12px',
              background: 'var(--bg-secondary)',
              borderRadius: '6px',
            }}>
              <div style={{
                fontSize: '11px',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '8px',
              }}>
                {t('terminal:usage.limits')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {rateLimitWindows.map(({ key, label, window }) => (
                  <RateLimitGauge key={key} label={label} window={window} />
                ))}
              </div>
            </div>
          )}

          {/* Today + recent days — Claude only (stats-cache / transcript scan) */}
          {claudeSnapshot && (
            <>
              <div style={{
                marginBottom: '12px',
                padding: '10px 12px',
                background: 'var(--bg-secondary)',
                borderRadius: '6px',
              }}>
                <div style={{
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  marginBottom: '6px',
                }}>
                  {t('terminal:usage.today')}
                </div>
                {claudeSnapshot.today ? (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: '8px',
                    fontSize: '12px',
                  }}>
                    <UsageStat label={t('terminal:usage.messages')} value={claudeSnapshot.today.messageCount} />
                    <UsageStat label={t('terminal:usage.sessions')} value={claudeSnapshot.today.sessionCount} />
                    <UsageStat label={t('terminal:usage.toolCalls')} value={claudeSnapshot.today.toolCallCount} />
                  </div>
                ) : (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {t('terminal:usage.noActivityToday')}
                  </div>
                )}
              </div>

              {claudeSnapshot.recentDays.length > 0 && (
                <div style={{
                  marginBottom: '12px',
                  padding: '10px 12px',
                  background: 'var(--bg-secondary)',
                  borderRadius: '6px',
                }}>
                  <div style={{
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    marginBottom: '8px',
                  }}>
                    {t('terminal:usage.recentDays')}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {claudeSnapshot.recentDays.slice(0, 8).map((day) => {
                      const ratio = peakMessages > 0 ? day.messageCount / peakMessages : 0;
                      return (
                        <div key={day.date} style={{
                          display: 'grid',
                          gridTemplateColumns: '60px 1fr 60px',
                          alignItems: 'center',
                          gap: '8px',
                          fontSize: '11px',
                        }}>
                          <span style={{ color: 'var(--text-secondary)' }}>
                            {formatActivityDate(day.date)}
                          </span>
                          <div style={{
                            height: '8px',
                            background: 'var(--bg-tertiary)',
                            borderRadius: '4px',
                            overflow: 'hidden',
                          }}>
                            <div style={{
                              width: `${Math.max(2, ratio * 100)}%`,
                              height: '100%',
                              background: '#4a9eff',
                              transition: 'width 0.3s ease',
                            }} />
                          </div>
                          <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {day.messageCount}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {/* CLI hint — fallback when the live rate-limit fetch failed */}
          {rateLimitWindows.length === 0 && (
            <div style={{
              padding: '8px 12px',
              background: 'rgba(74, 158, 255, 0.06)',
              border: '1px solid rgba(74, 158, 255, 0.2)',
              borderRadius: '6px',
              fontSize: '11px',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
            }}>
              {snapshot.rateLimitsError && (
                <div style={{ marginBottom: '4px' }}>
                  {t('terminal:usage.limitsError', { message: snapshot.rateLimitsError })}
                </div>
              )}
              {snapshot.cliHint}
            </div>
          )}

        </>
      )}

      {/* Switch Claude OAuth accounts when rate-limited (always for Claude). */}
      {showClaudeAccounts && (
        <ClaudeCredentialsPanel compact onSwitched={onRefresh} />
      )}
    </div>
  );
}

function RateLimitGauge({ label, window }: { label: string; window: ClaudeRateLimitWindow | null }) {
  const { t } = useTranslation(['terminal']);
  const percent = window ? Math.max(0, Math.min(100, window.utilization)) : 0;
  const color = getUsedPercentColor(percent);
  const hasCredits = window != null &&
    typeof window.used === 'number' &&
    typeof window.limit === 'number' &&
    Number.isFinite(window.used) &&
    Number.isFinite(window.limit);

  return (
    <div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        fontSize: '12px',
        marginBottom: '4px',
      }}>
        <span style={{ fontWeight: 500 }}>{label}</span>
        <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>
          {t('terminal:usage.percentUsed', { percent: Math.round(percent) })}
        </span>
      </div>
      <div style={{
        height: '10px',
        background: 'var(--bg-tertiary)',
        borderRadius: '5px',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${percent}%`,
          height: '100%',
          background: color,
          transition: 'width 0.3s ease',
        }} />
      </div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '8px',
        fontSize: '11px',
        color: 'var(--text-secondary)',
        marginTop: '3px',
      }}>
        {window && <span>{t('terminal:usage.resets', { time: formatResetTime(window.resetsAt) })}</span>}
        {hasCredits && (
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {t('terminal:usage.creditsUsed', {
              used: formatCreditAmount(window.used!),
              limit: formatCreditAmount(window.limit!),
            })}
          </span>
        )}
      </div>
    </div>
  );
}

function UsageStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>{label}</div>
      <div style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}
