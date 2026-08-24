/**
 * Tests for the Session Finder search fast path (session-loader.ts):
 * the chunked file scanner, and the per-file plan (reuse / tail-resume / full)
 * with query-refinement pruning.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  scanSessionFileForQuery,
  planFileSearch,
  planTokenFileSearch,
  parseRgCounts,
  parseRgSampleLines,
  pickSnippetFromLines,
  pickExtractsFromLines,
  userPromptWithNeedlePattern,
  SNIPPETS_PER_SESSION,
  sessionSearchScore,
  rankSessionMatches,
  foldAccents,
  accentFoldPattern,
  nearbyTokensPattern,
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

    expect(result).toEqual({ totalMatches: 0, snippet: '', extracts: [], matchingLines: [], reachedEof: true });
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

describe('pickSnippetFromLines (rg sample → display snippet)', () => {
  it('returns an empty snippet when every sample line was an omitted long line', () => {
    // parseRgSampleLines drops "[Omitted long matching line]" markers, so a file
    // whose first N matches all exceeded --max-columns yields NO lines at all.
    const samples = parseRgSampleLines('/p/a.jsonl:[Omitted long matching line]\n/p/a.jsonl:[Omitted long matching line]');
    expect(samples.get('/p/a.jsonl')).toBeUndefined();
    expect(pickSnippetFromLines(samples.get('/p/a.jsonl') ?? [], 'convert')).toBe('');
  });

  it('windows a huge tool-result line around the needle (the long-line re-sample case)', () => {
    const doc = 'x '.repeat(3000) + 'instead of converting thinking to text' + ' y'.repeat(3000);
    const line = JSON.stringify({ type: 'message', message: { role: 'toolResult', content: [{ type: 'text', text: doc }] } });
    expect(line.length).toBeGreaterThan(4096);

    const snippet = pickSnippetFromLines([line], 'convert');

    expect(snippet).toContain('converting thinking to text');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(282);
  });

  it('prefers readable text that CONTAINS the needle over conversation text that does not', () => {
    // Assistant text says nothing about the query; the match lives in the tool
    // call — the row highlights the query, so the tool text is the useful preview.
    const assistantNoNeedle = JSON.stringify({ type: 'assistant', message: { content: [
      { type: 'text', text: 'Sure, doing that now.' },
      { type: 'tool_use', name: 'Bash', input: { command: 'pi convert --all' } },
    ] } });
    const toolWithNeedle = JSON.stringify({ type: 'assistant', message: { content: [
      { type: 'tool_use', name: 'Bash', input: { command: 'pi convert --all' } },
    ] } });

    expect(pickSnippetFromLines([assistantNoNeedle, toolWithNeedle], 'convert')).toBe('Bash: pi convert --all');
  });

  it('still prefers conversation text over tool chatter when both contain the needle', () => {
    const tool = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'grep scroll src/' } }] } });
    const user = JSON.stringify({ type: 'user', message: { content: 'the scroll bug is back' } });

    expect(pickSnippetFromLines([tool, user], 'scroll')).toBe('the scroll bug is back');
    // Order-independent: the message-rank text wins regardless of position.
    expect(pickSnippetFromLines([user, tool], 'scroll')).toBe('the scroll bug is back');
  });

  it('matches the needle accent-blind inside the readable text', () => {
    const user = JSON.stringify({ type: 'user', message: { content: 'la conciliación quedó lista' } });
    const raw = 'plain raw line with conciliacion in it';

    // Folded needle "conciliacion" is contained in the accented message → the
    // message wins over the raw line (contains bonus + message rank).
    expect(pickSnippetFromLines([raw, user], 'conciliacion')).toBe('la conciliación quedó lista');
  });
});

describe('pickExtractsFromLines (multi-extract, user prompts first, role-tagged)', () => {
  const claudeUser = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
  const claudeAssistant = (text: string) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
  const claudeThinking = (thinking: string, cmd: string) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [
    { type: 'thinking', thinking, signature: 'sig' },
    { type: 'tool_use', name: 'Bash', input: { command: cmd } },
  ] } });
  const claudeTool = (cmd: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: cmd } }] } });

  it('ranks the user prompt above assistant text above tool output, tagging each with who said it', () => {
    const lines = [
      claudeTool('pi convert --dry-run'),
      claudeAssistant('I will convert the sessions now.'),
      claudeUser('can you convert my pi sessions?'),
    ];

    expect(pickExtractsFromLines(lines, 'convert')).toEqual([
      { text: 'can you convert my pi sessions?', kind: 'user' },
      { text: 'I will convert the sessions now.', kind: 'assistant' },
      { text: 'Bash: pi convert --dry-run', kind: 'tool' },
    ]);
  });

  it('surfaces the agent reasoning (thinking block) as agent text when a row has no visible text', () => {
    const lines = [claudeThinking('The user wants me to convert the sessions; check the format first.', 'ls sessions/')];

    expect(pickExtractsFromLines(lines, 'convert')).toEqual([
      { text: 'The user wants me to convert the sessions; check the format first.', kind: 'assistant' },
    ]);
  });

  it('caps at SNIPPETS_PER_SESSION and dedupes repeated extracts (resumed-session duplicate rows)', () => {
    const lines = [
      claudeUser('convert A'),
      claudeUser('convert A'), // duplicate row
      claudeUser('convert B'),
      claudeUser('convert C'),
      claudeUser('convert D'),
      claudeUser('convert E'),
    ];

    const out = pickExtractsFromLines(lines, 'convert');

    expect(out).toHaveLength(SNIPPETS_PER_SESSION);
    expect(out.map((e) => e.text)).toEqual(['convert A', 'convert B', 'convert C', 'convert D']);
    expect(out.every((e) => e.kind === 'user')).toBe(true);
  });

  it('keeps file order among equal-rank extracts and returns [] for no lines', () => {
    expect(pickExtractsFromLines([claudeUser('first convert'), claudeUser('second convert')], 'convert').map((e) => e.text))
      .toEqual(['first convert', 'second convert']);
    expect(pickExtractsFromLines([], 'convert')).toEqual([]);
  });

  it('multi-word previews prefer and center an extract containing all words nearby', () => {
    const pluginOnly = claudeUser('the plugin needs more contrast');
    const combined = claudeUser(`${'unrelated setup '.repeat(40)}please build a plugin de Gmail for my inbox`);

    const out = pickExtractsFromLines([pluginOnly, combined], 'plugin', ['gmail', 'plugin']);

    expect(out[0].text).toContain('plugin de Gmail');
    expect(out[0].text.startsWith('…')).toBe(true);
  });

  it('pickSnippetFromLines is the text of the first extract', () => {
    const lines = [claudeTool('grep convert'), claudeUser('please convert this')];
    expect(pickSnippetFromLines(lines, 'convert')).toBe(pickExtractsFromLines(lines, 'convert')[0].text);
  });

  it('tags Claude last-prompt bookkeeping rows as the user voice', () => {
    const row = JSON.stringify({ type: 'last-prompt', lastPrompt: 'deploy pls convert pipeline', leafUuid: 'x', sessionId: 's' });
    expect(pickExtractsFromLines([row], 'convert')).toEqual([{ text: 'deploy pls convert pipeline', kind: 'user' }]);
  });

  it('tags pi rows by role (user / assistant / toolResult) and grok reasoning as agent text', () => {
    const piUser = JSON.stringify({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'pi convert please' }] } });
    const piAssistant = JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Converting now.' }] } });
    const piToolResult = JSON.stringify({ type: 'message', message: { role: 'toolResult', content: [{ type: 'text', text: '# Docs about convert' }] } });
    const grokReasoning = JSON.stringify({ type: 'reasoning', summary: [{ text: 'Need to convert the file first' }] });

    expect(pickExtractsFromLines([piToolResult, grokReasoning, piAssistant, piUser], 'convert')).toEqual([
      { text: 'pi convert please', kind: 'user' },
      { text: 'Need to convert the file first', kind: 'assistant' },
      { text: 'Converting now.', kind: 'assistant' },
      { text: '# Docs about convert', kind: 'tool' },
    ]);
  });

  it('tags codex rows: user_message / agent_message / agent_reasoning / reasoning / function_call(+output) / custom_tool_call', () => {
    const rows = [
      JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: 'Chunk convert done\nexit 0' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"pi convert"}' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', input: '*** convert patch' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_reasoning', text: '**Planning the convert step**' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Deciding how to convert' }], content: null } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'I converted the file.' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'convert it please', images: [] } }),
    ];

    const out = pickExtractsFromLines(rows, 'convert');

    expect(out).toEqual([
      { text: 'convert it please', kind: 'user' },
      { text: '**Planning the convert step**', kind: 'assistant' },
      { text: 'Deciding how to convert', kind: 'assistant' },
      { text: 'I converted the file.', kind: 'assistant' },
    ]);
    // Tool rows are parsed (not raw) — visible when the agent-voice rows are absent.
    expect(pickExtractsFromLines(rows.slice(0, 3), 'convert')).toEqual([
      { text: 'Chunk convert done exit 0', kind: 'tool' },
      { text: 'exec_command: {"cmd":"pi convert"}', kind: 'tool' },
      { text: 'apply_patch: *** convert patch', kind: 'tool' },
    ]);
  });

  it('parses grok assistant tool_calls (empty content) as tool voice and dedupes the call against its result', () => {
    // ≥48 shared chars on both sides of the needle — the dedupe key is the
    // escape-stripped span around the needle, so the passage must be long
    // enough that the span never reaches the rows' differing prefixes.
    const passage = '## Theme notes\n- Panels used compile-time $dracula-* SCSS; high-traffic guake/input/header/agent-bar converted to var(--accent-*) / var(--bg-*)\n- Extended theme vars: --selection-bg, --selection-text';
    const grokToolResult = JSON.stringify({ type: 'tool_result', tool_call_id: 'c1', content: `exit: 0\n--- memory ---\n${passage}` });
    // The call that WROTE that memory: the passage sits inside a JSON-encoded
    // arguments string (one escaping level deeper than the result).
    const grokAssistantCall = JSON.stringify({ type: 'assistant', content: '', tool_calls: [
      { id: 'c1', name: 'run_terminal_command', arguments: JSON.stringify({ command: `curl -d ${JSON.stringify({ memory: passage })}` }) },
    ] });

    const out = pickExtractsFromLines([grokToolResult, grokAssistantCall], 'converted');

    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('tool');
    expect(out[0].text).toContain('converted to var(--accent-*)');
    // On its own the call row is a readable tool extract, not raw JSON.
    expect(pickExtractsFromLines([grokAssistantCall], 'converted')[0]).toMatchObject({ kind: 'tool' });
    expect(pickExtractsFromLines([grokAssistantCall], 'converted')[0].text.startsWith('run_terminal_command: ')).toBe(true);
  });

  it('dedupes the same passage seen parsed and raw (JSON-escaped newlines / quotes)', () => {
    const parsed = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'convert "this"\nnow' }] } });
    const rawEscaped = 'prefix convert \\"this\\"\\nnow'; // not JSON → raw, but the same words
    const out = pickExtractsFromLines([parsed, rawEscaped], 'convert');
    expect(out).toHaveLength(2); // different leading text ("prefix ") → distinct
    const same = pickExtractsFromLines([parsed, 'convert \\"this\\"\\nnow'], 'convert');
    expect(same).toEqual([{ text: 'convert "this" now', kind: 'assistant' }]);
  });

  it('scanSessionFileForQuery returns the same ranked, tagged extracts (JS engine parity)', async () => {
    const file = writeTmpJsonl([
      claudeTool('pi convert --dry-run'),
      claudeAssistant('I will convert the sessions now.'),
      claudeUser('can you convert my pi sessions?'),
    ]);

    const result = await scanSessionFileForQuery(file, 'convert');

    expect(result.extracts).toEqual([
      { text: 'can you convert my pi sessions?', kind: 'user' },
      { text: 'I will convert the sessions now.', kind: 'assistant' },
      { text: 'Bash: pi convert --dry-run', kind: 'tool' },
    ]);
    expect(result.snippet).toBe('can you convert my pi sessions?');
  });
});

describe('userPromptWithNeedlePattern (rg pass B-user)', () => {
  // Real line shapes per harness (abridged from actual session files).
  const CLAUDE_PROMPT_STRING = '{"parentUuid":null,"type":"user","message":{"role":"user","content":"deploy pls convert pipeline"},"uuid":"1"}';
  const CLAUDE_PROMPT_BLOCK = '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Base directory convert here"}]}}';
  const CLAUDE_TOOL_RESULT = '{"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_1","type":"tool_result","content":"convert output"}]}}';
  const CLAUDE_ASSISTANT = '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"I will convert it"}]}}';
  const PI_USER = '{"type":"message","id":"d1","message":{"role":"user","content":[{"type":"text","text":"pi convert please"}]}}';
  const PI_TOOL_RESULT = '{"type":"message","id":"d2","message":{"role":"toolResult","content":[{"type":"text","text":"# Docs convert"}]}}';
  const CODEX_EVENT = '{"timestamp":"t","type":"event_msg","payload":{"type":"user_message","message":"convert this","images":[]}}';
  const CODEX_ITEM = '{"type":"message","id":null,"role":"user","content":[{"type":"input_text","text":"<environment_context>convert</environment_context>"}]}';
  const GROK_USER = '{"type":"user","content":[{"type":"text","text":"<user_info>convert</user_info>"}]}';

  const re = () => new RegExp(userPromptWithNeedlePattern(accentFoldPattern('convert')), 'i');

  it('matches user-typed rows of every harness that contain the needle', () => {
    for (const line of [CLAUDE_PROMPT_STRING, CLAUDE_PROMPT_BLOCK, PI_USER, CODEX_EVENT, CODEX_ITEM, GROK_USER]) {
      expect(re().test(line), line).toBe(true);
    }
  });

  it('does NOT match tool results, assistant rows, or user rows without the needle', () => {
    for (const line of [CLAUDE_TOOL_RESULT, CLAUDE_ASSISTANT, PI_TOOL_RESULT]) {
      expect(re().test(line), line).toBe(false);
    }
    expect(re().test('{"type":"user","message":{"role":"user","content":"unrelated"}}')).toBe(false);
  });

  it('is accent-blind through accentFoldPattern', () => {
    const line = '{"type":"user","message":{"role":"user","content":"la conciliación de hoy"}}';
    expect(new RegExp(userPromptWithNeedlePattern(accentFoldPattern('conciliacion')), 'i').test(line)).toBe(true);
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

    expect(planFileSearch([cached], 'scroll', 1000, 500)).toEqual({ kind: 'reuse', totalMatches: 3, snippet: 'the scroll bug', extracts: [{ text: 'the scroll bug', kind: 'raw' }] });
  });

  it('prunes a refined query when the shorter query already had zero matches', () => {
    // "scro" was nowhere in the file → "scroll" cannot be either.
    expect(planFileSearch([entry({})], 'scroll', 1000, 500)).toEqual({ kind: 'reuse', totalMatches: 0, snippet: '', extracts: [] });
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
      extracts: [{ text: 'fix the SCROLL bar', kind: 'user' }],
    });
  });

  it('answers from an OLDER entry when the newest does not cover the query (backspace)', () => {
    // Typing "scroll" then backspacing to "scro": the newest entry ("scroll")
    // cannot answer "scro", but the older exact "scro" entry can.
    const entries = [
      entry({ query: 'scroll', totalMatches: 1, snippet: 'newer' }),
      entry({ query: 'scro', totalMatches: 4, snippet: 'older exact' }),
    ];

    expect(planFileSearch(entries, 'scro', 1000, 500)).toEqual({ kind: 'reuse', totalMatches: 4, snippet: 'older exact', extracts: [{ text: 'older exact', kind: 'raw' }] });
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
      head: { totalMatches: 2, snippet: 'old snippet', extracts: [{ text: 'old snippet', kind: 'raw' }], matchingLines: [] },
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
    const cached = entry({ query: 'jira krunner', totalMatches: 3, nearbyMatches: 2, snippet: 'the jira board' });

    expect(planTokenFileSearch([cached], 'jira krunner', 1000, 500)).toEqual({
      totalMatches: 3,
      nearbyMatches: 2,
      snippet: 'the jira board',
      extracts: [{ text: 'the jira board', kind: 'raw' }],
    });
  });

  it('zero-prunes from a contained query with no matches ("jira" absent → "jira krunner" cannot AND-match)', () => {
    expect(planTokenFileSearch([entry({ query: 'jira', totalMatches: 0 })], 'jira krunner', 1000, 500)).toEqual({
      totalMatches: 0,
      nearbyMatches: 0,
      snippet: '',
      extracts: [],
    });
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

describe('nearbyTokensPattern', () => {
  it('matches all words close together in any order', () => {
    const source = nearbyTokensPattern(['gmail', 'plugin']);
    expect(source).not.toBeNull();
    const re = new RegExp(source!, 'i');

    expect(re.test('build a Gmail plugin for the command palette')).toBe(true);
    expect(re.test('this plugin is specifically for Gmail inboxes')).toBe(true);
    expect(re.test(`gmail ${'x'.repeat(81)} plugin`)).toBe(false);
  });

  it('requires every word and stays accent-insensitive', () => {
    const source = nearbyTokensPattern(['conciliacion', 'pase', 'automatica']);
    const re = new RegExp(source!, 'i');

    expect(re.test('PASE necesita conciliación automática')).toBe(true);
    expect(re.test('PASE necesita conciliación manual')).toBe(false);
  });
});

describe('accent-insensitive matching', () => {
  it('foldAccents collapses accented vowels and ñ, preserving length', () => {
    expect(foldAccents('conciliación automática')).toBe('conciliacion automatica');
    expect(foldAccents('Ñoño ÁÉÍÓÚ ü')).toBe('nono aeiou u');
    expect(foldAccents('conciliación').length).toBe('conciliación'.length);
  });

  it('accentFoldPattern matches both spellings regardless of which one was typed', () => {
    for (const literal of ['conciliación', 'conciliacion']) {
      const re = new RegExp(accentFoldPattern(literal), 'i');
      expect(re.test('la CONCILIACIÓN de PASE')).toBe(true);
      expect(re.test('la conciliacion de PASE')).toBe(true);
      expect(re.test('reconciliar')).toBe(false);
    }
  });

  it('scanner finds accented content with an unaccented query (and vice versa)', async () => {
    const file = writeTmpJsonl([
      userLine('Revisar la conciliación automática de PASE'),
      userLine('nada relacionado'),
    ]);

    const unaccented = await scanSessionFileForQuery(file, 'conciliacion');
    expect(unaccented.totalMatches).toBe(1);
    expect(unaccented.snippet).toContain('conciliación');

    const accented = await scanSessionFileForQuery(file, 'automática');
    expect(accented.totalMatches).toBe(1);
  });

  it('planFileSearch answers a folded refinement from accented retained lines', () => {
    const cached: SearchFileCacheEntry = {
      mtimeMs: 1000,
      sizeBytes: 500,
      query: 'concilia',
      totalMatches: 1,
      snippet: 'la conciliación automática',
      matchingLines: [JSON.stringify({ type: 'user', message: { content: 'la conciliación automática' } })],
    };

    const plan = planFileSearch([cached], 'conciliacion', 1000, 500);
    expect(plan.kind).toBe('reuse');
    if (plan.kind === 'reuse') {
      expect(plan.totalMatches).toBe(1);
    }
  });
});

describe('session search ranking (relevance × recency)', () => {
  const DAY = 86_400_000;
  const now = 1_700_000_000_000;
  const match = (sessionId: string, totalMatches: number, ageDays: number, nearbyMatches?: number) => ({
    sessionId,
    totalMatches,
    nearbyMatches,
    lastModified: new Date(now - ageDays * DAY),
  });
  // Freeze "now" so rankSessionMatches scores against the fixtures' epoch.
  const rank = (ms: ReturnType<typeof match>[]) => {
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      return rankSessionMatches(ms).map((m) => m.sessionId);
    } finally {
      spy.mockRestore();
    }
  };

  it('ranks a topical session above fresher one-hit sessions (the "conciliación pase" case)', () => {
    expect(rank([
      match('one-hit-today-a', 1, 0),
      match('one-hit-today-b', 2, 0),
      match('topical-2d-ago', 10, 2),
    ])).toEqual(['topical-2d-ago', 'one-hit-today-b', 'one-hit-today-a']);
  });

  it('puts a concentrated multi-word topic above huge unrelated token counts', () => {
    expect(rank([
      match('boilerplate-noise', 3941, 4, 16),
      match('incidental-dispersed', 475, 0, 0),
      match('gmail-plugin-topic', 136, 1, 102),
    ])).toEqual(['gmail-plugin-topic', 'boilerplate-noise', 'incidental-dispersed']);
  });

  it('prefers the newer session at equal match counts (recency decay)', () => {
    expect(rank([
      match('older', 5, 10),
      match('newer', 5, 1),
    ])).toEqual(['newer', 'older']);
  });

  it('keeps a heavily-matching old session above a fresh incidental one (decay floor)', () => {
    expect(rank([
      match('one-hit-today', 1, 0),
      match('topical-1y-ago', 50, 365),
    ])).toEqual(['topical-1y-ago', 'one-hit-today']);
  });

  it('log-scales match counts so a huge session cannot bury moderately-topical fresh ones', () => {
    // 300 hits from a month ago vs 12 hits from today: recency wins.
    const huge = sessionSearchScore(300, new Date(now - 30 * DAY), now);
    const fresh = sessionSearchScore(12, new Date(now), now);
    expect(fresh).toBeGreaterThan(huge);
  });

  it('breaks exact score ties newest-first', () => {
    const a = match('tie-old', 3, 5);
    const b = { ...match('tie-new', 3, 5), lastModified: new Date(now - 5 * DAY + 1) };
    expect(rank([a, b])).toEqual(['tie-new', 'tie-old']);
  });
});
