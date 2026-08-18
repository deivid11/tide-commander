/**
 * Pure helpers for the ArchiveViewer: DTO types, size/date formatting and the
 * entry-path → directory tree builder (intermediate dirs materialised, sizes
 * and file counts rolled up, dirs-first natural sort). Kept free of React /
 * browser imports so it is unit-testable under vitest's node environment.
 */

export interface ArchiveEntryDto {
  path: string;
  isDir: boolean;
  size: number | null;
  compressedSize: number | null;
  mtime: string | null;
}

export interface ArchiveListingDto {
  path: string;
  filename: string;
  size: number;
  format: string;
  tool: string;
  entries: ArchiveEntryDto[];
  entryCount: number;
  fileCount: number;
  dirCount: number;
  totalSize: number | null;
  totalCompressed: number | null;
  truncated: boolean;
}

export interface ArchiveTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  /** Own size for files; aggregated descendant size for directories (null when unknown). */
  size: number | null;
  compressedSize: number | null;
  mtime: string | null;
  children: ArchiveTreeNode[];
  /** Descendant file count for directories. */
  fileCount: number;
}

/** Above this many nodes the tree starts collapsed (top level only). */
export const AUTO_EXPAND_LIMIT = 300;

export function formatArchiveSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v).toString()} ${units[i]}`;
}

export function formatArchiveMtime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Build the directory tree from flat entry paths. Intermediate directories
 * are materialised even when the container has no explicit entry for them
 * (zip and tar both allow that). Sizes roll up into their ancestors.
 */
export function buildArchiveTree(entries: readonly ArchiveEntryDto[]): ArchiveTreeNode {
  const root: ArchiveTreeNode = { name: '', path: '', isDir: true, size: 0, compressedSize: 0, mtime: null, children: [], fileCount: 0 };
  const dirIndex = new Map<string, ArchiveTreeNode>([['', root]]);

  const ensureDir = (dirPath: string): ArchiveTreeNode => {
    const existing = dirIndex.get(dirPath);
    if (existing) return existing;
    const slash = dirPath.lastIndexOf('/');
    const parent = ensureDir(slash === -1 ? '' : dirPath.slice(0, slash));
    const node: ArchiveTreeNode = {
      name: slash === -1 ? dirPath : dirPath.slice(slash + 1),
      path: dirPath,
      isDir: true,
      size: 0,
      compressedSize: 0,
      mtime: null,
      children: [],
      fileCount: 0,
    };
    parent.children.push(node);
    dirIndex.set(dirPath, node);
    return node;
  };

  for (const e of entries) {
    const clean = e.path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!clean) continue;
    if (e.isDir) {
      const d = ensureDir(clean);
      if (e.mtime && !d.mtime) d.mtime = e.mtime;
      continue;
    }
    const slash = clean.lastIndexOf('/');
    const parent = ensureDir(slash === -1 ? '' : clean.slice(0, slash));
    parent.children.push({
      name: slash === -1 ? clean : clean.slice(slash + 1),
      path: clean,
      isDir: false,
      size: e.size,
      compressedSize: e.compressedSize,
      mtime: e.mtime,
      children: [],
      fileCount: 0,
    });
  }

  // Roll sizes/counts up and sort (dirs first, then case-insensitive name).
  const finalize = (node: ArchiveTreeNode): void => {
    let size: number | null = 0;
    let compressed: number | null = 0;
    let files = 0;
    for (const child of node.children) {
      if (child.isDir) finalize(child);
      if (size !== null) size = child.size === null ? null : size + child.size;
      if (compressed !== null) compressed = child.compressedSize === null ? null : compressed + child.compressedSize;
      files += child.isDir ? child.fileCount : 1;
    }
    node.children.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) : a.isDir ? -1 : 1));
    if (node.isDir) {
      node.size = size;
      node.compressedSize = compressed;
      node.fileCount = files;
    }
  };
  finalize(root);
  return root;
}

export function countArchiveNodes(node: ArchiveTreeNode): number {
  let n = 0;
  for (const c of node.children) n += 1 + (c.isDir ? countArchiveNodes(c) : 0);
  return n;
}

export function collectArchiveDirPaths(node: ArchiveTreeNode, out: string[] = []): string[] {
  for (const c of node.children) {
    if (c.isDir) { out.push(c.path); collectArchiveDirPaths(c, out); }
  }
  return out;
}
