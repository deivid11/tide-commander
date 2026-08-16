import { describe, it, expect } from 'vitest';
import Fuse from 'fuse.js';
import { tokenizeQuery, searchAllTokens, matchTierForQuery, escapeRegExp } from './multiTokenSearch';

interface Item {
  title: string;
  _searchText: string;
}

// Mirrors the agentFuse configuration in useSpotlightSearch.tsx.
function makeFuse(items: Item[]): Fuse<Item> {
  return new Fuse(items, {
    keys: ['title', '_searchText'],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
  });
}

// The real-world case that motivated AND-of-words matching: the agent's name
// and its area name live in different parts of the searchable text.
const designer: Item = {
  title: 'Designer 3D print',
  _searchText: 'Designer 3D print ralts idle /home/riven/d/daisy DaisySeed',
};
const decoys: Item[] = [
  { title: 'Zapdos Kai', _searchText: 'Zapdos Kai zapdos idle /home/riven/d/last-hit-trainer Wind' },
  { title: 'Cotización SPEI 2', _searchText: 'Cotización SPEI 2 smoochum idle /home/riven/d/tconnect Transfer Connect' },
];

describe('tokenizeQuery', () => {
  it('splits on whitespace, lowercases, drops empties', () => {
    expect(tokenizeQuery('  Daisy   Designer ')).toEqual(['daisy', 'designer']);
    expect(tokenizeQuery('')).toEqual([]);
    expect(tokenizeQuery('   ')).toEqual([]);
  });
});

describe('searchAllTokens', () => {
  const fuse = makeFuse([designer, ...decoys]);

  it('finds an item whose words match different fields ("daisy designer")', () => {
    const hits = searchAllTokens(fuse, 'daisy designer');
    expect(hits.map((h) => h.item.title)).toContain('Designer 3D print');
  });

  it('is word-order independent', () => {
    const hits = searchAllTokens(fuse, 'designer daisy');
    expect(hits.map((h) => h.item.title)).toContain('Designer 3D print');
  });

  it('requires EVERY word to match (AND semantics)', () => {
    const hits = searchAllTokens(fuse, 'daisy zebra');
    expect(hits).toEqual([]);
  });

  it('single-word queries behave exactly like fuse.search', () => {
    const direct = fuse.search('designer').map((r) => r.item.title);
    const tokened = searchAllTokens(fuse, 'designer').map((h) => h.item.title);
    expect(tokened).toEqual(direct);
  });

  it('ranks items matching all words strongly above weaker matches', () => {
    const twin: Item = { title: 'Daisy Designer', _searchText: 'Daisy Designer ditto idle /home/riven/d/daisy DaisySeed' };
    const hits = searchAllTokens(makeFuse([designer, twin, ...decoys]), 'daisy designer');
    expect(hits[0].item.title).toBe('Daisy Designer');
  });
});

describe('matchTierForQuery', () => {
  const other = 'ralts • /home/riven/d/daisy DaisySeed';

  it('keeps single-word tier semantics', () => {
    expect(matchTierForQuery('designer 3d print', 'Designer 3D print', other)).toBe(6);
    expect(matchTierForQuery('designer', 'Designer 3D print', other)).toBe(5);
    expect(matchTierForQuery('print', 'Designer 3D print', other)).toBe(4);
    expect(matchTierForQuery('rint', 'Designer 3D print', other)).toBe(3);
    expect(matchTierForQuery('daisyseed', 'Designer 3D print', other)).toBe(2);
    expect(matchTierForQuery('zebra', 'Designer 3D print', other)).toBe(1);
  });

  it('cross-field multi-word matches land at tier 2 (weakest word), not the fuzzy floor', () => {
    expect(matchTierForQuery('daisy designer', 'Designer 3D print', other)).toBe(2);
  });

  it('multi-word phrase matches keep their phrase tier', () => {
    expect(matchTierForQuery('designer 3d', 'Designer 3D print', other)).toBe(5);
  });

  it('empty query is the floor', () => {
    expect(matchTierForQuery('', 'Designer 3D print', other)).toBe(1);
  });
});

describe('escapeRegExp', () => {
  it('escapes regex metacharacters', () => {
    const escaped = escapeRegExp('a.b*c?');
    expect(new RegExp(escaped).test('a.b*c?')).toBe(true);
    expect(new RegExp(escaped).test('axbxc')).toBe(false);
  });
});
