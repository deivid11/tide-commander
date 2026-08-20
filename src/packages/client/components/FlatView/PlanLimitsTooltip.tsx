/**
 * PlanLimitsTooltip — hover/focus tooltip for the FlatView status-bar context
 * chip (`.flat-terminal-wrapper__context`).
 *
 * It surfaces the same provider-specific plan gauges as ContextViewModal for
 * Claude, Codex, Grok, and Pi (including Pi-loaded subscriptions).
 *
 * Snapshots are cached and in-flight requests are shared with the two compact
 * status bars, so opening the tooltip does not duplicate upstream requests.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '../shared/Tooltip';
import {
  fetchProviderUsage,
  type ClaudeRateLimitWindow,
  type ClaudeUsageSnapshot,
  type CodexUsageSnapshot,
  type GrokUsageSnapshot,
  type PiUsageSnapshot,
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
const usageRequests = new Map<string, Promise<ProviderUsageSnapshot>>();
const CACHE_TTL_MS = 60_000;

function snapshotHasQuotaData(snapshot: ProviderUsageSnapshot): boolean {
  if (snapshot.provider === 'pi') {
    return snapshot.quotaWindows.length > 0 || snapshot.rateLimits !== null;
  }
  if (snapshot.provider === 'opencode') {
    return snapshot.plan === 'free' || snapshot.quotaWindows.length > 0;
  }
  return snapshot.rateLimits !== null;
}

function loadProviderUsage(agentId: string, cacheKey: string, force = false): Promise<ProviderUsageSnapshot> {
  const cached = usageCache.get(cacheKey);
  if (
    !force
    && cached
    && snapshotHasQuotaData(cached.snapshot)
    && Date.now() - cached.fetchedAt < CACHE_TTL_MS
  ) {
    return Promise.resolve(cached.snapshot);
  }

  const pending = usageRequests.get(cacheKey);
  if (pending) return pending;

  const request = fetchProviderUsage(agentId)
    .then((snapshot) => {
      usageCache.set(cacheKey, { snapshot, fetchedAt: Date.now() });
      return snapshot;
    })
    .finally(() => usageRequests.delete(cacheKey));
  usageRequests.set(cacheKey, request);
  return request;
}

/** Cached provider usage for status surfaces and the detailed tooltip. */
export function useProviderUsageSnapshot(agentId: string, enabled = true, refreshMs = 0, scope = '') {
  const cacheKey = scope ? `${agentId}:${scope}` : agentId;
  const [snapshot, setSnapshot] = useState<ProviderUsageSnapshot | null>(
    () => usageCache.get(cacheKey)?.snapshot ?? null,
  );
  const [snapshotCacheKey, setSnapshotCacheKey] = useState(cacheKey);
  const [loading, setLoading] = useState(enabled && !snapshot);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setSnapshot(null);
      setSnapshotCacheKey(cacheKey);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const cached = usageCache.get(cacheKey)?.snapshot ?? null;
    setSnapshot(cached);
    setSnapshotCacheKey(cacheKey);
    setLoading(!cached);
    setError(null);

    const refresh = (force = false) => {
      loadProviderUsage(agentId, cacheKey, force)
        .then((next) => {
          if (cancelled) return;
          setSnapshot(next);
          setSnapshotCacheKey(cacheKey);
          setLoading(false);
          setError(null);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          setLoading(false);
          setError(err.message || 'Failed to load plan limits');
        });
    };

    refresh(false);
    const interval = refreshMs > 0
      ? window.setInterval(() => refresh(true), refreshMs)
      : null;
    return () => {
      cancelled = true;
      if (interval !== null) window.clearInterval(interval);
    };
  }, [agentId, cacheKey, enabled, refreshMs]);

  const belongsToCurrentScope = snapshotCacheKey === cacheKey;
  return {
    snapshot: belongsToCurrentScope ? snapshot : null,
    loading: belongsToCurrentScope ? loading : enabled,
    error: belongsToCurrentScope ? error : null,
  };
}

/** General weekly quota window across the supported harness providers. */
export function getWeeklyUsageWindow(snapshot: ProviderUsageSnapshot | null): ClaudeRateLimitWindow | null {
  if (!snapshot) return null;
  if (snapshot.provider === 'claude') return snapshot.rateLimits?.sevenDay ?? null;
  if (snapshot.provider === 'codex') return snapshot.rateLimits?.weekly ?? null;
  if (snapshot.provider === 'grok') return snapshot.rateLimits?.weekly ?? null;
  if (snapshot.provider === 'opencode') {
    return snapshot.quotaWindows.find((window) => window.key === 'weekly') ?? null;
  }

  const pi = snapshot as PiUsageSnapshot;
  const quotaWindow = pi.quotaWindows?.find((window) => window.key === 'weekly')
    ?? pi.quotaWindows?.find((window) => window.key === 'weekly-opus')
    ?? pi.quotaWindows?.find((window) => window.key === 'weekly-fable');
  return quotaWindow ?? pi.rateLimits?.sevenDay ?? null;
}

interface PlanLimitsContentProps {
  agentId: string;
  usageScope?: string;
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
  if ((snapshot.provider === 'pi' || snapshot.provider === 'opencode') && snapshot.quotaWindows?.length > 0) {
    const labels: Record<string, string> = {
      session: t('terminal:usage.currentSession'),
      'five-hour': t('terminal:usage.fiveHourLimit'),
      daily: t('terminal:usage.dailyLimit'),
      weekly: t('terminal:usage.weeklyLimit'),
      'weekly-opus': t('terminal:usage.currentWeekOpus'),
      'weekly-fable': t('terminal:usage.currentWeekFable'),
      monthly: t('terminal:usage.monthlyLimit'),
      'on-demand': t('terminal:usage.onDemandLimit'),
    };
    return snapshot.quotaWindows.map((window) => ({
      key: window.key,
      label: labels[window.key] ?? window.key,
      window,
    }));
  }

  if (!snapshot.rateLimits) return windows;

  if (snapshot.provider === 'claude' || (snapshot.provider === 'pi' && snapshot.modelProvider === 'anthropic')) {
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

  if (snapshot.provider === 'codex') {
    const codex = snapshot as CodexUsageSnapshot;
    if (codex.rateLimits?.daily) {
      windows.push({ key: 'daily', label: t('terminal:usage.dailyLimit'), window: codex.rateLimits.daily });
    }
    if (codex.rateLimits?.weekly) {
      windows.push({ key: 'weekly', label: t('terminal:usage.weeklyLimit'), window: codex.rateLimits.weekly });
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

/** Tooltip body. The shared Tooltip mounts it only while visible. */
function PlanLimitsContent({ agentId, usageScope, contextSummary }: PlanLimitsContentProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const { snapshot, loading, error } = useProviderUsageSnapshot(agentId, true, 0, usageScope);

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
  usageScope?: string;
  /** Disable to fall back to no tooltip (e.g. providers without quota APIs). */
  disabled?: boolean;
  /** Optional context-usage summary rendered above the plan limits. */
  contextSummary?: string;
  children: React.ReactNode;
}

export function PlanLimitsTooltip({ agentId, usageScope, disabled, contextSummary, children }: PlanLimitsTooltipProps) {
  return (
    <Tooltip
      position="top"
      maxWidth={320}
      disabled={disabled}
      className="plan-limits-tooltip-wrapper"
      triggerStyle={{ display: 'inline-flex', alignItems: 'center' }}
      content={<PlanLimitsContent agentId={agentId} usageScope={usageScope} contextSummary={contextSummary} />}
    >
      {children}
    </Tooltip>
  );
}
