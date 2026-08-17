import { describe, it, expect } from 'vitest';
import { mergeExtracts, MAX_EXTRACTS } from './matchedExtracts';
import type { SessionExtract } from '../../api/sessions';

const u = (text: string): SessionExtract => ({ text, kind: 'user' });
const a = (text: string): SessionExtract => ({ text, kind: 'assistant' });
const t = (text: string): SessionExtract => ({ text, kind: 'tool' });

describe('mergeExtracts', () => {
  it('returns undefined when there is nothing to show', () => {
    expect(mergeExtracts(undefined, undefined)).toBeUndefined();
    expect(mergeExtracts('', [])).toBeUndefined();
    expect(mergeExtracts('   ', [u('  ')])).toBeUndefined();
  });

  it('leads with the store match as a USER extract, then the server extracts, preserving order and kinds', () => {
    expect(mergeExtracts('user asked to convert', [a('assistant converts'), t('Bash: convert')])).toEqual([
      u('user asked to convert'),
      a('assistant converts'),
      t('Bash: convert'),
    ]);
  });

  it('caps at MAX_EXTRACTS', () => {
    const out = mergeExtracts('lead', [u('a'), u('b'), u('c'), u('d'), u('e')]);
    expect(out).toHaveLength(MAX_EXTRACTS);
    expect(out).toEqual([u('lead'), u('a'), u('b'), u('c')]);
  });

  it('does not let a short extract be swallowed by a longer one that contains it', () => {
    // "convert A" ⊂ "please convert A and B" — different prompts, both kept.
    expect(mergeExtracts(undefined, [u('please convert A and B now'), u('convert A')]))
      .toEqual([u('please convert A and B now'), u('convert A')]);
  });

  it('dedupes the same prompt seen through different truncation windows (keeps the first, its kind)', () => {
    // Store: "..." + slice; server: "…" + a wider window of the same prompt.
    const store = '...please convert the pi sessions to...';
    const server = '…now please convert the pi sessions to jsonl before…';
    expect(mergeExtracts(store, [u(server), a('other convert')])).toEqual([u(store), a('other convert')]);
  });

  it('dedupes case/whitespace variants', () => {
    expect(mergeExtracts('Convert  THIS', [u('convert this'), u('convert that')])).toEqual([u('Convert  THIS'), u('convert that')]);
  });

  it('works with server extracts only', () => {
    expect(mergeExtracts(undefined, [a('x'), t('y')])).toEqual([a('x'), t('y')]);
  });
});
