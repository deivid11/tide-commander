import { describe, it, expect } from 'vitest';
import { tokenizeAlfredQuery, alfredMatchTier } from './alfred-match.js';

describe('tokenizeAlfredQuery', () => {
  it('splits on whitespace, lowercases, drops empties', () => {
    expect(tokenizeAlfredQuery('  Daisy   Designer ')).toEqual(['daisy', 'designer']);
    expect(tokenizeAlfredQuery('')).toEqual([]);
  });
});

describe('alfredMatchTier', () => {
  const other = 'quagsire idle claude /home/riven/d/daisy DaisySeed print the enclosure';

  it('ranks title match quality in tiers', () => {
    expect(alfredMatchTier(['designer 3d print'.split(' ')].flat(), 'Designer 3D print', other)).toBeGreaterThan(0);
    expect(alfredMatchTier(['designer'], 'Designer 3D print', other)).toBe(5);   // prefix
    expect(alfredMatchTier(['print'], 'Designer 3D print', other)).toBe(4);      // whole word
    expect(alfredMatchTier(['rint'], 'Designer 3D print', other)).toBe(3);       // substring
    expect(alfredMatchTier(['daisyseed'], 'Designer 3D print', other)).toBe(2);  // other field
    expect(alfredMatchTier(['zebra'], 'Designer 3D print', other)).toBe(0);      // no match
  });

  it('AND-of-words: every word must match, tier is the weakest word', () => {
    expect(alfredMatchTier(['daisy', 'designer'], 'Designer 3D print', other)).toBe(2);
    expect(alfredMatchTier(['daisy', 'zebra'], 'Designer 3D print', other)).toBe(0);
  });

  it('is word-order independent', () => {
    expect(alfredMatchTier(['designer', 'daisy'], 'Designer 3D print', other))
      .toBe(alfredMatchTier(['daisy', 'designer'], 'Designer 3D print', other));
  });

  it('empty queries rank everything at 1 (recency decides)', () => {
    expect(alfredMatchTier([], 'Anything', '')).toBe(1);
  });
});
