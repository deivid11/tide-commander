/**
 * PlanLimitsTooltip — hover/focus tooltip for the FlatView status-bar context
 * chip (`.flat-terminal-wrapper__context`).
 *
 * For Claude agents it surfaces the same "Plan limits" gauges the CLI's /usage
 * panel (and the ContextViewModal) show — current session + weekly rate-limit
 * windows with their reset times.
 *
 * For Grok agents it surfaces the billing-period credit limit (weekly or
 * monthly, matching the CLI's `/usage` panel) from the chat-proxy billing API.
 *
 * The usage snapshot is fetched lazily the first time the tooltip is shown and
 * cached briefly so repeated hovers don't hammer the rate-limit endpoint.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '../shared/Tooltip';
import {
  fetchProviderUsage,
  type ClaudeRateLimitWindow,
  type ClaudeUsageSnapshot,
  type GrokUsageSnapshot,
  type ProviderUsageSnapshot,
} from '../../api/claude-usage';
import { getUsedPercentColor, formatResetTime } from '../../utils/claude-usage-format';

// Short-lived module cache so re-hovering the chip (or switching back to an
// agent) reuses a recent snapshot instead of re-hitting the upstream each time.
interface CacheEntry {
  snapshot: ProviderUsageSnapshot;
  fetchedAt: number;
}
const usageCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

interface PlanLimitsContentProps {
  agentId: string;
  /** Optional context-usage summary rendered above the plan limits. */
  contextSummary?: string;
}

function formatCreditAmount(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function buildWindows(
  snapshot: ProviderUsageSnapshot,
  t: (key: string) => string,
): Array<{ key: string; label: string; window: ClaudeRateLimitWindow | null }> {
  const windows: Array<{ key: string; label: string; window: ClaudeRateLimitWindow | null }> = [];
  if (!snapshot.rateLimits) return windows;

  if (snapshot.provider === 'claude') {
    const claude = snapshot as ClaudeUsageSnapshot;
    const candidates = [
      { key: 'fiveHour', label: t('terminal:usage.currentSession'), window: claude.rateLimits!.fiveHour },
      { key: 'sevenDay', label: t('terminal:usage.currentWeekAll'), window: claude.rateLimits!.sevenDay },
      { key: 'sevenDayOpus', label: t('terminal:usage.currentWeekOpus'), window: claude.rateLimits!.sevenDayOpus },
      { key: 'sevenDayFable', label: t('terminal:usage.currentWeekFable'), window: claude.rateLimits!.sevenDayFable },
    ];
    for (const candidate of candidates) {
      if (candidate.window || candidate.key === 'sevenDayFable') windows.push(candidate);
    }
    return windows;
  }

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

/**
 * Tooltip body. Only mounted while the tooltip is visible (the shared Tooltip
 * defers rendering its `content`), so the fetch fires lazily on first hover.
 */
function PlanLimitsContent({ agentId, contextSummary }: PlanLimitsContentProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [snapshot, setSnapshot] = useState<ProviderUsageSnapshot | null>(
    () => usageCache.get(agentId)?.snapshot ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    const cached = usageCache.get(agentId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      setSnapshot(cached.snapshot);
      return;
    }
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    fetchProviderUsage(agentId)
      .then((snap) => {
        if (reqId !== reqRef.current) return; // stale
        usageCache.set(agentId, { snapshot: snap, fetchedAt: Date.now() });
        setSnapshot(snap);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (reqId !== reqRef.current) return;
        setError(err.message || 'Failed to load plan limits');
        setLoading(false);
      });
  }, [agentId]);

  const windows = snapshot ? buildWindows(snapshot, t) : [];

  return (
    <div className="plan-limits-tooltip">
      {contextSummary && (
        <div className="plan-limits-tooltip__context">{contextSummary}</div>
      )}

      <div className="plan-limits-tooltip__title">{t('terminal:usage.limits')}</div>

      {loading && !snapshot && (
        <div className="plan-limits-tooltip__muted">{t('common:status.loading')}…</div>
      )}

      {!loading && error && !snapshot && (
        <div className="plan-limits-tooltip__muted">
          {t('terminal:usage.limitsError', { message: error })}
        </div>
      )}

      {windows.length > 0 ? (
        <div className="plan-limits-tooltip__gauges">
          {windows.map(({ key, label, window }) => {
            const percent = window ? Math.max(0, Math.min(100, window.utilization)) : 0;
            const color = getUsedPercentColor(percent);
            const hasCredits =
              window != null &&
              typeof window.used === 'number' &&
              typeof window.limit === 'number' &&
              Number.isFinite(window.used) &&
              Number.isFinite(window.limit);
            return (
              <div key={key} className="plan-limits-tooltip__gauge">
                <div className="plan-limits-tooltip__gauge-head">
                  <span className="plan-limits-tooltip__gauge-label">{label}</span>
                  <span className="plan-limits-tooltip__gauge-percent" style={{ color }}>
                    {t('terminal:usage.percentUsed', { percent: Math.round(percent) })}
                  </span>
                </div>
                <div className="plan-limits-tooltip__bar">
                  <div
                    className="plan-limits-tooltip__bar-fill"
                    style={{ width: `${percent}%`, background: color }}
                  />
                </div>
                <div className="plan-limits-tooltip__reset">
                  {window && t('terminal:usage.resets', { time: formatResetTime(window.resetsAt) })}
                  {hasCredits && (
                    <span style={{ marginLeft: 8 }}>
                      {t('terminal:usage.creditsUsed', {
                        used: formatCreditAmount(window.used!),
                        limit: formatCreditAmount(window.limit!),
                      })}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        snapshot && !loading && (
          <div className="plan-limits-tooltip__muted">
            {snapshot.rateLimitsError
              ? t('terminal:usage.limitsError', { message: snapshot.rateLimitsError })
              : snapshot.cliHint}
          </div>
        )
      )}
    </div>
  );
}

interface PlanLimitsTooltipProps {
  agentId: string;
  /** Disable to fall back to no tooltip (e.g. non-Claude/Grok agents). */
  disabled?: boolean;
  /** Optional context-usage summary rendered above the plan limits. */
  contextSummary?: string;
  children: React.ReactNode;
}

export function PlanLimitsTooltip({ agentId, disabled, contextSummary, children }: PlanLimitsTooltipProps) {
  return (
    <Tooltip
      position="top"
      maxWidth={320}
      disabled={disabled}
      className="plan-limits-tooltip-wrapper"
      triggerStyle={{ display: 'inline-flex', alignItems: 'center' }}
      content={<PlanLimitsContent agentId={agentId} contextSummary={contextSummary} />}
    >
      {children}
    </Tooltip>
  );
}
