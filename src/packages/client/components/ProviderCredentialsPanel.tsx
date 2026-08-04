/**
 * ProviderCredentialsPanel — manage Grok / Codex OAuth credential profiles.
 *
 * Same account-switcher UX as ClaudeCredentialsPanel, generalized: lists the
 * active ~/.<provider>/auth.json and named copies (auth.david.json, etc.) so
 * operators can switch the live account when rate-limited, without renaming
 * files on disk. Shows email · plan · token expiry per profile; Codex also
 * gets per-account daily + weekly rate-limit gauges (same admin model as the
 * Claude panel). Grok exposes no per-account gauges.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  deleteProviderCredentials,
  fetchCodexCredentialsUsage,
  fetchProviderCredentials,
  renameProviderCredentials,
  saveProviderCredentials,
  switchProviderCredentials,
  type CodexProfileRateLimitWindow,
  type CodexProfileUsage,
  type CredentialProviderId,
  type ProviderCredentialProfileMeta,
  type ProviderCredentialsList,
} from '../api/provider-credentials';
import { getUsedPercentColor } from '../utils/claude-usage-format';
import { Icon } from './Icon';

export interface ProviderCredentialsPanelProps {
  provider: CredentialProviderId;
  onSwitched?: () => void;
  compact?: boolean;
}

const PROVIDER_LABEL: Record<CredentialProviderId, string> = {
  grok: 'Grok',
  codex: 'Codex',
};

function formatExpiry(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Reset time, compact: same-day → "3:00 PM"; otherwise "Wed 3:00 PM".
function formatResetShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
}

/** One compact gauge row: label · bar · % · reset time (Codex profiles). */
function LimitGauge({ label, window }: { label: string; window: CodexProfileRateLimitWindow | null }) {
  const { t } = useTranslation(['terminal']);
  const percent = window ? Math.max(0, Math.min(100, window.utilization)) : 0;
  const color = window ? getUsedPercentColor(percent) : 'var(--text-muted)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', marginTop: '3px' }}>
      <span style={{ width: '52px', flexShrink: 0, color: 'var(--text-secondary)' }}>{label}</span>
      <div
        style={{
          flex: 1,
          minWidth: '36px',
          height: '5px',
          background: 'var(--bg-primary)',
          borderRadius: '3px',
          overflow: 'hidden',
        }}
      >
        {window && <div style={{ width: `${percent}%`, height: '100%', background: color }} />}
      </div>
      <span style={{ color, fontVariantNumeric: 'tabular-nums', width: '34px', textAlign: 'right', flexShrink: 0 }}>
        {window ? `${Math.round(percent)}%` : '0%'}
      </span>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
        {window?.resetsAt ? t('terminal:usage.resets', { time: formatResetShort(window.resetsAt) }) : ''}
      </span>
    </div>
  );
}

/** Daily + weekly gauges for one Codex profile (or its error state). */
function ProfileLimits({ usage }: { usage: CodexProfileUsage | undefined }) {
  const { t } = useTranslation(['terminal']);
  if (!usage) return null;

  const limits = usage.rateLimits;
  return (
    <div style={{ marginTop: '4px' }}>
      {limits && (
        <>
          <LimitGauge label={t('terminal:credentials.gaugeDaily', { defaultValue: 'Daily' })} window={limits.daily} />
          <LimitGauge label={t('terminal:credentials.gaugeWeek', { defaultValue: 'Week' })} window={limits.weekly} />
        </>
      )}
      {usage.error && (
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '3px' }}>{usage.error}</div>
      )}
    </div>
  );
}

function ProfileRow({
  profile,
  usage,
  busy,
  onUse,
  onRename,
  onDelete,
}: {
  profile: ProviderCredentialProfileMeta;
  usage: CodexProfileUsage | undefined;
  busy: boolean;
  onUse: (name: string) => void;
  onRename: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const { t } = useTranslation(['terminal', 'common']);
  const expired = profile.expiresAt != null && profile.expiresAt <= Date.now();
  const meta = [profile.label, profile.email].filter(Boolean).join(' · ');

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 10px',
        background: profile.isActive ? 'rgba(74, 158, 255, 0.1)' : 'var(--bg-tertiary, var(--bg-secondary))',
        border: profile.isActive ? '1px solid rgba(74, 158, 255, 0.45)' : '1px solid var(--border-color)',
        borderRadius: '6px',
        marginBottom: '6px',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: '13px' }}>{profile.name}</span>
          {profile.isActive && (
            <span
              style={{
                fontSize: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
                color: '#4a9eff',
                border: '1px solid rgba(74, 158, 255, 0.5)',
                borderRadius: '4px',
                padding: '1px 6px',
              }}
            >
              {t('terminal:credentials.activeBadge')}
            </span>
          )}
          {!profile.valid && <span style={{ fontSize: '10px', color: '#ff8a8a' }}>{t('terminal:credentials.invalid')}</span>}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
          {meta}
          {profile.expiresAt != null && (
            <span style={{ color: expired ? '#ff8a8a' : undefined }}>
              {meta ? ' · ' : ''}
              {t('terminal:credentials.tokenExpires', { time: formatExpiry(profile.expiresAt) })}
            </span>
          )}
        </div>
        <ProfileLimits usage={usage} />
      </div>
      <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
        {!profile.isActive && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !profile.valid}
            onClick={() => onUse(profile.name)}
            style={{ padding: '4px 10px', fontSize: '11px' }}
            title={t('terminal:credentials.useTitle')}
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

export function ProviderCredentialsPanel({ provider, onSwitched, compact }: ProviderCredentialsPanelProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [data, setData] = useState<ProviderCredentialsList | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState('');
  const [stashName, setStashName] = useState('');
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Daily/weekly gauges per profile id ("active" or name), Codex only, server-cached
  const [usageById, setUsageById] = useState<Record<string, CodexProfileUsage>>({});

  const loadUsage = useCallback(async () => {
    if (provider !== 'codex') return;
    try {
      const result = await fetchCodexCredentialsUsage();
      const byId: Record<string, CodexProfileUsage> = {};
      for (const entry of result.usage) byId[entry.id] = entry;
      setUsageById(byId);
    } catch {
      // Gauges are best-effort decoration; the profile list stays usable.
    }
  }, [provider]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchProviderCredentials(provider));
      void loadUsage();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [provider, loadUsage]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyList = (list: ProviderCredentialsList) => setData(list);
  const needsStash = Boolean(data?.active?.valid && !data.active.matchesNamed);

  const handleUse = async (name: string) => {
    setError(null);
    setMessage(null);
    if (needsStash) {
      setPendingSwitch(name);
      return;
    }
    setBusy(true);
    try {
      const result = await switchProviderCredentials(provider, name);
      setData({ provider, dir: data?.dir ?? '', active: result.active, profiles: result.profiles });
      setMessage(t('terminal:credentials.switched', { name }));
      setPendingSwitch(null);
      void loadUsage();
      onSwitched?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmSwitchWithStash = async () => {
    if (!pendingSwitch) return;
    const stash = stashName.trim();
    if (!stash) {
      setError(t('terminal:credentials.stashRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await switchProviderCredentials(provider, pendingSwitch, { stashActiveAs: stash });
      setData({ provider, dir: data?.dir ?? '', active: result.active, profiles: result.profiles });
      setMessage(
        result.stashedAs
          ? t('terminal:credentials.switchedWithStash', { name: pendingSwitch, stash: result.stashedAs })
          : t('terminal:credentials.switched', { name: pendingSwitch }),
      );
      setPendingSwitch(null);
      setStashName('');
      void loadUsage();
      onSwitched?.();
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
      applyList(await saveProviderCredentials(provider, name));
      setSaveName('');
      setMessage(t('terminal:credentials.saved', { name }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already exists/i.test(msg) && window.confirm(t('terminal:credentials.confirmOverwrite', { name }))) {
        try {
          applyList(await saveProviderCredentials(provider, name, { force: true }));
          setSaveName('');
          setMessage(t('terminal:credentials.saved', { name }));
          setBusy(false);
          return;
        } catch (err2) {
          setError(err2 instanceof Error ? err2.message : String(err2));
          setBusy(false);
          return;
        }
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async (from: string) => {
    const to = window.prompt(t('terminal:credentials.renamePrompt', { name: from }), from);
    if (!to || to.trim() === from) return;
    setBusy(true);
    setError(null);
    try {
      applyList(await renameProviderCredentials(provider, from, to.trim()));
      setMessage(t('terminal:credentials.renamed', { from, to: to.trim() }));
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
      applyList(await deleteProviderCredentials(provider, name));
      setMessage(t('terminal:credentials.deleted', { name }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const activeLabel = data?.active
    ? data.active.matchesNamed
      ? data.active.matchesNamed
      : t('terminal:credentials.unsavedActive')
    : t('terminal:credentials.noActive');

  return (
    <div
      className="claude-credentials-panel"
      style={{
        marginTop: compact ? '12px' : '0',
        paddingTop: compact ? '12px' : '0',
        borderTop: compact ? '1px solid var(--border-color)' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', gap: '8px' }}>
        <div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {t('terminal:credentials.providerTitle', {
              provider: PROVIDER_LABEL[provider],
              defaultValue: `${PROVIDER_LABEL[provider]} Accounts`,
            })}
          </div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>
            {t('terminal:credentials.current', { name: activeLabel })}
            {data?.active?.email && <span style={{ color: 'var(--text-secondary)' }}> · {data.active.email}</span>}
            {data?.active?.label && <span style={{ color: 'var(--text-secondary)' }}> ({data.active.label})</span>}
          </div>
          {/* Unsaved active account has no profile row below — show its gauges here */}
          {data?.active && !data.active.matchesNamed && (
            <ProfileLimits usage={usageById['active']} />
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
        {t('terminal:credentials.providerHelp', {
          provider: PROVIDER_LABEL[provider],
          dir: data?.dir ?? `~/.${provider}`,
          defaultValue: `Named copies of ${data?.dir ?? `~/.${provider}`}/auth.json. Switch the active ${PROVIDER_LABEL[provider]} account when you hit rate limits — same as renaming the file manually.`,
        })}
      </p>

      {error && (
        <div
          style={{
            padding: '8px 10px',
            marginBottom: '8px',
            background: 'rgba(255, 74, 74, 0.08)',
            border: '1px solid rgba(255, 74, 74, 0.3)',
            borderRadius: '6px',
            color: '#ff8a8a',
            fontSize: '12px',
          }}
        >
          {error}
        </div>
      )}

      {message && (
        <div
          style={{
            padding: '8px 10px',
            marginBottom: '8px',
            background: 'rgba(74, 255, 158, 0.08)',
            border: '1px solid rgba(74, 255, 158, 0.3)',
            borderRadius: '6px',
            color: '#7dffb0',
            fontSize: '12px',
          }}
        >
          {message}
        </div>
      )}

      {pendingSwitch && (
        <div
          style={{
            padding: '10px 12px',
            marginBottom: '10px',
            background: 'rgba(255, 158, 74, 0.08)',
            border: '1px solid rgba(255, 158, 74, 0.35)',
            borderRadius: '6px',
          }}
        >
          <div style={{ fontSize: '12px', marginBottom: '8px', lineHeight: 1.45 }}>
            {t('terminal:credentials.stashPrompt', { name: pendingSwitch })}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={stashName}
              onChange={(e) => setStashName(e.target.value)}
              placeholder={t('terminal:credentials.stashPlaceholder')}
              disabled={busy}
              style={{
                flex: 1,
                minWidth: '120px',
                padding: '6px 8px',
                fontSize: '12px',
                borderRadius: '4px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
              }}
            />
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void confirmSwitchWithStash()} style={{ padding: '6px 12px', fontSize: '12px' }}>
              {t('terminal:credentials.confirmSwitch')}
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setPendingSwitch(null)} style={{ padding: '6px 12px', fontSize: '12px' }}>
              {t('common:buttons.cancel')}
            </button>
          </div>
        </div>
      )}

      {loading && !data && (
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '8px 0' }}>{t('common:status.loading')}…</div>
      )}

      {data && data.profiles.length === 0 && (
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>{t('terminal:credentials.noProfiles')}</div>
      )}

      {data?.profiles.map((profile) => (
        <ProfileRow
          key={profile.name}
          profile={profile}
          usage={usageById[profile.id]}
          busy={busy}
          onUse={(n) => void handleUse(n)}
          onRename={(n) => void handleRename(n)}
          onDelete={(n) => void handleDelete(n)}
        />
      ))}

      <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder={t('terminal:credentials.savePlaceholder')}
          disabled={busy || !data?.active?.valid}
          style={{
            flex: 1,
            minWidth: '140px',
            padding: '6px 8px',
            fontSize: '12px',
            borderRadius: '4px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
          }}
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

      {data?.dir && (
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '8px', wordBreak: 'break-all' }}>{data.dir}</div>
      )}
    </div>
  );
}
