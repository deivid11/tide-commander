import { describe, it, expect } from 'vitest';
import { nextStreamFadeState, splitStreamWords, splitStableMarkdown } from '../StreamFadeText';

describe('nextStreamFadeState', () => {
  it('returns full text with no fade when not streaming', () => {
    expect(nextStreamFadeState('', 'Hello world', false)).toEqual({
      solid: 'Hello world',
      fade: null,
    });
  });

  it('fades the first chunk from empty base', () => {
    expect(nextStreamFadeState('', 'Hello', true)).toEqual({
      solid: '',
      fade: 'Hello',
    });
  });

  it('fades only the newest suffix on append', () => {
    expect(nextStreamFadeState('Hello', 'Hello world', true)).toEqual({
      solid: 'Hello',
      fade: ' world',
    });
  });

  it('resets solid when text does not append previous base', () => {
    expect(nextStreamFadeState('Hello', 'Goodbye', true)).toEqual({
      solid: 'Goodbye',
      fade: null,
    });
  });
});

describe('splitStreamWords', () => {
  it('keeps whitespace tokens for layout', () => {
    expect(splitStreamWords('hello world')).toEqual(['hello', ' ', 'world']);
    expect(splitStreamWords(' a  b')).toEqual([' ', 'a', '  ', 'b']);
  });
});

describe('splitStableMarkdown', () => {
  it('returns whole text as tail when no paragraph boundary', () => {
    expect(splitStableMarkdown('single paragraph still typing')).toEqual({
      head: '',
      tail: 'single paragraph still typing',
    });
  });

  it('splits at the last paragraph boundary, head keeps the blank line', () => {
    expect(splitStableMarkdown('first para\n\nsecond para\n\nstill typ')).toEqual({
      head: 'first para\n\nsecond para\n\n',
      tail: 'still typ',
    });
  });

  it('head stays byte-identical while the tail grows (memo stability)', () => {
    const a = splitStableMarkdown('done\n\npartial wor');
    const b = splitStableMarkdown('done\n\npartial words arriving');
    expect(a.head).toBe(b.head);
  });

  it('never splits inside an open code fence', () => {
    const text = 'intro\n\n```js\nconst a = 1;\n\nconst b = 2;';
    expect(splitStableMarkdown(text)).toEqual({
      head: 'intro\n\n',
      tail: '```js\nconst a = 1;\n\nconst b = 2;',
    });
  });

  it('splits after a closed code fence', () => {
    const text = 'intro\n\n```js\ncode\n```\n\nafter fen';
    expect(splitStableMarkdown(text)).toEqual({
      head: 'intro\n\n```js\ncode\n```\n\n',
      tail: 'after fen',
    });
  });
});
