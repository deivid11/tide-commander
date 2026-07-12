/**
 * ClaudeCredentialsPanel — manage Claude Code OAuth credential profiles.
 *
 * Lists ~/.claude/.credentials.json (active) and named copies
 * (.credentials.david.json, etc.) so operators can switch the live account
 * when rate-limited, without manually renaming files on disk.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  deleteClaudeCredentials,
  fetchClaudeCredentials,
  renameClaudeCredentials,
  saveClaudeCredentials,
  switchClaudeCredentials,
  type ClaudeCredentialProfileMeta,
  type ClaudeCredentialsList,
} from '../api/claude-credentials';
import { Icon } from './Icon';

export interface ClaudeCredentialsPanelProps {
  /** Called after a successful switch so parent can refresh usage gauges. */
  onSwitched?: () => void;
  /** Compact layout for embedding under the usage section. */
  compact?: boolean;
}

function formatExpiry(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ProfileRow({
  profile,
  busy,
  onUse,
  onRename,
  onDelete,
}: {
  profile: ClaudeCredentialProfileMeta;
  busy: boolean;
  onUse: (name: string) => void;
  onRename: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const { t } = useTranslation(['terminal', 'common']);
  const sub = profile.subscriptionType ?? '—';
  const tier = profile.rateLimitTier ?? '';
  const meta = [sub, tier].filter(Boolean).join(' · ');

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 10px',
        background: profile.isActive ? 'rgba(74, 158, 255, 0.1)' : 'var(--bg-tertiary, var(--bg-secondary))',
        border: profile.isActive
          ? '1px solid rgba(74, 158, 255, 0.45)'
          : '1px solid var(--border-color)',
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
          {!profile.valid && (
            <span style={{ fontSize: '10px', color: '#ff8a8a' }}>
              {t('terminal:credentials.invalid')}
            </span>
          )}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
          {meta}
          {profile.expiresAt != null && (
            <span> · {t('terminal:credentials.tokenExpires', { time: formatExpiry(profile.expiresAt) })}</span>
          )}
        </div>
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

export function ClaudeCredentialsPanel({ onSwitched, compact }: ClaudeCredentialsPanelProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [data, setData] = useState<ClaudeCredentialsList | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState('');
  const [stashName, setStashName] = useState('');
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchClaudeCredentials();
      setData(list);
      // Prefill stash name when active is unsaved
      if (list.active && !list.active.matchesNamed && !stashName) {
        setStashName('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [stashName]);

  useEffect(() => {
    // load once on mount
    void load();
  }, []);

  const applyList = (list: ClaudeCredentialsList) => {
    setData(list);
  };

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
      const result = await switchClaudeCredentials(name);
      setData({
        claudeDir: data?.claudeDir ?? '',
        active: result.active,
        profiles: result.profiles,
      });
      setMessage(t('terminal:credentials.switched', { name }));
      setPendingSwitch(null);
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
      const result = await switchClaudeCredentials(pendingSwitch, { stashActiveAs: stash });
      setData({
        claudeDir: data?.claudeDir ?? '',
        active: result.active,
        profiles: result.profiles,
      });
      setMessage(
        result.stashedAs
          ? t('terminal:credentials.switchedWithStash', { name: pendingSwitch, stash: result.stashedAs })
          : t('terminal:credentials.switched', { name: pendingSwitch }),
      );
      setPendingSwitch(null);
      setStashName('');
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
      const list = await saveClaudeCredentials(name);
      applyList(list);
      setSaveName('');
      setMessage(t('terminal:credentials.saved', { name }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already exists/i.test(msg)) {
        if (window.confirm(t('terminal:credentials.confirmOverwrite', { name }))) {
          try {
            const list = await saveClaudeCredentials(name, { force: true });
            applyList(list);
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
      const list = await renameClaudeCredentials(from, to.trim());
      applyList(list);
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
      const list = await deleteClaudeCredentials(name);
      applyList(list);
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '10px',
          gap: '8px',
        }}
      >
        <div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {t('terminal:credentials.title')}
          </div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>
            {t('terminal:credentials.current', { name: activeLabel })}
            {data?.active?.subscriptionType && (
              <span style={{ color: 'var(--text-secondary)' }}>
                {' '}
                · {data.active.subscriptionType}
                {data.active.rateLimitTier ? ` (${data.active.rateLimitTier})` : ''}
              </span>
            )}
          </div>
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
        {t('terminal:credentials.help')}
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
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void confirmSwitchWithStash()}
              style={{ padding: '6px 12px', fontSize: '12px' }}
            >
              {t('terminal:credentials.confirmSwitch')}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => setPendingSwitch(null)}
              style={{ padding: '6px 12px', fontSize: '12px' }}
            >
              {t('common:buttons.cancel')}
            </button>
          </div>
        </div>
      )}

      {loading && !data && (
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '8px 0' }}>
          {t('common:status.loading')}…
        </div>
      )}

      {data && data.profiles.length === 0 && (
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>
          {t('terminal:credentials.noProfiles')}
        </div>
      )}

      {data?.profiles.map((profile) => (
        <ProfileRow
          key={profile.name}
          profile={profile}
          busy={busy}
          onUse={(n) => void handleUse(n)}
          onRename={(n) => void handleRename(n)}
          onDelete={(n) => void handleDelete(n)}
        />
      ))}

      <div
        style={{
          display: 'flex',
          gap: '6px',
          marginTop: '10px',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
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

      {data?.claudeDir && (
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '8px', wordBreak: 'break-all' }}>
          {data.claudeDir}
        </div>
      )}
    </div>
  );
}
