/**
 * Tests for the Session Finder search fast path (session-loader.ts):
 * the chunked file scanner, and the per-file plan (reuse / tail-resume / full)
 * with query-refinement pruning.
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  scanSessionFileForQuery,
  planFileSearch,
  planTokenFileSearch,
  parseRgCounts,
  parseRgSampleLines,
  type SearchFileCacheEntry,
} from './session-loader.js';

const tmpFiles: string[] = [];

function writeTmpJsonl(lines: string[]): string {
  const file = path.join(os.tmpdir(), `tc-session-search-test-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  tmpFiles.push(file);
  return file;
}

afterAll(() => {
  for (const file of tmpFiles) {
    try { fs.unlinkSync(file); } catch { /* already gone */ }
  }
});

function userLine(text: string): string {
  return JSON.stringify({ type: 'user', message: { content: text } });
}

function toolUseLine(name: string, input: Record<string, unknown>): string {
  return JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
}

describe('scanSessionFileForQuery', () => {
  it('counts matching lines case-insensitively and extracts a message snippet', async () => {
    const file = writeTmpJsonl([
      userLine('Fix the SCROLL bug in the terminal'),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Looking at the scroll logic' }] } }),
      userLine('unrelated prompt'),
    ]);

    const result = await scanSessionFileForQuery(file, 'scroll');

    expect(result.totalMatches).toBe(2);
    expect(result.snippet).toBe('Fix the SCROLL bug in the terminal');
    // Small result set → the complete matching lines come back for the
    // refinement cache, and the scan reached EOF (resumable).
    expect(result.matchingLines).toHaveLength(2);
    expect(result.reachedEof).toBe(true);
  });

  it('returns zero matches without a snippet when the query is absent', async () => {
    const file = writeTmpJsonl([userLine('hello world')]);

    const result = await scanSessionFileForQuery(file, 'zebra');

    expect(result).toEqual({ totalMatches: 0, snippet: '', matchingLines: [], reachedEof: true });
  });

  it('renders a readable snippet for tool-only matches instead of raw JSON', async () => {
    const file = writeTmpJsonl([toolUseLine('Bash', { command: 'npm run build:apk' })]);

    const result = await scanSessionFileForQuery(file, 'build:apk');

    expect(result.snippet).toBe('Bash: npm run build:apk');
  });

  it('prefers real conversation text over tool chatter for the snippet', async () => {
    const file = writeTmpJsonl([
      toolUseLine('Bash', { command: 'grep scroll src/' }),
      userLine('the scroll bug is back'),
    ]);

    const result = await scanSessionFileForQuery(file, 'scroll');

    expect(result.snippet).toBe('the scroll bug is back');
  });

  it('windows long snippets around the match instead of truncating from the start', async () => {
    const padded = 'x '.repeat(300) + 'the actual needle here' + ' y'.repeat(300);
    const file = writeTmpJsonl([userLine(padded)]);

    const result = await scanSessionFileForQuery(file, 'needle');

    expect(result.snippet).toContain('needle');
    expect(result.snippet.startsWith('…')).toBe(true);
  });

  it('escapes regex metacharacters in the query', async () => {
    const file = writeTmpJsonl([userLine('call foo(bar) please'), userLine('call foo please')]);

    const result = await scanSessionFileForQuery(file, 'foo(bar)');

    expect(result.totalMatches).toBe(1);
  });

  it('finds matches across the 1MB chunk boundary of a large file', async () => {
    const filler = userLine('x'.repeat(4000));
    const lines: string[] = [];
    for (let i = 0; i < 550; i++) lines.push(filler);
    lines.push(userLine('the needle-in-haystack prompt'));
    for (let i = 0; i < 10; i++) lines.push(filler);
    const file = writeTmpJsonl(lines);

    const result = await scanSessionFileForQuery(file, 'needle-in-haystack');

    expect(result.totalMatches).toBe(1);
    expect(result.snippet).toContain('needle-in-haystack');
  });

  it('collects first matching lines (windowed) when keepFirst is set — metadata-only hits included', async () => {
    // The hit lives in wire metadata the preview does not render.
    const metaLine = JSON.stringify({ type: 'file-history-snapshot', snapshot: 'content with the needle inside' });
    const hugeLine = JSON.stringify({ type: 'x', blob: 'z'.repeat(5000) + ' needle ' + 'z'.repeat(5000) });
    const file = writeTmpJsonl([userLine('nothing relevant'), metaLine, hugeLine]);

    const result = await scanSessionFileForQuery(file, 'needle', undefined, 5);

    expect(result.firstLines).toHaveLength(2);
    expect(result.firstLines![0]).toBe(metaLine);
    // Huge line is windowed around the match instead of stored whole.
    expect(result.firstLines![1]).toContain('needle');
    expect(result.firstLines![1].length).toBeLessThan(3000);
  });

  it('scans only the tail when startByte is given (append-only resume)', async () => {
    const head = userLine('needle in the head');
    const file = writeTmpJsonl([head, userLine('nothing here')]);
    const headBytes = fs.statSync(file).size;
    fs.appendFileSync(file, userLine('a fresh needle appended') + '\n');

    const result = await scanSessionFileForQuery(file, 'needle', headBytes);

    expect(result.totalMatches).toBe(1);
    expect(result.snippet).toBe('a fresh needle appended');
  });
});

describe('ripgrep output parsers', () => {
  it('parses rg -c path:count lines, keeping only positive counts', () => {
    const out = [
      '/home/riven/.claude/projects/-a/s1.jsonl:12',
      '/home/riven/.claude/projects/-a/s2.jsonl:0',
      '/home/riven/.claude/projects/-b/s3.jsonl:3',
      '',
      'garbage-without-separator',
    ].join('\n');

    const counts = parseRgCounts(out);

    expect(counts.get('/home/riven/.claude/projects/-a/s1.jsonl')).toBe(12);
    expect(counts.get('/home/riven/.claude/projects/-b/s3.jsonl')).toBe(3);
    expect(counts.size).toBe(2);
  });

  it('parses sample lines grouped per file, splitting at the first colon', () => {
    const out = [
      '/p/a.jsonl:{"type":"user","message":{"content":"scroll: broken"}}',
      '/p/a.jsonl:{"type":"assistant"}',
      '/p/b.jsonl:{"x":1}',
      '/p/b.jsonl:[Omitted long matching line]',
      'not-an-absolute-path:ignored',
    ].join('\n');

    const samples = parseRgSampleLines(out);

    expect(samples.get('/p/a.jsonl')).toHaveLength(2);
    // JSON after the first colon survives intact (colons inside preserved).
    expect(samples.get('/p/a.jsonl')![0]).toContain('"content":"scroll: broken"');
    expect(samples.get('/p/b.jsonl')).toEqual(['{"x":1}']);
    expect(samples.size).toBe(2);
  });
});

describe('planFileSearch', () => {
  const entry = (overrides: Partial<SearchFileCacheEntry>): SearchFileCacheEntry => ({
    mtimeMs: 1000,
    sizeBytes: 500,
    query: 'scro',
    totalMatches: 0,
    snippet: '',
    ...overrides,
  });

  it('reuses an exact-query result on an unchanged file', () => {
    const cached = entry({ query: 'scroll', totalMatches: 3, snippet: 'the scroll bug' });

    expect(planFileSearch([cached], 'scroll', 1000, 500)).toEqual({ kind: 'reuse', totalMatches: 3, snippet: 'the scroll bug' });
  });

  it('prunes a refined query when the shorter query already had zero matches', () => {
    // "scro" was nowhere in the file → "scroll" cannot be either.
    expect(planFileSearch([entry({})], 'scroll', 1000, 500)).toEqual({ kind: 'reuse', totalMatches: 0, snippet: '' });
  });

  it('answers a refined query from retained matching lines without a file read', () => {
    const cached = entry({
      query: 'scro',
      totalMatches: 2,
      snippet: 's',
      matchingLines: [
        JSON.stringify({ type: 'user', message: { content: 'fix the SCROLL bar' } }),
        JSON.stringify({ type: 'user', message: { content: 'scrolling is fine' } }),
      ],
    });

    expect(planFileSearch([cached], 'scroll b', 1000, 500)).toEqual({
      kind: 'reuse',
      totalMatches: 1,
      snippet: 'fix the SCROLL bar',
    });
  });

  it('answers from an OLDER entry when the newest does not cover the query (backspace)', () => {
    // Typing "scroll" then backspacing to "scro": the newest entry ("scroll")
    // cannot answer "scro", but the older exact "scro" entry can.
    const entries = [
      entry({ query: 'scroll', totalMatches: 1, snippet: 'newer' }),
      entry({ query: 'scro', totalMatches: 4, snippet: 'older exact' }),
    ];

    expect(planFileSearch(entries, 'scro', 1000, 500)).toEqual({ kind: 'reuse', totalMatches: 4, snippet: 'older exact' });
  });

  it('falls back to a full scan for an unrelated query or a positive result without lines', () => {
    expect(planFileSearch([entry({})], 'zebra', 1000, 500)).toEqual({ kind: 'full' });
    expect(planFileSearch([entry({ query: 'scro', totalMatches: 3, snippet: 's' })], 'scroll', 1000, 500)).toEqual({ kind: 'full' });
    expect(planFileSearch(undefined, 'scroll', 1000, 500)).toEqual({ kind: 'full' });
    expect(planFileSearch([], 'scroll', 1000, 500)).toEqual({ kind: 'full' });
  });

  it('plans a tail scan when the file merely grew (append-only sessions)', () => {
    const cached = entry({ query: 'scroll', totalMatches: 2, snippet: 'old snippet', scannedBytes: 500, matchingLines: [] });

    const plan = planFileSearch([cached], 'scroll', 2000, 900);

    expect(plan).toEqual({
      kind: 'tail',
      startByte: 500,
      head: { totalMatches: 2, snippet: 'old snippet', matchingLines: [] },
    });
  });

  it('requires a full rescan when the file shrank or has no resume point', () => {
    // Shrunk (rewritten) file.
    expect(planFileSearch([entry({ query: 'scroll', scannedBytes: 500 })], 'scroll', 2000, 300)).toEqual({ kind: 'full' });
    // Changed file with no scannedBytes (previous scan hit the match cap).
    expect(planFileSearch([entry({ query: 'scroll' })], 'scroll', 2000, 900)).toEqual({ kind: 'full' });
  });
});

describe('scanSessionFileForQuery — provider line shapes', () => {
  it('extracts message snippets from grok chat_history rows (top-level content)', async () => {
    const file = writeTmpJsonl([
      JSON.stringify({ type: 'system', content: 'You are Grok.' }),
      JSON.stringify({ type: 'user', content: [{ type: 'text', text: 'look up the Jira ticket for me' }] }),
      JSON.stringify({ type: 'tool_result', tool_call_id: 'x', content: 'jira result body' }),
    ]);

    const result = await scanSessionFileForQuery(file, 'jira');

    expect(result.totalMatches).toBe(2);
    // Message text beats tool_result chatter for the snippet.
    expect(result.snippet).toBe('look up the Jira ticket for me');
  });

  it('extracts message snippets from codex rows (old top-level and new response_item formats)', async () => {
    const oldFormat = writeTmpJsonl([
      JSON.stringify({ id: 'abc', timestamp: '2025-08-18T11:23:56.105Z' }),
      JSON.stringify({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'build the zombie shooter game' }] }),
    ]);
    const newFormat = writeTmpJsonl([
      JSON.stringify({ type: 'session_meta', payload: { cwd: '/x' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The zombie wave spawner is ready.' }] } }),
    ]);

    expect((await scanSessionFileForQuery(oldFormat, 'zombie')).snippet).toBe('build the zombie shooter game');
    expect((await scanSessionFileForQuery(newFormat, 'zombie')).snippet).toBe('The zombie wave spawner is ready.');
  });

  it('extracts message snippets from pi rows (nested message envelope)', async () => {
    const file = writeTmpJsonl([
      JSON.stringify({ type: 'session', version: 3, id: 's1', cwd: '/home/riven' }),
      JSON.stringify({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'which model are you exactly?' }] } }),
    ]);

    expect((await scanSessionFileForQuery(file, 'model')).snippet).toBe('which model are you exactly?');
  });
});

describe('planTokenFileSearch (multi-word AND queries)', () => {
  const entry = (overrides: Partial<SearchFileCacheEntry>): SearchFileCacheEntry => ({
    mtimeMs: 1000,
    sizeBytes: 500,
    query: 'jira',
    totalMatches: 0,
    snippet: '',
    ...overrides,
  });

  it('reuses an exact-query result on an unchanged file', () => {
    const cached = entry({ query: 'jira krunner', totalMatches: 3, snippet: 'the jira board' });

    expect(planTokenFileSearch([cached], 'jira krunner', 1000, 500)).toEqual({ totalMatches: 3, snippet: 'the jira board' });
  });

  it('zero-prunes from a contained query with no matches ("jira" absent → "jira krunner" cannot AND-match)', () => {
    expect(planTokenFileSearch([entry({ query: 'jira', totalMatches: 0 })], 'jira krunner', 1000, 500)).toEqual({ totalMatches: 0, snippet: '' });
  });

  it('does NOT reuse positive phrase refinements — different words match different lines', () => {
    // The phrase cache would re-test these lines for the full string
    // "jira krunner" and wrongly answer 0; word semantics must rescan.
    const cached = entry({
      query: 'jira',
      totalMatches: 2,
      snippet: 'jira ticket',
      matchingLines: [
        JSON.stringify({ type: 'user', message: { content: 'open the jira ticket' } }),
        JSON.stringify({ type: 'user', message: { content: 'jira sync done' } }),
      ],
    });

    expect(planTokenFileSearch([cached], 'jira krunner', 1000, 500)).toBeNull();
  });

  it('ignores entries from a changed file', () => {
    expect(planTokenFileSearch([entry({ query: 'jira krunner', totalMatches: 3 })], 'jira krunner', 2000, 500)).toBeNull();
    expect(planTokenFileSearch([entry({ query: 'jira', totalMatches: 0 })], 'jira krunner', 1000, 900)).toBeNull();
  });

  it('returns null without cached entries', () => {
    expect(planTokenFileSearch(undefined, 'jira krunner', 1000, 500)).toBeNull();
    expect(planTokenFileSearch([], 'jira krunner', 1000, 500)).toBeNull();
  });
});
