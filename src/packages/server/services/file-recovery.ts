/**
 * What to show when a file an agent touched is no longer on disk.
 *
 * Conversations keep linking to files that were scratch artifacts (a montage
 * the agent rendered, read once and `rm`'d). Instead of a bare 404 the viewer
 * gets:
 *   - a diagnosis: was it deleted (its folder still exists), is the whole
 *     folder gone, is it tracked in git, are there similarly named files;
 *   - recovered copies: the git HEAD version for tracked files, and the last
 *     copy the conversation itself recorded — Claude stores the bytes of every
 *     Read result (images as base64) and the full body of every Write in the
 *     session JSONL, so a deleted file is often still fully recoverable there.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { execFile, execFileSync } from 'child_process';

export interface SimilarFile {
  name: string;
  path: string;
  size: number;
}

export interface MissingFileDiagnosis {
  /** 'deleted': the folder exists but the file does not. 'folder-missing': the folder itself is gone. */
  kind: 'deleted' | 'folder-missing';
  parentDir: string;
  /** Closest ancestor that still exists — where "open folder" should land. */
  nearestExistingDir: string | null;
  similar: SimilarFile[];
  git?: {
    repoRoot: string;
    relPath: string;
    /** The file exists at HEAD, so its committed version can be shown. */
    inHead: boolean;
  };
}

export type RecoveredCopy =
  | {
      source: 'git-head' | 'conversation';
      kind: 'text';
      content: string;
      /** How the copy was obtained, e.g. "Write" or "Write + 2 edits". */
      detail: string;
      timestamp?: string;
      /** Edits after the base snapshot that could not be replayed. */
      incomplete?: boolean;
    }
  | {
      source: 'git-head' | 'conversation';
      kind: 'image';
      mediaType: string;
      dataB64: string;
      detail: string;
      timestamp?: string;
    };

const SIMILAR_MAX = 6;
const TEXT_MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_MAX_B64 = 20 * 1024 * 1024;
const IMAGE_EXT_MEDIA: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.ico': 'image/x-icon',
};

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Rank sibling names by how likely they are the file the reference meant:
 * a case-only difference, the same stem with another extension (`report.md`
 * → `report.pdf`), a versioned/suffixed variant (`montage-2.png`), a typo.
 * Unrelated names are dropped, so an empty list means "nothing close".
 */
export function rankSimilarNames(target: string, names: readonly string[]): string[] {
  const lower = target.toLowerCase();
  const ext = path.extname(lower);
  const stem = ext ? lower.slice(0, -ext.length) : lower;
  const scored: Array<{ name: string; score: number }> = [];
  for (const name of names) {
    const candidate = name.toLowerCase();
    if (candidate === lower && name === target) continue;
    const cExt = path.extname(candidate);
    const cStem = cExt ? candidate.slice(0, -cExt.length) : candidate;
    let score: number | null = null;
    if (candidate === lower) score = 0;
    else if (cStem === stem && stem.length > 0) score = 1;
    else if (stem.length >= 3 && (cStem.startsWith(stem) || stem.startsWith(cStem)) && cStem.length >= 3) score = 2 + Math.abs(cStem.length - stem.length) / 100;
    else {
      const distance = levenshtein(stem, cStem);
      if (distance <= Math.max(1, Math.floor(stem.length / 4))) score = 3 + distance;
    }
    if (score === null) continue;
    if (ext && cExt !== ext) score += 0.5;
    scored.push({ name, score });
  }
  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return scored.slice(0, SIMILAR_MAX).map((entry) => entry.name);
}

function nearestExistingDir(start: string): string | null {
  let cur = start;
  for (let depth = 0; depth < 64; depth++) {
    try {
      if (fs.statSync(cur).isDirectory()) return cur;
    } catch { /* keep climbing */ }
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
}

function gitInfo(absPath: string, fromDir: string): MissingFileDiagnosis['git'] {
  try {
    const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: fromDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000,
    }).trim();
    if (!repoRoot) return undefined;
    const relPath = path.relative(repoRoot, absPath);
    if (!relPath || relPath.startsWith('..') || path.isAbsolute(relPath)) return undefined;
    let inHead = false;
    try {
      execFileSync('git', ['cat-file', '-e', `HEAD:${relPath}`], { cwd: repoRoot, stdio: 'ignore', timeout: 3000 });
      inHead = true;
    } catch { /* not in HEAD (untracked, never committed, or no commits) */ }
    return { repoRoot, relPath, inHead };
  } catch {
    return undefined;
  }
}

/** Explain a missing absolute path. Cheap: one readdir + at most three git calls. */
export function diagnoseMissingFile(absPath: string): MissingFileDiagnosis {
  const parentDir = path.dirname(absPath);
  const existing = nearestExistingDir(parentDir);
  const kind: MissingFileDiagnosis['kind'] = existing === parentDir ? 'deleted' : 'folder-missing';

  let similar: SimilarFile[] = [];
  if (kind === 'deleted') {
    try {
      const entries = fs.readdirSync(parentDir, { withFileTypes: true }).filter((e) => e.isFile());
      const ranked = rankSimilarNames(path.basename(absPath), entries.map((e) => e.name));
      similar = ranked.map((name) => {
        const full = path.join(parentDir, name);
        let size = 0;
        try { size = fs.statSync(full).size; } catch { /* raced away */ }
        return { name, path: full, size };
      });
    } catch { /* unreadable folder */ }
  }

  const diagnosis: MissingFileDiagnosis = { kind, parentDir, nearestExistingDir: existing, similar };
  const git = existing ? gitInfo(absPath, existing) : undefined;
  if (git) diagnosis.git = git;
  return diagnosis;
}

// ─── Conversation snapshots ────────────────────────────────────────────────

interface JsonlContentBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
}

type Snapshot =
  | { kind: 'text'; content: string; base: string; edits: number; incomplete: boolean; timestamp?: string }
  | { kind: 'image'; mediaType: string; dataB64: string; timestamp?: string };

function applyEdit(content: string, oldString: unknown, newString: unknown, replaceAll: unknown): string | null {
  if (typeof oldString !== 'string' || typeof newString !== 'string' || !oldString) return null;
  if (!content.includes(oldString)) return null;
  return replaceAll === true ? content.split(oldString).join(newString) : content.replace(oldString, () => newString);
}

/**
 * Replay a Claude session JSONL and return every distinct version of
 * `absPath` it recorded, oldest first: each Write body, full-file Read or
 * image Read starts a version, and later Edit/MultiEdit calls are applied on
 * top of a text version. A scratch file is often regenerated several times
 * (two different montages under one name), and the row the user clicked may
 * refer to an earlier one — so all versions are kept, not just the last.
 * Pure over the line stream so it can be unit-tested with fixture lines.
 */
export async function snapshotsFromJsonlLines(lines: AsyncIterable<string> | Iterable<string>, absPath: string): Promise<Snapshot[]> {
  const needle = JSON.stringify(absPath).slice(1, -1);
  const pendingReads = new Set<string>();
  const versions: Snapshot[] = [];
  const current = (): Snapshot | null => versions[versions.length - 1] ?? null;
  // Re-reading an unchanged file is the same version, just seen later.
  const addVersion = (next: Snapshot) => {
    const last = current();
    const same = last && last.kind === next.kind && (
      (last.kind === 'image' && next.kind === 'image' && last.dataB64 === next.dataB64)
      || (last.kind === 'text' && next.kind === 'text' && last.content === next.content)
    );
    if (same) last.timestamp = next.timestamp ?? last.timestamp;
    else versions.push(next);
  };

  for await (const line of lines as AsyncIterable<string>) {
    const mentionsPath = line.includes(needle);
    let mentionsPending = false;
    if (!mentionsPath && pendingReads.size > 0) {
      for (const id of pendingReads) {
        if (line.includes(id)) { mentionsPending = true; break; }
      }
    }
    if (!mentionsPath && !mentionsPending) continue;

    let entry: any;
    try { entry = JSON.parse(line); } catch { continue; }
    const content: JsonlContentBlock[] | undefined = Array.isArray(entry?.message?.content) ? entry.message.content : undefined;
    if (!content) continue;
    const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : undefined;

    for (const block of content) {
      if (block.type === 'tool_use' && block.input && block.input.file_path === absPath) {
        const input = block.input;
        const snapshot = current();
        if (block.name === 'Write' && typeof input.content === 'string') {
          addVersion({ kind: 'text', content: input.content, base: 'Write', edits: 0, incomplete: false, timestamp });
        } else if ((block.name === 'Edit' || block.name === 'MultiEdit') && snapshot?.kind === 'text') {
          const edits = block.name === 'Edit'
            ? [input]
            : (Array.isArray(input.edits) ? input.edits as Array<Record<string, unknown>> : []);
          for (const edit of edits) {
            const next = applyEdit(snapshot.content, edit.old_string, edit.new_string, edit.replace_all);
            if (next === null) snapshot.incomplete = true;
            else { snapshot.content = next; snapshot.edits += 1; snapshot.timestamp = timestamp; }
          }
        } else if (block.name === 'Read' && block.id) {
          pendingReads.add(block.id);
        }
      } else if (block.type === 'tool_result' && block.tool_use_id && pendingReads.has(block.tool_use_id)) {
        pendingReads.delete(block.tool_use_id);
        const result = entry.toolUseResult;
        const file = result && typeof result === 'object' ? result.file : undefined;
        if (!file || typeof file !== 'object') continue;
        if (result.type === 'image' && typeof file.base64 === 'string' && file.base64.length <= IMAGE_MAX_B64) {
          addVersion({ kind: 'image', mediaType: typeof file.type === 'string' ? file.type : 'image/png', dataB64: file.base64, timestamp });
        } else if (
          result.type === 'text'
          && typeof file.content === 'string'
          && file.startLine === 1
          && typeof file.numLines === 'number'
          && file.numLines >= (typeof file.totalLines === 'number' ? file.totalLines : Infinity)
        ) {
          // Only a Read that covered the whole file is a trustworthy base.
          addVersion({ kind: 'text', content: file.content, base: 'Read', edits: 0, incomplete: false, timestamp });
        }
      }
    }
  }
  return versions;
}

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const SESSION_FILES_MAX = 12;

function encodeProjectDir(cwd: string): string {
  return path.join(CLAUDE_PROJECTS_DIR, cwd.replace(/\/+$/, '').replace(/[/_]/g, '-'));
}

/** Session JSONLs that mention `needle`, newest first. rg when available, a bounded scan otherwise. */
function sessionFilesMentioning(dirs: string[], needle: string): Promise<string[]> {
  const existingDirs = dirs.filter((dir) => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } });
  if (existingDirs.length === 0) return Promise.resolve([]);
  const byMtime = (files: string[]) => files
    .map((file) => { try { return { file, mtime: fs.statSync(file).mtimeMs }; } catch { return null; } })
    .filter((entry): entry is { file: string; mtime: number } => entry !== null)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, SESSION_FILES_MAX)
    .map((entry) => entry.file);

  return new Promise((resolve) => {
    execFile(
      'rg',
      ['-l', '--fixed-strings', '--no-messages', '--glob', '*.jsonl', '--max-depth', '2', '--', needle, ...existingDirs],
      { maxBuffer: 4 * 1024 * 1024, timeout: 10_000 },
      (error, stdout) => {
        // rg exits 1 for "no match" — a real answer, not a failure.
        if (!error || (error as unknown as { code?: unknown }).code === 1) {
          resolve(byMtime(stdout.split('\n').filter(Boolean)));
          return;
        }
        // rg missing/failed: scan the newest JSONLs of each dir directly.
        const candidates: string[] = [];
        for (const dir of existingDirs) {
          try {
            for (const name of fs.readdirSync(dir)) if (name.endsWith('.jsonl')) candidates.push(path.join(dir, name));
          } catch { /* skip */ }
        }
        const matches = byMtime(candidates).filter((file) => {
          try { return fs.readFileSync(file, 'utf-8').includes(needle); } catch { return false; }
        });
        resolve(matches);
      },
    );
  });
}

const CONVERSATION_VERSIONS_MAX = 4;

/**
 * The copies of `absPath` recorded by Claude conversations, newest first
 * (at most CONVERSATION_VERSIONS_MAX). Searches the agent's own project
 * sessions first (derived from `baseDir`, the agent cwd), then every project —
 * agents often touch files outside their cwd.
 */
export async function findConversationSnapshots(absPath: string, baseDir?: string): Promise<RecoveredCopy[]> {
  const needle = JSON.stringify(absPath).slice(1, -1);
  const scopes: string[][] = [];
  if (baseDir && path.isAbsolute(baseDir)) scopes.push([encodeProjectDir(baseDir)]);
  scopes.push([CLAUDE_PROJECTS_DIR]);

  const visited = new Set<string>();
  for (const dirs of scopes) {
    const files = (await sessionFilesMentioning(dirs, needle)).filter((file) => !visited.has(file));
    const found: Snapshot[] = [];
    for (const file of files) {
      visited.add(file);
      const stream = fs.createReadStream(file, { encoding: 'utf-8' });
      const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
      try {
        found.push(...await snapshotsFromJsonlLines(lines, absPath));
      } finally {
        lines.close();
        stream.destroy();
      }
    }
    if (found.length === 0) continue;
    const time = (snapshot: Snapshot) => (snapshot.timestamp ? Date.parse(snapshot.timestamp) || 0 : 0);
    return found
      .sort((a, b) => time(b) - time(a))
      .map(toRecoveredCopy)
      .filter((copy): copy is RecoveredCopy => copy !== null)
      .slice(0, CONVERSATION_VERSIONS_MAX);
  }
  return [];
}

function toRecoveredCopy(snapshot: Snapshot): RecoveredCopy | null {
  if (snapshot.kind === 'image') {
    return { source: 'conversation', kind: 'image', mediaType: snapshot.mediaType, dataB64: snapshot.dataB64, detail: 'Read', timestamp: snapshot.timestamp };
  }
  if (Buffer.byteLength(snapshot.content, 'utf-8') > TEXT_MAX_BYTES) return null;
  const detail = snapshot.edits > 0 ? `${snapshot.base} + ${snapshot.edits} edit${snapshot.edits === 1 ? '' : 's'}` : snapshot.base;
  return {
    source: 'conversation',
    kind: 'text',
    content: snapshot.content,
    detail,
    timestamp: snapshot.timestamp,
    ...(snapshot.incomplete ? { incomplete: true } : {}),
  };
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}

/** The committed (HEAD) version of a deleted tracked file, as text or image. */
export function gitHeadCopy(absPath: string, git: NonNullable<MissingFileDiagnosis['git']>): RecoveredCopy | null {
  if (!git.inHead) return null;
  let buffer: Buffer;
  try {
    buffer = execFileSync('git', ['cat-file', 'blob', `HEAD:${git.relPath}`], { cwd: git.repoRoot, maxBuffer: 25 * 1024 * 1024, timeout: 5000 });
  } catch {
    return null;
  }
  const mediaType = IMAGE_EXT_MEDIA[path.extname(absPath).toLowerCase()];
  if (mediaType) return { source: 'git-head', kind: 'image', mediaType, dataB64: buffer.toString('base64'), detail: 'HEAD' };
  if (looksBinary(buffer) || buffer.length > TEXT_MAX_BYTES) return null;
  return { source: 'git-head', kind: 'text', content: buffer.toString('utf-8'), detail: 'HEAD' };
}
