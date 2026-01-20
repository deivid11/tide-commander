/**
 * useFileContent - Custom hook for file content management
 *
 * Handles loading file content for the viewer.
 * Following ClaudeOutputPanel's useTerminalInput pattern.
 */

import { useState, useCallback } from 'react';
import type { FileData, UseFileContentReturn } from './types';

/**
 * Hook for managing file content loading
 */
export function useFileContent(): UseFileContentReturn {
  const [file, setFile] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Load file content from the server
   */
  const loadFile = useCallback(async (filePath: string) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/files/read?path=${encodeURIComponent(filePath)}`
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to load file');
        setFile(null);
        return;
      }

      setFile(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load file';
      setError(message);
      setFile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Clear the current file selection
   */
  const clearFile = useCallback(() => {
    setFile(null);
    setError(null);
  }, []);

  return {
    file,
    loading,
    error,
    loadFile,
    clearFile,
  };
}
