/**
 * useGitBranches - Custom hook for git branch management
 *
 * Handles loading branches, checkout, create, pull, and push operations.
 * Following useGitStatus.ts patterns.
 */

import { useState, useCallback } from 'react';
import type { GitBranch, GitBranchOperationResult, MergeResult, UseGitBranchesReturn } from './types';
import { apiUrl, authFetch } from '../../utils/storage';

export function useGitBranches(): UseGitBranchesReturn {
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operationInProgress, setOperationInProgress] = useState<string | null>(null);

  const loadBranches = useCallback(async (directory: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(
        apiUrl(`/api/files/git-branches?path=${encodeURIComponent(directory)}`)
      );
      const data = await res.json();
      if (res.ok) {
        setBranches(data.branches || []);
      } else {
        setError(data.error || 'Failed to load branches');
        setBranches([]);
      }
    } catch (err) {
      console.error('[GitBranches] Failed to load branches:', err);
      setError('Failed to load branches');
      setBranches([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const checkoutBranch = useCallback(async (directory: string, branch: string): Promise<GitBranchOperationResult> => {
    setOperationInProgress('checkout');
    setError(null);
    try {
      const res = await authFetch(apiUrl('/api/files/git-checkout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory, branch }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Checkout failed');
      }
      return data;
    } catch (err) {
      console.error('[GitBranches] Checkout failed:', err);
      const result = { success: false, error: 'Checkout failed' };
      setError(result.error);
      return result;
    } finally {
      setOperationInProgress(null);
    }
  }, []);

  const createBranch = useCallback(async (directory: string, name: string, startPoint?: string): Promise<GitBranchOperationResult> => {
    setOperationInProgress('create');
    setError(null);
    try {
      const res = await authFetch(apiUrl('/api/files/git-branch-create'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory, name, startPoint }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to create branch');
      }
      return data;
    } catch (err) {
      console.error('[GitBranches] Create branch failed:', err);
      const result = { success: false, error: 'Failed to create branch' };
      setError(result.error);
      return result;
    } finally {
      setOperationInProgress(null);
    }
  }, []);

  const pullFromRemote = useCallback(async (directory: string): Promise<MergeResult> => {
    setOperationInProgress('pull');
    setError(null);
    try {
      const res = await authFetch(apiUrl('/api/files/git-pull'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory }),
      });
      const data = await res.json();
      if (!res.ok && !data.conflicts) {
        setError(data.error || 'Pull failed');
      }
      return data;
    } catch (err) {
      console.error('[GitBranches] Pull failed:', err);
      const result: MergeResult = { success: false, error: 'Pull failed' };
      setError(result.error!);
      return result;
    } finally {
      setOperationInProgress(null);
    }
  }, []);

  const pushToRemote = useCallback(async (directory: string): Promise<GitBranchOperationResult> => {
    setOperationInProgress('push');
    setError(null);
    try {
      const res = await authFetch(apiUrl('/api/files/git-push'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Push failed');
      }
      return data;
    } catch (err) {
      console.error('[GitBranches] Push failed:', err);
      const result = { success: false, error: 'Push failed' };
      setError(result.error);
      return result;
    } finally {
      setOperationInProgress(null);
    }
  }, []);

  const mergeBranch = useCallback(async (directory: string, branch: string): Promise<MergeResult> => {
    setOperationInProgress('merge');
    setError(null);
    try {
      const res = await authFetch(apiUrl('/api/files/git-merge'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory, branch }),
      });
      const data = await res.json();
      if (!res.ok && !data.conflicts) {
        setError(data.error || 'Merge failed');
      }
      return data;
    } catch (err) {
      console.error('[GitBranches] Merge failed:', err);
      const result: MergeResult = { success: false, error: 'Merge failed' };
      setError(result.error!);
      return result;
    } finally {
      setOperationInProgress(null);
    }
  }, []);

  const mergeAbort = useCallback(async (directory: string): Promise<GitBranchOperationResult> => {
    setOperationInProgress('merge-abort');
    setError(null);
    try {
      const res = await authFetch(apiUrl('/api/files/git-merge-abort'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Merge abort failed');
      }
      return data;
    } catch (err) {
      console.error('[GitBranches] Merge abort failed:', err);
      const result = { success: false, error: 'Merge abort failed' };
      setError(result.error);
      return result;
    } finally {
      setOperationInProgress(null);
    }
  }, []);

  const mergeContinue = useCallback(async (directory: string): Promise<GitBranchOperationResult> => {
    setOperationInProgress('merge-continue');
    setError(null);
    try {
      const res = await authFetch(apiUrl('/api/files/git-merge-continue'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Merge continue failed');
      }
      return data;
    } catch (err) {
      console.error('[GitBranches] Merge continue failed:', err);
      const result = { success: false, error: 'Merge continue failed' };
      setError(result.error);
      return result;
    } finally {
      setOperationInProgress(null);
    }
  }, []);

  return {
    branches,
    loading,
    error,
    operationInProgress,
    loadBranches,
    checkoutBranch,
    createBranch,
    pullFromRemote,
    pushToRemote,
    mergeBranch,
    mergeAbort,
    mergeContinue,
  };
}
