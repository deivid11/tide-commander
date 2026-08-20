import { describe, it, expect } from 'vitest';
import {
  blocksToMarkdown,
  blocksToPlainText,
  buildOutline,
  countMatches,
  findMatchingBlocks,
  groupBlocks,
  splitHighlight,
  type DocBlock,
} from './documentBlocks';

const blocks: DocBlock[] = [
  { type: 'paragraph', heading: 1, runs: [{ text: 'Título uno' }] },
  { type: 'paragraph', runs: [{ text: 'Texto con ' }, { text: 'negrita', bold: true }, { text: ' y ' }, { text: 'link', href: 'https://tide.mx' }] },
  { type: 'paragraph', heading: 2, runs: [{ text: 'Sub sección' }] },
  { type: 'paragraph', list: { kind: 'bullet', level: 0 }, runs: [{ text: 'uno' }] },
  { type: 'paragraph', list: { kind: 'bullet', level: 0 }, runs: [{ text: 'dos' }] },
  { type: 'paragraph', list: { kind: 'ordered', level: 0 }, runs: [{ text: 'primero' }] },
  {
    type: 'table',
    colCount: 2,
    rows: [
      [{ blocks: [{ type: 'paragraph', runs: [{ text: 'Concepto' }] }], header: true }, { blocks: [{ type: 'paragraph', runs: [{ text: 'Monto' }] }], header: true }],
      [{ blocks: [{ type: 'paragraph', runs: [{ text: 'SPEI' }] }] }, { blocks: [{ type: 'paragraph', runs: [{ text: '1,234.56' }] }] }],
    ],
  },
  { type: 'paragraph', runs: [{ text: 'Cierre con código', mono: true }] },
];

describe('buildOutline', () => {
  it('lists headings with their block index and level', () => {
    expect(buildOutline(blocks)).toEqual([
      { index: 0, level: 1, text: 'Título uno' },
      { index: 2, level: 2, text: 'Sub sección' },
    ]);
  });

  it('skips empty headings', () => {
    expect(buildOutline([{ type: 'paragraph', heading: 1, runs: [{ text: '   ' }] }])).toEqual([]);
  });
});

describe('groupBlocks', () => {
  it('merges consecutive list items of the same kind and level into one group', () => {
    const groups = groupBlocks(blocks);
    const lists = groups.filter((g) => g.kind === 'list');
    expect(lists).toHaveLength(2);
    expect(lists[0]).toMatchObject({ listKind: 'bullet', level: 0 });
    expect(lists[0].blocks.map((b) => b.index)).toEqual([3, 4]);
    expect(lists[1]).toMatchObject({ listKind: 'ordered', level: 0 });
    // Non-list blocks keep their own group and original index.
    expect(groups[0]).toMatchObject({ kind: 'block' });
    expect(groups[0].blocks[0].index).toBe(0);
  });

  it('splits a list when the level changes', () => {
    const nested: DocBlock[] = [
      { type: 'paragraph', list: { kind: 'bullet', level: 0 }, runs: [{ text: 'a' }] },
      { type: 'paragraph', list: { kind: 'bullet', level: 1 }, runs: [{ text: 'a.1' }] },
      { type: 'paragraph', list: { kind: 'bullet', level: 0 }, runs: [{ text: 'b' }] },
    ];
    expect(groupBlocks(nested).map((g) => g.level)).toEqual([0, 1, 0]);
  });
});

describe('text + markdown export', () => {
  it('renders plain text with tab-separated table rows', () => {
    const text = blocksToPlainText(blocks);
    expect(text).toContain('Texto con negrita y link');
    expect(text).toContain('Concepto\tMonto');
    expect(text).toContain('SPEI\t1,234.56');
  });

  it('renders GFM markdown with headings, lists, links and a table', () => {
    const md = blocksToMarkdown(blocks);
    expect(md).toContain('# Título uno');
    expect(md).toContain('## Sub sección');
    expect(md).toContain('**negrita**');
    expect(md).toContain('[link](https://tide.mx)');
    expect(md).toContain('- uno');
    expect(md).toContain('1. primero');
    expect(md).toContain('| Concepto | Monto |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('| SPEI | 1,234.56 |');
    expect(md).toContain('`Cierre con código`');
  });

  it('escapes markdown metacharacters in plain runs', () => {
    const md = blocksToMarkdown([{ type: 'paragraph', runs: [{ text: 'a * b _ c [d]' }] }]);
    expect(md).toBe('a \\* b \\_ c \\[d\\]\n');
  });
});

describe('search helpers', () => {
  it('counts every occurrence, case-insensitively, including table cells', () => {
    expect(countMatches(blocks, 'sección')).toBe(1);
    expect(countMatches(blocks, 'o')).toBeGreaterThan(5);
    expect(countMatches(blocks, 'SPEI')).toBe(1);
    expect(countMatches(blocks, '')).toBe(0);
    expect(countMatches(blocks, 'zzz')).toBe(0);
  });

  it('returns the indices of matching blocks', () => {
    expect(findMatchingBlocks(blocks, 'negrita')).toEqual([1]);
    expect(findMatchingBlocks(blocks, 'monto')).toEqual([6]);
    expect(findMatchingBlocks(blocks, 'zzz')).toEqual([]);
  });

  it('splits text into highlight segments', () => {
    expect(splitHighlight('abcABC', 'bc')).toEqual([
      { text: 'a', match: false },
      { text: 'bc', match: true },
      { text: 'A', match: false },
      { text: 'BC', match: true },
    ]);
    expect(splitHighlight('sin coincidencia', 'zz')).toEqual([{ text: 'sin coincidencia', match: false }]);
    expect(splitHighlight('texto', '')).toEqual([{ text: 'texto', match: false }]);
  });
});
