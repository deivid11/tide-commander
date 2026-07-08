import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fetchChangelog } from '../api/system-update';

const RELEASES_URL = 'https://github.com/deivid11/tide-commander/releases';

interface ChangelogModalProps {
  /** When set, show just that version's section; otherwise the whole changelog. */
  version?: string;
  onClose: () => void;
}

/** Extract a single version's section from Keep-a-Changelog markdown. */
function extractVersion(md: string, version: string): string | null {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => {
    const s = l.trim();
    return (
      s.startsWith(`## [${version}]`) ||
      s.startsWith(`## [v${version}]`) ||
      s.startsWith(`## ${version}`) ||
      s.startsWith(`## v${version}`)
    );
  });
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

/** Drop the leading "# Changelog" + intro so rendering starts at the first version. */
function stripPreamble(md: string): string {
  const idx = md.search(/^##\s/m);
  return idx >= 0 ? md.slice(idx) : md;
}

/**
 * Changelog viewer. With `version` it shows a single release's section
 * (post-update); without it, the full changelog. Content is the locally-served
 * bundled CHANGELOG.md (with a raw-GitHub-CDN fallback) — no GitHub API, so no
 * rate limits.
 */
export function ChangelogModal({ version, onClose }: ChangelogModalProps) {
  const { t } = useTranslation(['config']);
  const [raw, setRaw] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRaw(null);
    fetchChangelog()
      .then((md) => {
        if (!cancelled) {
          setRaw(md);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError((err as Error).message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stop = useCallback((e: React.MouseEvent) => e.stopPropagation(), []);

  const content = useMemo(() => {
    if (!raw) return null;
    if (version) return extractVersion(raw, version) ?? stripPreamble(raw);
    return stripPreamble(raw);
  }, [raw, version]);

  const title = version
    ? t('config:updateBanner.changelogTitle', { version })
    : t('config:updateBanner.changelogTitleAll');

  return (
    <div className="changelog-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="changelog-modal" onClick={stop}>
        <div className="changelog-modal-header">
          <span className="changelog-modal-title">{title}</span>
          <button className="changelog-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="changelog-modal-body">
          {loading && (
            <div className="changelog-modal-loading">{t('config:updateBanner.changelogLoading')}</div>
          )}

          {error && <div className="changelog-modal-error">{t('config:updateBanner.changelogError')}</div>}

          {!loading && !error && content && (
            <div className="changelog-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}

          {!loading && !error && !content && (
            <div className="changelog-modal-empty">{t('config:updateBanner.changelogEmpty')}</div>
          )}
        </div>

        <div className="changelog-modal-footer">
          <a href={RELEASES_URL} target="_blank" rel="noreferrer" className="changelog-modal-link">
            {t('config:updateBanner.viewOnGithub')}
          </a>
        </div>
      </div>
    </div>
  );
}
