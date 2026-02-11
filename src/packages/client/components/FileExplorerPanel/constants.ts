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
  // Web languages
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'scss',
  '.less': 'css',
  '.html': 'markup',
  '.xml': 'markup',
  '.svg': 'markup',
  '.graphql': 'graphql',
  '.gql': 'graphql',

  // JVM languages
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.scala': 'scala',
  '.groovy': 'groovy',
  '.gradle': 'groovy',
  '.clj': 'clojure',
  '.cljs': 'clojure',

  // C family
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'cpp',
  '.cs': 'csharp',

  // Scripting languages
  '.py': 'python',
  '.rb': 'ruby',
  '.php': 'php',
  '.lua': 'lua',
  '.pl': 'perl',
  '.pm': 'perl',
  '.r': 'r',
  '.R': 'r',

  // Functional languages
  '.hs': 'haskell',
  '.lhs': 'haskell',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hrl': 'erlang',

  // Systems languages
  '.rs': 'rust',
  '.go': 'go',
  '.swift': 'swift',

  // Shell/scripting
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.fish': 'bash',
  '.ps1': 'powershell',
  '.psm1': 'powershell',
  '.psd1': 'powershell',

  // Data formats
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.conf': 'ini',

  // Documentation
  '.md': 'markdown',
  '.mdx': 'markdown',

  // Database
  '.sql': 'sql',

  // Build/config
  '.dockerfile': 'docker',
  '.nginx': 'nginx',
  '.vim': 'vim',
  '.vimrc': 'vim',
  '.diff': 'diff',
  '.patch': 'diff',
  '.makefile': 'makefile',
  '.mk': 'makefile',
};

// ============================================================================
// FILE ICONS - VSCODE ICONS (SVG)
// ============================================================================

const ICON_BASE = '/assets/vscode-icons/';

export const FILE_ICONS: Record<string, string> = {
  // Web languages
  '.ts': `${ICON_BASE}file_type_typescript_official.svg`,
  '.tsx': `${ICON_BASE}file_type_typescript_official.svg`,
  '.js': `${ICON_BASE}file_type_js_official.svg`,
  '.jsx': `${ICON_BASE}file_type_reactjs.svg`,
  '.mjs': `${ICON_BASE}file_type_js_official.svg`,
  '.cjs': `${ICON_BASE}file_type_js_official.svg`,
  '.css': `${ICON_BASE}file_type_css.svg`,
  '.scss': `${ICON_BASE}file_type_scss.svg`,
  '.sass': `${ICON_BASE}file_type_scss.svg`,
  '.less': `${ICON_BASE}file_type_less.svg`,
  '.html': `${ICON_BASE}file_type_html.svg`,
  '.xml': `${ICON_BASE}file_type_xml.svg`,
  '.svg': `${ICON_BASE}file_type_svg.svg`,
  '.graphql': `${ICON_BASE}file_type_graphql.svg`,
  '.gql': `${ICON_BASE}file_type_graphql.svg`,

  // JVM languages
  '.java': `${ICON_BASE}file_type_java.svg`,
  '.kt': `${ICON_BASE}file_type_kotlin.svg`,
  '.kts': `${ICON_BASE}file_type_kotlin.svg`,
  '.scala': `${ICON_BASE}file_type_scala.svg`,
  '.groovy': `${ICON_BASE}file_type_groovy.svg`,
  '.gradle': `${ICON_BASE}file_type_gradle.svg`,
  '.clj': `${ICON_BASE}file_type_clojure.svg`,
  '.cljs': `${ICON_BASE}file_type_clojure.svg`,

  // C family
  '.c': `${ICON_BASE}file_type_c.svg`,
  '.h': `${ICON_BASE}file_type_c.svg`,
  '.cpp': `${ICON_BASE}file_type_cpp.svg`,
  '.cc': `${ICON_BASE}file_type_cpp.svg`,
  '.cxx': `${ICON_BASE}file_type_cpp.svg`,
  '.hpp': `${ICON_BASE}file_type_cpp.svg`,
  '.hxx': `${ICON_BASE}file_type_cpp.svg`,
  '.cs': `${ICON_BASE}file_type_csharp.svg`,

  // Scripting
  '.py': `${ICON_BASE}file_type_python.svg`,
  '.rb': `${ICON_BASE}file_type_ruby.svg`,
  '.php': `${ICON_BASE}file_type_php.svg`,
  '.lua': `${ICON_BASE}file_type_lua.svg`,
  '.pl': `${ICON_BASE}file_type_perl.svg`,
  '.pm': `${ICON_BASE}file_type_perl.svg`,
  '.r': `${ICON_BASE}file_type_r.svg`,
  '.R': `${ICON_BASE}file_type_r.svg`,

  // Functional
  '.hs': `${ICON_BASE}file_type_haskell.svg`,
  '.lhs': `${ICON_BASE}file_type_haskell.svg`,
  '.ex': `${ICON_BASE}file_type_elixir.svg`,
  '.exs': `${ICON_BASE}file_type_elixir.svg`,
  '.erl': `${ICON_BASE}file_type_erlang.svg`,
  '.hrl': `${ICON_BASE}file_type_erlang.svg`,

  // Systems
  '.rs': `${ICON_BASE}file_type_rust.svg`,
  '.go': `${ICON_BASE}file_type_go.svg`,
  '.swift': `${ICON_BASE}file_type_swift.svg`,

  // Shell
  '.sh': `${ICON_BASE}file_type_shell.svg`,
  '.bash': `${ICON_BASE}file_type_shell.svg`,
  '.zsh': `${ICON_BASE}file_type_shell.svg`,
  '.fish': `${ICON_BASE}file_type_shell.svg`,
  '.ps1': `${ICON_BASE}file_type_powershell.svg`,
  '.psm1': `${ICON_BASE}file_type_powershell.svg`,
  '.psd1': `${ICON_BASE}file_type_powershell.svg`,

  // Data formats
  '.json': `${ICON_BASE}file_type_json_official.svg`,
  '.yaml': `${ICON_BASE}file_type_yaml_official.svg`,
  '.yml': `${ICON_BASE}file_type_yaml_official.svg`,
  '.toml': `${ICON_BASE}file_type_toml.svg`,
  '.ini': `${ICON_BASE}file_type_ini.svg`,
  '.cfg': `${ICON_BASE}file_type_ini.svg`,
  '.conf': `${ICON_BASE}file_type_ini.svg`,

  // Documentation
  '.md': `${ICON_BASE}file_type_markdown.svg`,
  '.mdx': `${ICON_BASE}file_type_markdown.svg`,

  // Database
  '.sql': `${ICON_BASE}file_type_sql.svg`,

  // Build/config
  '.dockerfile': `${ICON_BASE}file_type_docker.svg`,
  'Dockerfile': `${ICON_BASE}file_type_docker.svg`,
  '.env': `${ICON_BASE}file_type_dotenv.svg`,
  'package.json': `${ICON_BASE}file_type_npm.svg`,
  'package-lock.json': `${ICON_BASE}file_type_npm.svg`,
  'tsconfig.json': `${ICON_BASE}file_type_tsconfig.svg`,
  '.gitignore': `${ICON_BASE}file_type_git.svg`,

  // Images
  '.png': `${ICON_BASE}file_type_image.svg`,
  '.jpg': `${ICON_BASE}file_type_image.svg`,
  '.jpeg': `${ICON_BASE}file_type_image.svg`,
  '.gif': `${ICON_BASE}file_type_image.svg`,
  '.webp': `${ICON_BASE}file_type_image.svg`,

  default: `${ICON_BASE}default_file.svg`,
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
  modified: { icon: 'M', color: '#c89a5a', label: 'Modified' },
  added: { icon: 'A', color: '#5cb88a', label: 'Added' },
  deleted: { icon: 'D', color: '#c85a5a', label: 'Deleted' },
  untracked: { icon: 'U', color: '#6ab8c8', label: 'Untracked' },
  renamed: { icon: 'R', color: '#9a80c0', label: 'Renamed' },
};

// ============================================================================
// API CONFIGURATION
// ============================================================================

export const DEFAULT_TREE_DEPTH = 10;
