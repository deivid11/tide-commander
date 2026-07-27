import { describe, it, expect } from 'vitest';
import { serializeToolResultContent } from './tool-result-content';

describe('serializeToolResultContent', () => {
  it('passes string content through untouched', () => {
    expect(serializeToolResultContent('total 4\ndrwxr-xr-x')).toBe('total 4\ndrwxr-xr-x');
  });

  it('replaces inline base64 images with a size placeholder', () => {
    // 4 base64 chars per 3 bytes → 400 chars ≈ 300 B
    const content = [
      { type: 'image', source: { type: 'base64', data: 'A'.repeat(400), media_type: 'image/jpeg' } },
    ];
    const out = serializeToolResultContent(content);
    expect(out).not.toContain('AAAA');
    expect(out).toBe(JSON.stringify([{ type: 'text', text: '[Image: image/jpeg, 300 B]' }]));
  });

  it('reports large images in KB/MB', () => {
    const oneMb = [
      { type: 'image', source: { type: 'base64', data: 'A'.repeat(4 * 1024 * 1024), media_type: 'image/png' } },
    ];
    expect(serializeToolResultContent(oneMb)).toContain('[Image: image/png, 3.0 MB]');
  });

  it('keeps sibling text blocks and only strips the image', () => {
    const content = [
      { type: 'text', text: 'before' },
      { type: 'image', source: { type: 'base64', data: 'A'.repeat(4000), media_type: 'image/png' } },
      { type: 'text', text: 'after' },
    ];
    const parsed = JSON.parse(serializeToolResultContent(content));
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toEqual({ type: 'text', text: 'before' });
    expect(parsed[1]).toEqual({ type: 'text', text: '[Image: image/png, 3 KB]' });
    expect(parsed[2]).toEqual({ type: 'text', text: 'after' });
  });

  it('leaves non-image block arrays serialized exactly as before', () => {
    const content = [{ type: 'text', text: 'plain result' }];
    expect(serializeToolResultContent(content)).toBe(JSON.stringify(content));
  });

  it('leaves URL-sourced images alone (nothing inline to strip)', () => {
    const content = [{ type: 'image', source: { type: 'url', url: 'https://x/y.png' } }];
    expect(serializeToolResultContent(content)).toBe(JSON.stringify(content));
  });
});
