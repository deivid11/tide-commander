/**
 * Folder / git-repo discovery for Spotlight search.
 *
 * GET /api/folders/search?q=<query>
 *   Scans a bounded set of sensible roots (existing agent/building cwds, area
 *   directories, and their in-home parents — or the home directory as a
 *   fallback) for directories whose name matches the query, flagging which are
 *   git repositories. The scan is depth/result/visit-capped so it never walks
 *   the whole filesystem. Returns { folders: [{ path, name, isGitRepo, gitBranch? }] }.
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadAgents, loadBuildings, loadAreas } from '../data/index.js';
import { createLogger } from '../utils/logger.js';
import { isAbsolutePathCrossPlatform, toPosixSeparators } from './files.js';

const log = createLogger('Routes');
const router = Router();

// --- Scan bounds (keep the walk fast; never enumerate the whole disk) --------
const MIN_QUERY = 2;          // ignore 0–1 char queries (would match everything)
const MAX_DEPTH = 3;          // levels to descend below each root
const MAX_RESULTS = 50;       // cap returned folders
const MAX_ROOTS = 12;         // cap distinct roots scanned per request
const MAX_VISITED_DIRS = 4000; // hard ceiling on directories read per request

// Heavy/uninteresting dirs we never descend into or list.
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'vendor', '.next', 'target',
  '.cache', '.turbo', '.venv', '__pycache__', '.svn', '.hg', 'bin', 'obj',
]);

export interface FolderResult {
  path: string;
  name: string;
  isGitRepo: boolean;
  gitBranch?: string;
}

// Absolute, resolved, no trailing slash — or null if not an absolute path.
// Windows-aware: `C:\…` / UNC paths are absolute even when the server is POSIX.
function normalizeDir(p: string | undefined): string | null {
  if (!p || !isAbsolutePathCrossPlatform(p)) return null;
  return path.resolve(p);
}

// True when `child` is the same as or nested inside `parent`.
function isInside(child: string, parent: string): boolean {
  if (child === parent) return true;
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// A directory is a git repo if it contains a `.git` entry (dir for a normal
// clone, file for a worktree/submodule).
function isGitRepo(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, '.git'));
  } catch {
    return false;
  }
}

// Cheap current-branch read from `.git/HEAD` (only works for a real .git dir).
function readGitBranch(dir: string): string | undefined {
  try {
    const head = fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf-8').trim();
    const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    if (ref) return ref[1];
    if (/^[0-9a-f]{7,40}$/i.test(head)) return head.slice(0, 7); // detached HEAD
  } catch {
    /* .git is a file (worktree) or unreadable — no branch info */
  }
  return undefined;
}

// Build the bounded set of roots to scan. Prefers configured locations (agent
// and building cwds, area directories) plus their parents (so sibling repos are
// discoverable), restricting parent-escalation to the user's home so a scan can
// never climb to broad system roots. Falls back to the home directory.
function gatherSearchRoots(): string[] {
  const home = os.homedir();
  const explicit = new Set<string>();

  for (const a of loadAgents()) {
    const n = normalizeDir(a.cwd);
    if (n) explicit.add(n);
  }
  for (const b of loadBuildings()) {
    const n = normalizeDir(b.cwd);
    if (n) explicit.add(n);
  }
  for (const area of loadAreas()) {
    for (const d of area.directories || []) {
      const n = normalizeDir(d);
      if (n) explicit.add(n);
    }
  }

  // Add the parent of each configured dir (surfaces sibling projects), but only
  // when the parent is the home dir or inside it.
  const withParents = new Set(explicit);
  for (const dir of explicit) {
    const parent = path.dirname(dir);
    if (parent !== dir && (parent === home || parent.startsWith(home + path.sep))) {
      withParents.add(parent);
    }
  }

  let roots = Array.from(withParents);
  // Drop roots nested inside another root — scan the common ancestor once.
  roots = roots.filter((r) => !roots.some((other) => other !== r && isInside(r, other)));

  if (roots.length === 0) roots = [home];

  // Shallower roots first (broader coverage) before capping.
  roots.sort((a, b) => a.split(path.sep).length - b.split(path.sep).length);
  return roots.slice(0, MAX_ROOTS);
}

function searchFolders(query: string): FolderResult[] {
  const q = query.trim().toLowerCase();
  const roots = gatherSearchRoots();
  const results: FolderResult[] = [];
  const seen = new Set<string>();
  let visited = 0;

  const record = (dir: string, name: string) => {
    if (seen.has(dir)) return;
    if (!name.toLowerCase().includes(q)) return;
    seen.add(dir);
    const gitRepo = isGitRepo(dir);
    results.push({
      path: toPosixSeparators(dir), // API boundary: '/'-separated for the browser
      name,
      isGitRepo: gitRepo,
      gitBranch: gitRepo ? readGitBranch(dir) : undefined,
    });
  };

  const walk = (dir: string, depth: number) => {
    if (results.length >= MAX_RESULTS || depth > MAX_DEPTH || visited >= MAX_VISITED_DIRS) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable (permissions) — skip
    }
    visited++;
    for (const e of entries) {
      if (results.length >= MAX_RESULTS) return;
      if (!e.isDirectory()) continue;
      const name = e.name;
      if (name.startsWith('.')) continue; // skip dotdirs (.git is detected, not listed)
      if (IGNORE_DIRS.has(name)) continue;
      const full = path.join(dir, name);
      record(full, name);
      walk(full, depth + 1);
    }
  };

  for (const root of roots) {
    if (results.length >= MAX_RESULTS) break;
    record(root, path.basename(root)); // the root itself can match
    walk(root, 1);
  }

  // Git repos first, then name-prefix matches, then shorter paths.
  results.sort((a, b) => {
    if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1;
    const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
    const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.path.length - b.path.length;
  });

  return results.slice(0, MAX_RESULTS);
}

// GET /api/folders/search?q=<query>
router.get('/search', (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    if (q.trim().length < MIN_QUERY) {
      res.json({ folders: [] });
      return;
    }
    res.json({ folders: searchFolders(q) });
  } catch (err: any) {
    log.error(' Folder search failed:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
