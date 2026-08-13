/**
 * Shared defaults for Spotlight / file-explorer filename search.
 * Folder *names* (not paths) skipped while walking area project trees.
 */

export const DEFAULT_FILE_SEARCH_EXCLUDE_DIRS = [
  'node_modules',
  'vendor',
  '.git',
  'dist',
  'build',
  '.next',
  'target',
  '.cache',
  '.turbo',
  '.venv',
  '__pycache__',
  'venv',
] as const;

/** True when `name` is a safe directory basename (no path separators). */
export function isValidExcludeDirName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && !trimmed.includes('/') && !trimmed.includes('\\') && trimmed !== '.' && trimmed !== '..';
}

/**
 * Parse a query-string or settings value into a set of folder names.
 * Accepts a comma-separated string, a string[], or undefined.
 */
export function parseExcludeDirNames(raw: unknown): string[] {
  const parts: string[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') parts.push(item);
    }
  } else if (typeof raw === 'string') {
    parts.push(...raw.split(','));
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const name = part.trim();
    if (!isValidExcludeDirName(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
