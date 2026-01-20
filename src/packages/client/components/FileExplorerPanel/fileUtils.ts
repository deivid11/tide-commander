/**
 * File utility functions for FileExplorerPanel
 *
 * Pure utility functions following ClaudeOutputPanel's viewFilters.ts pattern.
 */

import type { TreeNode } from './types';
import { FILE_ICONS } from './constants';

// ============================================================================
// FILE ICON UTILITIES
// ============================================================================

/**
 * Get the icon for a tree node based on its extension
 */
export function getFileIcon(node: TreeNode): string {
  if (node.isDirectory) return '';
  return FILE_ICONS[node.extension] || FILE_ICONS.default;
}

/**
 * Get the icon for an extension
 */
export function getIconForExtension(extension: string): string {
  return FILE_ICONS[extension] || FILE_ICONS.default;
}

// ============================================================================
// FILE SIZE UTILITIES
// ============================================================================

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// TEXT HIGHLIGHTING
// ============================================================================

/**
 * Highlight matching text in a string
 * Returns the indices of the match for rendering
 */
export function findMatchIndices(
  text: string,
  query: string
): { start: number; end: number } | null {
  if (!query) return null;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return null;
  return { start: idx, end: idx + query.length };
}

// ============================================================================
// PATH UTILITIES
// ============================================================================

/**
 * Get the filename from a path
 */
export function getFilename(path: string): string {
  return path.split('/').pop() || path;
}

/**
 * Get the parent directory from a path
 */
export function getParentDir(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/') || '/';
}
