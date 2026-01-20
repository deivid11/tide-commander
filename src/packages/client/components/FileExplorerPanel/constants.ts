/**
 * Constants for the FileExplorerPanel component family
 *
 * Centralized configuration following ClaudeOutputPanel patterns.
 */

import type { GitFileStatusType } from './types';

// ============================================================================
// EXTENSION TO PRISM LANGUAGE MAPPING
// ============================================================================

export const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'scss',
  '.less': 'css',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.sql': 'sql',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.fish': 'bash',
  '.toml': 'toml',
  '.dockerfile': 'docker',
  '.html': 'markup',
  '.xml': 'markup',
  '.svg': 'markup',
};

// ============================================================================
// FILE ICONS
// ============================================================================

export const FILE_ICONS: Record<string, string> = {
  '.ts': '📘',
  '.tsx': '⚛️',
  '.js': '📒',
  '.jsx': '⚛️',
  '.py': '🐍',
  '.rs': '🦀',
  '.go': '🔷',
  '.md': '📝',
  '.json': '📋',
  '.yaml': '⚙️',
  '.yml': '⚙️',
  '.css': '🎨',
  '.scss': '🎨',
  '.html': '🌐',
  '.sql': '🗃️',
  '.sh': '💻',
  '.env': '🔐',
  '.toml': '⚙️',
  '.lock': '🔒',
  '.png': '🖼️',
  '.jpg': '🖼️',
  '.svg': '🖼️',
  '.gif': '🖼️',
  default: '📄',
};

// ============================================================================
// GIT STATUS CONFIGURATION
// ============================================================================

export interface GitStatusConfig {
  icon: string;
  color: string;
  label: string;
}

export const GIT_STATUS_CONFIG: Record<GitFileStatusType, GitStatusConfig> = {
  modified: { icon: 'M', color: '#ffb86c', label: 'Modified' },
  added: { icon: 'A', color: '#50fa7b', label: 'Added' },
  deleted: { icon: 'D', color: '#ff5555', label: 'Deleted' },
  untracked: { icon: 'U', color: '#8be9fd', label: 'Untracked' },
  renamed: { icon: 'R', color: '#bd93f9', label: 'Renamed' },
};

// ============================================================================
// API CONFIGURATION
// ============================================================================

export const DEFAULT_TREE_DEPTH = 10;
