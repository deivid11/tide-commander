import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const GITHUB_REPO = 'deivid11/tide-commander';
const FULL_LIST_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`;
const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;

interface ReleaseEntry {
  version: string;
  date: string | null;
  body: string;
  url: string;
}

interface ChangelogModalProps {
  /** When set, show just that release; otherwise the full list of releases. */
  version?: string;
  onClose: () => void;
}

/**
 * Changelog viewer. With `version` it shows a single release's notes
 * (post-update); without it, the full list of releases. Notes come from the
 * GitHub Releases API and render as markdown; falls back to a GitHub link.
 */
export function ChangelogModal({ version, onClose }: ChangelogModalProps) {
  const { t } = useTranslation(['config']);
  const [releases, setReleases] = useState<ReleaseEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const footerUrl = version ? `${RELEASES_URL}/tag/v${version}` : RELEASES_URL;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReleases(null);
    (async () => {
      try {
        const url = version
          ? `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/v${version}`
          : FULL_LIST_URL;
        const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
        if (!res.ok) throw new Error(`GitHub API ${res.status}`);
        const data = (await res.json()) as unknown;
        const list = (Array.isArray(data) ? data : [data]) as Array<{
          tag_name?: string;
          published_at?: string;
          body?: string;
          html_url?: string;
        }>;
        const parsed: ReleaseEntry[] = list.map((r) => ({
          version: (r.tag_name ?? '').replace(/^v/, ''),
          date: r.published_at ? new Date(r.published_at).toLocaleDateString() : null,
          body: r.body ?? '',
          url: r.html_url ?? RELEASES_URL,
        }));
        if (!cancelled) {
          setReleases(parsed);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stop = useCallback((e: React.MouseEvent) => e.stopPropagation(), []);

  const title = version
    ? t('config:updateBanner.changelogTitle', { version })
    : t('config:updateBanner.changelogTitleAll');

  const isEmpty = releases !== null && releases.every((r) => !r.body.trim());

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

          {!loading && !error && isEmpty && (
            <div className="changelog-modal-empty">{t('config:updateBanner.changelogEmpty')}</div>
          )}

          {!loading && !error && releases && !isEmpty && (
            <div className="changelog-markdown">
              {releases.map((r) => (
                <section key={r.version || r.url} className="changelog-release">
                  {/* Version header only in full (multi-release) mode */}
                  {!version && (
                    <div className="changelog-release-head">
                      <span className="changelog-release-version">v{r.version}</span>
                      {r.date && <span className="changelog-release-date">{r.date}</span>}
                    </div>
                  )}
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.body}</ReactMarkdown>
                </section>
              ))}
            </div>
          )}
        </div>

        <div className="changelog-modal-footer">
          <a href={footerUrl} target="_blank" rel="noreferrer" className="changelog-modal-link">
            {t('config:updateBanner.viewOnGithub')}
          </a>
        </div>
      </div>
    </div>
  );
}
