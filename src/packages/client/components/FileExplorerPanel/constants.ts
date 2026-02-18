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
// FILE EXTENSION TO ICON MAPPING - VSCODE ICONS (SVG)
// ============================================================================
// Comprehensive mapping covering 190+ file types and extensions
// ============================================================================

const ICON_BASE = `${import.meta.env.BASE_URL}assets/vscode-icons/`;

export const FILE_ICONS: Record<string, string> = {
  '.7z': `${ICON_BASE}file_type_zip.svg`,
  '.R': `${ICON_BASE}file_type_r.svg`,
  '.adoc': `${ICON_BASE}file_type_asciidoc.svg`,
  '.asciidoc': `${ICON_BASE}file_type_asciidoc.svg`,
  '.astro': `${ICON_BASE}file_type_astro.svg`,
  '.avi': `${ICON_BASE}file_type_video.svg`,
  '.babelrc': `${ICON_BASE}file_type_babel.svg`,
  '.bash': `${ICON_BASE}file_type_shell.svg`,
  '.bat': `${ICON_BASE}file_type_bat.svg`,
  '.bmp': `${ICON_BASE}file_type_image.svg`,
  '.c': `${ICON_BASE}file_type_c.svg`,
  '.cc': `${ICON_BASE}file_type_cpp.svg`,
  '.cfg': `${ICON_BASE}file_type_ini.svg`,
  '.circleci': `${ICON_BASE}file_type_circleci.svg`,
  '.cjs': `${ICON_BASE}file_type_js_official.svg`,
  '.clj': `${ICON_BASE}file_type_clojure.svg`,
  '.cljs': `${ICON_BASE}file_type_clojure.svg`,
  '.cmd': `${ICON_BASE}file_type_bat.svg`,
  '.conf': `${ICON_BASE}file_type_ini.svg`,
  '.cpp': `${ICON_BASE}file_type_cpp.svg`,
  '.cs': `${ICON_BASE}file_type_csharp.svg`,
  '.css': `${ICON_BASE}file_type_css.svg`,
  '.csv': `${ICON_BASE}file_type_csv.svg`,
  '.cxx': `${ICON_BASE}file_type_cpp.svg`,
  '.dart': `${ICON_BASE}file_type_dart.svg`,
  '.diff': `${ICON_BASE}file_type_diff.svg`,
  '.dockerfile': `${ICON_BASE}file_type_docker.svg`,
  '.dockerignore': `${ICON_BASE}file_type_docker.svg`,
  '.env': `${ICON_BASE}file_type_dotenv.svg`,
  '.env.development': `${ICON_BASE}file_type_dotenv.svg`,
  '.env.local': `${ICON_BASE}file_type_dotenv.svg`,
  '.env.production': `${ICON_BASE}file_type_dotenv.svg`,
  '.env.test': `${ICON_BASE}file_type_dotenv.svg`,
  '.erb': `${ICON_BASE}file_type_ruby.svg`,
  '.erl': `${ICON_BASE}file_type_erlang.svg`,
  '.eslintrc': `${ICON_BASE}file_type_eslint.svg`,
  '.eslintrc.js': `${ICON_BASE}file_type_eslint.svg`,
  '.eslintrc.json': `${ICON_BASE}file_type_eslint.svg`,
  '.ex': `${ICON_BASE}file_type_elixir.svg`,
  '.exs': `${ICON_BASE}file_type_elixir.svg`,
  '.fish': `${ICON_BASE}file_type_shell.svg`,
  '.gif': `${ICON_BASE}file_type_image.svg`,
  '.git': `${ICON_BASE}file_type_git.svg`,
  '.gitattributes': `${ICON_BASE}file_type_git.svg`,
  '.github': `${ICON_BASE}file_type_github.svg`,
  '.gitignore': `${ICON_BASE}file_type_git.svg`,
  '.gitlab-ci.yml': `${ICON_BASE}file_type_gitlab.svg`,
  '.gitmodules': `${ICON_BASE}file_type_git.svg`,
  '.go': `${ICON_BASE}file_type_go.svg`,
  '.gql': `${ICON_BASE}file_type_graphql.svg`,
  '.gradle': `${ICON_BASE}file_type_gradle.svg`,
  '.graphql': `${ICON_BASE}file_type_graphql.svg`,
  '.groovy': `${ICON_BASE}file_type_groovy.svg`,
  '.gz': `${ICON_BASE}file_type_zip.svg`,
  '.h': `${ICON_BASE}file_type_c.svg`,
  '.hpp': `${ICON_BASE}file_type_cpp.svg`,
  '.hrl': `${ICON_BASE}file_type_erlang.svg`,
  '.hs': `${ICON_BASE}file_type_haskell.svg`,
  '.htm': `${ICON_BASE}file_type_html.svg`,
  '.html': `${ICON_BASE}file_type_html.svg`,
  '.ico': `${ICON_BASE}file_type_image.svg`,
  '.ini': `${ICON_BASE}file_type_ini.svg`,
  '.java': `${ICON_BASE}file_type_java.svg`,
  '.jl': `${ICON_BASE}file_type_julia.svg`,
  '.jpeg': `${ICON_BASE}file_type_image.svg`,
  '.jpg': `${ICON_BASE}file_type_image.svg`,
  '.js': `${ICON_BASE}file_type_js_official.svg`,
  '.json': `${ICON_BASE}file_type_json_official.svg`,
  '.json5': `${ICON_BASE}file_type_json5.svg`,
  '.jsonc': `${ICON_BASE}file_type_json_official.svg`,
  '.jsx': `${ICON_BASE}file_type_reactjs.svg`,
  '.kt': `${ICON_BASE}file_type_kotlin.svg`,
  '.kts': `${ICON_BASE}file_type_kotlin.svg`,
  '.kubernetes.yaml': `${ICON_BASE}file_type_kubernetes.svg`,
  '.less': `${ICON_BASE}file_type_less.svg`,
  '.lhs': `${ICON_BASE}file_type_haskell.svg`,
  '.lock': `${ICON_BASE}file_type_lock.svg`,
  '.log': `${ICON_BASE}file_type_log.svg`,
  '.lua': `${ICON_BASE}file_type_lua.svg`,
  '.markdown': `${ICON_BASE}file_type_markdown.svg`,
  '.md': `${ICON_BASE}file_type_markdown.svg`,
  '.mdown': `${ICON_BASE}file_type_markdown.svg`,
  '.mdx': `${ICON_BASE}file_type_markdown.svg`,
  '.mjs': `${ICON_BASE}file_type_js_official.svg`,
  '.mk': `${ICON_BASE}file_type_makefile.svg`,
  '.mov': `${ICON_BASE}file_type_video.svg`,
  '.mp3': `${ICON_BASE}file_type_audio.svg`,
  '.mp4': `${ICON_BASE}file_type_video.svg`,
  '.nim': `${ICON_BASE}file_type_nim.svg`,
  '.nims': `${ICON_BASE}file_type_nim.svg`,
  '.patch': `${ICON_BASE}file_type_diff.svg`,
  '.pdf': `${ICON_BASE}file_type_pdf.svg`,
  '.php': `${ICON_BASE}file_type_php.svg`,
  '.pl': `${ICON_BASE}file_type_perl.svg`,
  '.pm': `${ICON_BASE}file_type_perl.svg`,
  '.png': `${ICON_BASE}file_type_image.svg`,
  '.prettier.json': `${ICON_BASE}file_type_prettier.svg`,
  '.prettierrc': `${ICON_BASE}file_type_prettier.svg`,
  '.ps1': `${ICON_BASE}file_type_powershell.svg`,
  '.psd1': `${ICON_BASE}file_type_powershell.svg`,
  '.psm1': `${ICON_BASE}file_type_powershell.svg`,
  '.py': `${ICON_BASE}file_type_python.svg`,
  '.pyw': `${ICON_BASE}file_type_python.svg`,
  '.r': `${ICON_BASE}file_type_r.svg`,
  '.rar': `${ICON_BASE}file_type_zip.svg`,
  '.rb': `${ICON_BASE}file_type_ruby.svg`,
  '.rs': `${ICON_BASE}file_type_rust.svg`,
  '.rst': `${ICON_BASE}file_type_rst.svg`,
  '.sass': `${ICON_BASE}file_type_scss.svg`,
  '.scala': `${ICON_BASE}file_type_scala.svg`,
  '.scss': `${ICON_BASE}file_type_scss.svg`,
  '.sh': `${ICON_BASE}file_type_shell.svg`,
  '.sql': `${ICON_BASE}file_type_sql.svg`,
  '.sty': `${ICON_BASE}file_type_latex.svg`,
  '.svelte': `${ICON_BASE}file_type_svelte.svg`,
  '.svg': `${ICON_BASE}file_type_svg.svg`,
  '.swift': `${ICON_BASE}file_type_swift.svg`,
  '.tar': `${ICON_BASE}file_type_tar.svg`,
  '.tar.bz2': `${ICON_BASE}file_type_zip.svg`,
  '.tar.gz': `${ICON_BASE}file_type_zip.svg`,
  '.terraform': `${ICON_BASE}file_type_terraform.svg`,
  '.tex': `${ICON_BASE}file_type_latex.svg`,
  '.toml': `${ICON_BASE}file_type_toml.svg`,
  '.travis.yml': `${ICON_BASE}file_type_travis.svg`,
  '.ts': `${ICON_BASE}file_type_typescript_official.svg`,
  '.tsv': `${ICON_BASE}file_type_tsv.svg`,
  '.tsx': `${ICON_BASE}file_type_typescript_official.svg`,
  '.txt': `${ICON_BASE}file_type_text.svg`,
  '.vue': `${ICON_BASE}file_type_vue.svg`,
  '.webm': `${ICON_BASE}file_type_video.svg`,
  '.webp': `${ICON_BASE}file_type_image.svg`,
  '.xml': `${ICON_BASE}file_type_xml.svg`,
  '.yaml': `${ICON_BASE}file_type_yaml_official.svg`,
  '.yml': `${ICON_BASE}file_type_yaml_official.svg`,
  '.zig': `${ICON_BASE}file_type_zig.svg`,
  '.zip': `${ICON_BASE}file_type_zip.svg`,
  '.zsh': `${ICON_BASE}file_type_shell.svg`,
  'CMakeLists.txt': `${ICON_BASE}file_type_cmake.svg`,
  'Cargo.lock': `${ICON_BASE}file_type_cargo.svg`,
  'Cargo.toml': `${ICON_BASE}file_type_cargo.svg`,
  'Dockerfile': `${ICON_BASE}file_type_docker.svg`,
  'Gemfile': `${ICON_BASE}file_type_ruby.svg`,
  'Gemfile.lock': `${ICON_BASE}file_type_ruby.svg`,
  'Justfile': `${ICON_BASE}file_type_just.svg`,
  'Makefile': `${ICON_BASE}file_type_makefile.svg`,
  'Pipfile': `${ICON_BASE}file_type_python.svg`,
  'Pipfile.lock': `${ICON_BASE}file_type_python.svg`,
  'Procfile': `${ICON_BASE}file_type_procfile.svg`,
  'Vagrantfile': `${ICON_BASE}file_type_vagrant.svg`,
  'azure-pipelines.yml': `${ICON_BASE}file_type_azurepipelines.svg`,
  'build.gradle': `${ICON_BASE}file_type_gradle.svg`,
  'build.sbt': `${ICON_BASE}file_type_scala.svg`,
  'docker-compose.yaml': `${ICON_BASE}file_type_docker.svg`,
  'docker-compose.yml': `${ICON_BASE}file_type_docker.svg`,
  'dune': `${ICON_BASE}file_type_dune.svg`,
  'gatsby-config.js': `${ICON_BASE}file_type_gatsby.svg`,
  'go.mod': `${ICON_BASE}file_type_go.svg`,
  'go.sum': `${ICON_BASE}file_type_go.svg`,
  'heroku.yml': `${ICON_BASE}file_type_heroku.svg`,
  'jsconfig.json': `${ICON_BASE}file_type_jsconfig.svg`,
  'kubernetes.yaml': `${ICON_BASE}file_type_kubernetes.svg`,
  'makefile': `${ICON_BASE}file_type_makefile.svg`,
  'meson.build': `${ICON_BASE}file_type_meson.svg`,
  'mix.exs': `${ICON_BASE}file_type_elixir.svg`,
  'next.config.js': `${ICON_BASE}file_type_nextjs.svg`,
  'nuxt.config.js': `${ICON_BASE}file_type_nuxtjs.svg`,
  'package-lock.json': `${ICON_BASE}file_type_npm.svg`,
  'package.json': `${ICON_BASE}file_type_npm.svg`,
  'pnpm-lock.yaml': `${ICON_BASE}file_type_pnpm.svg`,
  'pom.xml': `${ICON_BASE}file_type_maven.svg`,
  'pubspec.lock': `${ICON_BASE}file_type_dart.svg`,
  'pubspec.yaml': `${ICON_BASE}file_type_dart.svg`,
  'pyproject.toml': `${ICON_BASE}file_type_python.svg`,
  'rebar.config': `${ICON_BASE}file_type_erlang.svg`,
  'requirements.txt': `${ICON_BASE}file_type_python.svg`,
  'terraform.tfvars': `${ICON_BASE}file_type_terraform.svg`,
  'tox.ini': `${ICON_BASE}file_type_tox.svg`,
  'tsconfig.json': `${ICON_BASE}file_type_tsconfig.svg`,
  'vite.config.js': `${ICON_BASE}file_type_vite.svg`,
  'vite.config.ts': `${ICON_BASE}file_type_vite.svg`,
  'webpack.config.js': `${ICON_BASE}file_type_webpack.svg`,
  'yarn.lock': `${ICON_BASE}file_type_yarn.svg`,

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
  conflict: { icon: 'C', color: '#ff5555', label: 'Conflicts' },
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
