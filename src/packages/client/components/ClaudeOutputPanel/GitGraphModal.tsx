/**
 * Branch graph — a GitKraken-style view of the repository's commit history.
 *
 * The SVG gutter on the left is drawn from the lane geometry computed by
 * gitGraphLayout; each row lines up with its commit so the graph and the text
 * scroll as one surface. Filters reuse the server's existing git-log query
 * params, so narrowing the view is a refetch rather than client-side slicing —
 * that way a filtered graph still shows the true parent edges between the
 * commits that remain.
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../Icon';
import { BranchMultiSelect, type BranchOption } from './BranchMultiSelect';
import {
  fetchGraphPage,
  readGraphPage,
  invalidateGraphCache,
  fetchBranches,
  fetchAuthors,
  buildGraphParams,
  GRAPH_PAGE_SIZE,
  type GitGraphCommit,
} from './gitGraphData';
import {
  loadGitGraphFilters,
  saveGitGraphFilters,
  countActiveFilters,
  EMPTY_GIT_GRAPH_FILTERS,
  type GitGraphFilters,
} from '../../utils/gitGraphFilters';
import { computeGitGraphLayout, laneColor } from '../../utils/gitGraphLayout';
import {
  DATE_RANGE_PRESETS,
  resolvePresetSince,
  type DateRangePresetId,
} from '../../utils/dateRangePresets';

interface RepoOption {
  dir: string;
  dirName: string;
}

interface GitGraphModalProps {
  repos: RepoOption[];
  initialDir: string;
  onClose: () => void;
}

/** Row height in px — must match .git-graph-row in the stylesheet. */
const ROW_HEIGHT = 30;
const LANE_WIDTH = 13;
const GUTTER_PADDING = 12;
const DOT_RADIUS = 4.5;
const SEARCH_DEBOUNCE_MS = 300;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffH = (Date.now() - d.getTime()) / 36e5;
  if (diffH < 1) return 'now';
  if (diffH < 24) return `${Math.round(diffH)}h`;
  const diffD = diffH / 24;
  if (diffD < 30) return `${Math.round(diffD)}d`;
  if (diffD < 365) return `${Math.round(diffD / 30)}mo`;
  return `${Math.round(diffD / 365)}y`;
}

function fullDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Initials for the author chip — long names blew out the row width. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Stable colour per author so the same person keeps the same chip. */
function authorColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(hash) % 360} 55% 58%)`;
}

/** Drop the noisy `origin/` prefix but keep it visible as a remote marker. */
function shortRef(ref: string): string {
  return ref.replace(/^origin\//, '');
}

/**
 * The lane gutter, isolated behind memo().
 *
 * A 120-commit page draws 300+ SVG elements. Re-running that on every click,
 * hover or filter keystroke made selection feel laggy, so this only re-renders
 * when the geometry or the selected commit actually changes.
 */
const GraphCanvas = memo(function GraphCanvas({
  layout,
  mergeHashes,
  selectedHash,
  width,
  height,
}: {
  layout: ReturnType<typeof computeGitGraphLayout>;
  mergeHashes: Set<string>;
  selectedHash: string | null;
  width: number;
  height: number;
}) {
  const laneX = (lane: number) => GUTTER_PADDING + lane * LANE_WIDTH + LANE_WIDTH / 2;
  const rowY = (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2;

  return (
    <svg className="git-graph-svg" width={width} height={height} style={{ minWidth: width }}>
      {layout.edges.map((edge, i) => {
        const x1 = laneX(edge.fromLane);
        const y1 = rowY(edge.fromRow);
        const x2 = laneX(edge.toLane);
        const y2 = edge.toRow === -1 ? height : rowY(edge.toRow);
        const color = laneColor(edge.isMerge ? edge.toLane : edge.fromLane);
        const d = x1 === x2
          ? `M ${x1} ${y1} L ${x2} ${y2}`
          : `M ${x1} ${y1} C ${x1} ${y1 + ROW_HEIGHT * 0.6}, ${x2} ${y2 - ROW_HEIGHT * 0.6}, ${x2} ${y2}`;
        return (
          <path
            key={`${edge.fromHash}-${edge.toHash}-${i}`}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={1.7}
            strokeLinecap="round"
            opacity={0.9}
          />
        );
      })}
      {layout.nodes.map((node) => {
        const isMerge = mergeHashes.has(node.hash);
        const isSel = selectedHash === node.hash;
        return (
          <circle
            key={node.hash}
            cx={laneX(node.lane)}
            cy={rowY(node.row)}
            r={isSel ? DOT_RADIUS + 1.5 : DOT_RADIUS}
            // Hollow dot marks a merge — readable without a legend.
            fill={isMerge ? 'var(--bg-primary)' : laneColor(node.lane)}
            stroke={laneColor(node.lane)}
            strokeWidth={isMerge ? 2.2 : 1.5}
          />
        );
      })}
    </svg>
  );
});

export function GitGraphModal({ repos, initialDir, onClose }: GitGraphModalProps) {
  const [dir, setDir] = useState(initialDir);
  const [commits, setCommits] = useState<GitGraphCommit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GitGraphCommit | null>(null);

  // Restored per repo, so reopening the view keeps whatever was set last time.
  const [filters, setFilters] = useState<GitGraphFilters>(() => loadGitGraphFilters(initialDir));
  const [searchInput, setSearchInput] = useState(() => loadGitGraphFilters(initialDir).search);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [authors, setAuthors] = useState<string[]>([]);

  const repoName = repos.find((r) => r.dir === dir)?.dirName || dir;
  const activeFilterCount = countActiveFilters(filters);
  const datePreset = filters.datePreset;

  const selectRepo = (nextDir: string) => {
    const restored = loadGitGraphFilters(nextDir);
    setDir(nextDir);
    setFilters(restored);
    setSearchInput(restored.search);
  };

  // Persist on every change so the next open starts where this one left off.
  useEffect(() => { saveGitGraphFilters(dir, filters); }, [dir, filters]);

  // Debounce only the free-text box; dropdowns apply immediately.
  useEffect(() => {
    const t = setTimeout(
      // Bail when the value is unchanged: a new object identity here would
      // re-trigger the fetch effect (it fired twice on every open).
      () => setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput })),
      SEARCH_DEBOUNCE_MS
    );
    return () => clearTimeout(t);
  }, [searchInput]);

  const buildParams = useCallback(
    (offset: number) => buildGraphParams(dir, filters, offset),
    [dir, filters]
  );

  useEffect(() => {
    let cancelled = false;
    const params = buildParams(0);
    setError(null);
    setSelected(null);

    // Warm from the prefetch cache synchronously so a hovered-then-clicked
    // button paints instantly instead of flashing a spinner.
    const warm = readGraphPage(params);
    if (warm) {
      setCommits(warm.commits);
      setHasMore(warm.hasMore);
      setLoading(false);
      return () => { cancelled = true; };
    }

    setLoading(true);
    fetchGraphPage(params)
      .then((page) => {
        if (cancelled) return;
        setCommits(page.commits);
        setHasMore(page.hasMore);
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'No se pudo cargar el historial'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [buildParams]);

  // Filter options follow the selected repo.
  useEffect(() => {
    let cancelled = false;
    fetchBranches(dir)
      .then((b) => { if (!cancelled) setBranches((b.branches ?? []) as BranchOption[]); })
      .catch(() => { if (!cancelled) setBranches([]); });
    fetchAuthors(dir)
      .then((b) => { if (!cancelled) setAuthors((b.authors ?? []) as string[]); })
      .catch(() => { if (!cancelled) setAuthors([]); });
    return () => { cancelled = true; };
  }, [dir]);

  const loadMore = useCallback(() => {
    setLoadingMore(true);
    fetchGraphPage(buildParams(commits.length))
      .then((page) => {
        setCommits((prev) => [...prev, ...page.commits]);
        setHasMore(page.hasMore);
      })
      .catch(() => { /* keep what we have */ })
      .finally(() => setLoadingMore(false));
  }, [buildParams, commits.length]);

  const layout = useMemo(
    () => computeGitGraphLayout(commits.map((c) => ({ hash: c.hash, parents: c.parents || [] }))),
    [commits]
  );
  const mergeHashes = useMemo(
    () => new Set(commits.filter((c) => (c.parents || []).length > 1).map((c) => c.hash)),
    [commits]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const gutterWidth = Math.max(1, layout.laneCount) * LANE_WIDTH + GUTTER_PADDING * 2;
  const svgHeight = Math.max(commits.length * ROW_HEIGHT, ROW_HEIGHT);

  const resetFilters = () => {
    setFilters({ ...EMPTY_GIT_GRAPH_FILTERS });
    setSearchInput('');
  };

  const applyDatePreset = (id: DateRangePresetId) => {
    // 'custom' keeps whatever dates are already typed; the rest compute a window.
    setFilters((f) => id === 'custom'
      ? { ...f, datePreset: id }
      : { ...f, datePreset: id, since: resolvePresetSince(id, Date.now()), until: '' });
  };

  return (
    <div className="git-graph-overlay" onClick={onClose}>
      <div className="git-graph-modal" onClick={(e) => e.stopPropagation()}>
        <div className="git-graph-header">
          <span className="git-graph-title"><Icon name="git-branch" size={14} /> Branch graph</span>

          {repos.length > 1 ? (
            <select
              className="git-graph-repo-select"
              value={dir}
              onChange={(e) => selectRepo(e.target.value)}
            >
              {repos.map((r) => <option key={r.dir} value={r.dir}>{r.dirName}</option>)}
            </select>
          ) : (
            <span className="git-graph-repo-name">{repoName}</span>
          )}

          <span className="git-graph-stats">
            {loading ? 'loading…' : (
              <>
                <strong>{commits.length}</strong>{hasMore ? '+' : ''} commits
                <span className="git-graph-dim"> · </span>
                <strong>{layout.laneCount}</strong> lanes
              </>
            )}
          </span>

          <div className="git-graph-header-actions">
            <button
              className="git-graph-icon-btn"
              onClick={() => { invalidateGraphCache(); setFilters((f) => ({ ...f })); }}
              title="Refresh"
            >
              <Icon name="refresh" size={13} />
            </button>
            <button className="git-graph-icon-btn git-graph-close" onClick={onClose} title="Close (Esc)">
              <Icon name="close" size={14} />
            </button>
          </div>
        </div>

        <div className="git-graph-filters">
            <input
              className="git-graph-filter git-graph-filter--search"
              type="text"
              placeholder="Search commit messages…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <BranchMultiSelect
              branches={branches}
              selected={filters.branches}
              onChange={(next) => setFilters((f) => ({ ...f, branches: next }))}
            />
            <select
              className="git-graph-filter"
              value={filters.author}
              onChange={(e) => setFilters((f) => ({ ...f, author: e.target.value }))}
            >
              <option value="">All authors</option>
              {authors.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select
              className="git-graph-filter"
              value={datePreset}
              onChange={(e) => applyDatePreset(e.target.value as DateRangePresetId)}
            >
              {DATE_RANGE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            {activeFilterCount > 0 && (
              <button className="git-graph-filter-clear" onClick={resetFilters}>Clear</button>
            )}
            {/* Exact dates stay available, but only once asked for — they cost
                two wide controls and pull in the browser's own locale/chrome. */}
            {datePreset === 'custom' && (
              <div className="git-graph-daterange">
                <label className="git-graph-daterange-field">
                  <span>From</span>
                  <input
                    className="git-graph-filter git-graph-filter--date"
                    type="date"
                    value={filters.since}
                    max={filters.until || undefined}
                    onChange={(e) => setFilters((f) => ({ ...f, since: e.target.value }))}
                  />
                </label>
                <label className="git-graph-daterange-field">
                  <span>To</span>
                  <input
                    className="git-graph-filter git-graph-filter--date"
                    type="date"
                    value={filters.until}
                    min={filters.since || undefined}
                    onChange={(e) => setFilters((f) => ({ ...f, until: e.target.value }))}
                  />
                </label>
              </div>
            )}
        </div>

        {error && <div className="git-graph-error"><Icon name="warn" size={13} /> {error}</div>}
        {!error && !loading && commits.length === 0 && (
          <div className="git-graph-empty">
            {activeFilterCount > 0 ? 'No commits match these filters.' : 'This repository has no commits yet.'}
          </div>
        )}

        {!error && commits.length > 0 && (
          <div className="git-graph-body">
            <div className="git-graph-scroll">
              <GraphCanvas
                layout={layout}
                mergeHashes={mergeHashes}
                selectedHash={selected?.hash ?? null}
                width={gutterWidth}
                height={svgHeight}
              />

              <div className="git-graph-rows">
                {commits.map((commit) => (
                  <div
                    key={commit.hash}
                    className={`git-graph-row ${selected?.hash === commit.hash ? 'is-selected' : ''}`}
                    onClick={() => setSelected(selected?.hash === commit.hash ? null : commit)}
                  >
                    <span className="git-graph-refs">
                      {commit.refs?.isHead && <span className="git-graph-ref is-head">HEAD</span>}
                      {(commit.refs?.branches || []).map((b) => (
                        <span
                          key={b}
                          className={`git-graph-ref ${b.startsWith('origin/') ? 'is-remote' : 'is-branch'}`}
                          title={b}
                        >{shortRef(b)}</span>
                      ))}
                      {(commit.refs?.tags || []).map((t) => (
                        <span key={t} className="git-graph-ref is-tag" title={`tag: ${t}`}>{t}</span>
                      ))}
                    </span>
                    <span className="git-graph-subject" title={commit.subject}>{commit.subject}</span>
                    <span
                      className="git-graph-avatar"
                      style={{ background: authorColor(commit.author) }}
                      title={`${commit.author} <${commit.authorEmail}>`}
                    >{initials(commit.author)}</span>
                    <span className="git-graph-hash" title={commit.hash}>{commit.shortHash}</span>
                    <span className="git-graph-date" title={fullDate(commit.date)}>{formatDate(commit.date)}</span>
                  </div>
                ))}
              </div>
            </div>

            {hasMore && (
              <button className="git-graph-more" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : `Load ${GRAPH_PAGE_SIZE} more commits`}
              </button>
            )}
          </div>
        )}

        {selected && (
          <div className="git-graph-detail">
            <div className="git-graph-detail-subject">{selected.subject}</div>
            <div className="git-graph-detail-meta">
              <span
                className="git-graph-avatar"
                style={{ background: authorColor(selected.author) }}
              >{initials(selected.author)}</span>
              <span>{selected.author}</span>
              <span className="git-graph-dim">{selected.authorEmail}</span>
              <span className="git-graph-dim">{fullDate(selected.date)}</span>
            </div>
            <div className="git-graph-detail-hashes">
              <code title={selected.hash}>{selected.shortHash}</code>
              {(selected.parents || []).length > 0 && (
                <span className="git-graph-dim">
                  {selected.parents.length > 1 ? 'merge of' : 'parent'}{' '}
                  {selected.parents.map((p) => p.slice(0, 8)).join(' + ')}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
