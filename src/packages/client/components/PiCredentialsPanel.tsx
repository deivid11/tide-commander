/** Account switcher for Pi's auth.json + named auth.<name>.json profiles. */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  deletePiCredentials,
  fetchPiCredentials,
  fetchPiCredentialsUsage,
  renamePiCredentials,
  savePiCredentials,
  switchPiCredentials,
  type PiCredentialProfileMeta,
  type PiCredentialsList,
  type PiProfileUsage,
  type PiQuotaWindow,
  type PiQuotaWindowKey,
} from '../api/pi-credentials';
import { getUsedPercentColor } from '../utils/claude-usage-format';
import { Icon } from './Icon';

interface PiCredentialsPanelProps {
  modelProvider: string;
  onSwitched?: () => void;
  compact?: boolean;
}

function providerLabel(provider: string): string {
  const known: Record<string, string> = {
    anthropic: 'Anthropic',
    'openai-codex': 'OpenAI Codex',
    'opencode-go': 'OpenCode Go',
    'github-copilot': 'GitHub Copilot',
    xai: 'xAI',
    radius: 'Radius',
  };
  return known[provider] ?? provider
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function formatExpiry(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatResetShort(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
}

function formatQuotaAmount(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function quotaLabel(key: PiQuotaWindowKey, t: (key: string, options?: Record<string, unknown>) => string): string {
  const labels: Record<PiQuotaWindowKey, string> = {
    session: t('terminal:credentials.gaugeSession', { defaultValue: 'Session' }),
    'five-hour': t('terminal:credentials.gaugeFiveHour', { defaultValue: '5-hour' }),
    daily: t('terminal:credentials.gaugeDaily', { defaultValue: 'Daily' }),
    weekly: t('terminal:credentials.gaugeWeek', { defaultValue: 'Week' }),
    'weekly-opus': t('terminal:credentials.gaugeWeekOpus', { defaultValue: 'Opus wk' }),
    'weekly-fable': t('terminal:credentials.gaugeWeekFable', { defaultValue: 'Fable wk' }),
    monthly: t('terminal:credentials.gaugeMonth', { defaultValue: 'Month' }),
    'on-demand': t('terminal:credentials.gaugeOnDemand', { defaultValue: 'On-demand' }),
  };
  return labels[key];
}

function legacyQuotaWindows(usage: PiProfileUsage): PiQuotaWindow[] {
  if (Array.isArray(usage.quotaWindows)) return usage.quotaWindows;
  const limits = usage.rateLimits;
  if (!limits) return [];
  const windows: Array<PiQuotaWindow | null> = [
    limits.fiveHour ? { key: 'session', ...limits.fiveHour } : null,
    limits.sevenDay ? { key: 'weekly', ...limits.sevenDay } : null,
    limits.sevenDayOpus ? { key: 'weekly-opus', ...limits.sevenDayOpus } : null,
    limits.sevenDayFable ? { key: 'weekly-fable', ...limits.sevenDayFable } : null,
  ];
  return windows.filter((window): window is PiQuotaWindow => window !== null);
}

function LimitGauge({ label, window }: { label: string; window: PiQuotaWindow }) {
  const { t } = useTranslation(['terminal']);
  const usedPercent = Math.max(0, Math.min(100, window.utilization));
  const remainingPercent = Math.max(0, 100 - usedPercent);
  const color = getUsedPercentColor(usedPercent);
  const hasAmount = typeof window.used === 'number'
    && typeof window.limit === 'number'
    && Number.isFinite(window.used)
    && Number.isFinite(window.limit);
  const remainingAmount = hasAmount ? Math.max(0, window.limit! - window.used!) : null;
  return (
    <div style={{ marginTop: '5px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px' }}>
        <span style={{ width: '58px', flexShrink: 0, color: 'var(--text-secondary)' }}>{label}</span>
        <div style={{
          flex: 1,
          minWidth: '42px',
          height: '6px',
          background: 'var(--bg-primary)',
          borderRadius: '3px',
          overflow: 'hidden',
        }}>
          <div style={{ width: `${remainingPercent}%`, height: '100%', background: color }} />
        </div>
        <span style={{ color, fontVariantNumeric: 'tabular-nums', minWidth: '58px', textAlign: 'right', flexShrink: 0, fontWeight: 600 }}>
          {t('terminal:usage.percentRemaining', { percent: Math.round(remainingPercent), defaultValue: `${Math.round(remainingPercent)}% left` })}
        </span>
      </div>
      <div style={{ marginLeft: '64px', marginTop: '2px', color: 'var(--text-muted)', fontSize: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {remainingAmount != null && (
          <span>{t('terminal:usage.amountRemaining', {
            remaining: formatQuotaAmount(remainingAmount),
            limit: formatQuotaAmount(window.limit!),
            defaultValue: `${formatQuotaAmount(remainingAmount)} / ${formatQuotaAmount(window.limit!)} left`,
          })}</span>
        )}
        {window.resetsAt && <span>{t('terminal:usage.resets', { time: formatResetShort(window.resetsAt) })}</span>}
        <span>{t('terminal:usage.percentUsed', { percent: Math.round(usedPercent) })}</span>
      </div>
    </div>
  );
}

function ProfileLimits({ usage, loading }: { usage: PiProfileUsage | undefined; loading: boolean }) {
  const { t } = useTranslation(['terminal']);
  if (!usage && loading) {
    return <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '5px' }}>{t('terminal:credentials.loadingLimits', { defaultValue: 'Loading remaining limits…' })}</div>;
  }
  if (!usage) return null;
  const windows = legacyQuotaWindows(usage);
  return (
    <div style={{ marginTop: '4px' }}>
      {windows.map((window) => (
        <LimitGauge key={window.key} label={quotaLabel(window.key, t)} window={window} />
      ))}
      {windows.length === 0 && !usage.error && (
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '3px' }}>
          {t('terminal:credentials.noLimitWindows', { defaultValue: 'No plan-limit windows were reported.' })}
        </div>
      )}
      {usage.error && (
        <div style={{ fontSize: '10px', color: '#ff8a8a', marginTop: '4px', lineHeight: 1.35 }}>{usage.error}</div>
      )}
    </div>
  );
}

function ProfileRow({
  profile,
  usage,
  usageLoading,
  busy,
  onUse,
  onRename,
  onDelete,
}: {
  profile: PiCredentialProfileMeta;
  usage: PiProfileUsage | undefined;
  usageLoading: boolean;
  busy: boolean;
  onUse: (name: string) => void;
  onRename: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const { t } = useTranslation(['terminal']);
  const expired = profile.expiresAt != null && profile.expiresAt <= Date.now();
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '8px 10px',
      background: profile.isActive ? 'rgba(74, 158, 255, 0.1)' : 'var(--bg-tertiary, var(--bg-secondary))',
      border: profile.isActive ? '1px solid rgba(74, 158, 255, 0.45)' : '1px solid var(--border-color)',
      borderRadius: '6px',
      marginBottom: '6px',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: '13px' }}>{profile.name}</span>
          {profile.isActive && (
            <span style={{
              fontSize: '10px',
              textTransform: 'uppercase',
              letterSpacing: '0.4px',
              color: '#4a9eff',
              border: '1px solid rgba(74, 158, 255, 0.5)',
              borderRadius: '4px',
              padding: '1px 6px',
            }}>
              {t('terminal:credentials.activeBadge')}
            </span>
          )}
          {!profile.valid && <span style={{ fontSize: '10px', color: '#ff8a8a' }}>{t('terminal:credentials.invalid')}</span>}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
          {profile.detail ?? profile.label} · {profile.credentialType === 'oauth' ? 'OAuth' : 'API key'}
          {profile.expiresAt != null && (
            <span style={{ color: expired ? '#ff8a8a' : undefined }}>
              {' '}· {t('terminal:credentials.tokenExpires', { time: formatExpiry(profile.expiresAt) })}
            </span>
          )}
        </div>
        <ProfileLimits usage={usage} loading={usageLoading} />
      </div>
      <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
        {!profile.isActive && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !profile.valid}
            onClick={() => onUse(profile.name)}
            style={{ padding: '4px 10px', fontSize: '11px' }}
            title={t('terminal:credentials.piUseTitle')}
          >
            {t('terminal:credentials.use')}
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => onRename(profile.name)}
          style={{ padding: '4px 8px', fontSize: '11px' }}
          title={t('terminal:credentials.rename')}
        >
          <Icon name="edit" size={12} />
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => onDelete(profile.name)}
          style={{ padding: '4px 8px', fontSize: '11px', color: '#ff8a8a' }}
          title={t('terminal:credentials.delete')}
        >
          <Icon name="trash" size={12} />
        </button>
      </div>
    </div>
  );
}

export function PiCredentialsPanel({ modelProvider, onSwitched, compact }: PiCredentialsPanelProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [data, setData] = useState<PiCredentialsList | null>(null);
  const [usageById, setUsageById] = useState<Record<string, PiProfileUsage>>({});
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saveName, setSaveName] = useState('');
  const [stashName, setStashName] = useState('');
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const label = providerLabel(modelProvider);

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    setUsageError(null);
    try {
      const result = await fetchPiCredentialsUsage(modelProvider);
      setUsageById(Object.fromEntries(result.usage.map((entry) => [entry.id, entry])));
    } catch (err) {
      setUsageError(err instanceof Error ? err.message : String(err));
    } finally {
      setUsageLoading(false);
    }
  }, [modelProvider]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchPiCredentials(modelProvider));
      void loadUsage();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [modelProvider, loadUsage]);

  useEffect(() => {
    setData(null);
    setUsageById({});
    void load();
  }, [load]);

  const needsStash = Boolean(data?.active?.valid && !data.active.matchesNamed);

  const applySwitch = async (name: string, stashActiveAs?: string) => {
    const result = await switchPiCredentials(modelProvider, name, { stashActiveAs });
    setData({
      provider: modelProvider,
      dir: data?.dir ?? '',
      profileDir: data?.profileDir ?? null,
      active: result.active,
      profiles: result.profiles,
    });
    setMessage(result.stashedAs
      ? t('terminal:credentials.piSwitchedWithStash', { name, stash: result.stashedAs })
      : t('terminal:credentials.piSwitched', { name }));
    setPendingSwitch(null);
    setStashName('');
    void loadUsage();
    onSwitched?.();
  };

  const handleUse = async (name: string) => {
    setError(null);
    setMessage(null);
    if (needsStash) {
      setPendingSwitch(name);
      return;
    }
    setBusy(true);
    try {
      await applySwitch(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmSwitch = async () => {
    if (!pendingSwitch) return;
    const stash = stashName.trim();
    if (!stash) {
      setError(t('terminal:credentials.stashRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await applySwitch(pendingSwitch, stash);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    const name = saveName.trim();
    if (!name) {
      setError(t('terminal:credentials.nameRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setData(await savePiCredentials(modelProvider, name));
      setSaveName('');
      setMessage(t('terminal:credentials.saved', { name }));
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      if (/already exists/i.test(text) && window.confirm(t('terminal:credentials.confirmOverwrite', { name }))) {
        try {
          setData(await savePiCredentials(modelProvider, name, { force: true }));
          setSaveName('');
          setMessage(t('terminal:credentials.saved', { name }));
          return;
        } catch (forceError) {
          setError(forceError instanceof Error ? forceError.message : String(forceError));
          return;
        }
      }
      setError(text);
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async (from: string) => {
    const to = window.prompt(t('terminal:credentials.renamePrompt', { name: from }), from)?.trim();
    if (!to || to === from) return;
    setBusy(true);
    setError(null);
    try {
      setData(await renamePiCredentials(modelProvider, from, to));
      setMessage(t('terminal:credentials.renamed', { from, to }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!window.confirm(t('terminal:credentials.confirmDelete', { name }))) return;
    setBusy(true);
    setError(null);
    try {
      setData(await deletePiCredentials(modelProvider, name));
      setMessage(t('terminal:credentials.deleted', { name }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const activeLabel = data?.active
    ? data.active.matchesNamed ?? t('terminal:credentials.unsavedActive')
    : t('terminal:credentials.noActive');

  return (
    <div className="claude-credentials-panel" style={{
      marginTop: compact ? '12px' : '0',
      paddingTop: compact ? '12px' : '0',
      borderTop: compact ? '1px solid var(--border-color)' : undefined,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', gap: '8px' }}>
        <div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {t('terminal:credentials.piTitle', { provider: label })}
          </div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>
            {t('terminal:credentials.current', { name: activeLabel })}
          </div>
          {data?.active && !data.active.matchesNamed && (
            <ProfileLimits usage={usageById.active} loading={usageLoading} />
          )}
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void load()}
          disabled={loading || busy}
          style={{ padding: '4px 10px', fontSize: '11px', display: 'inline-flex', gap: '6px', alignItems: 'center' }}
          title={t('common:buttons.refresh')}
        >
          <span style={{ display: 'inline-block', animation: loading ? 'spin 1s linear infinite' : 'none' }}>
            <Icon name="refresh" size={12} />
          </span>
        </button>
      </div>

      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.45 }}>
        {modelProvider === 'anthropic'
          ? t('terminal:credentials.piAnthropicHelp', {
              dir: data?.profileDir ?? '~/.claude',
              piDir: data?.dir ?? '~/.pi/agent',
            })
          : modelProvider === 'openai-codex'
            ? t('terminal:credentials.piCodexHelp', {
                dir: data?.profileDir ?? '~/.codex',
                piDir: data?.dir ?? '~/.pi/agent',
              })
            : modelProvider === 'xai'
              ? t('terminal:credentials.piGrokHelp', {
                  dir: data?.profileDir ?? '~/.grok',
                  piDir: data?.dir ?? '~/.pi/agent',
                })
              : t('terminal:credentials.piHelp', { provider: label, dir: data?.dir ?? '~/.pi/agent' })}
        {' '}{t('terminal:credentials.piQuotaHelp', {
          defaultValue: 'Each account shows the remaining plan percentage and reset time. Providers do not expose an exact remaining token count.',
        })}
      </p>

      {error && <div style={{ padding: '8px 10px', marginBottom: '8px', background: 'rgba(255, 74, 74, 0.08)', border: '1px solid rgba(255, 74, 74, 0.3)', borderRadius: '6px', color: '#ff8a8a', fontSize: '12px' }}>{error}</div>}
      {usageError && <div style={{ padding: '8px 10px', marginBottom: '8px', background: 'rgba(255, 74, 74, 0.08)', border: '1px solid rgba(255, 74, 74, 0.3)', borderRadius: '6px', color: '#ff8a8a', fontSize: '12px' }}>{t('terminal:credentials.limitsLoadError', { message: usageError, defaultValue: `Could not load account limits: ${usageError}` })}</div>}
      {message && <div style={{ padding: '8px 10px', marginBottom: '8px', background: 'rgba(74, 255, 158, 0.08)', border: '1px solid rgba(74, 255, 158, 0.3)', borderRadius: '6px', color: '#7dffb0', fontSize: '12px' }}>{message}</div>}

      {pendingSwitch && (
        <div style={{ padding: '10px 12px', marginBottom: '10px', background: 'rgba(255, 158, 74, 0.08)', border: '1px solid rgba(255, 158, 74, 0.35)', borderRadius: '6px' }}>
          <div style={{ fontSize: '12px', marginBottom: '8px', lineHeight: 1.45 }}>
            {t('terminal:credentials.stashPrompt', { name: pendingSwitch })}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={stashName}
              onChange={(event) => setStashName(event.target.value)}
              placeholder={t('terminal:credentials.stashPlaceholder')}
              disabled={busy}
              style={{ flex: 1, minWidth: '120px', padding: '6px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
            />
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void confirmSwitch()} style={{ padding: '6px 12px', fontSize: '12px' }}>
              {t('terminal:credentials.confirmSwitch')}
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setPendingSwitch(null)} style={{ padding: '6px 12px', fontSize: '12px' }}>
              {t('common:buttons.cancel')}
            </button>
          </div>
        </div>
      )}

      {loading && !data && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '8px 0' }}>{t('common:status.loading')}…</div>}
      {data && data.profiles.length === 0 && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>{t('terminal:credentials.noProfiles')}</div>}
      {data?.profiles.map((profile) => (
        <ProfileRow
          key={profile.name}
          profile={profile}
          usage={usageById[profile.id]}
          usageLoading={usageLoading}
          busy={busy}
          onUse={(name) => void handleUse(name)}
          onRename={(name) => void handleRename(name)}
          onDelete={(name) => void handleDelete(name)}
        />
      ))}

      <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          value={saveName}
          onChange={(event) => setSaveName(event.target.value)}
          placeholder={t('terminal:credentials.savePlaceholder')}
          disabled={busy || !data?.active?.valid}
          style={{ flex: 1, minWidth: '140px', padding: '6px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
        />
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || !data?.active?.valid || !saveName.trim()}
          onClick={() => void handleSave()}
          style={{ padding: '6px 12px', fontSize: '12px' }}
        >
          {t('terminal:credentials.saveActive')}
        </button>
      </div>

      {(data?.profileDir ?? data?.dir) && (
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '8px', wordBreak: 'break-all' }}>
          {data?.profileDir ?? data?.dir}
        </div>
      )}
    </div>
  );
}
