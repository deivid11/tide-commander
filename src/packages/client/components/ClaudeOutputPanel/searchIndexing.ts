/**
 * searchIndexing - Pure helpers for the Guake terminal search.
 *
 * These are intentionally free of React/DOM so they can be unit-tested in
 * isolation and reused by both the search hook (useSearchHistory) and the
 * results panel (SearchResultsPanel).
 *
 * Two flavours of result:
 *   - Content results: ranked messages/outputs whose text matches the query
 *     (multi-word AND matching, exact-phrase boosted).
 *   - File results:    files referenced across the conversation, ranked by a
 *     fuzzy (fzf-lite) match against the query.
 */

import type { EnrichedHistoryMessage } from './types';
import type { ClaudeOutput } from '../../store';
import { extractFilePathTokens } from '../../utils/outputRendering';

export type SearchItem = EnrichedHistoryMessage | ClaudeOutput;

export type ContentRole = 'user' | 'assistant' | 'tool' | 'command' | 'output';

export interface ContentResult {
  /** Index into the combined allItems array (for scroll-to navigation). */
  itemIndex: number;
  role: ContentRole;
  toolName?: string;
  timestamp?: string;
  /** Windowed text around the first match, ready for highlighting. */
  snippet: string;
  /** Number of occurrences of the primary term in the item. */
  matchCount: number;
  score: number;
}

export interface FileOps {
  read: number;
  edit: number;
  write: number;
  other: number;
}

export interface FileRef {
  path: string;
  basename: string;
  /** Directory portion (without a trailing slash), may be empty. */
  dir: string;
  ops: FileOps;
  /** Total number of references across the conversation. */
  count: number;
  /** Item indices where the file is referenced (for scroll-to navigation). */
  itemIndices: number[];
  lastTimestamp?: string;
}

export interface FileResult extends FileRef {
  score: number;
}

export interface ContentMatch {
  matched: boolean;
  score: number;
  /** Offset of the first match in the (original) text, or -1. */
  firstOffset: number;
  matchCount: number;
}

export interface FuzzyResult {
  matched: boolean;
  score: number;
  /** Positions of the matched characters in `target` — only when requested. */
  indices?: number[];
}

export interface FuzzyOptions {
  /** Compare with case preserved (smart-case callers). Default: case-insensitive. */
  caseSensitive?: boolean;
  /** Collect matched character positions for highlighting (allocates — off by default). */
  withIndices?: boolean;
}

// ── Type helpers ────────────────────────────────────────────────────────────

function isHistoryMessage(item: SearchItem): item is EnrichedHistoryMessage {
  return 'type' in item && 'content' in item;
}

/** Extract searchable text from an item (content + linked bash + tool name). */
export function getItemText(item: SearchItem): string {
  if (isHistoryMessage(item)) {
    let text = item.content || '';
    if (item._bashOutput) text += ' ' + item._bashOutput;
    if (item._bashCommand) text += ' ' + item._bashCommand;
    if (item.toolName) text += ' ' + item.toolName;
    return text;
  }
  const output = item as ClaudeOutput;
  let text = output.text || '';
  if (output.toolOutput) text += ' ' + output.toolOutput;
  return text;
}

/** Classify an item for the results-panel row icon/label. */
export function deriveRole(item: SearchItem): ContentRole {
  if (isHistoryMessage(item)) {
    if (item.type === 'user') {
      const content = item.content || '';
      if (content.includes('<command-name>')) return 'command';
      return 'user';
    }
    if (item.type === 'assistant') return 'assistant';
    return 'tool'; // tool_use / tool_result
  }
  const output = item as ClaudeOutput;
  if (output.isUserPrompt) return 'user';
  if (output.toolName) return 'tool';
  return 'output';
}

export function getItemToolName(item: SearchItem): string | undefined {
  return item.toolName;
}

/** Normalise both timestamp shapes (ISO string vs epoch number) to a string. */
export function getItemTimestamp(item: SearchItem): string | undefined {
  if (isHistoryMessage(item)) return item.timestamp;
  const ts = (item as ClaudeOutput).timestamp;
  return typeof ts === 'number' ? new Date(ts).toISOString() : undefined;
}

function timestampValue(ts?: string): number {
  if (!ts) return 0;
  const n = Date.parse(ts);
  return Number.isNaN(n) ? 0 : n;
}

// ── Query tokenisation & content matching ───────────────────────────────────

/** Split a query into lowercased whitespace-delimited tokens. */
export function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/**
 * Score `text` against a query. Matches when the exact phrase is present OR
 * every token is present (AND, any order). Exact-phrase matches dominate,
 * then token coverage, then match density and how early the first hit is.
 */
export function matchContent(text: string, phrase: string, tokens: string[]): ContentMatch {
  const empty: ContentMatch = { matched: false, score: 0, firstOffset: -1, matchCount: 0 };
  if (!text || tokens.length === 0) return empty;

  const lower = text.toLowerCase();
  const phraseLower = phrase.trim().toLowerCase();
  const isMultiWord = phraseLower.includes(' ');

  // Exact multi-word phrase is the strongest signal.
  let phraseCount = 0;
  let firstOffset = -1;
  if (isMultiWord && phraseLower) {
    phraseCount = countOccurrences(lower, phraseLower);
    if (phraseCount > 0) firstOffset = lower.indexOf(phraseLower);
  }

  // Token AND-match.
  let allTokens = true;
  let tokenHits = 0;
  let earliestToken = -1;
  for (const tok of tokens) {
    const at = lower.indexOf(tok);
    if (at === -1) {
      allTokens = false;
      break;
    }
    tokenHits++;
    if (earliestToken === -1 || at < earliestToken) earliestToken = at;
  }

  if (phraseCount === 0 && !allTokens) return empty;

  if (firstOffset === -1) firstOffset = earliestToken >= 0 ? earliestToken : 0;

  // Match count: phrase occurrences, else occurrences of the primary token.
  const matchCount = phraseCount > 0 ? phraseCount : countOccurrences(lower, tokens[0]);

  let score = 0;
  if (phraseCount > 0) score += 1000 + phraseCount * 5;
  if (allTokens) score += 200 + tokenHits * 10;
  score += Math.min(matchCount, 20);
  score += Math.max(0, 30 - Math.floor(firstOffset / 40)); // earlier = better

  return { matched: true, score, firstOffset, matchCount };
}

/**
 * Produce a single-line snippet centred on the first occurrence of `term`.
 * Whitespace is collapsed and the window is ellipsized at both ends.
 */
export function extractSnippet(text: string, term: string, radius = 100): string {
  const collapsed = (text || '').replace(/\s+/g, ' ').trim();
  const max = radius * 2;
  if (!term) return collapsed.length > max ? collapsed.slice(0, max) + '…' : collapsed;

  const idx = collapsed.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) {
    return collapsed.length > max ? collapsed.slice(0, max) + '…' : collapsed;
  }

  const start = Math.max(0, idx - radius);
  const end = Math.min(collapsed.length, idx + term.length + radius);
  let snippet = collapsed.slice(start, end);
  if (start > 0) snippet = '…' + snippet;
  if (end < collapsed.length) snippet = snippet + '…';
  return snippet;
}

// ── File reference extraction ───────────────────────────────────────────────

const READ_TOOLS = new Set(['Read', 'NotebookRead']);
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'NotebookEdit']);
const WRITE_TOOLS = new Set(['Write']);

// Free text is noisy: code accessors like `m.matched` or `msg._bashCommand`
// look like `name.ext` to the path regex. Only trust a text-mentioned token as
// a real file when it either contains a directory separator OR ends in a known
// file extension. Tool-op paths (Read/Edit/Write) are always trusted.
const KNOWN_FILE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'md', 'mdx', 'scss', 'css',
  'sass', 'less', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml', 'ini', 'env',
  'sh', 'bash', 'zsh', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp',
  'hpp', 'cs', 'php', 'sql', 'txt', 'log', 'csv', 'png', 'jpg', 'jpeg', 'gif',
  'svg', 'webp', 'pdf', 'lock', 'vue', 'svelte', 'proto', 'graphql', 'prisma',
]);

function fileExtension(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Whether a token found in free text is trustworthy enough to index as a file. */
function isIndexableTextFile(path: string): boolean {
  if (path.includes('/')) return true;
  return KNOWN_FILE_EXTENSIONS.has(fileExtension(path));
}

/** Operation weight: touched (read/edit/write) files matter more than mentions. */
function opWeight(ops: FileOps): number {
  return ops.read + ops.edit * 2 + ops.write * 2;
}

function toolOpKind(toolName: string): keyof FileOps {
  if (READ_TOOLS.has(toolName)) return 'read';
  if (EDIT_TOOLS.has(toolName)) return 'edit';
  if (WRITE_TOOLS.has(toolName)) return 'write';
  return 'other';
}

function pathFromToolInput(input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  const p = input.file_path ?? input.path ?? input.notebook_path;
  return typeof p === 'string' && p.trim() ? p.trim() : undefined;
}

function splitPath(path: string): { basename: string; dir: string } {
  const clean = path.replace(/\/+$/, '');
  const slash = clean.lastIndexOf('/');
  if (slash === -1) return { basename: clean, dir: '' };
  return { basename: clean.slice(slash + 1), dir: clean.slice(0, slash) };
}

/**
 * Build the per-file index for a conversation: every file touched by a
 * Read/Edit/Write tool call plus every file path mentioned in message text,
 * aggregated by path with operation counts and the item indices that touch it.
 */
export function extractFileReferences(items: SearchItem[]): FileRef[] {
  const map = new Map<string, FileRef>();

  const bump = (rawPath: string, kind: keyof FileOps, index: number, ts?: string) => {
    const path = rawPath.trim();
    if (!path) return;
    let ref = map.get(path);
    if (!ref) {
      const { basename, dir } = splitPath(path);
      ref = {
        path,
        basename,
        dir,
        ops: { read: 0, edit: 0, write: 0, other: 0 },
        count: 0,
        itemIndices: [],
        lastTimestamp: ts,
      };
      map.set(path, ref);
    }
    ref.ops[kind]++;
    ref.count++;
    if (ref.itemIndices[ref.itemIndices.length - 1] !== index) ref.itemIndices.push(index);
    if (ts && timestampValue(ts) >= timestampValue(ref.lastTimestamp)) ref.lastTimestamp = ts;
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const ts = getItemTimestamp(item);
    const toolName = item.toolName;
    const toolPath = pathFromToolInput(item.toolInput);

    if (toolName && toolPath) {
      bump(toolPath, toolOpKind(toolName), i, ts);
    }

    // File paths mentioned anywhere in the item text (skip the tool path we
    // already counted precisely above, and reject code accessors that merely
    // look like `name.ext`).
    for (const token of extractFilePathTokens(getItemText(item))) {
      if (token === toolPath) continue;
      if (!isIndexableTextFile(token)) continue;
      bump(token, 'other', i, ts);
    }
  }

  return Array.from(map.values());
}

// ── Fuzzy file matching (fzf-lite) ──────────────────────────────────────────

/**
 * Subsequence fuzzy match: every char of `query` must appear in `target` in
 * order. Score rewards contiguous runs and matches at token boundaries
 * (start, `/`, `.`, `_`, `-`), and penalises a late first match.
 */
export function fuzzyMatch(query: string, target: string, opts?: FuzzyOptions): FuzzyResult {
  const indices: number[] | undefined = opts?.withIndices ? [] : undefined;
  if (!query) return { matched: true, score: 0, indices };
  if (!target) return { matched: false, score: 0 };

  const q = opts?.caseSensitive ? query : query.toLowerCase();
  const t = opts?.caseSensitive ? target : target.toLowerCase();
  let qi = 0;
  let ti = 0;
  let score = 0;
  let prevMatch = -2;
  let firstIdx = -1;

  while (qi < q.length && ti < t.length) {
    if (q[qi] === t[ti]) {
      if (firstIdx === -1) firstIdx = ti;
      if (indices) indices.push(ti);
      score += prevMatch === ti - 1 ? 5 : 1; // contiguity bonus
      const prevChar = ti > 0 ? t[ti - 1] : '';
      if (ti === 0 || prevChar === '/' || prevChar === '.' || prevChar === '_' || prevChar === '-') {
        score += 3; // token-boundary bonus
      }
      prevMatch = ti;
      qi++;
    }
    ti++;
  }

  if (qi < q.length) return { matched: false, score: 0 };

  score -= Math.floor(firstIdx / 4); // prefer earlier first match
  score += Math.max(0, 15 - (t.length - q.length)); // prefer tighter matches
  return { matched: true, score, indices };
}

/**
 * Rank file references against a query. Basename matches weigh double the
 * full-path match; ties break on reference frequency then recency. An empty
 * query returns every file ranked by frequency then recency.
 */
export function rankFiles(refs: FileRef[], query: string): FileResult[] {
  const q = query.trim();
  const out: FileResult[] = [];

  if (!q) {
    for (const r of refs) out.push({ ...r, score: r.count });
    out.sort(
      (a, b) => b.count - a.count || timestampValue(b.lastTimestamp) - timestampValue(a.lastTimestamp)
    );
    return out;
  }

  const qLower = q.toLowerCase();
  for (const r of refs) {
    const byBase = fuzzyMatch(q, r.basename);
    const byPath = fuzzyMatch(q, r.path);
    if (!byBase.matched && !byPath.matched) continue;

    let score = Math.max(byBase.matched ? byBase.score * 2 : 0, byPath.score);
    // Exact contiguous substring in the basename beats a scattered fuzzy hit.
    if (r.basename.toLowerCase().includes(qLower)) score += 60;
    else if (r.path.toLowerCase().includes(qLower)) score += 20;
    // Files actually generated/consulted (real tool ops) outrank bare mentions.
    score += Math.min(opWeight(r.ops), 12);
    score += Math.min(r.count, 8);
    out.push({ ...r, score });
  }

  out.sort(
    (a, b) =>
      b.score - a.score ||
      b.count - a.count ||
      timestampValue(b.lastTimestamp) - timestampValue(a.lastTimestamp)
  );
  return out;
}
