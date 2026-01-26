/**
 * useFileContent - Custom hook for file content management
 *
 * Handles loading file content for the viewer.
 * Supports text files, images, PDFs, and binary files.
 */

import { useState, useCallback } from 'react';
import type { FileData, FileType, UseFileContentReturn } from './types';
import { apiUrl } from '../../utils/storage';

// File extensions that can be displayed as text
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.xml', '.html', '.htm',
  '.css', '.scss', '.sass', '.less', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.php', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs',
  '.swift', '.kt', '.scala', '.clj', '.ex', '.exs', '.erl', '.hs', '.ml', '.fs',
  '.sql', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.toml', '.ini', '.cfg', '.conf', '.env', '.gitignore', '.dockerignore',
  '.editorconfig', '.prettierrc', '.eslintrc', '.babelrc',
  '.log', '.csv', '.tsv', '.svg',
  // No extension often means text
  ''
]);

// Image extensions
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg'
]);

// PDF extension
const PDF_EXTENSIONS = new Set(['.pdf']);

// Binary/downloadable extensions (can't be viewed)
const BINARY_EXTENSIONS = new Set([
  '.xlsx', '.xls', '.docx', '.doc', '.pptx', '.ppt',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.exe', '.dmg', '.app', '.deb', '.rpm', '.apk', '.aab', '.ipa', '.msi',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.flac', '.ogg', '.webm',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.sqlite', '.db',
  '.so', '.dll', '.dylib', '.a', '.o', '.obj',
  '.bin', '.dat', '.iso', '.img',
  '.jar', '.war', '.ear', '.class'
]);

/**
 * Determine the file type based on extension
 */
function getFileType(extension: string): FileType {
  const ext = extension.toLowerCase();

  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (PDF_EXTENSIONS.has(ext)) return 'pdf';
  if (BINARY_EXTENSIONS.has(ext)) return 'binary';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';

  // Default: try to open as text, server will reject if binary
  return 'text';
}

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
      const extension = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
      const fileType = getFileType(extension);
      const filename = filePath.substring(filePath.lastIndexOf('/') + 1);

      // For images, load as blob and create data URL
      if (fileType === 'image') {
        const res = await fetch(apiUrl(`/api/files/binary?path=${encodeURIComponent(filePath)}`));

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({ error: 'Failed to load image' }));
          setError(errorData.error || 'Failed to load image');
          setFile(null);
          return;
        }

        const blob = await res.blob();
        const dataUrl = URL.createObjectURL(blob);

        setFile({
          path: filePath,
          filename,
          extension,
          content: '',
          size: blob.size,
          modified: new Date().toISOString(),
          fileType: 'image',
          dataUrl
        });
        return;
      }

      // For PDFs, create a URL to the binary endpoint
      if (fileType === 'pdf') {
        // Get file info first
        const infoRes = await fetch(apiUrl(`/api/files/info?path=${encodeURIComponent(filePath)}`));
        const info = await infoRes.json();

        if (!infoRes.ok) {
          setError(info.error || 'Failed to load PDF info');
          setFile(null);
          return;
        }

        setFile({
          path: filePath,
          filename,
          extension,
          content: '',
          size: info.size,
          modified: info.modified,
          fileType: 'pdf',
          dataUrl: apiUrl(`/api/files/binary?path=${encodeURIComponent(filePath)}`)
        });
        return;
      }

      // For binary files, just get file info for download
      if (fileType === 'binary') {
        const infoRes = await fetch(apiUrl(`/api/files/info?path=${encodeURIComponent(filePath)}`));
        const info = await infoRes.json();

        if (!infoRes.ok) {
          setError(info.error || 'Failed to load file info');
          setFile(null);
          return;
        }

        setFile({
          path: filePath,
          filename,
          extension,
          content: '',
          size: info.size,
          modified: info.modified,
          fileType: 'binary',
          dataUrl: apiUrl(`/api/files/binary?path=${encodeURIComponent(filePath)}&download=true`)
        });
        return;
      }

      // For text files, use the existing endpoint
      const res = await fetch(apiUrl(`/api/files/read?path=${encodeURIComponent(filePath)}`));
      const data = await res.json();

      if (!res.ok) {
        // If file is too large or unreadable, offer download instead of showing error
        if (data.error?.includes('too large') || data.error?.includes('binary')) {
          // Fall back to binary mode - get file info and offer download
          const infoRes = await fetch(apiUrl(`/api/files/info?path=${encodeURIComponent(filePath)}`));
          const info = await infoRes.json();

          if (infoRes.ok) {
            setFile({
              path: filePath,
              filename,
              extension,
              content: '',
              size: info.size,
              modified: info.modified,
              fileType: 'binary',
              dataUrl: apiUrl(`/api/files/binary?path=${encodeURIComponent(filePath)}&download=true`)
            });
            return;
          }
        }
        setError(data.error || 'Failed to load file');
        setFile(null);
        return;
      }

      setFile({
        ...data,
        fileType: 'text'
      });
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
   * Uses a ref pattern to avoid changing identity when file changes
   */
  const clearFile = useCallback(() => {
    // Revoke any blob URLs to free memory using setState callback to access current value
    setFile((prevFile) => {
      if (prevFile?.dataUrl && prevFile.dataUrl.startsWith('blob:')) {
        URL.revokeObjectURL(prevFile.dataUrl);
      }
      return null;
    });
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
