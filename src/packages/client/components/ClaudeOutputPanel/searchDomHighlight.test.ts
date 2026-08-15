import { describe, expect, it } from 'vitest';
import { computeMatchSpans } from './searchDomHighlight';

// Note: the DOM half of searchDomHighlight (buildRowTextIndex, spanToRange,
// applySearchHighlights) needs a real document + CSS Highlight registry and is
// exercised in the browser; this suite covers the pure span computation the
// painting is built on.

function slices(text: string, query: string): string[] {
  return computeMatchSpans(text, query).map((s) => text.slice(s.start, s.end));
}

describe('computeMatchSpans', () => {
  it('finds every occurrence of a single token, case-insensitively', () => {
    expect(slices('Foo bar foo BAZ fOo', 'foo')).toEqual(['Foo', 'foo', 'fOo']);
  });

  it('returns [start, end) offsets into the original text', () => {
    expect(computeMatchSpans('abc foo xyz', 'foo')).toEqual([{ start: 4, end: 7 }]);
  });

  it('highlights each word of a multi-word query independently', () => {
    expect(slices('the login page has a login redirect', 'login redirect')).toEqual([
      'login',
      'login redirect',
    ]);
  });

  it('prefers the full phrase over its own words at the same offset', () => {
    expect(slices('login redirect', 'login redirect')).toEqual(['login redirect']);
  });

  it('never returns overlapping spans', () => {
    const spans = computeMatchSpans('aaa aaa', 'aaa aa');
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end);
    }
  });

  it('escapes regex metacharacters in the query', () => {
    expect(slices('call foo(bar) then a.b', 'foo(bar) a.b')).toEqual(['foo(bar)', 'a.b']);
    expect(slices('axb', 'a.b')).toEqual([]);
  });

  it('returns nothing for blank queries or empty text', () => {
    expect(computeMatchSpans('some text', '   ')).toEqual([]);
    expect(computeMatchSpans('', 'foo')).toEqual([]);
  });

  it('does not match across the block-boundary separator', () => {
    // buildRowTextIndex joins blocks with '\n'; a phrase with a space must not
    // match across that separator.
    expect(slices('hello\nworld', 'hello world')).toEqual(['hello', 'world']);
  });
});
