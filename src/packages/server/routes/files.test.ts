import { describe, expect, it } from 'vitest';
import { resolveAndValidateFilePath } from './files';

describe('resolveAndValidateFilePath', () => {
  const FALLBACK = '/srv/tide-commander';

  it('passes through absolute paths unchanged', () => {
    const result = resolveAndValidateFilePath('/home/user/project/file.ts', undefined, FALLBACK);
    expect(result).toEqual({ ok: true, path: '/home/user/project/file.ts' });
  });

  it('passes through absolute paths even when baseDir is set', () => {
    const result = resolveAndValidateFilePath('/etc/hosts', '/home/user/project', FALLBACK);
    expect(result).toEqual({ ok: true, path: '/etc/hosts' });
  });

  it('resolves a simple relative path against baseDir', () => {
    const result = resolveAndValidateFilePath('foo.md', '/home/user/project', FALLBACK);
    expect(result).toEqual({ ok: true, path: '/home/user/project/foo.md' });
  });

  it('resolves "./" prefixed paths against baseDir', () => {
    const result = resolveAndValidateFilePath('./foo.md', '/home/user/project', FALLBACK);
    expect(result).toEqual({ ok: true, path: '/home/user/project/foo.md' });
  });

  it('resolves nested relative paths against baseDir', () => {
    const result = resolveAndValidateFilePath('src/utils/foo.ts', '/home/user/project', FALLBACK);
    expect(result).toEqual({ ok: true, path: '/home/user/project/src/utils/foo.ts' });
  });

  it('resolves ".." traversal correctly', () => {
    const result = resolveAndValidateFilePath('../sibling/file.ts', '/home/user/project', FALLBACK);
    expect(result).toEqual({ ok: true, path: '/home/user/sibling/file.ts' });
  });

  it('resolves the user example: four levels of "../" out of a project cwd', () => {
    // Mirrors the exact case the user reported: opening
    // ../../../../tmp/timeline_pdf_instructions.md from a deep cwd.
    const result = resolveAndValidateFilePath(
      '../../../../tmp/timeline_pdf_instructions.md',
      '/home/riven/d/tide-commander',
      FALLBACK,
    );
    expect(result).toEqual({ ok: true, path: '/tmp/timeline_pdf_instructions.md' });
  });

  it('falls back to the server cwd when no baseDir is provided', () => {
    const result = resolveAndValidateFilePath('foo.md', undefined, FALLBACK);
    expect(result).toEqual({ ok: true, path: '/srv/tide-commander/foo.md' });
  });

  it('falls back to the server cwd when baseDir is relative (untrusted)', () => {
    const result = resolveAndValidateFilePath('foo.md', 'relative/dir', FALLBACK);
    expect(result).toEqual({ ok: true, path: '/srv/tide-commander/foo.md' });
  });

  it('rejects when path is missing', () => {
    expect(resolveAndValidateFilePath(undefined, undefined, FALLBACK)).toEqual({
      ok: false,
      status: 400,
      error: 'Missing path parameter',
    });
    expect(resolveAndValidateFilePath('', undefined, FALLBACK)).toEqual({
      ok: false,
      status: 400,
      error: 'Missing path parameter',
    });
  });

  it('rejects when neither baseDir nor fallback is absolute', () => {
    const result = resolveAndValidateFilePath('foo.md', undefined, 'also-relative');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain('Cannot resolve relative path');
    }
  });
});
