/**
 * Files Routes
 * REST API endpoints for file operations
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { execFile, execFileSync, execSync, spawn } from 'child_process';
import * as os from 'os';
import { pathToFileURL } from 'url';
import { logger } from '../utils/logger.js';
import { loadAreas } from '../data/index.js';
import { detectRunnerType, mightBeTestFile, mightBeVitestFile, mightBePhpTestFile } from '../services/test-runner-service.js';
import type { TestRunnerType } from '../../shared/types.js';
import { DEFAULT_FILE_SEARCH_EXCLUDE_DIRS, parseExcludeDirNames } from '../../shared/file-search.js';
import { searchFilesGlobal, FILE_SEARCH_MIN_QUERY } from '../services/global-file-search.js';

const log = logger.files;

// Get or create temp directory for tide-commander uploads. Exported so other
// modules (attachment-downloader, attachment-janitor) put their files under the
// same root that Express already serves statically at `/uploads/`.
export const TEMP_DIR = path.join(os.tmpdir(), 'tide-commander-uploads');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}
log.log(` Temp upload directory: ${TEMP_DIR}`);

// File entry for directory listing
interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: Date;
  extension: string;
}

// Tree node for recursive listing
interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  extension: string;
  children?: TreeNode[];
  // Set on directories that belong to a runnable test project (e.g. 'maven'),
  // so the file explorer can offer "Run Tests" on the right folders.
  runnerType?: TestRunnerType;
}

const router = Router();

function looksLikeBinaryBuffer(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  // NUL catches the common case; replacement characters catch compressed or
  // media formats that contain no NUL in their first block but are not UTF-8.
  return sample.includes(0) || buffer.toString('utf-8').includes('\uFFFD');
}

/**
 * Content type for every binary the file routes stream. Shared by /binary,
 * /by-path and /git-original-binary — the client turns these responses straight
 * into Blobs, and a media element refuses an `application/octet-stream` blob, so
 * a missing entry here shows up as "this audio won't play" in the viewer.
 */
const BINARY_MIME_TYPES: Record<string, string> = {
  // images
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  // documents
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  // archives
  '.zip': 'application/zip', '.tar': 'application/x-tar', '.gz': 'application/gzip',
  // audio
  '.wav': 'audio/wav', '.wave': 'audio/wav', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg',
  '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.weba': 'audio/webm', '.aif': 'audio/aiff', '.aiff': 'audio/aiff',
  // video
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
  '.ogv': 'video/ogg', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  // 3D / fabrication
  '.stl': 'model/stl', '.fcstd': 'application/vnd.freecad',
  '.glb': 'model/gltf-binary', '.gbl': 'model/gltf-binary',
  '.gcode': 'text/x-gcode', '.gco': 'text/x-gcode',
};

function binaryContentTypeForExtension(extension: string): string {
  return BINARY_MIME_TYPES[extension] || 'application/octet-stream';
}

/**
 * Parse a single `Range: bytes=…` header against a known file size.
 *
 * Returns null when there is nothing to honour (absent/unsupported/multi-range
 * header — the caller replies 200 with the whole file), 'unsatisfiable' for a
 * range that starts past the end (416), or the inclusive byte window to stream.
 */
export function parseByteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  let start: number;
  let end: number;
  if (!rawStart) {
    // Suffix form ("bytes=-500") = the LAST n bytes.
    const suffixLength = Number(rawEnd);
    if (suffixLength <= 0) return 'unsatisfiable';
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start >= size) return 'unsatisfiable';
  end = Math.min(end, size - 1);
  if (end < start) return 'unsatisfiable';
  return { start, end };
}

// Windows absolute paths — drive-letter (`C:\…` or `C:/…`) and UNC (`\\server\share`)
// — are NOT recognized by path.isAbsolute() when the server runs on POSIX. Without
// this, a configured Windows path is misclassified as relative and resolved into
// the server cwd (producing a bogus path). Detect them explicitly so they pass
// through unchanged on any platform. On Linux the path simply won't exist (honest
// 404) rather than silently resolving somewhere inside cwd.
const WINDOWS_ABSOLUTE_RE = /^(?:[A-Za-z]:[\\/]|\\\\)/;
export function isAbsolutePathCrossPlatform(p: string): boolean {
  return path.isAbsolute(p) || WINDOWS_ABSOLUTE_RE.test(p);
}

// Normalize a path to forward-slash separators for the API boundary. The browser
// assumes '/' when it splits paths for trees/breadcrumbs, so every path we return
// must be canonical '/'. Node on Windows accepts '/' in fs calls, so a normalized
// path still round-trips when the client sends it back. No-op on POSIX (no '\').
export function toPosixSeparators(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Resolve a path query against an optional baseDir. Absolute paths pass through
 * unchanged; relative paths are resolved via path.resolve(baseDir, rawPath).
 * If no usable baseDir is supplied, the server's own cwd is used so file-modal
 * links like `../../../tmp/foo.md` open even from contexts without an explicit
 * agent cwd (e.g. spotlight, flat view). The client should pass the agent cwd
 * as baseDir whenever it has one, which takes precedence.
 */
export function resolveAndValidateFilePath(
  rawPath: string | undefined,
  baseDir?: string,
  fallbackBaseDir: string = process.cwd(),
): { ok: true; path: string } | { ok: false; status: number; error: string } {
  if (!rawPath) {
    return { ok: false, status: 400, error: 'Missing path parameter' };
  }
  if (isAbsolutePathCrossPlatform(rawPath)) {
    return { ok: true, path: rawPath };
  }
  const effectiveBase = baseDir && isAbsolutePathCrossPlatform(baseDir) ? baseDir : fallbackBaseDir;
  if (!isAbsolutePathCrossPlatform(effectiveBase)) {
    return {
      ok: false,
      status: 400,
      error: 'Cannot resolve relative path: no absolute baseDir and server cwd is not absolute',
    };
  }
  return { ok: true, path: path.resolve(effectiveBase, rawPath) };
}

function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function validateRevealPath(rawPath: unknown): { ok: true; path: string } | { ok: false; status: number; error: string } {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    return { ok: false, status: 400, error: 'Missing path parameter' };
  }

  if (!isAbsolutePathCrossPlatform(rawPath)) {
    return { ok: false, status: 400, error: 'Path must be absolute' };
  }

  let realPath: string;
  try {
    realPath = fs.realpathSync(rawPath);
  } catch {
    return { ok: false, status: 404, error: 'File not found' };
  }

  const allowedRoots = [process.cwd(), os.homedir()]
    .filter(Boolean)
    .map(rootPath => {
      try {
        return fs.realpathSync(rootPath);
      } catch {
        return path.resolve(rootPath);
      }
    });

  if (!allowedRoots.some(rootPath => isPathInsideRoot(realPath, rootPath))) {
    return { ok: false, status: 400, error: 'Path is outside allowed roots' };
  }

  return { ok: true, path: realPath };
}

function execFileAsync(command: string, args: string[], timeout: number = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, windowsHide: true }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function revealPathInFileExplorer(filePath: string): Promise<string> {
  if (process.platform === 'darwin') {
    await execFileAsync('open', ['-R', filePath]);
    return 'open -R';
  }

  if (process.platform === 'win32') {
    await execFileAsync('explorer.exe', [`/select,${filePath}`]);
    return 'explorer.exe /select';
  }

  if (process.platform === 'linux') {
    const fileUri = pathToFileURL(filePath).toString();
    try {
      await execFileAsync('dbus-send', [
        '--session',
        '--dest=org.freedesktop.FileManager1',
        '--type=method_call',
        '/org/freedesktop/FileManager1',
        'org.freedesktop.FileManager1.ShowItems',
        `array:string:${fileUri}`,
        'string:',
      ], 3000);
      return 'org.freedesktop.FileManager1.ShowItems';
    } catch (err) {
      log.warn(' FileManager1 reveal failed, falling back to xdg-open:', err);
      const stat = fs.statSync(filePath);
      const directoryPath = stat.isDirectory() ? filePath : path.dirname(filePath);
      await execFileAsync('xdg-open', [directoryPath]);
      return 'xdg-open';
    }
  }

  throw new Error(`Unsupported platform: ${process.platform}`);
}

// Cache of (requested path → resolved absolute path) for successful fallback
// resolutions. Avoids repeating the walk-up search for the same stale path.
const resolvedPathCache = new Map<string, { path: string; strategy: ResolutionStrategy }>();
const RESOLVED_CACHE_MAX = 500;

function rememberResolution(key: string, found: string, strategy: ResolutionStrategy): void {
  if (resolvedPathCache.size >= RESOLVED_CACHE_MAX) {
    const firstKey = resolvedPathCache.keys().next().value;
    if (firstKey !== undefined) resolvedPathCache.delete(firstKey);
  }
  resolvedPathCache.set(key, { path: found, strategy });
}

export type ResolutionStrategy =
  | 'exact'
  | 'cached'
  | 'parent-walk'
  | 'git-root'
  | 'suffix-match'
  | 'node-modules-match'
  | 'area-root'
  | 'area-suffix-match';

interface AreaDir { areaId: string; areaName: string; dir: string }
const AREA_DIR_TTL_MS = 30_000;
const AREA_DIR_MAX_AREAS = 5;
const AREA_DIR_MAX_PER_AREA = 10;
let areaDirCache: { entries: AreaDir[]; expiresAt: number } | null = null;

export function _resetAreaDirCacheForTests(): void {
  areaDirCache = null;
}

// Test seam: lets unit tests inject a deterministic area list without writing
// to ~/.local/share/tide-commander/areas.json. Production code uses loadAreas().
let areaLoaderForTests: (() => Array<{ id: string; name: string; directories?: string[] }>) | null = null;
export function _setAreaLoaderForTests(fn: typeof areaLoaderForTests): void {
  areaLoaderForTests = fn;
  areaDirCache = null;
}

function getAreaDirs(now: number = Date.now()): AreaDir[] {
  if (areaDirCache && areaDirCache.expiresAt > now) return areaDirCache.entries;
  const entries: AreaDir[] = [];
  let areas: Array<{ id: string; name: string; directories?: string[] }>;
  try {
    areas = areaLoaderForTests ? areaLoaderForTests() : loadAreas();
  } catch { areas = []; }
  let areaCount = 0;
  for (const area of areas) {
    if (areaCount >= AREA_DIR_MAX_AREAS) break;
    const dirs = Array.isArray(area.directories) ? area.directories : [];
    let perArea = 0;
    for (const raw of dirs) {
      if (perArea >= AREA_DIR_MAX_PER_AREA) break;
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const abs = path.isAbsolute(raw) ? raw : null;
      if (!abs) continue;
      entries.push({ areaId: area.id, areaName: area.name, dir: abs.replace(/\/+$/, '') });
      perArea++;
    }
    if (perArea > 0) areaCount++;
  }
  areaDirCache = { entries, expiresAt: now + AREA_DIR_TTL_MS };
  return entries;
}

// Recursive-walk cache for suffix-match: rooted at an absolute directory, value
// is the flat list of file absolute paths under that root. TTL keeps it warm
// across rapid clicks but lets edits propagate. Keys evict on TTL only — small
// LRU cap as a memory ceiling.
const SUFFIX_WALK_TTL_MS = 30_000;
const SUFFIX_WALK_MAX_ROOTS = 16;
const SUFFIX_WALK_MAX_DEPTH = 6;
const SUFFIX_WALK_IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', 'vendor', '.next', 'target',
  '.cache', '.turbo', '.venv', '__pycache__',
]);

interface SuffixWalkEntry { files: string[]; expiresAt: number }
const suffixWalkCache = new Map<string, SuffixWalkEntry>();

export function _resetSuffixWalkCacheForTests(): void {
  suffixWalkCache.clear();
}

function listFilesShallow(root: string, depth: number): string[] {
  if (depth > SUFFIX_WALK_MAX_DEPTH) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch { return []; }
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.') && SUFFIX_WALK_IGNORE.has(e.name)) continue;
    if (SUFFIX_WALK_IGNORE.has(e.name)) continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      out.push(...listFilesShallow(full, depth + 1));
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function getWalkedFiles(root: string, now: number = Date.now()): string[] {
  const cached = suffixWalkCache.get(root);
  if (cached && cached.expiresAt > now) return cached.files;
  const files = listFilesShallow(root, 0);
  if (suffixWalkCache.size >= SUFFIX_WALK_MAX_ROOTS) {
    const firstKey = suffixWalkCache.keys().next().value;
    if (firstKey !== undefined) suffixWalkCache.delete(firstKey);
  }
  suffixWalkCache.set(root, { files, expiresAt: now + SUFFIX_WALK_TTL_MS });
  return files;
}

function findBySuffixMatch(rawPath: string, walkRoot: string): string | null {
  const segments = rawPath.replace(/^\/+/, '').split(path.sep).filter(Boolean);
  if (segments.length === 0) return null;
  const files = getWalkedFiles(walkRoot);
  if (files.length === 0) return null;

  // Try the longest possible suffix first (most specific), shrinking down to
  // basename. The first suffix length with a UNIQUE hit wins — ambiguous suffix
  // means we'd guess wrong, so fall through.
  for (let take = Math.min(segments.length, 4); take >= 1; take--) {
    const suffix = path.sep + segments.slice(-take).join(path.sep);
    const matches = files.filter(f => f.endsWith(suffix));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) continue;
  }
  return null;
}

// The suffix walk skips node_modules for cost, but locally linked / installed
// packages (e.g. a monorepo's own `tide-api`) legitimately live there — so a
// path like `tide-api/src/api-core.js` can only be found under a node_modules
// tree. Instead of walking all of node_modules (huge), we locate WHERE the
// node_modules dirs are (shallow — they sit at workspace roots, and we never
// descend INTO one) and then probe the requested path's tail-slices under each.
const NODE_MODULES_SCAN_MAX_DEPTH = 4;
const NODE_MODULES_MAX_DIRS = 24;

function collectNodeModulesDirs(base: string, depth: number, out: string[]): void {
  if (out.length >= NODE_MODULES_MAX_DIRS || depth > NODE_MODULES_SCAN_MAX_DEPTH) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === 'node_modules') {
      out.push(path.join(base, e.name));
      if (out.length >= NODE_MODULES_MAX_DIRS) return;
      continue; // don't recurse into node_modules; tail-slice probing covers depth
    }
    if (e.name.startsWith('.') || SUFFIX_WALK_IGNORE.has(e.name)) continue;
    collectNodeModulesDirs(path.join(base, e.name), depth + 1, out);
    if (out.length >= NODE_MODULES_MAX_DIRS) return;
  }
}

// Probe the requested path (and each of its tail-slices) under every
// node_modules dir found beneath `base`. Uses the shared tryCandidate so hits
// are validated + recorded in `tried`. Returns the first existing file.
function findInNodeModules(
  rawPath: string,
  base: string,
  tryCandidate: (p: string) => string | null,
): string | null {
  if (!fs.existsSync(base)) return null;
  const segments = rawPath.replace(/^\/+/, '').split(path.sep).filter(Boolean);
  if (segments.length === 0) return null;
  const dirs: string[] = [];
  collectNodeModulesDirs(base, 0, dirs);
  for (const nm of dirs) {
    for (let i = 0; i < segments.length; i++) {
      const hit = tryCandidate(path.join(nm, ...segments.slice(i)));
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Resolve a requested file path to an existing file on disk, with fallbacks.
 * Tries (in order):
 *   1. exact              — resolved by resolveAndValidateFilePath() (absolute or baseDir+path)
 *   2. cached             — previously-resolved entry for the same requested key
 *   3. parent-walk        — tail slices anchored at baseDir AND each ancestor up to /
 *   4. git-root           — tail slices anchored at the git toplevel from baseDir
 *   5. suffix-match       — depth-limited walk of baseDir, unique trailing-segment match
 *   6. node-modules-match — tail slices probed under each node_modules dir beneath baseDir
 *   7. area-root          — verbatim join against each user-configured area directory
 *   8. area-suffix-match  — same depth-limited walk but rooted at each area directory
 *   9. node-modules-match — same node_modules probe but rooted at each area directory
 * On miss, returns the absolute path requested AND the list of paths tried so
 * the caller can surface a clear, debuggable error.
 */
export function findFileWithFallbacks(
  rawPath: string | undefined,
  baseDir: string | undefined,
):
  | { ok: true; path: string; strategy: ResolutionStrategy; areaId?: string; areaName?: string }
  | { ok: false; status: number; error: string; requested?: string; tried?: string[] } {
  if (!rawPath) {
    return { ok: false, status: 400, error: 'Missing path parameter' };
  }
  const resolution = resolveAndValidateFilePath(rawPath, baseDir);
  if (!resolution.ok) {
    return resolution;
  }

  // A path that resolves directly to an existing directory is a "browse this
  // folder" request, not a missing file. Short-circuit here so we return a
  // clear directory signal instead of running the whole fallback walk — which
  // rejects the directory at every candidate (tryCandidate skips directories)
  // and would surface dozens of futile "tried" locations before 404-ing.
  try {
    if (fs.existsSync(resolution.path) && fs.statSync(resolution.path).isDirectory()) {
      return { ok: false, status: 400, error: 'Path is a directory', requested: resolution.path };
    }
  } catch { /* stat failed (perms/broken symlink) — fall through to normal resolution */ }

  const tried: string[] = [];
  const seen = new Set<string>();
  const tryCandidate = (p: string): string | null => {
    if (seen.has(p)) return null;
    seen.add(p);
    tried.push(p);
    try {
      if (fs.existsSync(p) && !fs.statSync(p).isDirectory()) return p;
    } catch { /* permission denied, broken symlink — keep trying */ }
    return null;
  };

  const direct = tryCandidate(resolution.path);
  if (direct) return { ok: true, path: direct, strategy: 'exact' };

  const cached = resolvedPathCache.get(rawPath);
  if (cached) {
    const hit = tryCandidate(cached.path);
    if (hit) return { ok: true, path: hit, strategy: 'cached' };
    resolvedPathCache.delete(rawPath);
  }

  const absBase = baseDir && path.isAbsolute(baseDir) ? baseDir : null;
  if (absBase) {
    // Strip leading slashes so absolute and relative requested paths share one
    // segment list. Walking the tail anchors `<a>/<b>/<c>` not just at baseDir
    // but also at `<b>/<c>` and `<c>` against each ancestor — the file is
    // found regardless of which slice of the path moved.
    const tailSegments = rawPath.replace(/^\/+/, '').split(path.sep).filter(Boolean);
    let cur = absBase;
    // Bound the climb so a deep baseDir doesn't search the whole filesystem.
    for (let depth = 0; depth < 12; depth++) {
      for (let i = 0; i < tailSegments.length; i++) {
        const candidate = path.join(cur, ...tailSegments.slice(i));
        const hit = tryCandidate(candidate);
        if (hit) {
          rememberResolution(rawPath, hit, 'parent-walk');
          return { ok: true, path: hit, strategy: 'parent-walk' };
        }
      }
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }

    try {
      if (fs.existsSync(absBase)) {
        const gitTop = execSync('git rev-parse --show-toplevel', {
          cwd: absBase,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        if (gitTop) {
          for (let i = 0; i < tailSegments.length; i++) {
            const candidate = path.join(gitTop, ...tailSegments.slice(i));
            const hit = tryCandidate(candidate);
            if (hit) {
              rememberResolution(rawPath, hit, 'git-root');
              return { ok: true, path: hit, strategy: 'git-root' };
            }
          }
        }
      }
    } catch { /* baseDir is not in a git repo — skip */ }

    // Last-resort suffix match: cheap depth-limited recursive walk, cached for
    // 30s. Helps when the requested path's segments don't anchor anywhere via
    // parent-walk (e.g. file moved between dirs while UI still cites old path).
    try {
      if (fs.existsSync(absBase)) {
        const suffixHit = findBySuffixMatch(rawPath, absBase);
        if (suffixHit) {
          tried.push(`<suffix-match in ${absBase}>`);
          rememberResolution(rawPath, suffixHit, 'suffix-match');
          return { ok: true, path: suffixHit, strategy: 'suffix-match' };
        }
      }
    } catch { /* walk failed entirely — fall through to node_modules/area strategies */ }

    // node_modules-anchored: the suffix walk above skips node_modules, so a
    // locally-linked package path (e.g. tide-api/src/api-core.js) is only
    // reachable here.
    try {
      const nmHit = findInNodeModules(rawPath, absBase, tryCandidate);
      if (nmHit) {
        rememberResolution(rawPath, nmHit, 'node-modules-match');
        return { ok: true, path: nmHit, strategy: 'node-modules-match' };
      }
    } catch { /* scan failed — fall through to area strategies */ }
  }

  // Area strategies: try the user's configured area directories. Runs whether
  // or not baseDir is set — area paths are independent. Capped to keep cold
  // requests cheap (5 areas × 10 dirs).
  const areaDirs = getAreaDirs();
  const tailSegmentsForArea = rawPath.replace(/^\/+/, '').split(path.sep).filter(Boolean);

  for (const { areaId, areaName, dir } of areaDirs) {
    if (!fs.existsSync(dir)) continue;
    // area-root: try the requested path joined verbatim against the area dir,
    // plus every tail-slice (so partial-prefix paths still resolve).
    for (let i = 0; i < tailSegmentsForArea.length; i++) {
      const candidate = path.join(dir, ...tailSegmentsForArea.slice(i));
      const hit = tryCandidate(candidate);
      if (hit) {
        rememberResolution(rawPath, hit, 'area-root');
        return { ok: true, path: hit, strategy: 'area-root', areaId, areaName };
      }
    }
  }

  for (const { areaId, areaName, dir } of areaDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const suffixHit = findBySuffixMatch(rawPath, dir);
      if (suffixHit) {
        tried.push(`<area-suffix-match in ${dir}>`);
        rememberResolution(rawPath, suffixHit, 'area-suffix-match');
        return {
          ok: true,
          path: suffixHit,
          strategy: 'area-suffix-match',
          areaId,
          areaName,
        };
      }
    } catch { /* walk failed for this area — try next */ }
  }

  // node_modules-anchored search within each area dir (same reasoning as the
  // baseDir pass above: locally-linked packages under an area's node_modules).
  for (const { areaId, areaName, dir } of areaDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const nmHit = findInNodeModules(rawPath, dir, tryCandidate);
      if (nmHit) {
        rememberResolution(rawPath, nmHit, 'node-modules-match');
        return { ok: true, path: nmHit, strategy: 'node-modules-match', areaId, areaName };
      }
    } catch { /* scan failed for this area — try next */ }
  }

  return {
    ok: false,
    status: 404,
    error: 'File not found',
    requested: resolution.path,
    tried,
  };
}

// Prevent browser from caching git-related GET responses (status, diff, branch, etc.)
// Without this, browsers may serve stale cached data — e.g. deleted files still appearing.
router.use('/git-*path', (_req: Request, res: Response, next: import('express').NextFunction) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  next();
});

// GET /api/files/read - Read file contents
router.get('/read', async (req: Request, res: Response) => {
  try {
    const resolution = findFileWithFallbacks(
      req.query.path as string | undefined,
      req.query.baseDir as string | undefined,
    );
    if (!resolution.ok) {
      const body: Record<string, unknown> = { error: resolution.error };
      if (resolution.requested) body.path = resolution.requested;
      if (resolution.tried) body.triedRoots = resolution.tried;
      res.status(resolution.status).json(body);
      return;
    }
    const filePath = resolution.path;

    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      res.status(400).json({ error: 'Path is a directory', path: filePath });
      return;
    }

    // Limit file size to 1MB
    if (stats.size > 1024 * 1024) {
      res.status(400).json({ error: 'File too large (max 1MB)' });
      return;
    }

    const fileBuffer = fs.readFileSync(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const filename = path.basename(filePath);

    const base = {
      path: filePath,
      filename,
      extension,
      size: stats.size,
      modified: stats.mtime,
      strategy: resolution.strategy,
      areaId: resolution.areaId,
      areaName: resolution.areaName,
    };

    if (looksLikeBinaryBuffer(fileBuffer)) {
      res.status(415).json({ ...base, binary: true, error: 'Binary file cannot be read as text' });
      return;
    }

    const content = fileBuffer.toString('utf-8');

    // Preview mode (Ctrl+hover tooltip in the terminal): return only the
    // requested line window. Reading the file is cheap; shipping a 1MB body
    // over the wire on every hover is not.
    const previewLines = Number(req.query.previewLines);
    if (Number.isFinite(previewLines) && previewLines > 0) {
      const allLines = content.split('\n');
      const rawOffset = Number(req.query.previewOffset);
      const startLine = Number.isFinite(rawOffset) && rawOffset >= 1
        ? Math.min(Math.floor(rawOffset), Math.max(allLines.length, 1))
        : 1;
      const slice = allLines.slice(startLine - 1, startLine - 1 + Math.floor(previewLines));
      res.json({
        ...base,
        content: slice.join('\n'),
        preview: {
          startLine,
          totalLines: allLines.length,
          truncated: startLine - 1 + slice.length < allLines.length,
        },
      });
      return;
    }

    res.json({ ...base, content });
  } catch (err: any) {
    log.error(' Failed to read file:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/resolve - Find a file by name/partial path within a project directory
router.get('/resolve', async (req: Request, res: Response) => {
  try {
    const filename = req.query.name as string;
    const searchRoot = req.query.root as string;

    if (!filename) {
      res.status(400).json({ error: 'Missing name parameter' });
      return;
    }

    if (!searchRoot || !path.isAbsolute(searchRoot)) {
      res.status(400).json({ error: 'Missing or invalid root parameter (must be absolute)' });
      return;
    }

    if (!fs.existsSync(searchRoot)) {
      res.status(404).json({ error: 'Root directory not found' });
      return;
    }

    const results: TreeNode[] = [];
    const basename = path.basename(filename);
    const hasPathSeparator = filename.includes('/');

    // Check well-known locations first (e.g., .claude/ directory for config files)
    const wellKnownPaths = [
      path.join(searchRoot, '.claude', basename),
    ];
    for (const wkPath of wellKnownPaths) {
      try {
        if (fs.existsSync(wkPath)) {
          const stats = fs.statSync(wkPath);
          results.push({
            name: path.basename(wkPath),
            path: wkPath,
            isDirectory: stats.isDirectory(),
            size: stats.size,
            extension: stats.isDirectory() ? '' : path.extname(wkPath).toLowerCase(),
          });
        }
      } catch { /* skip */ }
    }

    // Search for files matching the basename (searchFilesAsync may re-find .claude/ files)
    const existingPaths = new Set(results.map(r => r.path));
    const searchResults: TreeNode[] = [];
    await searchFilesAsync(searchRoot, basename.toLowerCase(), searchResults, 20);
    for (const r of searchResults) {
      if (!existingPaths.has(r.path)) results.push(r);
    }

    // If the query had path segments (e.g. "components/App.tsx"), rank results
    // that contain the full partial path higher
    if (hasPathSeparator) {
      const normalizedQuery = filename.replace(/^\.\//, '');
      results.sort((a, b) => {
        const aContains = a.path.includes(normalizedQuery) ? 1 : 0;
        const bContains = b.path.includes(normalizedQuery) ? 1 : 0;
        if (aContains !== bContains) return bContains - aContains;
        // Prefer files over directories
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? 1 : -1;
        // Shorter paths first (closer to project root = more likely the right file)
        return a.path.length - b.path.length;
      });
    } else {
      // Sort: exact basename match first, then files before dirs, then shorter paths
      results.sort((a, b) => {
        const aExact = a.name === basename ? 1 : 0;
        const bExact = b.name === basename ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? 1 : -1;
        return a.path.length - b.path.length;
      });
    }

    res.json({ results });
  } catch (err: any) {
    log.error(' Failed to resolve file:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/exists - Check if a file exists
router.get('/exists', async (req: Request, res: Response) => {
  try {
    const resolution = resolveAndValidateFilePath(
      req.query.path as string | undefined,
      req.query.baseDir as string | undefined,
    );
    if (!resolution.ok) {
      res.status(resolution.status).json({ error: resolution.error });
      return;
    }
    const filePath = resolution.path;

    const exists = fs.existsSync(filePath);
    res.json({ exists, path: filePath });
  } catch (err: any) {
    log.error(' Failed to check file existence:', err);
    res.status(500).json({ error: err.message });
  }
});

// Viewer metadata and model bytes must always reflect the file currently on
// disk. authFetch also requests `no-store`, but these response headers cover
// direct URLs, embedded previews, proxies, and browser revalidation.
router.use(['/info', '/binary'], (_req: Request, res: Response, next: import('express').NextFunction) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// GET /api/files/info - Get file info without content
router.get('/info', async (req: Request, res: Response) => {
  try {
    const resolution = findFileWithFallbacks(
      req.query.path as string | undefined,
      req.query.baseDir as string | undefined,
    );
    if (!resolution.ok) {
      const body: Record<string, unknown> = { error: resolution.error };
      if (resolution.requested) body.path = resolution.requested;
      if (resolution.tried) body.triedRoots = resolution.tried;
      res.status(resolution.status).json(body);
      return;
    }
    const filePath = resolution.path;

    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      res.status(400).json({ error: 'Path is a directory', path: filePath });
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const filename = path.basename(filePath);

    res.json({
      path: filePath,
      filename,
      extension,
      size: stats.size,
      modified: stats.mtime,
      strategy: resolution.strategy,
      areaId: resolution.areaId,
      areaName: resolution.areaName,
    });
  } catch (err: any) {
    log.error(' Failed to get file info:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/binary - Read binary file (for images, PDFs, downloads)
router.get('/binary', async (req: Request, res: Response) => {
  try {
    const resolution = findFileWithFallbacks(
      req.query.path as string | undefined,
      req.query.baseDir as string | undefined,
    );
    if (!resolution.ok) {
      const body: Record<string, unknown> = { error: resolution.error };
      if (resolution.requested) body.path = resolution.requested;
      if (resolution.tried) body.triedRoots = resolution.tried;
      res.status(resolution.status).json(body);
      return;
    }
    const filePath = resolution.path;
    const download = req.query.download === 'true';

    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      res.status(400).json({ error: 'Path is a directory', path: filePath });
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const filename = path.basename(filePath);

    const contentType = binaryContentTypeForExtension(extension);

    // The 50MB cap guards the callers that swallow the whole response (image,
    // model and PDF viewers). Audio/video are exempt: the element streams them
    // in Range-sized chunks, and a 300MB screen capture is an ordinary file to
    // play — rejecting it would be the surprising behaviour.
    const isStreamableMedia = contentType.startsWith('video/') || contentType.startsWith('audio/');
    if (!isStreamableMedia && stats.size > 50 * 1024 * 1024) {
      res.status(400).json({ error: 'File too large (max 50MB)' });
      return;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');

    if (download) {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    } else if (extension === '.pdf') {
      // Tell browsers to display the PDF inline rather than download it
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    }

    // Media elements scrub by asking for byte ranges rather than re-fetching the
    // whole file, so honour Range instead of always replying 200 with everything.
    const range = parseByteRange(req.headers.range, stats.size);
    if (range === 'unsatisfiable') {
      res.setHeader('Content-Range', `bytes */${stats.size}`);
      res.status(416).end();
      return;
    }
    if (range) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stats.size}`);
      res.setHeader('Content-Length', range.end - range.start + 1);
      fs.createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
      return;
    }

    res.setHeader('Content-Length', stats.size);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err: any) {
    log.error(' Failed to read binary file:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/list - List directory contents
router.get('/list', async (req: Request, res: Response) => {
  try {
    const resolution = resolveAndValidateFilePath(
      req.query.path as string | undefined,
      req.query.baseDir as string | undefined,
    );
    if (!resolution.ok) {
      res.status(resolution.status).json({ error: resolution.error });
      return;
    }
    const dirPath = resolution.path;

    if (!fs.existsSync(dirPath)) {
      res.status(404).json({ error: 'Directory not found', path: dirPath });
      return;
    }

    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
      res.status(400).json({ error: 'Path is not a directory' });
      return;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const files: FileEntry[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        const entryStats = fs.statSync(fullPath);
        files.push({
          name: entry.name,
          path: toPosixSeparators(fullPath),
          isDirectory: entry.isDirectory(),
          size: entryStats.size,
          modified: entryStats.mtime,
          extension: entry.isDirectory() ? '' : path.extname(entry.name).toLowerCase(),
        });
      } catch {
        // Skip files we can't stat (permission issues, etc.)
      }
    }

    // Sort: directories first, then alphabetically
    files.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    res.json({
      path: toPosixSeparators(dirPath),
      parent: toPosixSeparators(path.dirname(dirPath)),
      files,
    });
  } catch (err: any) {
    log.error(' Failed to list directory:', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper function to build tree recursively
function buildTree(
  dirPath: string,
  depth: number,
  maxDepth: number,
  runnerMemo: Map<string, TestRunnerType | undefined> = new Map(),
): TreeNode[] {
  if (depth > maxDepth) return [];

  const nodes: TreeNode[] = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip common non-essential directories (but keep 'build' for APK access)
      if (['node_modules', 'dist', '.git', '__pycache__', 'venv', '.venv'].includes(entry.name)) continue;

      const fullPath = path.join(dirPath, entry.name);

      try {
        const stats = fs.statSync(fullPath);
        const node: TreeNode = {
          name: entry.name,
          // API boundary: emit '/' so the browser can split/join the tree paths.
          // fs recursion below still uses the native `fullPath`.
          path: toPosixSeparators(fullPath),
          isDirectory: entry.isDirectory(),
          size: stats.size,
          extension: entry.isDirectory() ? '' : path.extname(entry.name).toLowerCase(),
        };

        if (entry.isDirectory()) {
          // Annotate testable folders so the explorer can offer "Run Tests".
          const runnerType = detectRunnerType(fullPath, runnerMemo);
          if (runnerType) node.runnerType = runnerType;
          node.children = buildTree(fullPath, depth + 1, maxDepth, runnerMemo);
        } else if (mightBeTestFile(entry.name) || mightBeVitestFile(entry.name) || mightBePhpTestFile(entry.name)) {
          // Annotate individual test files so "Run Tests" can scope to one class/file.
          const runnerType = detectRunnerType(fullPath, runnerMemo);
          if (runnerType) node.runnerType = runnerType;
        }

        nodes.push(node);
      } catch {
        // Skip files we can't access
      }
    }

    // Sort: directories first, then alphabetically
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  } catch {
    // Return empty if can't read directory
  }

  return nodes;
}

function ensureAbsoluteExistingPath(targetPath: string): string | null {
  if (!targetPath || !path.isAbsolute(targetPath)) return null;
  return fs.existsSync(targetPath) ? targetPath : null;
}

function resolveUniqueCopyPath(targetDir: string, sourceName: string): string {
  const extension = path.extname(sourceName);
  const baseName = extension ? sourceName.slice(0, -extension.length) : sourceName;

  let attempt = 0;
  while (true) {
    const suffix = attempt === 0 ? ' copy' : ` copy ${attempt + 1}`;
    const candidateName = `${baseName}${suffix}${extension}`;
    const candidatePath = path.join(targetDir, candidateName);
    if (!fs.existsSync(candidatePath)) return candidatePath;
    attempt++;
  }
}

function copyPathToDirectory(sourcePath: string, targetDir: string): string {
  const sourceName = path.basename(sourcePath);
  const directTarget = path.join(targetDir, sourceName);
  const destinationPath = fs.existsSync(directTarget)
    ? resolveUniqueCopyPath(targetDir, sourceName)
    : directTarget;

  const sourceStats = fs.statSync(sourcePath);
  if (sourceStats.isDirectory()) {
    const rel = path.relative(sourcePath, targetDir);
    const targetInsideSource = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
    if (targetInsideSource) {
      throw new Error('Cannot copy a folder into itself');
    }
    fs.cpSync(sourcePath, destinationPath, { recursive: true, force: false, errorOnExist: true });
  } else {
    fs.copyFileSync(sourcePath, destinationPath);
  }

  return destinationPath;
}

// GET /api/files/tree - Get recursive directory tree
router.get('/tree', async (req: Request, res: Response) => {
  try {
    const resolution = resolveAndValidateFilePath(
      req.query.path as string | undefined,
      req.query.baseDir as string | undefined,
    );
    if (!resolution.ok) {
      res.status(resolution.status).json({ error: resolution.error });
      return;
    }
    const dirPath = resolution.path;
    const maxDepth = parseInt(req.query.depth as string) || 5;

    if (!fs.existsSync(dirPath)) {
      res.status(404).json({ error: 'Directory not found', path: dirPath });
      return;
    }

    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
      res.status(400).json({ error: 'Path is not a directory' });
      return;
    }

    const tree = buildTree(dirPath, 0, maxDepth);
    // Also report the runner for the requested directory itself, so the client
    // can offer "Run Tests" on the tree's root node (built client-side).
    const runnerType = detectRunnerType(dirPath);

    res.json({
      path: toPosixSeparators(dirPath),
      name: path.basename(dirPath),
      tree,
      ...(runnerType ? { runnerType } : {}),
    });
  } catch (err: any) {
    log.error(' Failed to build tree:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/rename - Rename file or folder in place
router.post('/rename', (req: Request, res: Response) => {
  try {
    const { path: sourcePath, newName } = req.body as { path?: string; newName?: string };

    const validatedSource = sourcePath && ensureAbsoluteExistingPath(sourcePath);
    if (!validatedSource) {
      res.status(400).json({ error: 'Invalid or missing source path' });
      return;
    }

    const nextName = (newName || '').trim();
    if (!nextName || nextName === '.' || nextName === '..') {
      res.status(400).json({ error: 'Invalid new name' });
      return;
    }
    if (nextName.includes('/') || nextName.includes('\\')) {
      res.status(400).json({ error: 'Name must not contain path separators' });
      return;
    }

    const destinationPath = path.join(path.dirname(validatedSource), nextName);
    if (validatedSource === destinationPath) {
      res.json({ success: true, newPath: destinationPath });
      return;
    }

    if (fs.existsSync(destinationPath)) {
      res.status(409).json({ error: 'Target already exists' });
      return;
    }

    fs.renameSync(validatedSource, destinationPath);
    res.json({ success: true, oldPath: validatedSource, newPath: destinationPath });
  } catch (err: any) {
    log.error(' Failed to rename path:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/create - Create a new file or folder inside a target directory
router.post('/create', (req: Request, res: Response) => {
  try {
    const { parentDir, name, isDirectory } = req.body as {
      parentDir?: string;
      name?: string;
      isDirectory?: boolean;
    };

    const validatedParent = parentDir && ensureAbsoluteExistingPath(parentDir);
    if (!validatedParent) {
      res.status(400).json({ error: 'Invalid or missing parent directory' });
      return;
    }

    const parentStats = fs.statSync(validatedParent);
    if (!parentStats.isDirectory()) {
      res.status(400).json({ error: 'Parent path is not a directory' });
      return;
    }

    const nextName = (name || '').trim();
    if (!nextName || nextName === '.' || nextName === '..') {
      res.status(400).json({ error: 'Invalid name' });
      return;
    }
    if (nextName.includes('/') || nextName.includes('\\')) {
      res.status(400).json({ error: 'Name must not contain path separators' });
      return;
    }

    const destinationPath = path.join(validatedParent, nextName);
    if (fs.existsSync(destinationPath)) {
      res.status(409).json({ error: 'Target already exists' });
      return;
    }

    if (isDirectory) {
      fs.mkdirSync(destinationPath);
    } else {
      fs.writeFileSync(destinationPath, '', { flag: 'wx' });
    }

    res.json({ success: true, path: destinationPath, isDirectory: !!isDirectory });
  } catch (err: any) {
    log.error(' Failed to create path:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/copy - Copy file/folder into target directory
router.post('/copy', (req: Request, res: Response) => {
  try {
    const { sourcePath, targetDir } = req.body as { sourcePath?: string; targetDir?: string };

    const validatedSource = sourcePath && ensureAbsoluteExistingPath(sourcePath);
    if (!validatedSource) {
      res.status(400).json({ error: 'Invalid or missing source path' });
      return;
    }
    const validatedTargetDir = targetDir && ensureAbsoluteExistingPath(targetDir);
    if (!validatedTargetDir) {
      res.status(400).json({ error: 'Invalid or missing target directory' });
      return;
    }

    const targetStats = fs.statSync(validatedTargetDir);
    if (!targetStats.isDirectory()) {
      res.status(400).json({ error: 'Target must be a directory' });
      return;
    }

    const destinationPath = copyPathToDirectory(validatedSource, validatedTargetDir);
    res.json({ success: true, sourcePath: validatedSource, destinationPath });
  } catch (err: any) {
    log.error(' Failed to copy path:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/paste - Alias for copy operation from clipboard source
router.post('/paste', (req: Request, res: Response) => {
  try {
    const { sourcePath, targetDir } = req.body as { sourcePath?: string; targetDir?: string };

    const validatedSource = sourcePath && ensureAbsoluteExistingPath(sourcePath);
    if (!validatedSource) {
      res.status(400).json({ error: 'Invalid or missing source path' });
      return;
    }
    const validatedTargetDir = targetDir && ensureAbsoluteExistingPath(targetDir);
    if (!validatedTargetDir) {
      res.status(400).json({ error: 'Invalid or missing target directory' });
      return;
    }

    const targetStats = fs.statSync(validatedTargetDir);
    if (!targetStats.isDirectory()) {
      res.status(400).json({ error: 'Target must be a directory' });
      return;
    }

    const destinationPath = copyPathToDirectory(validatedSource, validatedTargetDir);
    res.json({ success: true, sourcePath: validatedSource, destinationPath });
  } catch (err: any) {
    log.error(' Failed to paste path:', err);
    res.status(500).json({ error: err.message });
  }
});

// Directories skipped during file/content search unless the request supplies
// `exclude`. Kept as a Set for O(1) lookups (checked once per directory entry).
const SEARCH_SKIP_DIRS = new Set<string>(DEFAULT_FILE_SEARCH_EXCLUDE_DIRS);
const MAX_SEARCH_DEPTH = 10;

/** Request `exclude` (comma list or repeated) overrides the default skip set. */
function skipDirsFromQuery(req: Request): Set<string> {
  if (req.query.exclude === undefined) return SEARCH_SKIP_DIRS;
  return new Set(parseExcludeDirNames(req.query.exclude));
}

// Helper function to search files recursively (async / non-blocking).
// Uses fs.promises so a deep tree walk never blocks the event loop, which
// matters on a shared multi-agent server. `queryLower` must be pre-lowercased.
async function searchFilesAsync(
  dirPath: string,
  queryLower: string,
  results: TreeNode[],
  maxResults: number,
  depth: number = 0,
  skipDirs: Set<string> = SEARCH_SKIP_DIRS,
): Promise<void> {
  if (results.length >= maxResults || depth > MAX_SEARCH_DEPTH) return;

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return; // Skip directories we can't read
  }

  const subdirs: string[] = [];

  for (const entry of entries) {
    if (results.length >= maxResults) break;

    const isDir = entry.isDirectory();
    // Skip configured non-essential directories
    if (isDir && skipDirs.has(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);

    // Check if name matches query (case-insensitive)
    if (entry.name.toLowerCase().includes(queryLower)) {
      let size = 0;
      try {
        size = (await fs.promises.stat(fullPath)).size;
      } catch {
        // Keep size 0 if stat fails (broken symlink etc.) but still surface it
      }
      results.push({
        name: entry.name,
        path: fullPath,
        isDirectory: isDir,
        size,
        extension: isDir ? '' : path.extname(entry.name).toLowerCase(),
      });
    }

    if (isDir) subdirs.push(fullPath);
  }

  // Recurse after listing this level so match/recurse order stays bounded.
  for (const sub of subdirs) {
    if (results.length >= maxResults) break;
    await searchFilesAsync(sub, queryLower, results, maxResults, depth + 1, skipDirs);
  }
}

// GET /api/files/search - Search for files
router.get('/search', async (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string;
    const query = req.query.q as string;
    const maxResults = parseInt(req.query.limit as string) || 50;

    if (!dirPath || !query) {
      res.status(400).json({ error: 'Missing path or query parameter' });
      return;
    }

    if (!path.isAbsolute(dirPath)) {
      res.status(400).json({ error: 'Path must be absolute' });
      return;
    }

    if (!fs.existsSync(dirPath)) {
      res.status(404).json({ error: 'Directory not found' });
      return;
    }

    const results: TreeNode[] = [];
    await searchFilesAsync(dirPath, query.toLowerCase(), results, maxResults, 0, skipDirsFromQuery(req));

    // Sort: files first (more likely what user wants), then by name
    results.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? 1 : -1;
      }
      return a.name.localeCompare(b.name);
    });

    res.json({ results });
  } catch (err: any) {
    log.error(' Failed to search files:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/search-global - Filename search across every area directory
router.get('/search-global', async (req: Request, res: Response) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    if (query.trim().length < FILE_SEARCH_MIN_QUERY) {
      res.json({ files: [] });
      return;
    }
    const limit = parseInt(String(req.query.limit ?? ''), 10);
    const files = await searchFilesGlobal({
      query,
      exclude: req.query.exclude,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    res.json({ files });
  } catch (err: any) {
    log.error(' Global file search failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Content search result type
interface ContentMatch {
  path: string;
  name: string;
  extension: string;
  matches: {
    line: number;
    content: string;
    context?: { before: string; after: string };
  }[];
}

// Text file extensions for content search
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.xml', '.html', '.htm',
  '.css', '.scss', '.sass', '.less', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.php', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs',
  '.swift', '.kt', '.scala', '.clj', '.ex', '.exs', '.erl', '.hs', '.ml', '.fs',
  '.sql', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.toml', '.ini', '.cfg', '.conf', '.env', '.gitignore', '.dockerignore',
  '.editorconfig', '.prettierrc', '.eslintrc', '.babelrc',
  '.log', '.csv', '.tsv', '.svg', '.vue', '.svelte',
]);

// Max matches surfaced per file (both search paths respect this).
const MAX_MATCHES_PER_FILE = 5;
// Skip files larger than 1MB for content search.
const MAX_CONTENT_FILE_SIZE = 1024 * 1024;

// Primary content search: shell out to ripgrep. It runs off the event loop as
// a child process (never blocking the server) and is orders of magnitude faster
// than a JS tree walk. Resolves { ok:false } when rg is missing or errors, so
// the caller can fall back to the pure-JS walker.
function searchFileContentsRipgrep(
  dirPath: string,
  query: string,
  maxResults: number,
  skipDirs: Set<string> = SEARCH_SKIP_DIRS,
): Promise<{ ok: boolean; results: ContentMatch[] }> {
  return new Promise((resolve) => {
    const args = [
      '--json',
      '--ignore-case',
      '--fixed-strings',              // treat the query as a literal substring
      '--max-count', String(MAX_MATCHES_PER_FILE),
      '--max-filesize', String(MAX_CONTENT_FILE_SIZE),
      '--max-depth', String(MAX_SEARCH_DEPTH + 1),
      '--hidden',                     // include dotfiles (.env, .github, ...)
      '--no-ignore',                  // don't honor .gitignore (match old behavior)
      '--no-messages',                // suppress permission/binary warnings on stderr
      ...[...skipDirs].flatMap((d) => ['--glob', `!**/${d}/**`]),
      '--',
      query,
      dirPath,
    ];

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('rg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolve({ ok: false, results: [] });
      return;
    }

    const byFile = new Map<string, ContentMatch>();
    let buffer = '';
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ ok, results: [...byFile.values()] });
    };

    // Spawn failure (e.g. rg not installed) → fall back to the JS walker.
    child.on('error', () => finish(false));

    child.stdout?.setEncoding('utf-8');
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line) continue;

        let evt: any;
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }
        if (evt.type !== 'match') continue;

        const filePath: string | undefined = evt.data?.path?.text;
        if (!filePath) continue;

        let cm = byFile.get(filePath);
        if (!cm) {
          // Cap the number of distinct files we track.
          if (byFile.size >= maxResults) {
            child.kill();
            break;
          }
          cm = {
            path: filePath,
            name: path.basename(filePath),
            extension: path.extname(filePath).toLowerCase(),
            matches: [],
          };
          byFile.set(filePath, cm);
        }

        if (cm.matches.length >= MAX_MATCHES_PER_FILE) continue;
        const text: string = (evt.data?.lines?.text ?? '').replace(/\r?\n$/, '');
        cm.matches.push({
          line: evt.data?.line_number ?? 0,
          content: text.slice(0, 200),
        });
      }
    });

    // rg exit codes: 0 = matches, 1 = no matches, 2 = error. Only a real error
    // (or a kill, code null) that produced nothing should trigger the fallback.
    child.on('close', (code) => finish(!(code === 2 && byFile.size === 0)));
  });
}

// Fallback content search (async / non-blocking) used only when ripgrep is
// unavailable. Mirrors the old behavior but with fs.promises so it never
// blocks the event loop.
async function searchFileContentsAsync(
  dirPath: string,
  queryLower: string,
  results: ContentMatch[],
  maxResults: number,
  depth: number = 0,
  skipDirs: Set<string> = SEARCH_SKIP_DIRS,
): Promise<void> {
  if (results.length >= maxResults || depth > MAX_SEARCH_DEPTH) return;

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return; // Skip directories we can't read
  }

  const subdirs: string[] = [];

  for (const entry of entries) {
    if (results.length >= maxResults) break;

    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) subdirs.push(path.join(dirPath, entry.name));
      continue;
    }

    // Check if it's a text file we can search
    const ext = path.extname(entry.name).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext) && ext !== '') continue;

    const fullPath = path.join(dirPath, entry.name);
    try {
      const stats = await fs.promises.stat(fullPath);
      if (stats.size > MAX_CONTENT_FILE_SIZE) continue;

      const content = await fs.promises.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');
      const matches: ContentMatch['matches'] = [];

      for (let i = 0; i < lines.length && matches.length < MAX_MATCHES_PER_FILE; i++) {
        const line = lines[i];
        if (line.toLowerCase().includes(queryLower)) {
          matches.push({
            line: i + 1,
            content: line.slice(0, 200), // Truncate long lines
          });
        }
      }

      if (matches.length > 0) {
        results.push({ path: fullPath, name: entry.name, extension: ext, matches });
      }
    } catch {
      // Skip files we can't read (binary, permission issues)
    }
  }

  for (const sub of subdirs) {
    if (results.length >= maxResults) break;
    await searchFileContentsAsync(sub, queryLower, results, maxResults, depth + 1, skipDirs);
  }
}

// GET /api/files/search-content - Search file contents
router.get('/search-content', async (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string;
    const query = req.query.q as string;
    const maxResults = parseInt(req.query.limit as string) || 30;

    if (!dirPath || !query) {
      res.status(400).json({ error: 'Missing path or query parameter' });
      return;
    }

    if (query.length < 2) {
      res.status(400).json({ error: 'Query must be at least 2 characters' });
      return;
    }

    if (!path.isAbsolute(dirPath)) {
      res.status(400).json({ error: 'Path must be absolute' });
      return;
    }

    if (!fs.existsSync(dirPath)) {
      res.status(404).json({ error: 'Directory not found' });
      return;
    }

    let results: ContentMatch[] = [];
    const skipDirs = skipDirsFromQuery(req);
    const rg = await searchFileContentsRipgrep(dirPath, query, maxResults, skipDirs);
    if (rg.ok) {
      results = rg.results;
    } else {
      // ripgrep unavailable — fall back to the pure-JS async walker.
      await searchFileContentsAsync(dirPath, query.toLowerCase(), results, maxResults, 0, skipDirs);
    }

    res.json({ results });
  } catch (err: any) {
    log.error(' Failed to search content:', err);
    res.status(500).json({ error: err.message });
  }
});

// Git file status type
interface GitFileStatus {
  path: string;
  name: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'conflict';
  oldPath?: string; // For renamed files
}

// GET /api/files/git-status - Get git status for a directory
router.get('/git-status', async (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string;

    if (!dirPath) {
      res.status(400).json({ error: 'Missing path parameter' });
      return;
    }

    if (!path.isAbsolute(dirPath)) {
      res.status(400).json({ error: 'Path must be absolute' });
      return;
    }

    if (!fs.existsSync(dirPath)) {
      res.status(404).json({ error: 'Directory not found' });
      return;
    }

    // Check if directory is a git repo and get the git root
    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd: dirPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      res.json({ isGitRepo: false, files: [] });
      return;
    }

    // Check if a merge is in progress
    const mergeInProgress = fs.existsSync(path.join(gitRoot, '.git', 'MERGE_HEAD'));

    // Get git status with porcelain format for easy parsing
    let statusOutput = '';
    try {
      statusOutput = execSync('git status --porcelain -uall', {
        cwd: dirPath,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });
    } catch (err) {
      log.error(' Git status failed:', err);
      res.json({ isGitRepo: true, files: [], error: 'Failed to get git status' });
      return;
    }

    const files: GitFileStatus[] = [];
    const orphanedIndexFiles: string[] = []; // AD files: staged add but deleted from disk
    const lines = statusOutput.replace(/\n$/, '').split('\n').filter(Boolean);

    for (const line of lines) {
      // Porcelain v1 format: "XY PATH" or "XY ORIG -> NEW" for renames
      // X = index status (pos 0), Y = worktree status (pos 1),
      // space separator (pos 2), path starts at pos 3.
      // Paths are always relative to the git root.
      const indexStatus = line[0];
      const workTreeStatus = line[1];
      const filePart = line.substring(3);

      let status: GitFileStatus['status'];
      let filePath: string;
      let oldPath: string | undefined;

      // Check for rename (contains ' -> ')
      // Emit '/'-separated absolute paths: git returns forward-slash relatives
      // but path.join yields backslashes on Windows, which would break the
      // client's git tree (it splits on '/').
      if (filePart.includes(' -> ')) {
        const [old, newPath] = filePart.split(' -> ');
        filePath = toPosixSeparators(path.join(gitRoot, newPath));
        oldPath = toPosixSeparators(path.join(gitRoot, old));
        status = 'renamed';
      } else {
        filePath = toPosixSeparators(path.join(gitRoot, filePart));

        // Determine status from XY codes
        // Check for conflicts first (both modified, both added, both deleted, etc.)
        const conflictCodes = ['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD'];
        const xyCode = indexStatus + workTreeStatus;

        if (conflictCodes.includes(xyCode)) {
          status = 'conflict';
        } else if (xyCode === 'AD') {
          // File was staged (git add) but then deleted from disk.
          // Auto-unstage the orphaned index entry and skip it.
          orphanedIndexFiles.push(filePart);
          continue;
        } else if (indexStatus === '?' || workTreeStatus === '?') {
          status = 'untracked';
        } else if (indexStatus === 'A' || workTreeStatus === 'A') {
          status = 'added';
        } else if (indexStatus === 'D' || workTreeStatus === 'D') {
          status = 'deleted';
        } else if (indexStatus === 'R' || workTreeStatus === 'R') {
          status = 'renamed';
        } else {
          status = 'modified';
        }
      }

      files.push({
        path: filePath,
        name: path.basename(filePath),
        status,
        oldPath,
      });
    }

    // Auto-unstage orphaned AD files (staged add but file deleted from disk)
    if (orphanedIndexFiles.length > 0) {
      try {
        const quotedPaths = orphanedIndexFiles.map(p => `"${p}"`).join(' ');
        execSync(`git rm --cached --ignore-unmatch ${quotedPaths}`, {
          cwd: gitRoot,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        // Best effort — if unstaging fails, files are simply excluded from results
      }
    }

    // Sort by status priority: modified > added > deleted > untracked
    const statusOrder: Record<string, number> = { conflict: 0, modified: 1, added: 2, deleted: 3, renamed: 4, untracked: 5 };
    files.sort((a, b) => {
      const orderDiff = statusOrder[a.status] - statusOrder[b.status];
      if (orderDiff !== 0) return orderDiff;
      return a.name.localeCompare(b.name);
    });

    // Get branch name
    let branch = 'unknown';
    try {
      branch = execSync('git branch --show-current', {
        cwd: dirPath,
        encoding: 'utf-8',
      }).trim() || 'HEAD';
    } catch {
      // Ignore
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({
      isGitRepo: true,
      branch,
      files,
      mergeInProgress,
      counts: {
        conflict: files.filter(f => f.status === 'conflict').length,
        modified: files.filter(f => f.status === 'modified').length,
        added: files.filter(f => f.status === 'added').length,
        deleted: files.filter(f => f.status === 'deleted').length,
        untracked: files.filter(f => f.status === 'untracked').length,
        renamed: files.filter(f => f.status === 'renamed').length,
      },
    });
  } catch (err: any) {
    log.error(' Failed to get git status:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-add - Stage files with git add
router.post('/git-add', async (req: Request, res: Response) => {
  try {
    const { paths, directory } = req.body as { paths?: string[]; directory?: string };

    if (!directory || typeof directory !== 'string') {
      res.status(400).json({ error: 'Missing directory parameter' });
      return;
    }

    if (!path.isAbsolute(directory)) {
      res.status(400).json({ error: 'Directory must be absolute' });
      return;
    }

    if (!paths || !Array.isArray(paths) || paths.length === 0) {
      res.status(400).json({ error: 'Missing or empty paths array' });
      return;
    }

    // Validate all paths are absolute and don't contain traversal
    for (const p of paths) {
      if (!path.isAbsolute(p)) {
        res.status(400).json({ error: `Path must be absolute: ${p}` });
        return;
      }
      if (p.includes('..')) {
        res.status(400).json({ error: `Path traversal not allowed: ${p}` });
        return;
      }
    }

    // Find git root
    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd: directory,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    // Convert absolute paths to relative paths from git root and validate they're within the repo
    const relativePaths: string[] = [];
    for (const p of paths) {
      const rel = path.relative(gitRoot, p);
      if (rel.startsWith('..')) {
        res.status(400).json({ error: `Path is outside the git repository: ${p}` });
        return;
      }
      relativePaths.push(rel);
    }

    // Stage the files
    const quotedPaths = relativePaths.map(p => `"${p}"`).join(' ');
    try {
      execSync(`git add ${quotedPaths}`, {
        cwd: gitRoot,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (err: any) {
      log.error(' Git add failed:', err);
      res.status(500).json({ error: `Git add failed: ${err.message}` });
      return;
    }

    res.json({ success: true, staged: paths.length });
  } catch (err: any) {
    log.error(' Failed to stage files:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-discard - Discard working tree changes for files
router.post('/git-discard', async (req: Request, res: Response) => {
  try {
    const { files, directory } = req.body as {
      files?: Array<{ path: string; status: string }>;
      directory?: string;
    };

    if (!directory || typeof directory !== 'string') {
      res.status(400).json({ error: 'Missing directory parameter' });
      return;
    }

    if (!path.isAbsolute(directory)) {
      res.status(400).json({ error: 'Directory must be absolute' });
      return;
    }

    if (!files || !Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: 'Missing or empty files array' });
      return;
    }

    // Validate all paths
    for (const f of files) {
      if (!f.path || !path.isAbsolute(f.path)) {
        res.status(400).json({ error: `Path must be absolute: ${f.path}` });
        return;
      }
      if (f.path.includes('..')) {
        res.status(400).json({ error: `Path traversal not allowed: ${f.path}` });
        return;
      }
    }

    // Find git root
    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd: directory,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    let discarded = 0;

    for (const f of files) {
      const rel = path.relative(gitRoot, f.path);
      if (rel.startsWith('..')) {
        res.status(400).json({ error: `Path is outside the git repository: ${f.path}` });
        return;
      }

      try {
        if (f.status === 'untracked') {
          // Untracked files: just delete from disk
          if (fs.existsSync(f.path)) {
            fs.unlinkSync(f.path);
          }
        } else if (f.status === 'added') {
          // Staged new files: unstage then delete
          try {
            execSync(`git rm --cached "${rel}"`, {
              cwd: gitRoot,
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
            });
          } catch {
            // May not be staged, ignore
          }
          if (fs.existsSync(f.path)) {
            fs.unlinkSync(f.path);
          }
        } else {
          // modified, deleted, renamed, conflict: restore from HEAD
          execSync(`git checkout HEAD -- "${rel}"`, {
            cwd: gitRoot,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
          });
        }
        discarded++;
      } catch (err: any) {
        log.error(` Git discard failed for ${f.path}:`, err);
        res.status(500).json({ error: `Failed to discard ${f.path}: ${err.message}` });
        return;
      }
    }

    res.json({ success: true, discarded });
  } catch (err: any) {
    log.error(' Failed to discard files:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-discard-all - Discard ALL uncommitted changes in one repo.
// Destructive & irreversible. `git reset --hard HEAD` restores every tracked file
// (staged + unstaged) to HEAD; `git clean -fd` removes untracked files AND
// directories. `-fd` respects .gitignore, so ignored paths (node_modules, .env,
// build output) are intentionally left untouched — this matches the untracked set
// shown by `git status`. Scoped to the git root resolved from `directory`, so it
// can never touch another repo.
router.post('/git-discard-all', async (req: Request, res: Response) => {
  try {
    const { directory } = req.body as { directory?: string };

    if (!directory || typeof directory !== 'string') {
      res.status(400).json({ error: 'Missing directory parameter' });
      return;
    }
    if (!path.isAbsolute(directory)) {
      res.status(400).json({ error: 'Directory must be absolute' });
      return;
    }

    // Resolve the git root so both commands are scoped to exactly this repo.
    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd: directory,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    // Count changes first so the response can report how many were discarded.
    let discarded = 0;
    try {
      const statusOut = execSync('git status --porcelain -uall', {
        cwd: gitRoot,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });
      discarded = statusOut.split('\n').filter((l) => l.trim().length > 0).length;
    } catch {
      // Non-fatal: if counting fails, still proceed with the discard.
    }

    try {
      // Restore all tracked files (staged + unstaged) to HEAD.
      execSync('git reset --hard HEAD', {
        cwd: gitRoot,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });
      // Remove untracked files and directories (respects .gitignore).
      execSync('git clean -fd', {
        cwd: gitRoot,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (err: any) {
      log.error(' Git discard-all failed:', err);
      res.status(500).json({ error: `Failed to discard all changes: ${err.message}` });
      return;
    }

    res.json({ success: true, discarded });
  } catch (err: any) {
    log.error(' Failed to discard all changes:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/git-original - Get original file content from git HEAD
router.get('/git-original', async (req: Request, res: Response) => {
  try {
    const resolution = resolveAndValidateFilePath(
      req.query.path as string | undefined,
      req.query.baseDir as string | undefined,
    );
    if (!resolution.ok) {
      res.status(resolution.status).json({ error: resolution.error });
      return;
    }
    const filePath = resolution.path;

    // Find git root
    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd: path.dirname(filePath),
        encoding: 'utf-8',
      }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    // Get relative path from git root
    const relativePath = path.relative(gitRoot, filePath);

    // Get original content from HEAD
    let originalBuffer: Buffer;
    try {
      originalBuffer = execFileSync('git', ['show', `HEAD:${relativePath}`], {
        cwd: gitRoot,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
    } catch (err: any) {
      // File might be new (not in HEAD)
      if (err.message?.includes('does not exist') || err.message?.includes('fatal')) {
        res.json({
          path: filePath,
          filename: path.basename(filePath),
          extension: path.extname(filePath).toLowerCase(),
          content: '',
          isNew: true,
        });
        return;
      }
      throw err;
    }

    if (looksLikeBinaryBuffer(originalBuffer)) {
      res.status(415).json({
        path: filePath,
        filename: path.basename(filePath),
        extension: path.extname(filePath).toLowerCase(),
        binary: true,
        isNew: false,
        error: 'Binary file cannot be read as text',
      });
      return;
    }

    res.json({
      path: filePath,
      filename: path.basename(filePath),
      extension: path.extname(filePath).toLowerCase(),
      content: originalBuffer.toString('utf-8'),
      isNew: false,
    });
  } catch (err: any) {
    log.error(' Failed to get git original:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/git-original-binary - Stream the HEAD version of a binary
// file. This keeps deleted image/PDF/STL/FCStd previews useful in the Git modal.
router.get('/git-original-binary', async (req: Request, res: Response) => {
  try {
    const resolution = resolveAndValidateFilePath(
      req.query.path as string | undefined,
      req.query.baseDir as string | undefined,
    );
    if (!resolution.ok) {
      res.status(resolution.status).json({ error: resolution.error });
      return;
    }
    const filePath = resolution.path;
    const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: path.dirname(filePath),
      encoding: 'utf-8',
    }).trim();
    const relativePath = path.relative(gitRoot, filePath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      res.status(400).json({ error: 'Path is outside the git repository' });
      return;
    }
    const buffer = execFileSync('git', ['show', `HEAD:${relativePath}`], {
      cwd: gitRoot,
      maxBuffer: 50 * 1024 * 1024,
    });
    const extension = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', binaryContentTypeForExtension(extension));
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(buffer);
  } catch (err: any) {
    log.error(' Failed to get original binary from git:', err);
    res.status(404).json({ error: 'Original binary file not found' });
  }
});

// GET /api/files/git-diff - Get unified diff for a file
router.get('/git-diff', async (req: Request, res: Response) => {
  try {
    const resolution = resolveAndValidateFilePath(
      req.query.path as string | undefined,
      req.query.baseDir as string | undefined,
    );
    if (!resolution.ok) {
      res.status(resolution.status).json({ error: resolution.error });
      return;
    }
    const filePath = resolution.path;

    // Find git root
    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd: path.dirname(filePath),
        encoding: 'utf-8',
      }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    // Get relative path from git root
    const relativePath = path.relative(gitRoot, filePath);

    // Get diff
    let diff: string;
    try {
      diff = execSync(`git diff HEAD -- "${relativePath}"`, {
        cwd: gitRoot,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch {
      diff = '';
    }

    res.json({
      path: filePath,
      diff,
    });
  } catch (err: any) {
    log.error(' Failed to get git diff:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/git-branch - Get current branch name for a directory (lightweight)
router.get('/git-branch', async (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string;
    if (!dirPath) { res.status(400).json({ error: 'Missing path parameter' }); return; }
    if (!path.isAbsolute(dirPath)) { res.status(400).json({ error: 'Path must be absolute' }); return; }
    if (!fs.existsSync(dirPath)) { res.json({ branch: null }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: dirPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.json({ branch: null });
      return;
    }

    let branch = '';
    try {
      branch = execSync('git branch --show-current', { cwd: gitRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() || 'HEAD';
    } catch {
      branch = 'HEAD';
    }

    // Get ahead/behind counts relative to upstream
    let ahead = 0;
    let behind = 0;
    if (branch && branch !== 'HEAD') {
      try {
        const revList = execSync(
          `git rev-list --left-right --count ${branch}...@{upstream}`,
          { cwd: gitRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim();
        const parts = revList.split(/\s+/);
        if (parts.length === 2) {
          ahead = parseInt(parts[0], 10) || 0;
          behind = parseInt(parts[1], 10) || 0;
        }
      } catch {
        // No upstream configured or error — leave at 0
      }
    }

    res.json({ branch, ahead, behind });
  } catch {
    res.json({ branch: null, ahead: 0, behind: 0 });
  }
});

// GET /api/files/git-branches - List all local and remote branches
router.get('/git-branches', async (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string;
    if (!dirPath) { res.status(400).json({ error: 'Missing path parameter' }); return; }
    if (!path.isAbsolute(dirPath)) { res.status(400).json({ error: 'Path must be absolute' }); return; }
    if (!fs.existsSync(dirPath)) { res.status(404).json({ error: 'Directory not found' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: dirPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    let currentBranch = '';
    try {
      currentBranch = execSync('git branch --show-current', { cwd: gitRoot, encoding: 'utf-8' }).trim() || 'HEAD';
    } catch { currentBranch = 'HEAD'; }

    interface BranchInfo {
      name: string;
      isCurrent: boolean;
      isRemote: boolean;
      remote?: string;
      lastCommit?: string;
      lastMessage?: string;
    }
    const branches: BranchInfo[] = [];

    try {
      const localOutput = execSync(
        "git branch --format='%(refname:short)|%(objectname:short)|%(subject)' --sort=-committerdate",
        { cwd: gitRoot, encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
      );
      for (const line of localOutput.trim().split('\n').filter(Boolean)) {
        const [name, commit, ...msgParts] = line.split('|');
        branches.push({
          name: name.trim(),
          isCurrent: name.trim() === currentBranch,
          isRemote: false,
          lastCommit: commit?.trim(),
          lastMessage: msgParts.join('|').trim(),
        });
      }
    } catch (err) {
      log.error(' Failed to list local branches:', err);
    }

    try {
      const remoteOutput = execSync(
        "git branch -r --format='%(refname:short)|%(objectname:short)|%(subject)' --sort=-committerdate",
        { cwd: gitRoot, encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
      );
      for (const line of remoteOutput.trim().split('\n').filter(Boolean)) {
        const [name, commit, ...msgParts] = line.split('|');
        const trimmedName = name.trim();
        if (trimmedName.includes('/HEAD')) continue;
        const slashIndex = trimmedName.indexOf('/');
        const remote = slashIndex > -1 ? trimmedName.substring(0, slashIndex) : undefined;
        branches.push({
          name: trimmedName,
          isCurrent: false,
          isRemote: true,
          remote,
          lastCommit: commit?.trim(),
          lastMessage: msgParts.join('|').trim(),
        });
      }
    } catch {
      // No remote branches or not configured
    }

    let remotes: string[] = [];
    try {
      remotes = execSync('git remote', { cwd: gitRoot, encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
    } catch { /* no remotes */ }

    res.json({ branches, currentBranch, remotes });
  } catch (err: any) {
    log.error(' Failed to list branches:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-checkout - Switch to a different branch
router.post('/git-checkout', async (req: Request, res: Response) => {
  try {
    const { directory, branch } = req.body as { directory?: string; branch?: string };
    if (!directory || !branch) { res.status(400).json({ error: 'Missing directory or branch parameter' }); return; }
    if (!path.isAbsolute(directory)) { res.status(400).json({ error: 'Directory must be absolute' }); return; }
    if (!/^[a-zA-Z0-9._\-\/]+$/.test(branch)) { res.status(400).json({ error: 'Invalid branch name' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: directory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    try {
      const isRemote = branch.includes('/');
      if (isRemote) {
        const localName = branch.substring(branch.indexOf('/') + 1);
        try {
          execSync(`git rev-parse --verify "${localName}"`, { cwd: gitRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
          execSync(`git checkout "${localName}"`, { cwd: gitRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        } catch {
          execSync(`git checkout -b "${localName}" "${branch}"`, { cwd: gitRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        }
        res.json({ success: true, branch: localName });
      } else {
        execSync(`git checkout "${branch}"`, { cwd: gitRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        res.json({ success: true, branch });
      }
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message || '';
      if (stderr.includes('Your local changes')) {
        res.status(409).json({ success: false, error: 'Uncommitted changes would be overwritten. Commit or stash first.' });
      } else if (stderr.includes('pathspec')) {
        res.status(404).json({ success: false, error: `Branch not found: ${branch}` });
      } else {
        res.status(500).json({ success: false, error: stderr.trim() || err.message });
      }
    }
  } catch (err: any) {
    log.error(' Failed to checkout branch:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-branch-create - Create a new branch and switch to it
router.post('/git-branch-create', async (req: Request, res: Response) => {
  try {
    const { directory, name, startPoint } = req.body as { directory?: string; name?: string; startPoint?: string };
    if (!directory || !name) { res.status(400).json({ error: 'Missing directory or name parameter' }); return; }
    if (!path.isAbsolute(directory)) { res.status(400).json({ error: 'Directory must be absolute' }); return; }
    if (!/^[a-zA-Z0-9._\-\/]+$/.test(name)) { res.status(400).json({ error: 'Invalid branch name. Use only letters, numbers, dots, hyphens, underscores, and slashes.' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: directory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    try {
      const cmd = startPoint
        ? `git checkout -b "${name}" "${startPoint}"`
        : `git checkout -b "${name}"`;
      execSync(cmd, { cwd: gitRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      res.json({ success: true, branch: name });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message || '';
      if (stderr.includes('already exists')) {
        res.status(409).json({ success: false, error: `Branch "${name}" already exists.` });
      } else {
        res.status(500).json({ success: false, error: stderr.trim() || err.message });
      }
    }
  } catch (err: any) {
    log.error(' Failed to create branch:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-pull - Pull from remote
router.post('/git-pull', async (req: Request, res: Response) => {
  try {
    const { directory, remote, branch } = req.body as { directory?: string; remote?: string; branch?: string };
    if (!directory) { res.status(400).json({ error: 'Missing directory parameter' }); return; }
    if (!path.isAbsolute(directory)) { res.status(400).json({ error: 'Directory must be absolute' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: directory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    const buildPullCmd = () => {
      let cmd = 'git pull --no-rebase';
      if (remote) cmd += ` "${remote}"`;
      if (branch) cmd += ` "${branch}"`;
      return cmd;
    };

    const parseConflicts = (text: string): string[] => {
      const conflicts: string[] = [];
      const conflictRegex = /CONFLICT \([^)]+\): Merge conflict in (.+)/g;
      let match;
      while ((match = conflictRegex.exec(text)) !== null) {
        conflicts.push(path.join(gitRoot, match[1].trim()));
      }
      const bothRegex = /CONFLICT \([^)]+\):.+?(?:both modified|both added):\s*(.+)/g;
      while ((match = bothRegex.exec(text)) !== null) {
        const conflictPath = path.join(gitRoot, match[1].trim());
        if (!conflicts.includes(conflictPath)) {
          conflicts.push(conflictPath);
        }
      }
      return conflicts;
    };

    const execOpts = { cwd: gitRoot, encoding: 'utf-8' as const, timeout: 30000, maxBuffer: 10 * 1024 * 1024 };

    try {
      const output = execSync(buildPullCmd(), execOpts);
      res.json({ success: true, output: output.trim() });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || '';
      const stdout = err.stdout?.toString() || '';
      const combined = stdout + '\n' + stderr;

      // Check if failure is due to local changes conflicting with incoming
      const needsStash = combined.includes('Your local changes') ||
        combined.includes('untracked working tree files would be overwritten');

      if (needsStash) {
        // Auto-stash local changes and retry
        try {
          execSync('git stash push --include-untracked -m "auto-stash before pull"', execOpts);
        } catch (stashErr: any) {
          res.status(500).json({ success: false, error: 'Failed to stash local changes: ' + (stashErr.stderr?.toString() || stashErr.message) });
          return;
        }

        // Retry pull
        try {
          const pullOutput = execSync(buildPullCmd(), execOpts);

          // Restore stashed changes
          try {
            execSync('git stash pop', execOpts);
            res.json({ success: true, output: pullOutput.trim(), stashed: true, message: 'Local changes were auto-stashed and restored.' });
          } catch (popErr: any) {
            const popStderr = popErr.stderr?.toString() || '';
            const popStdout = popErr.stdout?.toString() || '';
            const popCombined = popStdout + '\n' + popStderr;
            const stashConflicts = parseConflicts(popCombined);
            res.json({
              success: true,
              output: pullOutput.trim(),
              stashed: true,
              stashConflicts: stashConflicts.length > 0 ? stashConflicts : undefined,
              message: 'Pull succeeded but stash pop had conflicts. Resolve manually.',
            });
          }
        } catch (retryErr: any) {
          // Pull failed even after stash — restore stash and report error
          try { execSync('git stash pop', execOpts); } catch { /* best effort */ }
          const retryStderr = retryErr.stderr?.toString() || '';
          const retryStdout = retryErr.stdout?.toString() || '';
          const retryCombined = retryStdout + '\n' + retryStderr;

          if (retryCombined.includes('CONFLICT') || retryCombined.includes('Automatic merge failed')) {
            res.json({ success: false, output: retryCombined.trim(), conflicts: parseConflicts(retryCombined), stashed: true });
          } else if (retryCombined.includes('ETIMEDOUT') || retryCombined.includes('Could not resolve')) {
            res.status(504).json({ success: false, error: 'Network error. Check your connection.' });
          } else {
            res.status(500).json({ success: false, error: (retryStderr || retryStdout).trim() || retryErr.message });
          }
        }
      } else if (combined.includes('CONFLICT') || combined.includes('Automatic merge failed')) {
        res.json({ success: false, output: combined.trim(), conflicts: parseConflicts(combined) });
      } else if (combined.includes('ETIMEDOUT') || combined.includes('Could not resolve')) {
        res.status(504).json({ success: false, error: 'Network error. Check your connection.' });
      } else {
        res.status(500).json({ success: false, error: (stderr || stdout).trim() || err.message });
      }
    }
  } catch (err: any) {
    log.error(' Failed to pull:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-push - Push to remote
router.post('/git-push', async (req: Request, res: Response) => {
  try {
    const { directory, remote, branch, setUpstream } = req.body as { directory?: string; remote?: string; branch?: string; setUpstream?: boolean };
    if (!directory) { res.status(400).json({ error: 'Missing directory parameter' }); return; }
    if (!path.isAbsolute(directory)) { res.status(400).json({ error: 'Directory must be absolute' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: directory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    try {
      let cmd = 'git push';
      if (setUpstream) cmd += ' -u';
      if (remote) cmd += ` "${remote}"`;
      if (branch) cmd += ` "${branch}"`;
      const output = execSync(cmd, { cwd: gitRoot, encoding: 'utf-8', timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
      res.json({ success: true, output: output.trim() });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message || '';
      if (stderr.includes('rejected')) {
        res.status(409).json({ success: false, error: 'Push rejected. Pull first to integrate remote changes.' });
      } else if (stderr.includes('no upstream')) {
        res.status(400).json({ success: false, error: 'No upstream branch configured. Use "Set Upstream" option.' });
      } else if (stderr.includes('ETIMEDOUT') || stderr.includes('Could not resolve')) {
        res.status(504).json({ success: false, error: 'Network error. Check your connection.' });
      } else {
        res.status(500).json({ success: false, error: stderr.trim() || err.message });
      }
    }
  } catch (err: any) {
    log.error(' Failed to push:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/git-log-message - Get last commit message (for amend)
router.get('/git-log-message', async (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string;
    if (!dirPath) { res.status(400).json({ error: 'Missing path parameter' }); return; }
    if (!path.isAbsolute(dirPath)) { res.status(400).json({ error: 'Path must be absolute' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: dirPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    try {
      const message = execSync('git log -1 --format=%B', { cwd: gitRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      res.json({ message });
    } catch {
      res.json({ message: '' });
    }
  } catch (err: any) {
    log.error(' Failed to get log message:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-commit - Commit staged changes
router.post('/git-commit', async (req: Request, res: Response) => {
  try {
    const { directory, message, amend, paths } = req.body as {
      directory?: string;
      message?: string;
      amend?: boolean;
      paths?: string[];
    };

    if (!directory || typeof directory !== 'string') {
      res.status(400).json({ error: 'Missing directory parameter' });
      return;
    }
    if (!path.isAbsolute(directory)) {
      res.status(400).json({ error: 'Directory must be absolute' });
      return;
    }
    if (!message || !message.trim()) {
      res.status(400).json({ error: 'Commit message cannot be empty' });
      return;
    }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: directory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    // If specific paths are provided, stage them first
    if (paths && Array.isArray(paths) && paths.length > 0) {
      const relativePaths: string[] = [];
      for (const p of paths) {
        if (!path.isAbsolute(p)) {
          res.status(400).json({ error: `Path must be absolute: ${p}` });
          return;
        }
        const rel = path.relative(gitRoot, p);
        if (rel.startsWith('..')) {
          res.status(400).json({ error: `Path is outside the git repository: ${p}` });
          return;
        }
        relativePaths.push(rel);
      }
      const quotedPaths = relativePaths.map(p => `"${p}"`).join(' ');
      try {
        execSync(`git add ${quotedPaths}`, { cwd: gitRoot, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
      } catch (err: any) {
        res.status(500).json({ success: false, error: `Failed to stage files: ${err.message}` });
        return;
      }
    }

    // Build commit command - write message to a temp file to avoid shell escaping issues
    const tmpFile = path.join(gitRoot, '.git', 'TIDE_COMMIT_MSG');
    try {
      fs.writeFileSync(tmpFile, message, 'utf-8');
      let cmd = `git commit -F "${tmpFile}"`;
      if (amend) cmd = `git commit --amend -F "${tmpFile}"`;

      const output = execSync(cmd, { cwd: gitRoot, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
      res.json({ success: true, output: output.trim() });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.stdout?.toString() || err.message || '';
      if (stderr.includes('nothing to commit') || stderr.includes('nothing added to commit')) {
        res.status(400).json({ success: false, error: 'Nothing to commit. Stage files first.' });
      } else {
        res.status(500).json({ success: false, error: stderr.trim() || err.message });
      }
    } finally {
      // Clean up temp file
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  } catch (err: any) {
    log.error(' Failed to commit:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-merge - Merge a branch into the current branch
router.post('/git-merge', async (req: Request, res: Response) => {
  try {
    const { directory, branch } = req.body as { directory?: string; branch?: string };
    if (!directory) { res.status(400).json({ error: 'Missing directory parameter' }); return; }
    if (!path.isAbsolute(directory)) { res.status(400).json({ error: 'Directory must be absolute' }); return; }
    if (!branch) { res.status(400).json({ error: 'Missing branch parameter' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: directory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    try {
      const output = execSync(`git merge "${branch}"`, { cwd: gitRoot, encoding: 'utf-8', timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
      res.json({ success: true, output: output.trim() });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || '';
      const stdout = err.stdout?.toString() || '';
      const combined = stdout + '\n' + stderr;

      if (combined.includes('CONFLICT') || combined.includes('Automatic merge failed')) {
        // Parse conflict file paths from output
        const conflicts: string[] = [];
        const conflictRegex = /CONFLICT \([^)]+\): Merge conflict in (.+)/g;
        let match;
        while ((match = conflictRegex.exec(combined)) !== null) {
          conflicts.push(path.join(gitRoot, match[1].trim()));
        }
        // Also check for "both modified" / "both added" patterns
        const bothRegex = /CONFLICT \([^)]+\):.+?(?:both modified|both added):\s*(.+)/g;
        while ((match = bothRegex.exec(combined)) !== null) {
          const conflictPath = path.join(gitRoot, match[1].trim());
          if (!conflicts.includes(conflictPath)) {
            conflicts.push(conflictPath);
          }
        }
        res.json({ success: false, output: combined.trim(), conflicts });
      } else if (combined.includes('not something we can merge') || combined.includes('not a valid')) {
        res.status(400).json({ success: false, error: `Branch '${branch}' not found` });
      } else if (combined.includes('uncommitted changes') || combined.includes('not possible because you have unmerged')) {
        res.status(409).json({ success: false, error: 'You have uncommitted changes. Commit or stash them first.' });
      } else {
        res.status(500).json({ success: false, error: (stderr || stdout).trim() || err.message });
      }
    }
  } catch (err: any) {
    log.error(' Failed to merge:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/git-conflict-file - Get ours/theirs/merged versions of a conflict file
router.get('/git-conflict-file', async (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string;
    const filePath = req.query.file as string;
    if (!dirPath || !filePath) { res.status(400).json({ error: 'Missing path or file parameter' }); return; }
    if (!path.isAbsolute(dirPath)) { res.status(400).json({ error: 'Path must be absolute' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: dirPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    // Get the relative path from git root
    const absFilePath = path.isAbsolute(filePath) ? filePath : path.join(gitRoot, filePath);
    const relPath = path.relative(gitRoot, absFilePath);

    // Read the three versions
    let ours = '';
    let theirs = '';
    let merged = '';

    try {
      ours = execSync(`git show ":2:${relPath}"`, { cwd: gitRoot, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    } catch {
      ours = ''; // File may not exist in ours (e.g., added by both)
    }

    try {
      theirs = execSync(`git show ":3:${relPath}"`, { cwd: gitRoot, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    } catch {
      theirs = ''; // File may not exist in theirs
    }

    try {
      merged = fs.readFileSync(absFilePath, 'utf-8');
    } catch {
      res.status(404).json({ error: 'Conflict file not found on disk' });
      return;
    }

    res.json({ ours, theirs, merged, filename: path.basename(absFilePath) });
  } catch (err: any) {
    log.error(' Failed to get conflict file:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-resolve-conflict - Write resolved content and stage the file
router.post('/git-resolve-conflict', async (req: Request, res: Response) => {
  try {
    const { directory, file, content } = req.body as { directory?: string; file?: string; content?: string };
    if (!directory || !file) { res.status(400).json({ error: 'Missing directory or file parameter' }); return; }
    if (!path.isAbsolute(directory)) { res.status(400).json({ error: 'Directory must be absolute' }); return; }
    if (content === undefined || content === null) { res.status(400).json({ error: 'Missing content parameter' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: directory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    const absFilePath = path.isAbsolute(file) ? file : path.join(gitRoot, file);
    const relPath = path.relative(gitRoot, absFilePath);

    if (relPath.startsWith('..')) {
      res.status(400).json({ error: 'File is outside the git repository' });
      return;
    }

    // Write the resolved content
    fs.writeFileSync(absFilePath, content, 'utf-8');

    // Stage the resolved file
    execSync(`git add "${relPath}"`, { cwd: gitRoot, encoding: 'utf-8' });

    res.json({ success: true });
  } catch (err: any) {
    log.error(' Failed to resolve conflict:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-merge-continue - Complete the merge after all conflicts are resolved
router.post('/git-merge-continue', async (req: Request, res: Response) => {
  try {
    const { directory } = req.body as { directory?: string };
    if (!directory) { res.status(400).json({ error: 'Missing directory parameter' }); return; }
    if (!path.isAbsolute(directory)) { res.status(400).json({ error: 'Directory must be absolute' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: directory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    try {
      const output = execSync('git commit --no-edit', { cwd: gitRoot, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
      res.json({ success: true, output: output.trim() });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.stdout?.toString() || err.message || '';
      res.status(500).json({ success: false, error: stderr.trim() || err.message });
    }
  } catch (err: any) {
    log.error(' Failed to continue merge:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-merge-abort - Abort an in-progress merge
router.post('/git-merge-abort', async (req: Request, res: Response) => {
  try {
    const { directory } = req.body as { directory?: string };
    if (!directory) { res.status(400).json({ error: 'Missing directory parameter' }); return; }
    if (!path.isAbsolute(directory)) { res.status(400).json({ error: 'Directory must be absolute' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: directory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    try {
      const output = execSync('git merge --abort', { cwd: gitRoot, encoding: 'utf-8' });
      res.json({ success: true, output: (output || '').trim() });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message || '';
      res.status(500).json({ success: false, error: stderr.trim() || err.message });
    }
  } catch (err: any) {
    log.error(' Failed to abort merge:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/git-branch-compare - Compare two branches and return changed files
router.get('/git-branch-compare', async (req: Request, res: Response) => {
  try {
    const directory = req.query.directory as string;
    const branch = req.query.branch as string;

    if (!directory) {
      res.status(400).json({ error: 'Missing directory parameter' });
      return;
    }

    if (!path.isAbsolute(directory)) {
      res.status(400).json({ error: 'Directory must be absolute' });
      return;
    }

    if (!branch) {
      res.status(400).json({ error: 'Missing branch parameter' });
      return;
    }

    // Find git root
    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd: directory,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    // Get current branch
    let currentBranch: string;
    try {
      currentBranch = execSync('git branch --show-current', {
        cwd: gitRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      currentBranch = 'HEAD';
    }

    // Get diff between branches (three-dot diff: changes since branches diverged)
    let diffOutput: string;
    try {
      diffOutput = execSync(`git diff --name-status ${branch}...HEAD`, {
        cwd: gitRoot,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message || '';
      res.status(400).json({ error: stderr.trim() || 'Failed to compare branches' });
      return;
    }

    const counts = { modified: 0, added: 0, deleted: 0, untracked: 0, renamed: 0, conflict: 0 };
    const files: Array<{ path: string; name: string; status: string; oldPath?: string }> = [];

    const lines = diffOutput.trim().split('\n').filter((l: string) => l.trim());
    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length < 2) continue;

      const statusCode = parts[0].trim();
      let status: string;
      let filePath: string;
      let oldPath: string | undefined;

      if (statusCode === 'M') {
        status = 'modified';
        filePath = parts[1];
      } else if (statusCode === 'A') {
        status = 'added';
        filePath = parts[1];
      } else if (statusCode === 'D') {
        status = 'deleted';
        filePath = parts[1];
      } else if (statusCode.startsWith('R')) {
        status = 'renamed';
        oldPath = path.join(gitRoot, parts[1]);
        filePath = parts[2] || parts[1];
      } else if (statusCode.startsWith('C')) {
        status = 'modified';
        filePath = parts[2] || parts[1];
      } else {
        status = 'modified';
        filePath = parts[1];
      }

      const absolutePath = path.join(gitRoot, filePath);
      const entry: { path: string; name: string; status: string; oldPath?: string } = {
        path: absolutePath,
        name: path.basename(absolutePath),
        status,
      };
      if (oldPath) {
        entry.oldPath = oldPath;
      }
      files.push(entry);

      if (status === 'renamed') {
        counts.renamed++;
      } else if (status in counts) {
        (counts as any)[status]++;
      }
    }

    res.json({ files, counts, baseBranch: branch, currentBranch });
  } catch (err: any) {
    log.error(' Failed to compare branches:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/git-show - Get file content at a specific git ref
router.get('/git-show', async (req: Request, res: Response) => {
  try {
    const filePath = req.query.path as string;
    const ref = req.query.ref as string;

    if (!filePath) {
      res.status(400).json({ error: 'Missing path parameter' });
      return;
    }

    if (!path.isAbsolute(filePath)) {
      res.status(400).json({ error: 'Path must be absolute' });
      return;
    }

    if (!ref) {
      res.status(400).json({ error: 'Missing ref parameter' });
      return;
    }

    // Find git root
    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd: path.dirname(filePath),
        encoding: 'utf-8',
      }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    // Get relative path from git root
    const relativePath = path.relative(gitRoot, filePath);

    // Get file content at the specified ref
    let content: string;
    try {
      content = execSync(`git show ${ref}:"${relativePath}"`, {
        cwd: gitRoot,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
    } catch (err: any) {
      // File doesn't exist at the given ref
      if (err.message?.includes('does not exist') || err.message?.includes('fatal')) {
        res.json({
          path: filePath,
          filename: path.basename(filePath),
          extension: path.extname(filePath).toLowerCase(),
          content: '',
          notFound: true,
        });
        return;
      }
      throw err;
    }

    res.json({
      path: filePath,
      filename: path.basename(filePath),
      extension: path.extname(filePath).toLowerCase(),
      content,
      notFound: false,
    });
  } catch (err: any) {
    log.error(' Failed to get file at ref:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/git-commit-file-diff - Get before/after content for a file in a commit
router.get('/git-commit-file-diff', async (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string;
    const hash = req.query.hash as string;
    const filePath = req.query.file as string;

    if (!dirPath || !hash || !filePath) {
      res.status(400).json({ error: 'Missing path, hash, or file parameter' });
      return;
    }

    if (!path.isAbsolute(dirPath)) {
      res.status(400).json({ error: 'Path must be absolute' });
      return;
    }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd: dirPath,
        encoding: 'utf-8',
      }).trim();
    } catch {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    const relativePath = resolveGitRelativePath(gitRoot, filePath);
    if (!relativePath) {
      res.status(400).json({ error: 'File path is outside the git repository' });
      return;
    }

    const filename = path.basename(relativePath);
    const extension = path.extname(relativePath).toLowerCase();

    // Get file content after the commit
    let afterContent = '';
    try {
      afterContent = execSync(`git show "${hash}:${relativePath}"`, {
        cwd: gitRoot,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch {
      // File doesn't exist at this commit (was deleted)
      afterContent = '';
    }

    // Get file content before the commit (parent)
    let beforeContent = '';
    try {
      beforeContent = execSync(`git show "${hash}~1:${relativePath}"`, {
        cwd: gitRoot,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch {
      // File doesn't exist before this commit (was added)
      beforeContent = '';
    }

    res.json({
      filename,
      extension,
      filePath: relativePath,
      hash,
      beforeContent,
      afterContent,
    });
  } catch (err: any) {
    log.error(' Failed to get commit file diff:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/open-in-editor - Open file in specified or default editor
router.post('/open-in-editor', async (req: Request, res: Response) => {
  try {
    const { path: filePath, editorCommand } = req.body as { path?: string; editorCommand?: string };
    if (!filePath) { res.status(400).json({ error: 'Missing path parameter' }); return; }
    if (!path.isAbsolute(filePath)) { res.status(400).json({ error: 'Path must be absolute' }); return; }
    if (filePath.includes('..')) { res.status(400).json({ error: 'Path traversal not allowed' }); return; }
    if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found' }); return; }

    const platform = process.platform;
    let cmd: string;
    let args: string[];

    // If custom editor command is provided, use it
    if (editorCommand && editorCommand.trim()) {
      // Parse the command string to separate command and arguments
      const parts = editorCommand.trim().split(/\s+/);
      cmd = parts[0];
      args = [...parts.slice(1), filePath];
    } else {
      // Use platform default
      if (platform === 'linux') {
        cmd = 'xdg-open';
        args = [filePath];
      } else if (platform === 'darwin') {
        cmd = 'open';
        args = [filePath];
      } else if (platform === 'win32') {
        cmd = 'cmd';
        args = ['/c', 'start', '', filePath];
      } else {
        res.status(500).json({ error: `Unsupported platform: ${platform}` });
        return;
      }
    }

    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.unref();

    res.json({ success: true });
  } catch (err: any) {
    log.error(' Failed to open in editor:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/reveal - Reveal a file in the system file explorer
router.post('/reveal', async (req: Request, res: Response) => {
  try {
    const validation = validateRevealPath((req.body as { path?: unknown })?.path);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const method = await revealPathInFileExplorer(validation.path);
    res.json({ success: true, method });
  } catch (err: any) {
    log.error(' Failed to reveal file in explorer:', err);
    const message = err?.message || 'Failed to reveal file in explorer';
    if (message.startsWith('Unsupported platform:')) {
      res.status(500).json({ error: message });
      return;
    }
    res.status(500).json({ error: message });
  }
});

// POST /api/files/write - Write content to an existing file
router.post('/write', async (req: Request, res: Response) => {
  try {
    const { path: filePath, content } = req.body as { path?: string; content?: string };
    if (!filePath) { res.status(400).json({ error: 'Missing path parameter' }); return; }
    if (typeof content !== 'string') { res.status(400).json({ error: 'Missing content parameter' }); return; }
    if (!path.isAbsolute(filePath)) { res.status(400).json({ error: 'Path must be absolute' }); return; }
    if (filePath.includes('..')) { res.status(400).json({ error: 'Path traversal not allowed' }); return; }
    if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found' }); return; }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) { res.status(400).json({ error: 'Cannot write to a directory' }); return; }

    // Limit write size to 2MB
    const MAX_WRITE_SIZE = 2 * 1024 * 1024;
    if (Buffer.byteLength(content, 'utf-8') > MAX_WRITE_SIZE) {
      res.status(400).json({ error: 'Content exceeds maximum size (2MB)' });
      return;
    }

    fs.writeFileSync(filePath, content, 'utf-8');
    res.json({ success: true });
  } catch (err: any) {
    log.error(' Failed to write file:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/by-path - Load and return a file by its path (for clipboard paste)
router.post('/by-path', async (req: Request, res: Response) => {
  try {
    const { path: filePath } = req.body as { path?: string };

    if (!filePath) {
      res.status(400).json({ error: 'Missing path parameter' });
      return;
    }

    // Expand ~ to home directory
    let expandedPath = filePath;
    if (filePath.startsWith('~')) {
      expandedPath = path.join(os.homedir(), filePath.slice(1));
    }

    // Security: ensure path is absolute
    if (!path.isAbsolute(expandedPath)) {
      res.status(400).json({ error: 'Path must be absolute' });
      return;
    }

    if (!fs.existsSync(expandedPath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const stats = fs.statSync(expandedPath);

    if (stats.isDirectory()) {
      res.status(400).json({ error: 'Path is a directory' });
      return;
    }

    // Limit file size to 50MB for binary files
    if (stats.size > 50 * 1024 * 1024) {
      res.status(400).json({ error: 'File too large (max 50MB)' });
      return;
    }

    const extension = path.extname(expandedPath).toLowerCase();
    const _filename = path.basename(expandedPath);

    // Determine if it's an image
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg'];
    const _isImage = imageExtensions.includes(extension);

    res.setHeader('Content-Type', binaryContentTypeForExtension(extension));
    res.setHeader('Content-Length', stats.size);

    // Stream the file
    const stream = fs.createReadStream(expandedPath);
    stream.pipe(res);

    stream.on('error', (err) => {
      log.error(' Failed to stream file:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to read file' });
      }
    });
  } catch (err: any) {
    log.error(' Failed to load file by path:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/upload - Upload a file to temp directory
router.post('/upload', async (req: Request, res: Response) => {
  try {
    const contentType = req.headers['content-type'] || '';
    let filename = req.headers['x-filename'] as string;
    const isImage = contentType.startsWith('image/');

    // Decode filename if it's URL-encoded (handles special characters like –, é, etc.)
    if (filename) {
      try {
        filename = decodeURIComponent(filename);
      } catch {
        // If decoding fails, use as-is
      }
    }

    // Generate unique filename
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);

    let finalFilename: string;
    let extension: string;

    if (filename) {
      // Use provided filename with unique prefix
      extension = path.extname(filename);
      const baseName = path.basename(filename, extension);
      finalFilename = `${baseName}-${randomId}${extension}`;
    } else if (isImage) {
      // Determine extension from content type
      const extMap: Record<string, string> = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/svg+xml': '.svg',
      };
      extension = extMap[contentType] || '.png';
      finalFilename = `image-${timestamp}-${randomId}${extension}`;
    } else {
      // Default to txt
      extension = '.txt';
      finalFilename = `file-${timestamp}-${randomId}${extension}`;
    }

    const filePath = path.join(TEMP_DIR, finalFilename);

    // Collect body data
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      const buffer = Buffer.concat(chunks);

      // Write file
      fs.writeFileSync(filePath, buffer);

      log.log(` Uploaded: ${filePath} (${buffer.length} bytes)`);

      res.json({
        success: true,
        path: `/uploads/${finalFilename}`,
        absolutePath: filePath,
        filename: finalFilename,
        size: buffer.length,
        isImage,
        tempDir: TEMP_DIR,
      });
    });

    req.on('error', (err) => {
      log.error(' Upload error:', err);
      res.status(500).json({ error: 'Upload failed' });
    });
  } catch (err: any) {
    log.error(' Failed to upload file:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/temp-dir - Get the temp directory path
router.get('/temp-dir', (_req: Request, res: Response) => {
  res.json({ path: TEMP_DIR });
});

// GET /api/files/autocomplete - Autocomplete paths for folder/file input
router.get('/autocomplete', async (req: Request, res: Response) => {
  try {
    const inputPath = req.query.path as string;
    const directoriesOnly = req.query.dirs === 'true';
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    if (!inputPath) {
      // Return common starting points
      const homedir = os.homedir();
      const suggestions = [
        { name: '~', path: homedir, isDirectory: true },
        { name: '/', path: '/', isDirectory: true },
      ];
      res.json({ suggestions, basePath: '', partial: '' });
      return;
    }

    // Expand ~ to home directory
    let expandedPath = inputPath;
    if (inputPath.startsWith('~')) {
      expandedPath = path.join(os.homedir(), inputPath.slice(1));
    }

    // Determine base directory and partial name being typed
    let basePath: string;
    let partial: string;

    if (expandedPath.endsWith('/') || expandedPath === '/') {
      // User ended with / - list contents of that directory
      basePath = expandedPath === '/' ? '/' : expandedPath.slice(0, -1);
      partial = '';
    } else {
      // User is typing a partial name - get parent directory
      basePath = path.dirname(expandedPath);
      partial = path.basename(expandedPath).toLowerCase();
    }

    // Check if base path exists
    if (!fs.existsSync(basePath)) {
      // Try to find the closest existing parent
      let checkPath = basePath;
      while (checkPath !== '/' && !fs.existsSync(checkPath)) {
        checkPath = path.dirname(checkPath);
      }
      res.json({ suggestions: [], basePath: checkPath, partial, error: 'Path not found' });
      return;
    }

    // Check if it's a directory
    const stats = fs.statSync(basePath);
    if (!stats.isDirectory()) {
      res.json({ suggestions: [], basePath, partial, error: 'Not a directory' });
      return;
    }

    // Read directory entries
    const entries = fs.readdirSync(basePath, { withFileTypes: true });
    const suggestions: Array<{ name: string; path: string; isDirectory: boolean }> = [];

    for (const entry of entries) {
      // Skip hidden files unless user is explicitly typing a dot
      if (entry.name.startsWith('.') && !partial.startsWith('.')) continue;

      // Filter by partial match
      if (partial && !entry.name.toLowerCase().startsWith(partial)) continue;

      // Filter by directories only if requested
      if (directoriesOnly && !entry.isDirectory()) continue;

      const fullPath = path.join(basePath, entry.name);

      suggestions.push({
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory(),
      });

      if (suggestions.length >= limit) break;
    }

    // Sort: directories first, then alphabetically
    suggestions.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    res.json({ suggestions, basePath, partial });
  } catch (err: any) {
    log.error(' Failed to autocomplete path:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/files/temp/:filename - Delete a temp file
router.delete('/temp/:filename', (req: Request<{ filename: string }>, res: Response) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(TEMP_DIR, filename);

    // Security: ensure file is in temp dir
    if (!filePath.startsWith(TEMP_DIR)) {
      res.status(403).json({ error: 'Invalid path' });
      return;
    }

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err: any) {
    log.error(' Failed to delete temp file:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/git-fetch - Run git fetch in a directory
router.post('/git-fetch', async (req: Request, res: Response) => {
  try {
    const dirPath = (req.body as { path?: string }).path;
    if (!dirPath || typeof dirPath !== 'string') { res.status(400).json({ error: 'Missing path parameter' }); return; }
    if (!path.isAbsolute(dirPath)) { res.status(400).json({ error: 'Path must be absolute' }); return; }
    if (!fs.existsSync(dirPath)) { res.status(404).json({ error: 'Directory not found' }); return; }

    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { cwd: dirPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      res.status(400).json({ error: 'Not a git repository' });
      return;
    }

    try {
      execSync('git fetch --prune', { cwd: gitRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000 });
    } catch (err: any) {
      res.status(500).json({ error: `git fetch failed: ${err.message}` });
      return;
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/delete - Delete a file or (with recursive: true) a directory
router.post('/delete', (req: Request, res: Response) => {
  try {
    const { path: filePath, recursive } = req.body as { path?: string; recursive?: boolean };
    if (!filePath || typeof filePath !== 'string') {
      res.status(400).json({ error: 'Missing path parameter' });
      return;
    }
    if (!path.isAbsolute(filePath)) {
      res.status(400).json({ error: 'Path must be absolute' });
      return;
    }
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (!recursive) {
        res.status(400).json({ error: 'Pass recursive: true to delete directories' });
        return;
      }
      fs.rmSync(filePath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(filePath);
    }
    res.json({ success: true });
  } catch (err: any) {
    log.error(' Failed to delete path:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Git History Endpoints
// ============================================================

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function resolveGitRootOrThrow(dirPath: string): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd: dirPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function resolveGitRelativePath(gitRoot: string, inputPath: string): string | null {
  const resolvedPath = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(gitRoot, inputPath);
  const relativePath = path.relative(gitRoot, resolvedPath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }

  return relativePath.split(path.sep).join('/');
}

function parseGitRefs(refsValue: string): { branches: string[]; tags: string[]; isHead: boolean } {
  const branches: string[] = [];
  const tags: string[] = [];
  let isHead = false;

  const normalizedRefs = refsValue.trim().replace(/^\((.*)\)$/, '$1');
  if (!normalizedRefs) {
    return { branches, tags, isHead };
  }

  for (const rawPart of normalizedRefs.split(',')) {
    const part = rawPart.trim();
    if (!part) {
      continue;
    }
    if (part === 'HEAD') {
      isHead = true;
      continue;
    }
    if (part.startsWith('HEAD -> ')) {
      isHead = true;
      branches.push(part.slice('HEAD -> '.length).trim());
      continue;
    }
    if (part.startsWith('tag: ')) {
      tags.push(part.slice('tag: '.length).trim());
      continue;
    }
    branches.push(part);
  }

  return { branches, tags, isHead };
}

function buildGitLogFilterArgs(params: {
  branch?: string;
  author?: string;
  since?: string;
  until?: string;
  search?: string;
  searchPath?: string;
}) {
  const revision = params.branch?.trim() || 'HEAD';
  const args = [shellEscape(revision)];

  if (params.author?.trim()) {
    args.push(`--author=${shellEscape(params.author.trim())}`);
  }
  if (params.since?.trim()) {
    args.push(`--since=${shellEscape(params.since.trim())}`);
  }
  if (params.until?.trim()) {
    args.push(`--until=${shellEscape(params.until.trim())}`);
  }
  if (params.search?.trim()) {
    args.push(`--grep=${shellEscape(params.search.trim())}`);
  }
  if (params.searchPath) {
    args.push('--', shellEscape(params.searchPath));
  }

  return args;
}

// GET /api/files/git-log - Commit history with pagination and filters
router.get('/git-log', async (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string;
    if (!dirPath) { res.status(400).json({ error: 'Missing path parameter' }); return; }
    if (!path.isAbsolute(dirPath)) { res.status(400).json({ error: 'Path must be absolute' }); return; }
    if (!fs.existsSync(dirPath)) { res.status(404).json({ error: 'Directory not found' }); return; }

    const gitRoot = resolveGitRootOrThrow(dirPath);
    if (!gitRoot) {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    const parsedLimit = Number.parseInt(req.query.limit as string, 10);
    const parsedOffset = Number.parseInt(req.query.offset as string, 10);
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 50;
    const offset = Number.isFinite(parsedOffset) ? parsedOffset : 0;
    if (limit <= 0) { res.status(400).json({ error: 'Limit must be greater than 0' }); return; }
    if (offset < 0) { res.status(400).json({ error: 'Offset must be 0 or greater' }); return; }

    const branch = req.query.branch as string | undefined;
    const author = req.query.author as string | undefined;
    const since = req.query.since as string | undefined;
    const until = req.query.until as string | undefined;
    const search = req.query.search as string | undefined;
    const searchPathInput = req.query.searchPath as string | undefined;

    let searchPath: string | undefined;
    if (searchPathInput) {
      const resolvedSearchPath = resolveGitRelativePath(gitRoot, searchPathInput);
      if (!resolvedSearchPath) {
        res.status(400).json({ error: 'searchPath is outside the git repository' });
        return;
      }
      searchPath = resolvedSearchPath;
    }

    const filterArgs = buildGitLogFilterArgs({ branch, author, since, until, search, searchPath });
    const logFormat = '%H%x00%h%x00%an%x00%ae%x00%aI%x00%s%x00%D';
    const logCommand = [
      'git log',
      `--format=${shellEscape(logFormat)}`,
      `--skip=${offset}`,
      `--max-count=${limit}`,
      ...filterArgs,
    ].join(' ');

    let logOutput = '';
    try {
      logOutput = execSync(logCommand, {
        cwd: gitRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message || '';
      if (stderr.includes('does not have any commits yet')) {
        res.json({ commits: [], total: 0, hasMore: false });
        return;
      }
      if (stderr.includes('unknown revision') || stderr.includes('bad revision') || stderr.includes('ambiguous argument')) {
        res.status(400).json({ error: stderr.trim() || 'Invalid branch or revision' });
        return;
      }
      throw err;
    }

    const lines = logOutput ? logOutput.trim().split('\n').filter(l => l) : [];
    const commits: Array<{
      hash: string;
      shortHash: string;
      author: string;
      authorEmail: string;
      date: string;
      subject: string;
      refs: { branches: string[]; tags: string[]; isHead: boolean };
    }> = [];

    for (const line of lines) {
      const fields = line.split('\x00');
      if (fields.length < 6) continue;
      commits.push({
        hash: fields[0] || '',
        shortHash: fields[1] || '',
        author: fields[2] || '',
        authorEmail: fields[3] || '',
        date: fields[4] || '',
        subject: fields[5] || '',
        refs: parseGitRefs(fields[6] || ''),
      });
    }

    let total = 0;
    try {
      const countCommand = ['git rev-list --count', ...filterArgs].join(' ');
      total = Number.parseInt(execSync(countCommand, {
        cwd: gitRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024,
      }).trim(), 10) || 0;
    } catch {
      total = offset + commits.length;
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.json({ commits, total, hasMore: offset + commits.length < total });
  } catch (err: any) {
    log.error(' Failed to get git log:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/git-commit-files - Files changed in a specific commit
router.get('/git-commit-files', async (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string;
    const hash = req.query.hash as string;
    if (!dirPath) { res.status(400).json({ error: 'Missing path parameter' }); return; }
    if (!path.isAbsolute(dirPath)) { res.status(400).json({ error: 'Path must be absolute' }); return; }
    if (!fs.existsSync(dirPath)) { res.status(404).json({ error: 'Directory not found' }); return; }
    if (!hash) { res.status(400).json({ error: 'Missing hash parameter' }); return; }
    if (!/^[0-9a-f]{4,40}$/i.test(hash)) { res.status(400).json({ error: 'Invalid commit hash format' }); return; }

    const gitRoot = resolveGitRootOrThrow(dirPath);
    if (!gitRoot) {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    let parentLine = '';
    try {
      parentLine = execSync(`git rev-list --parents -n 1 ${shellEscape(hash)}`, {
        cwd: gitRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024,
      }).trim();
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message || '';
      if (stderr.includes('unknown revision') || stderr.includes('bad object') || stderr.includes('ambiguous argument')) {
        res.status(404).json({ error: 'Commit not found' });
        return;
      }
      throw err;
    }

    const parentCount = parentLine ? parentLine.split(/\s+/).length - 1 : 0;
    const diffTreeCommand = parentCount === 0
      ? `git diff-tree --no-commit-id -r --name-status --root ${shellEscape(hash)}`
      : `git diff-tree --no-commit-id -r --name-status ${shellEscape(hash)}`;

    const output = execSync(diffTreeCommand, {
      cwd: gitRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    });

    const files: Array<{ path: string; status: 'modified' | 'added' | 'deleted' | 'renamed'; oldPath?: string }> = [];
    for (const line of output.split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      const statusCode = parts[0] || '';

      if (statusCode.startsWith('R') && parts.length >= 3) {
        files.push({
          path: parts[2],
          status: 'renamed',
          oldPath: parts[1],
        });
        continue;
      }

      if (parts.length < 2) {
        continue;
      }

      let status: 'modified' | 'added' | 'deleted' | 'renamed' = 'modified';
      if (statusCode.startsWith('A')) status = 'added';
      else if (statusCode.startsWith('D')) status = 'deleted';
      else if (statusCode.startsWith('R')) status = 'renamed';

      files.push({
        path: parts[1],
        status,
      });
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.json({ files });
  } catch (err: any) {
    log.error(' Failed to get commit files:', err);
    res.status(500).json({ error: err.message });
  }
});

// Simple extension-based language detection for the diff viewer
function detectLanguageFromPath(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'makefile';
  const ext = path.extname(base);
  const mapping: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.json': 'json', '.jsonc': 'json',
    '.html': 'html', '.htm': 'html',
    '.css': 'css', '.scss': 'scss', '.sass': 'sass', '.less': 'less',
    '.md': 'markdown', '.mdx': 'markdown',
    '.py': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust',
    '.java': 'java', '.kt': 'kotlin', '.swift': 'swift',
    '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp',
    '.cs': 'csharp', '.php': 'php',
    '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
    '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.xml': 'xml',
    '.sql': 'sql', '.lua': 'lua', '.dart': 'dart',
    '.svelte': 'svelte', '.vue': 'vue',
    '.dockerfile': 'dockerfile', '.ini': 'ini', '.env': 'shell',
  };
  return mapping[ext] || 'plaintext';
}

// GET /api/files/git-file-history - History of commits that touched a single file (with --follow)
router.get('/git-file-history', async (req: Request, res: Response) => {
  try {
    const filePath = req.query.path as string;
    const cwd = req.query.cwd as string;
    const limitParam = req.query.limit as string | undefined;

    if (!filePath) { res.status(400).json({ error: 'Missing path parameter' }); return; }
    if (!cwd) { res.status(400).json({ error: 'Missing cwd parameter' }); return; }
    if (!path.isAbsolute(cwd)) { res.status(400).json({ error: 'cwd must be absolute' }); return; }
    if (!fs.existsSync(cwd)) { res.status(404).json({ error: 'cwd not found' }); return; }

    let limit = 100;
    if (limitParam !== undefined) {
      const parsed = Number.parseInt(limitParam, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        res.status(400).json({ error: 'limit must be a positive integer' });
        return;
      }
      limit = Math.min(parsed, 1000);
    }

    const gitRoot = resolveGitRootOrThrow(cwd);
    if (!gitRoot) { res.status(400).json({ error: 'Not in a git repository' }); return; }

    const relativePath = resolveGitRelativePath(gitRoot, filePath);
    if (!relativePath) { res.status(400).json({ error: 'path is outside the git repository' }); return; }

    // NUL-delimited fields, newline-separated commits (git log default)
    const logFormat = '%H%x00%h%x00%an%x00%ae%x00%aI%x00%s';
    const cmd = [
      'git log',
      '--follow',
      `--format=${shellEscape(logFormat)}`,
      `-n ${limit}`,
      '--',
      shellEscape(relativePath),
    ].join(' ');

    let output = '';
    try {
      output = execSync(cmd, {
        cwd: gitRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message || '';
      if (stderr.includes('does not have any commits yet')) {
        res.json({ commits: [] });
        return;
      }
      if (stderr.includes('unknown revision') || stderr.includes('bad revision') || stderr.includes('ambiguous argument')) {
        res.status(404).json({ error: 'file not tracked' });
        return;
      }
      throw err;
    }

    const commits: Array<{
      sha: string;
      shortSha: string;
      author: string;
      email: string;
      date: string;
      subject: string;
    }> = [];

    for (const line of output.split('\n')) {
      if (!line) continue;
      const fields = line.split('\x00');
      if (fields.length < 6) continue;
      commits.push({
        sha: fields[0] || '',
        shortSha: fields[1] || '',
        author: fields[2] || '',
        email: fields[3] || '',
        date: fields[4] || '',
        subject: fields[5] || '',
      });
    }

    if (commits.length === 0) {
      // Distinguish "tracked but no history" (rare) from "not tracked at all" (404).
      try {
        execSync(`git ls-files --error-unmatch -- ${shellEscape(relativePath)}`, {
          cwd: gitRoot,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        res.status(404).json({ error: 'file not tracked' });
        return;
      }
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.json({ commits });
  } catch (err: any) {
    log.error(' Failed to get git file history:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/git-file-commit-diff - File contents at <sha> vs its parent, for the
// per-file history diff viewer (GitFileHistoryModal). Distinct from the older
// /git-commit-file-diff endpoint above, which serves the FileExplorerPanel commit-log
// view with a different param/shape contract.
router.get('/git-file-commit-diff', async (req: Request, res: Response) => {
  try {
    const filePath = req.query.path as string;
    const cwd = req.query.cwd as string;
    const sha = req.query.sha as string;

    if (!filePath) { res.status(400).json({ error: 'Missing path parameter' }); return; }
    if (!cwd) { res.status(400).json({ error: 'Missing cwd parameter' }); return; }
    if (!sha) { res.status(400).json({ error: 'Missing sha parameter' }); return; }
    if (!path.isAbsolute(cwd)) { res.status(400).json({ error: 'cwd must be absolute' }); return; }
    if (!fs.existsSync(cwd)) { res.status(404).json({ error: 'cwd not found' }); return; }
    if (!/^[a-f0-9]{4,40}$/i.test(sha)) { res.status(400).json({ error: 'Invalid commit SHA' }); return; }

    const gitRoot = resolveGitRootOrThrow(cwd);
    if (!gitRoot) { res.status(400).json({ error: 'Not in a git repository' }); return; }

    const relativePath = resolveGitRelativePath(gitRoot, filePath);
    if (!relativePath) { res.status(400).json({ error: 'path is outside the git repository' }); return; }

    // Determine if this commit has a parent (root commits don't)
    let hasParent = false;
    try {
      const parentLine = execSync(`git rev-list --parents -n 1 ${shellEscape(sha)}`, {
        cwd: gitRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      hasParent = parentLine.split(/\s+/).length > 1;
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message || '';
      if (stderr.includes('unknown revision') || stderr.includes('bad object') || stderr.includes('ambiguous argument')) {
        res.status(404).json({ error: 'Commit not found' });
        return;
      }
      throw err;
    }

    // Read raw bytes so we can sniff for binary content. execSync without encoding returns Buffer.
    const showBytes = (ref: string): { buf: Buffer | null; missing: boolean } => {
      try {
        const buf = execSync(`git show ${shellEscape(`${ref}:${relativePath}`)}`, {
          cwd: gitRoot,
          stdio: ['pipe', 'pipe', 'pipe'],
          maxBuffer: 50 * 1024 * 1024,
        }) as Buffer;
        return { buf, missing: false };
      } catch {
        // git show fails when the path doesn't exist at that ref — treat as missing.
        return { buf: null, missing: true };
      }
    };

    const original = hasParent ? showBytes(`${sha}~1`) : { buf: null, missing: true };
    const modified = showBytes(sha);

    let changeType: 'added' | 'modified' | 'deleted';
    if (original.missing && !modified.missing) changeType = 'added';
    else if (!original.missing && modified.missing) changeType = 'deleted';
    else if (!original.missing && !modified.missing) changeType = 'modified';
    else {
      res.status(404).json({ error: 'File not present in commit or its parent' });
      return;
    }

    const filename = path.basename(relativePath);

    // Binary sniff: scan first 8KB of either side for NUL byte.
    const looksBinary = (b: Buffer | null): boolean => {
      if (!b || b.length === 0) return false;
      const sample = b.subarray(0, Math.min(b.length, 8192));
      return sample.includes(0);
    };
    const binary = looksBinary(original.buf) || looksBinary(modified.buf);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');

    if (binary) {
      res.json({ binary: true, filename, changeType });
      return;
    }

    res.json({
      originalContent: original.buf ? original.buf.toString('utf-8') : '',
      modifiedContent: modified.buf ? modified.buf.toString('utf-8') : '',
      filename,
      language: detectLanguageFromPath(filename),
      changeType,
      binary: false,
    });
  } catch (err: any) {
    log.error(' Failed to get git commit file diff:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/git-branches-list - Simple branch list for filters
router.get('/git-branches-list', async (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string;
    if (!dirPath) { res.status(400).json({ error: 'Missing path parameter' }); return; }
    if (!path.isAbsolute(dirPath)) { res.status(400).json({ error: 'Path must be absolute' }); return; }
    if (!fs.existsSync(dirPath)) { res.status(404).json({ error: 'Directory not found' }); return; }

    const gitRoot = resolveGitRootOrThrow(dirPath);
    if (!gitRoot) {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    let currentBranch = 'HEAD';
    try {
      currentBranch = execSync('git branch --show-current', {
        cwd: gitRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim() || 'HEAD';
    } catch {
      currentBranch = 'HEAD';
    }

    const branches: Array<{ name: string; isCurrent: boolean; isRemote: boolean }> = [];

    try {
      const localOutput = execSync(
        "git branch --format='%(refname:short)' --sort=refname",
        { cwd: gitRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 }
      );
      for (const branchName of localOutput.split('\n').map(line => line.trim()).filter(Boolean)) {
        branches.push({ name: branchName, isCurrent: branchName === currentBranch, isRemote: false });
      }
    } catch {
      // Ignore local branch listing errors and continue with empty result.
    }

    try {
      const remoteOutput = execSync(
        "git branch -r --format='%(refname:short)' --sort=refname",
        { cwd: gitRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 }
      );
      for (const branchName of remoteOutput.split('\n').map(line => line.trim()).filter(Boolean)) {
        if (branchName.includes('/HEAD')) {
          continue;
        }
        branches.push({ name: branchName, isCurrent: false, isRemote: true });
      }
    } catch {
      // No remotes configured.
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.json({ branches, currentBranch });
  } catch (err: any) {
    log.error(' Failed to get git branches list:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/git-authors - Unique author list for filter dropdown
router.get('/git-authors', async (req: Request, res: Response) => {
  try {
    const dirPath = req.query.path as string;
    if (!dirPath) { res.status(400).json({ error: 'Missing path parameter' }); return; }
    if (!path.isAbsolute(dirPath)) { res.status(400).json({ error: 'Path must be absolute' }); return; }
    if (!fs.existsSync(dirPath)) { res.status(404).json({ error: 'Directory not found' }); return; }

    const gitRoot = resolveGitRootOrThrow(dirPath);
    if (!gitRoot) {
      res.status(400).json({ error: 'Not in a git repository' });
      return;
    }

    let output = '';
    try {
      output = execSync('git log --format=%an | sort -u', {
        cwd: gitRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message || '';
      if (stderr.includes('does not have any commits yet')) {
        res.json({ authors: [] });
        return;
      }
      throw err;
    }

    const authors = output.split('\n').map(authorName => authorName.trim()).filter(Boolean);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.json({ authors });
  } catch (err: any) {
    log.error(' Failed to get git authors:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
