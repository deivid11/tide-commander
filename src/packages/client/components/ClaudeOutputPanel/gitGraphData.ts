/**
 * Fetch + cache layer for the branch graph.
 *
 * Shared by the panel button (which warms the cache on hover) and the modal
 * (which reads it), so the first open renders from memory instead of waiting on
 * a round trip. Lives outside the components on purpose: the cache has to
 * survive the modal unmounting when it closes.
 */

import { apiUrl, authFetch } from '../../utils/storage';
import { TtlCache } from '../../utils/ttlCache';
import type { GitGraphFilters } from '../../utils/gitGraphFilters';

export interface GitGraphCommit {
  hash: string;
  shortHash: string;
  author: string;
  authorEmail: string;
  date: string;
  subject: string;
  parents: string[];
  refs: { branches: string[]; tags: string[]; isHead: boolean };
}

export interface GitGraphPage {
  commits: GitGraphCommit[];
  hasMore: boolean;
}

/** Long enough to cover open → close → reopen, short enough that a fresh
 *  commit shows up without hunting for the refresh button. */
const TTL_MS = 30_000;

const pageCache = new TtlCache<GitGraphPage>(TTL_MS);
const branchCache = new TtlCache<unknown>(TTL_MS);

export function graphCacheKey(params: URLSearchParams): string {
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([k, v]) => `${k}=${v}`).join('&');
}

async function requestPage(params: URLSearchParams): Promise<GitGraphPage> {
  const res = await authFetch(apiUrl(`/api/files/git-log?${params.toString()}`));
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return {
    commits: Array.isArray(body.commits) ? body.commits : [],
    hasMore: !!body.hasMore,
  };
}

export function fetchGraphPage(params: URLSearchParams): Promise<GitGraphPage> {
  return pageCache.load(graphCacheKey(params), () => requestPage(params));
}

/** True when fetchGraphPage would resolve without touching the network. */
export function isGraphPageWarm(params: URLSearchParams): boolean {
  return pageCache.isWarm(graphCacheKey(params));
}

export function readGraphPage(params: URLSearchParams): GitGraphPage | undefined {
  return pageCache.get(graphCacheKey(params));
}

export function invalidateGraphCache(): void {
  pageCache.clear();
  branchCache.clear();
}

/**
 * The single place that builds a git-log query for the graph. Both the modal
 * and the prefetch go through it — if they built params separately, one stray
 * difference would make the warmed cache key unreachable.
 */
export function buildGraphParams(
  dir: string,
  filters: GitGraphFilters,
  offset: number,
  pageSize: number = GRAPH_PAGE_SIZE
): URLSearchParams {
  const params = new URLSearchParams({
    path: dir,
    limit: String(pageSize),
    offset: String(offset),
  });
  // Naming branches narrows the walk; otherwise show every ref, since a graph
  // that only followed HEAD would hide the side branches it exists to show.
  if (filters.branches.length > 0) params.set('branches', filters.branches.join(','));
  else params.set('all', '1');
  // Skip the server's full-history rev-list --count; hasMore is enough here and
  // the count costs ~10x the page fetch on a large repo.
  params.set('count', '0');
  if (filters.author) params.set('author', filters.author);
  if (filters.since) params.set('since', filters.since);
  if (filters.until) params.set('until', filters.until);
  if (filters.search) params.set('search', filters.search);
  return params;
}

async function requestJson<T>(url: string): Promise<T> {
  const res = await authFetch(apiUrl(url));
  return res.json() as Promise<T>;
}

export function fetchBranches(dir: string) {
  return branchCache.load(
    `branches:${dir}`,
    () => requestJson<{ branches?: unknown[] }>(`/api/files/git-branches-list?path=${encodeURIComponent(dir)}`)
  ) as Promise<{ branches?: unknown[] }>;
}

export function fetchAuthors(dir: string) {
  return branchCache.load(
    `authors:${dir}`,
    () => requestJson<{ authors?: unknown[] }>(`/api/files/git-authors?path=${encodeURIComponent(dir)}`)
  ) as Promise<{ authors?: unknown[] }>;
}

/**
 * Warm everything the modal needs for `dir`. Safe to call repeatedly — the
 * cache skips keys that are already warm or in flight.
 *
 * `params` must match what the modal will ask for, so the caller passes the
 * repo's persisted filters: prefetching the unfiltered page while the modal
 * opens filtered would warm a key nobody reads.
 */
export function prefetchGraph(dir: string, params: URLSearchParams): void {
  pageCache.prefetch(graphCacheKey(params), () => requestPage(params));
  branchCache.prefetch(
    `branches:${dir}`,
    () => requestJson(`/api/files/git-branches-list?path=${encodeURIComponent(dir)}`)
  );
  branchCache.prefetch(
    `authors:${dir}`,
    () => requestJson(`/api/files/git-authors?path=${encodeURIComponent(dir)}`)
  );
}

/** Page size the prefetch and the modal must agree on, or the warmed key won't
 *  be the one the modal asks for. */
export const GRAPH_PAGE_SIZE = 120;
