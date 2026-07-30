/**
 * File utility functions for FileExplorerPanel
 *
 * Pure utility functions following ClaudeOutputPanel's viewFilters.ts pattern.
 */

import type { TreeNode, GitFileStatus } from './types';
import { FILE_ICONS } from './constants';

// ============================================================================
// FILE ICON UTILITIES
// ============================================================================

// Whole-name keys are written in their canonical casing ("Dockerfile",
// "LICENSE"), but real repos hold `dockerfile` and `license` too — this mirror
// makes the whole-name lookup case-insensitive without duplicating the map.
const FILE_ICONS_LOWER: Record<string, string> = Object.fromEntries(
  Object.entries(FILE_ICONS).map(([key, src]) => [key.toLowerCase(), src])
);

/** Suffixes that mark a copy/template of another file rather than a type. */
const VARIANT_SUFFIXES = ['.sample', '.dist', '.example', '.template', '.default', '.in'];

/**
 * Get the icon for a tree node. Resolves by whole filename first, so
 * extension-less and dot-only names (Dockerfile, gradlew, .gitignore) get their
 * real icon instead of the generic fallback.
 */
export function getFileIcon(node: TreeNode): string {
  if (node.isDirectory) return '';
  return getIconForFileName(node.name);
}

/**
 * Get the icon for an extension
 */
export function getIconForExtension(extension: string): string {
  return FILE_ICONS[extension] || FILE_ICONS.default;
}

/**
 * Get the icon for a bare filename. FILE_ICONS is keyed by whole names
 * ("Dockerfile", "go.mod"), by compound suffixes (".controller.ts",
 * ".blade.php", ".d.ts") and by plain extensions (".svg"), so a filename is
 * resolved in that order — longest suffix wins, so "users.controller.ts" gets
 * the Nest controller icon and "users.ts" still gets the TypeScript one.
 * Passing a filename straight to getIconForExtension always lands on the
 * generic fallback instead.
 */
export function getIconForFileName(name: string): string {
  if (FILE_ICONS[name]) return FILE_ICONS[name];

  const lower = name.toLowerCase();
  if (FILE_ICONS_LOWER[lower]) return FILE_ICONS_LOWER[lower];

  // Walk the dots left to right; the leading dot of a dotfile is skipped
  // because the whole name was already tried above.
  let dot = lower.indexOf('.', lower.startsWith('.') ? 1 : 0);
  const firstDot = dot;
  while (dot !== -1) {
    const icon = FILE_ICONS[lower.slice(dot)];
    if (icon) return icon;
    dot = lower.indexOf('.', dot + 1);
  }

  // Template/variant markers carry no type of their own — drop one and resolve
  // what's underneath ("config.yaml.dist" is a YAML file, "pre-commit.sample"
  // a shell script). Backup markers (.bak/.orig/.tmp) are deliberately absent:
  // those have their own icon.
  for (const marker of VARIANT_SUFFIXES) {
    if (lower.endsWith(marker) && lower.length > marker.length) {
      return getIconForFileName(name.slice(0, -marker.length));
    }
  }

  // Last resort: the stem before the first dot, so variants of a known
  // extension-less file ("Dockerfile.dev", "Makefile.local") keep its icon.
  if (firstDot > 0) {
    const stem = name.slice(0, firstDot);
    const byStem = FILE_ICONS[stem] || FILE_ICONS_LOWER[stem.toLowerCase()];
    if (byStem) return byStem;
  }

  return FILE_ICONS.default;
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
 * Separator-agnostic split: handles both POSIX '/' and Windows '\' paths, so a
 * configured Windows path (e.g. `C:\Users\x`) is parsed correctly on the client
 * even if it reaches the UI without server normalization.
 */
export const PATH_SEP_RE = /[\\/]/;

/**
 * Get the filename from a path
 */
export function getFilename(path: string): string {
  return path.split(PATH_SEP_RE).pop() || path;
}

/**
 * Get the parent directory from a path
 */
export function getParentDir(path: string): string {
  const parts = path.split(PATH_SEP_RE);
  parts.pop();
  return parts.join('/') || '/';
}

// ============================================================================
// GIT TREE UTILITIES
// ============================================================================

export interface GitTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  file?: GitFileStatus;
  children: GitTreeNode[];
  fileCount: number;
}

/**
 * Build a directory tree from a flat list of git file statuses.
 * Collapses single-child directory chains (e.g. src/packages/client shown as one node).
 */
export function buildGitTree(files: GitFileStatus[]): GitTreeNode[] {
  if (files.length === 0) return [];

  // Build raw trie from file paths
  const root: GitTreeNode = { name: '', path: '', isDirectory: true, children: [], fileCount: 0 };

  for (const file of files) {
    const segments = file.path.split(PATH_SEP_RE);
    let current = root;

    // Walk/create directory nodes for all segments except the last (filename)
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      const dirPath = segments.slice(0, i + 1).join('/');
      let child = current.children.find(c => c.isDirectory && c.name === seg);
      if (!child) {
        child = { name: seg, path: dirPath, isDirectory: true, children: [], fileCount: 0 };
        current.children.push(child);
      }
      current = child;
    }

    // Add file leaf
    current.children.push({
      name: file.name,
      path: file.path,
      isDirectory: false,
      file,
      children: [],
      fileCount: 1,
    });
  }

  // Collapse single-child directory chains
  function collapse(node: GitTreeNode): GitTreeNode {
    node.children = node.children.map(collapse);
    while (
      node.isDirectory &&
      node.children.length === 1 &&
      node.children[0].isDirectory
    ) {
      const child = node.children[0];
      node.name = node.name ? node.name + '/' + child.name : child.name;
      node.path = child.path;
      node.children = child.children;
    }
    return node;
  }

  // Compute file counts bottom-up
  function countFiles(node: GitTreeNode): number {
    if (!node.isDirectory) return 1;
    node.fileCount = node.children.reduce((sum, c) => sum + countFiles(c), 0);
    return node.fileCount;
  }

  // Sort: directories first, then files, alphabetically
  function sortTree(nodes: GitTreeNode[]): GitTreeNode[] {
    return [...nodes].sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    }).map(n => {
      if (n.isDirectory) n.children = sortTree(n.children);
      return n;
    });
  }

  // Process root's children
  root.children = root.children.map(collapse);
  countFiles(root);
  root.children = sortTree(root.children);

  return root.children;
}

/**
 * Collect all directory paths from a git tree (for initializing expanded state).
 */
export function collectGitTreeDirPaths(nodes: GitTreeNode[], out: Set<string>): void {
  for (const node of nodes) {
    if (node.isDirectory) {
      out.add(node.path);
      collectGitTreeDirPaths(node.children, out);
    }
  }
}
