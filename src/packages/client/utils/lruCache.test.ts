import { describe, expect, it } from 'vitest';
import { LruCache, contentKey } from './lruCache';
import { renderedLinesToHtml, terminalOutputToHtmlLines } from './terminalOutputHtml';

describe('LruCache', () => {
  it('evicts by entry count and by size budget, refreshing recency on get', () => {
    const c = new LruCache<string>(3, 100, (v) => v.length);
    c.set('a', 'aaaa');
    c.set('b', 'bbbb');
    c.set('c', 'cccc');
    expect(c.get('a')).toBe('aaaa'); // a becomes most recent
    c.set('d', 'dddd'); // evicts b (oldest)
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe('aaaa');
    expect(c.size).toBe(3);
    c.set('big', 'x'.repeat(90)); // pushes total over 100 → evicts oldest until it fits
    expect(c.get('big')).toBeDefined();
    expect(c.size).toBeLessThanOrEqual(3);
    // Larger than the whole budget: not cached, no eviction storm.
    c.set('huge', 'y'.repeat(500));
    expect(c.get('huge')).toBeUndefined();
    expect(c.get('big')).toBeDefined();
  });

  it('contentKey is stable, length-prefixed and sensitive to content', () => {
    expect(contentKey('hello')).toBe(contentKey('hello'));
    expect(contentKey('hello')).not.toBe(contentKey('hellp'));
    expect(contentKey('ab')).not.toBe(contentKey('ba'));
    expect(contentKey('hello').startsWith('5:')).toBe(true);
  });
});

const TSX = `import React from 'react';
/**
 * Doc
 */
export function Toggle({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation(['tools']);
  return <span className={enabled ? 'active' : ''}>{t('x')}</span>;
}`;

describe('render memoization', () => {
  it('terminalOutputToHtmlLines returns the cached array for identical text', () => {
    const text = `${TSX}\n=== section ===\n M src/a.ts\n?? src/b.ts`;
    const a = terminalOutputToHtmlLines(text);
    const b = terminalOutputToHtmlLines(text);
    expect(b).toBe(a); // same reference → React sees identical strings, no DOM churn
    expect(terminalOutputToHtmlLines(text + '\nx')).not.toBe(a);
  });

  it('renderedLinesToHtml reuses cached segments and only recomputes the changed tail', () => {
    const head = TSX.split('\n');
    const first = renderedLinesToHtml([...head, '=== next ===', 'INFO one']);
    const second = renderedLinesToHtml([...head, '=== next ===', 'INFO one', 'INFO two']);
    // The unchanged first segment renders identically (cache hit) …
    for (let i = 0; i < head.length; i += 1) expect(second[i]).toBe(first[i]);
    // … and the new tail line is present.
    expect(second[second.length - 1]).toContain('sh-info');
  });

  it('streaming mode keeps code segments on the per-line path; a final non-streaming pass uses the block pass', () => {
    const lines = TSX.split('\n');
    const streaming = renderedLinesToHtml(lines, { streaming: true });
    const finished = renderedLinesToHtml(lines);
    // Both highlight code…
    expect(streaming[0]).toContain('token keyword');
    expect(finished[0]).toContain('token keyword');
    // …but only the block pass carries the doc-comment state across lines.
    expect(finished[2]).toBe('<span class="sh-code"><span class="token comment"> * Doc</span></span>');
    expect(streaming[2]).not.toContain('token comment');
    // Growing the streamed window is stable for the untouched lines.
    const grown = renderedLinesToHtml([...lines, 'const more = 1;'], { streaming: true });
    for (let i = 0; i < lines.length; i += 1) expect(grown[i]).toBe(streaming[i]);
  });
});
