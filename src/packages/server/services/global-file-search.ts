/**
 * Global filename search across every directory configured on areas.
 * Used by Spotlight (GET /api/files/search-global).
 *
 * Prefer ripgrep (`rg --files`) when available; fall back to an async
 * directory walk so the event loop stays unblocked.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { loadAreas } from '../data/index.js';
import {
  DEFAULT_FILE_SEARCH_EXCLUDE_DIRS,
  parseExcludeDirNames,
} from '../../shared/file-search.js';

function toPosixSeparators(p: string): string {
  return p.replace(/\\/g, '/');
}

export const FILE_SEARCH_MIN_QUERY = 2;
export const FILE_SEARCH_MAX_RESULTS = 50;
const MAX_AREA_DIRS = 48;
const MAX_SEARCH_DEPTH = 12;
const RG_TIMEOUT_MS = 4000;

export interface GlobalFileHit {
  path: string;
  name: string;
  relativePath: string;
  projectName: string;
  projectRoot: string;
  areaId: string;
  areaName: string;
}

export interface AreaSearchRoot {
  id: string;
  name: string;
  archived?: boolean;
  directories?: string[];
}

export interface SearchFilesGlobalOptions {
  query: string;
  /** Folder names to skip. When omitted, the shared default list is used. */
  exclude?: unknown;
  limit?: number;
  /** Injected in tests. Production uses loadAreas(). */
  areas?: AreaSearchRoot[];
}

interface ResolvedRoot {
  areaId: string;
  areaName: string;
  projectName: string;
  /** Path as stored on the area (for opening the explorer). */
  projectRoot: string;
  /** Absolute resolved path used for walking / prefix matching. */
  resolved: string;
}

function defaultExcludeSet(): Set<string> {
  return new Set<string>(DEFAULT_FILE_SEARCH_EXCLUDE_DIRS);
}

export function excludeDirsFromInput(raw: unknown, useDefaultWhenMissing: boolean): Set<string> {
  if (raw === undefined) {
    return useDefaultWhenMissing ? defaultExcludeSet() : new Set();
  }
  return new Set(parseExcludeDirNames(raw));
}

function gatherRoots(areas: AreaSearchRoot[]): ResolvedRoot[] {
  const roots: ResolvedRoot[] = [];
  const seenResolved = new Set<string>();

  for (const area of areas) {
    if (area.archived) continue;
    const dirs = Array.isArray(area.directories) ? area.directories : [];
    for (const raw of dirs) {
      if (roots.length >= MAX_AREA_DIRS) return roots;
      if (typeof raw !== 'string' || !raw.trim()) continue;
      if (!path.isAbsolute(raw)) continue;
      let resolved: string;
      try {
        resolved = path.resolve(raw);
      } catch {
        continue;
      }
      if (seenResolved.has(resolved)) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(resolved);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      seenResolved.add(resolved);
      const posixRoot = toPosixSeparators(resolved);
      roots.push({
        areaId: area.id,
        areaName: area.name,
        projectName: path.basename(resolved) || posixRoot,
        projectRoot: posixRoot,
        resolved,
      });
    }
  }
  return roots;
}

function matchRoot(filePath: string, roots: ResolvedRoot[]): ResolvedRoot | null {
  let best: ResolvedRoot | null = null;
  for (const root of roots) {
    if (filePath === root.resolved || filePath.startsWith(root.resolved + path.sep)) {
      if (!best || root.resolved.length > best.resolved.length) best = root;
    }
  }
  return best;
}

function toHit(filePath: string, root: ResolvedRoot): GlobalFileHit {
  const rel = path.relative(root.resolved, filePath);
  return {
    path: toPosixSeparators(filePath),
    name: path.basename(filePath),
    relativePath: toPosixSeparators(rel || path.basename(filePath)),
    projectName: root.projectName,
    projectRoot: root.projectRoot,
    areaId: root.areaId,
    areaName: root.areaName,
  };
}

function rankHit(hit: GlobalFileHit, queryLower: string): number {
  const name = hit.name.toLowerCase();
  if (name === queryLower) return 0;
  if (name.startsWith(queryLower)) return 1;
  if (name.includes(queryLower)) return 2;
  if (hit.relativePath.toLowerCase().includes(queryLower)) return 3;
  return 4;
}

function sortHits(hits: GlobalFileHit[], queryLower: string): GlobalFileHit[] {
  return hits.sort((a, b) => {
    const ra = rankHit(a, queryLower);
    const rb = rankHit(b, queryLower);
    if (ra !== rb) return ra - rb;
    if (a.name.length !== b.name.length) return a.name.length - b.name.length;
    return a.relativePath.length - b.relativePath.length;
  });
}

function searchOneRootRipgrep(
  root: string,
  query: string,
  exclude: Set<string>,
  maxResults: number
): Promise<{ ok: boolean; paths: string[] }> {
  return new Promise((resolve) => {
    // cwd = project root so exclude globs like `!**/tmp/**` cannot match a
    // host path prefix (e.g. searching a tree that lives under /tmp).
    // Do NOT use --iglob for the query: an include glob overrides exclude
    // globs in rg, so `tmp/Keep.ts` would leak through. Filter the query
    // against streamed paths instead.
    const queryLower = query.toLowerCase();
    const args = [
      '--files',
      '--hidden',
      '--no-ignore',
      '--no-messages',
      '--max-depth',
      String(MAX_SEARCH_DEPTH + 1),
      ...[...exclude].flatMap((d) => ['--glob', `!${d}/**`, '--glob', `!**/${d}/**`]),
      '--',
      '.',
    ];

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('rg', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolve({ ok: false, paths: [] });
      return;
    }

    const paths: string[] = [];
    let buffer = '';
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, paths });
    };

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      finish(paths.length > 0);
    }, RG_TIMEOUT_MS);

    child.on('error', () => finish(false));

    child.stdout?.setEncoding('utf-8');
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const rel = line.replace(/^\.\//, '');
        const name = path.basename(rel);
        if (!name.toLowerCase().includes(queryLower) && !rel.toLowerCase().includes(queryLower)) {
          continue;
        }
        const abs = path.isAbsolute(line) ? line : path.join(root, line);
        paths.push(abs);
        if (paths.length >= maxResults) {
          try { child.kill(); } catch { /* already gone */ }
          break;
        }
      }
    });

    child.on('close', (code) => {
      // rg: 0 = matches, 1 = no matches, 2 = error.
      finish(!(code === 2 && paths.length === 0));
    });
  });
}

async function searchFilenamesRipgrep(
  roots: ResolvedRoot[],
  query: string,
  exclude: Set<string>,
  maxResults: number
): Promise<{ ok: boolean; paths: string[] }> {
  const paths: string[] = [];
  let anyOk = false;
  for (const root of roots) {
    if (paths.length >= maxResults) break;
    const result = await searchOneRootRipgrep(root.resolved, query, exclude, maxResults - paths.length);
    if (result.ok) {
      anyOk = true;
      paths.push(...result.paths);
    }
  }
  return { ok: anyOk, paths };
}

async function walkForFiles(
  dirPath: string,
  queryLower: string,
  exclude: Set<string>,
  acc: string[],
  maxResults: number,
  depth: number
): Promise<void> {
  if (acc.length >= maxResults || depth > MAX_SEARCH_DEPTH) return;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  const subdirs: string[] = [];
  for (const entry of entries) {
    if (acc.length >= maxResults) return;
    if (entry.isDirectory()) {
      if (exclude.has(entry.name)) continue;
      subdirs.push(path.join(dirPath, entry.name));
      continue;
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    if (!entry.name.toLowerCase().includes(queryLower)) continue;
    acc.push(path.join(dirPath, entry.name));
  }

  for (const sub of subdirs) {
    if (acc.length >= maxResults) return;
    await walkForFiles(sub, queryLower, exclude, acc, maxResults, depth + 1);
  }
}

export async function searchFilesGlobal(opts: SearchFilesGlobalOptions): Promise<GlobalFileHit[]> {
  const query = (opts.query || '').trim();
  if (query.length < FILE_SEARCH_MIN_QUERY) return [];

  const limit = Math.max(1, Math.min(opts.limit ?? FILE_SEARCH_MAX_RESULTS, FILE_SEARCH_MAX_RESULTS));
  const exclude = excludeDirsFromInput(opts.exclude, true);
  const areas = opts.areas ?? loadAreas();
  const roots = gatherRoots(areas);
  if (roots.length === 0) return [];

  const queryLower = query.toLowerCase();
  const seen = new Set<string>();
  const hits: GlobalFileHit[] = [];

  const consume = (filePath: string) => {
    const resolved = path.resolve(filePath);
    if (seen.has(resolved)) return;
    const root = matchRoot(resolved, roots);
    if (!root) return;
    seen.add(resolved);
    hits.push(toHit(resolved, root));
  };

  const rg = await searchFilenamesRipgrep(roots, query, exclude, limit);
  if (rg.ok) {
    for (const p of rg.paths) consume(p);
  } else {
    const walked: string[] = [];
    for (const root of roots) {
      if (walked.length >= limit * 4) break;
      await walkForFiles(root.resolved, queryLower, exclude, walked, limit * 4, 0);
    }
    for (const p of walked) consume(p);
  }

  return sortHits(hits, queryLower).slice(0, limit);
}
