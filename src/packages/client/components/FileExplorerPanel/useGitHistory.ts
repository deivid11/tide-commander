/**
 * useGitHistory - Hook for managing git history state and fetching
 *
 * Handles commit list fetching with filters, pagination, selected commit files.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { apiUrl, authFetch } from '../../utils/storage';
import type { GitCommit, GitHistoryFilters, GitCommitFile } from './types';

const DEFAULT_LIMIT = 50;
const DEBOUNCE_MS = 400;

export interface UseGitHistoryReturn {
  commits: GitCommit[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  total: number;
  filters: GitHistoryFilters;
  setFilter: (key: keyof GitHistoryFilters, value: string) => void;
  resetFilters: () => void;
  selectedCommit: GitCommit | null;
  selectCommit: (commit: GitCommit | null) => void;
  commitFiles: GitCommitFile[];
  commitFilesLoading: boolean;
  loadHistory: (directory: string) => Promise<void>;
  loadMore: (directory: string) => Promise<void>;
  authors: string[];
  authorsLoading: boolean;
  loadAuthors: (directory: string) => Promise<void>;
}

const EMPTY_FILTERS: GitHistoryFilters = {
  branch: '',
  author: '',
  since: '',
  until: '',
  searchPath: '',
  search: '',
};

export function useGitHistory(): UseGitHistoryReturn {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<GitHistoryFilters>({ ...EMPTY_FILTERS });
  const [selectedCommit, setSelectedCommit] = useState<GitCommit | null>(null);
  const [commitFiles, setCommitFiles] = useState<GitCommitFile[]>([]);
  const [commitFilesLoading, setCommitFilesLoading] = useState(false);
  const [authors, setAuthors] = useState<string[]>([]);
  const [authorsLoading, setAuthorsLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentDirRef = useRef<string>('');

  const buildQueryString = useCallback((dir: string, offset: number, filtersOverride?: GitHistoryFilters) => {
    const f = filtersOverride || filters;
    const params = new URLSearchParams();
    params.set('path', dir);
    params.set('limit', String(DEFAULT_LIMIT));
    params.set('offset', String(offset));
    if (f.branch) params.set('branch', f.branch);
    if (f.author) params.set('author', f.author);
    if (f.since) params.set('since', f.since);
    if (f.until) params.set('until', f.until);
    if (f.searchPath) params.set('searchPath', f.searchPath);
    if (f.search) params.set('search', f.search);
    return params.toString();
  }, [filters]);

  const loadHistory = useCallback(async (directory: string) => {
    currentDirRef.current = directory;
    setLoading(true);
    setError(null);
    setSelectedCommit(null);
    setCommitFiles([]);
    try {
      const qs = buildQueryString(directory, 0);
      const res = await authFetch(apiUrl(`/api/files/git-log?${qs}`));
      const data = await res.json();
      if (res.ok) {
        setCommits(data.commits || []);
        setTotal(data.total || 0);
        setHasMore(data.hasMore || false);
      } else {
        setError(data.error || 'Failed to load git history');
        setCommits([]);
      }
    } catch (err) {
      console.error('[useGitHistory] loadHistory error:', err);
      setError('Failed to load git history');
      setCommits([]);
    } finally {
      setLoading(false);
    }
  }, [buildQueryString]);

  const loadMore = useCallback(async (directory: string) => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const qs = buildQueryString(directory, commits.length);
      const res = await authFetch(apiUrl(`/api/files/git-log?${qs}`));
      const data = await res.json();
      if (res.ok) {
        setCommits(prev => [...prev, ...(data.commits || [])]);
        setTotal(data.total || 0);
        setHasMore(data.hasMore || false);
      }
    } catch (err) {
      console.error('[useGitHistory] loadMore error:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [buildQueryString, commits.length, hasMore, loadingMore]);

  const selectCommit = useCallback(async (commit: GitCommit | null) => {
    setSelectedCommit(commit);
    if (!commit) {
      setCommitFiles([]);
      return;
    }
    setCommitFilesLoading(true);
    try {
      const dir = currentDirRef.current;
      const params = new URLSearchParams({ path: dir, hash: commit.hash });
      const res = await authFetch(apiUrl(`/api/files/git-commit-files?${params}`));
      const data = await res.json();
      if (res.ok) {
        setCommitFiles(data.files || []);
      } else {
        setCommitFiles([]);
      }
    } catch (err) {
      console.error('[useGitHistory] selectCommit files error:', err);
      setCommitFiles([]);
    } finally {
      setCommitFilesLoading(false);
    }
  }, []);

  const setFilter = useCallback((key: keyof GitHistoryFilters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters({ ...EMPTY_FILTERS });
  }, []);

  // Debounced reload when filters change
  useEffect(() => {
    const dir = currentDirRef.current;
    if (!dir) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      loadHistory(dir);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters]);

  const loadAuthors = useCallback(async (directory: string) => {
    setAuthorsLoading(true);
    try {
      const params = new URLSearchParams({ path: directory });
      const res = await authFetch(apiUrl(`/api/files/git-authors?${params}`));
      const data = await res.json();
      if (res.ok) {
        setAuthors(data.authors || []);
      }
    } catch (err) {
      console.error('[useGitHistory] loadAuthors error:', err);
    } finally {
      setAuthorsLoading(false);
    }
  }, []);

  return {
    commits,
    loading,
    loadingMore,
    error,
    hasMore,
    total,
    filters,
    setFilter,
    resetFilters,
    selectedCommit,
    selectCommit,
    commitFiles,
    commitFilesLoading,
    loadHistory,
    loadMore,
    authors,
    authorsLoading,
    loadAuthors,
  };
}
