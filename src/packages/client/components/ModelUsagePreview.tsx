import React, { useEffect, useMemo, useState } from 'react';
import type { Agent, AgentProvider, ClaudeModel } from '../../shared/types';
import { CLAUDE_MODELS, GROK_MODELS } from '../../shared/types';
import { fetchPiModels } from '../api/pi';
import { fetchPiCredentialsUsage } from '../api/pi-credentials';
import { fetchClaudeCredentialsUsage } from '../api/claude-credentials';
import { fetchCodexCredentialsUsage, fetchGrokCredentialsUsage } from '../api/provider-credentials';
import type { ClaudeRateLimitWindow } from '../api/claude-usage';
import { getDisplayContextInfo } from '../utils/context';
import { getUsedPercentColor } from '../utils/claude-usage-format';
import { formatTokenCapacity } from '../utils/formatting';

interface ModelUsagePreviewProps {
  provider: AgentProvider;
  claudeModel?: ClaudeModel;
  codexModel?: string;
  opencodeModel?: string;
  grokModel?: string;
  piModel?: string;
  /** Present in Edit Agent; omitted for New Agent. */
  agent?: Agent;
}

interface WeeklyResult {
  window: ClaudeRateLimitWindow | null;
  error: string | null;
  free?: boolean;
}

const usageCache = new Map<string, { result: WeeklyResult; fetchedAt: number }>();
const USAGE_CACHE_MS = 60_000;

function piProvider(model: string | undefined): string | null {
  const slash = model?.indexOf('/') ?? -1;
  return slash > 0 ? model!.slice(0, slash) : null;
}

function pickPiWeekly(
  windows: Array<ClaudeRateLimitWindow & { key: string }>,
): ClaudeRateLimitWindow | null {
  return windows.find((window) => window.key === 'weekly')
    ?? windows.find((window) => window.key === 'weekly-opus')
    ?? windows.find((window) => window.key === 'weekly-fable')
    ?? null;
}

async function fetchWeekly(
  provider: AgentProvider,
  selectedModelProvider: string | null,
): Promise<WeeklyResult> {
  if (provider === 'claude') {
    const result = await fetchClaudeCredentialsUsage();
    const active = result.usage.find((entry) => entry.id === 'active');
    return { window: active?.rateLimits?.sevenDay ?? null, error: active?.error ?? null };
  }
  if (provider === 'codex') {
    const result = await fetchCodexCredentialsUsage();
    const active = result.usage.find((entry) => entry.id === 'active');
    return { window: active?.rateLimits?.weekly ?? null, error: active?.error ?? null };
  }
  if (provider === 'grok') {
    const result = await fetchGrokCredentialsUsage();
    return { window: result.rateLimits?.weekly ?? null, error: result.error };
  }
  if (provider === 'pi') {
    if (!selectedModelProvider) {
      return { window: null, error: 'Choose a Pi provider/model to load limits' };
    }
    const result = await fetchPiCredentialsUsage(selectedModelProvider);
    const active = result.usage.find((entry) => entry.id === 'active');
    return {
      window: active ? pickPiWeekly(active.quotaWindows) ?? active.rateLimits?.sevenDay ?? null : null,
      error: active?.error ?? null,
    };
  }
  if (provider === 'opencode') {
    if (selectedModelProvider === 'opencode') {
      return {
        window: null,
        error: 'OpenCode free-model capacity is dynamic; no weekly quota is published',
        free: true,
      };
    }
    if (selectedModelProvider === 'opencode-go') {
      const result = await fetchPiCredentialsUsage('opencode-go');
      const active = result.usage.find((entry) => entry.id === 'active');
      return {
        window: active ? pickPiWeekly(active.quotaWindows) : null,
        error: active?.error ?? null,
      };
    }
  }
  return { window: null, error: 'Weekly limits are unavailable for this model provider' };
}

function staticContextWindow(props: ModelUsagePreviewProps): number | null {
  if (props.provider === 'claude') {
    return props.claudeModel ? CLAUDE_MODELS[props.claudeModel]?.contextWindow ?? 200_000 : 200_000;
  }
  if (props.provider === 'codex') return 258_400;
  if (props.provider === 'grok') return GROK_MODELS[props.grokModel || '']?.contextWindow ?? 500_000;
  if (props.provider === 'opencode') return 200_000;
  return null;
}

export function ModelUsagePreview(props: ModelUsagePreviewProps) {
  const selectedPiProvider = piProvider(props.piModel);
  const selectedOpenCodeProvider = piProvider(props.opencodeModel);
  const selectedUsageProvider = props.provider === 'pi' ? selectedPiProvider : selectedOpenCodeProvider;
  const selectedUsageModel = props.provider === 'pi' ? props.piModel : props.opencodeModel;
  const [piContextWindow, setPiContextWindow] = useState<number | null>(null);
  const [weekly, setWeekly] = useState<WeeklyResult>({ window: null, error: null });
  const [loading, setLoading] = useState(false);

  const usageKey = `${props.provider}:${selectedUsageProvider ?? ''}:${selectedUsageModel ?? ''}`;

  useEffect(() => {
    let cancelled = false;

    if (props.provider === 'pi' && props.piModel) {
      setPiContextWindow(null);
      fetchPiModels(false)
        .then((catalog) => {
          if (cancelled) return;
          const detail = catalog.modelDetails?.find((model) => model.id === props.piModel);
          setPiContextWindow(detail?.contextWindow ?? null);
        })
        .catch(() => {
          if (!cancelled) setPiContextWindow(null);
        });
    } else {
      setPiContextWindow(null);
    }

    const cached = usageCache.get(usageKey);
    if (cached && Date.now() - cached.fetchedAt < USAGE_CACHE_MS) {
      setWeekly(cached.result);
      setLoading(false);
      return () => { cancelled = true; };
    }

    setLoading(true);
    setWeekly({ window: null, error: null });
    fetchWeekly(props.provider, selectedUsageProvider)
      .then((result) => {
        if (cancelled) return;
        // Missing/error limits are transient (fresh login, upstream schema,
        // temporary billing failure); don't make them sticky across modal opens.
        if (result.window || result.free) usageCache.set(usageKey, { result, fetchedAt: Date.now() });
        else usageCache.delete(usageKey);
        setWeekly(result);
        setLoading(false);
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setWeekly({ window: null, error: error.message || 'Failed to load weekly limits' });
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [props.provider, props.piModel, selectedUsageModel, selectedUsageProvider, usageKey]);

  const context = useMemo(() => {
    const selectedLimit = props.provider === 'pi'
      ? piContextWindow
      : staticContextWindow(props);
    const sameRuntime = props.agent?.provider === props.provider;
    const live = sameRuntime && props.agent ? getDisplayContextInfo(props.agent) : null;
    const limit = selectedLimit ?? live?.contextWindow ?? null;
    const used = live?.totalTokens ?? 0;
    const usedPercent = limit && limit > 0 ? Math.max(0, Math.min(100, (used / limit) * 100)) : 0;
    return { limit, usedPercent, remaining: Math.max(0, 100 - usedPercent) };
  }, [piContextWindow, props]);

  const weekUsed = weekly.window
    ? Math.max(0, Math.min(100, weekly.window.utilization))
    : null;
  const weekRemaining = weekUsed === null ? null : Math.max(0, 100 - weekUsed);
  const contextColor = getUsedPercentColor(context.usedPercent);
  const weekColor = weekly.free ? '#4aff9e' : weekUsed === null ? 'var(--text-muted)' : getUsedPercentColor(weekUsed);

  return (
    <div className="model-usage-preview" aria-label="Selected model capacity and plan usage">
      <div className="model-usage-preview__gauge" title={context.limit ? `${context.remaining.toFixed(1)}% context remaining` : 'Context capacity unavailable'}>
        <span className="model-usage-preview__label">
          Ctx <strong>{context.limit ? formatTokenCapacity(context.limit) : '—'}</strong>
        </span>
        <span className="model-usage-preview__bar">
          <span style={{ width: `${context.usedPercent}%`, backgroundColor: contextColor }} />
        </span>
        <span className="model-usage-preview__value" style={{ color: contextColor }}>
          {context.limit ? `${Math.round(context.remaining)}% free` : '—'}
        </span>
      </div>
      <div className="model-usage-preview__gauge" title={weekly.window ? `${weekRemaining}% weekly quota remaining` : weekly.error ?? 'Weekly limit unavailable'}>
        <span className="model-usage-preview__label">Week</span>
        <span className="model-usage-preview__bar">
          <span style={{ width: `${weekUsed ?? 0}%`, backgroundColor: weekColor }} />
        </span>
        <span className="model-usage-preview__value" style={{ color: weekColor }}>
          {loading ? '…' : weekly.free ? 'Free' : weekRemaining === null ? '—' : `${Math.round(weekRemaining)}% left`}
        </span>
      </div>
    </div>
  );
}
