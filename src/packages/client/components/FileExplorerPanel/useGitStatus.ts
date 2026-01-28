/**
 * useGitStatus - Custom hook for git status management
 *
 * Handles loading and refreshing git status for a directory.
 * Following ClaudeOutputPanel's useTerminalInput pattern.
 */

import { useState, useCallback } from 'react';
import type { GitStatus, UseGitStatusReturn } from './types';
import { apiUrl, authFetch } from '../../utils/storage';

/**
 * Hook for managing git status state and operations
 */
export function useGitStatus(currentFolder: string | null): UseGitStatusReturn {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * Load git status for the current folder
   */
  const loadGitStatus = useCallback(async () => {
    if (!currentFolder) return;

    setLoading(true);

    try {
      const res = await fetch(
        apiUrl(`/api/files/git-status?path=${encodeURIComponent(currentFolder)}`)
      );
      const data = await res.json();

      if (res.ok) {
        setGitStatus(data);
      } else {
        setGitStatus({ isGitRepo: false, files: [] });
      }
    } catch (err) {
      console.error('[FileExplorer] Failed to load git status:', err);
      setGitStatus({ isGitRepo: false, files: [] });
    } finally {
      setLoading(false);
    }
  }, [currentFolder]);

  return {
    gitStatus,
    loading,
    loadGitStatus,
  };
}

/**
 * Load original file content from git (for diff view)
 */
export async function loadGitOriginalContent(
  filePath: string
): Promise<{ content: string | null; isNew: boolean }> {
  try {
    const res = await fetch(
      apiUrl(`/api/files/git-original?path=${encodeURIComponent(filePath)}`)
    );
    const data = await res.json();

    if (res.ok && !data.isNew) {
      return { content: data.content, isNew: false };
    }
    return { content: null, isNew: true };
  } catch (err) {
    console.error('[FileExplorer] Failed to load original file:', err);
    return { content: null, isNew: true };
  }
}
