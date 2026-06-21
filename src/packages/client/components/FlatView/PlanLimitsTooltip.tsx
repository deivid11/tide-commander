/**
 * PlanLimitsTooltip — hover/focus tooltip for the FlatView status-bar context
 * chip (`.flat-terminal-wrapper__context`).
 *
 * For Claude agents it surfaces the same "Plan limits" gauges the CLI's /usage
 * panel (and the ContextViewModal) show — current session + weekly rate-limit
 * windows with their reset times. The usage snapshot is fetched lazily the
 * first time the tooltip is shown and cached briefly so repeated hovers don't
 * hammer the rate-limit endpoint.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '../shared/Tooltip';
import {
  fetchClaudeUsage,
  type ClaudeRateLimitWindow,
  type ClaudeUsageSnapshot,
} from '../../api/claude-usage';
import { getUsedPercentColor, formatResetTime } from '../../utils/claude-usage-format';

// Short-lived module cache so re-hovering the chip (or switching back to an
// agent) reuses a recent snapshot instead of re-hitting Anthropic each time.
interface CacheEntry {
  snapshot: ClaudeUsageSnapshot;
  fetchedAt: number;
}
const usageCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

interface PlanLimitsContentProps {
  agentId: string;
  /** Optional context-usage summary rendered above the plan limits. */
  contextSummary?: string;
}

/**
 * Tooltip body. Only mounted while the tooltip is visible (the shared Tooltip
 * defers rendering its `content`), so the fetch fires lazily on first hover.
 */
function PlanLimitsContent({ agentId, contextSummary }: PlanLimitsContentProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [snapshot, setSnapshot] = useState<ClaudeUsageSnapshot | null>(
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
    fetchClaudeUsage(agentId)
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

  // Rate-limit windows in the CLI's /usage display order; absent buckets skip.
  const windows: Array<{ key: string; label: string; window: ClaudeRateLimitWindow }> = [];
  if (snapshot?.rateLimits) {
    const candidates = [
      { key: 'fiveHour', label: t('terminal:usage.currentSession'), window: snapshot.rateLimits.fiveHour },
      { key: 'sevenDay', label: t('terminal:usage.currentWeekAll'), window: snapshot.rateLimits.sevenDay },
      { key: 'sevenDayOpus', label: t('terminal:usage.currentWeekOpus'), window: snapshot.rateLimits.sevenDayOpus },
      { key: 'sevenDaySonnet', label: t('terminal:usage.currentWeekSonnet'), window: snapshot.rateLimits.sevenDaySonnet },
    ];
    for (const candidate of candidates) {
      if (candidate.window) windows.push({ ...candidate, window: candidate.window });
    }
  }

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
            const percent = Math.max(0, Math.min(100, window.utilization));
            const color = getUsedPercentColor(percent);
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
                  {t('terminal:usage.resets', { time: formatResetTime(window.resetsAt) })}
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
  /** Disable to fall back to no tooltip (e.g. non-Claude agents). */
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
