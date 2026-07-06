import { describe, expect, it } from 'vitest';
import {
  tokenize,
  matchContent,
  extractSnippet,
  extractFileReferences,
  fuzzyMatch,
  rankFiles,
  type SearchItem,
} from './searchIndexing';
import type { EnrichedHistoryMessage } from './types';

// ── Builders ──────────────────────────────────────────────────────────────
function msg(partial: Partial<EnrichedHistoryMessage> & { content: string }): SearchItem {
  return {
    type: 'assistant',
    timestamp: '2026-07-06T10:00:00.000Z',
    ...partial,
  } as EnrichedHistoryMessage;
}

function toolUse(toolName: string, input: Record<string, unknown>, ts?: string): SearchItem {
  return {
    type: 'tool_use',
    content: '',
    timestamp: ts ?? '2026-07-06T10:00:00.000Z',
    toolName,
    toolInput: input,
  } as EnrichedHistoryMessage;
}

// ── tokenize ──────────────────────────────────────────────────────────────
describe('tokenize', () => {
  it('lowercases and splits on whitespace, dropping empties', () => {
    expect(tokenize('  Hello   World ')).toEqual(['hello', 'world']);
  });
  it('returns empty for blank input', () => {
    expect(tokenize('   ')).toEqual([]);
  });
});

// ── matchContent ──────────────────────────────────────────────────────────
describe('matchContent', () => {
  it('matches an exact multi-word phrase and outranks a token-only match', () => {
    const phrase = matchContent('say hello world today', 'hello world', tokenize('hello world'));
    const tokensOnly = matchContent('world then hello', 'hello world', tokenize('hello world'));
    expect(phrase.matched).toBe(true);
    expect(tokensOnly.matched).toBe(true);
    expect(phrase.score).toBeGreaterThan(tokensOnly.score);
    expect(phrase.score).toBeGreaterThanOrEqual(1000);
  });

  it('requires every token to be present (AND semantics)', () => {
    const q = 'hello world';
    expect(matchContent('only hello here', q, tokenize(q)).matched).toBe(false);
    expect(matchContent('hello and world', q, tokenize(q)).matched).toBe(true);
  });

  it('counts occurrences of the primary token when there is no phrase match', () => {
    const q = 'foo';
    const m = matchContent('foo bar foo baz foo', q, tokenize(q));
    expect(m.matched).toBe(true);
    expect(m.matchCount).toBe(3);
  });

  it('does not match empty text or empty tokens', () => {
    expect(matchContent('', 'foo', ['foo']).matched).toBe(false);
    expect(matchContent('some text', '', []).matched).toBe(false);
  });
});

// ── extractSnippet ────────────────────────────────────────────────────────
describe('extractSnippet', () => {
  it('collapses whitespace and returns the full text when short', () => {
    expect(extractSnippet('a   b\n c', 'b')).toBe('a b c');
  });

  it('windows around the match and ellipsizes both ends', () => {
    const text = 'x'.repeat(300) + ' NEEDLE ' + 'y'.repeat(300);
    const snippet = extractSnippet(text, 'NEEDLE', 20);
    expect(snippet).toContain('NEEDLE');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThan(text.length);
  });
});

// ── extractFileReferences ─────────────────────────────────────────────────
describe('extractFileReferences', () => {
  it('aggregates tool operations per file with counts and item indices', () => {
    const path = 'src/packages/server/claude/runner/recovery-store.ts';
    const items: SearchItem[] = [
      toolUse('Read', { file_path: path }),
      toolUse('Edit', { file_path: path }),
      toolUse('Edit', { file_path: path }),
      toolUse('Write', { file_path: 'src/packages/client/store/agents.ts' }),
    ];
    const refs = extractFileReferences(items);
    const rec = refs.find((r) => r.path === path);
    expect(rec).toBeDefined();
    expect(rec?.basename).toBe('recovery-store.ts');
    expect(rec?.dir).toBe('src/packages/server/claude/runner');
    expect(rec?.ops).toMatchObject({ read: 1, edit: 2, write: 0 });
    expect(rec?.count).toBe(3);
    expect(rec?.itemIndices).toEqual([0, 1, 2]);
  });

  it('picks up file paths mentioned in free text as "other" ops', () => {
    const items: SearchItem[] = [
      msg({ content: 'I updated src/foo/bar.ts to fix the bug' }),
    ];
    const refs = extractFileReferences(items);
    const bar = refs.find((r) => r.path === 'src/foo/bar.ts');
    expect(bar).toBeDefined();
    expect(bar?.ops.other).toBe(1);
  });

  it('ignores code accessors that merely look like name.ext', () => {
    // Source code shown in the conversation must not pollute the file index.
    const items: SearchItem[] = [
      msg({ content: 'expect(m.matched).toBe(true) and check msg._bashCommand and r.itemIndex' }),
    ];
    const refs = extractFileReferences(items);
    expect(refs).toHaveLength(0);
  });

  it('keeps a bare filename with a known extension', () => {
    const items: SearchItem[] = [msg({ content: 'see README.md for details' })];
    const refs = extractFileReferences(items);
    expect(refs.find((r) => r.path === 'README.md')).toBeDefined();
  });

  it('does not double-count a tool path that also appears in item text', () => {
    const items: SearchItem[] = [
      toolUse('Read', { file_path: 'src/a.ts' }),
    ];
    // getItemText for a tool_use only includes content + toolName, not the
    // toolInput path, so the tool path is counted exactly once.
    const refs = extractFileReferences(items);
    expect(refs.find((r) => r.path === 'src/a.ts')?.count).toBe(1);
  });
});

// ── fuzzyMatch ────────────────────────────────────────────────────────────
describe('fuzzyMatch', () => {
  it('matches a subsequence and rejects a non-subsequence', () => {
    expect(fuzzyMatch('rec', 'recovery-store.ts').matched).toBe(true);
    expect(fuzzyMatch('xyz', 'recovery-store.ts').matched).toBe(false);
  });

  it('scores a contiguous prefix match above a scattered one', () => {
    const tight = fuzzyMatch('rec', 'recovery.ts');
    const loose = fuzzyMatch('rec', 'rxexcxovery.ts');
    expect(tight.score).toBeGreaterThan(loose.score);
  });
});

// ── rankFiles ─────────────────────────────────────────────────────────────
describe('rankFiles', () => {
  const items: SearchItem[] = [
    toolUse('Read', { file_path: 'src/packages/server/claude/runner/recovery-store.ts' }),
    toolUse('Edit', { file_path: 'src/packages/client/store/agents.ts' }),
  ];
  const refs = extractFileReferences(items);

  it('finds a file via a cross-directory fuzzy query on the full path', () => {
    const ranked = rankFiles(refs, 'runrec');
    expect(ranked.length).toBe(1);
    expect(ranked[0].basename).toBe('recovery-store.ts');
  });

  it('ranks the best (exact-substring, tool-touched) file first', () => {
    // A real .md file that was Written vs a code mention that fuzzily contains
    // the letters m,d somewhere. The real file must come first.
    const mixed = extractFileReferences([
      toolUse('Write', { file_path: '/home/riven/.claude/plans/moonlit-honking-wilkinson.md' }),
      msg({ content: 'the command src/model-data.txt was noted' }),
    ]);
    const ranked = rankFiles(mixed, '.md');
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].basename).toBe('moonlit-honking-wilkinson.md');
  });

  it('returns every file for an empty query, ranked by frequency', () => {
    const busier = extractFileReferences([
      ...items,
      toolUse('Edit', { file_path: 'src/packages/client/store/agents.ts' }),
    ]);
    const ranked = rankFiles(busier, '');
    expect(ranked.length).toBe(2);
    expect(ranked[0].basename).toBe('agents.ts'); // referenced twice
  });
});
