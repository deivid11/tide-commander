import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  findFileWithFallbacks,
  resolveAndValidateFilePath,
  _resetSuffixWalkCacheForTests,
} from './files';

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

describe('findFileWithFallbacks', () => {
  // Build a temp tree:
  //   <tmp>/repo/.git/HEAD
  //   <tmp>/repo/back/src/Helpers/Reports/ReportTypes/TransactionsReportGenerator.php
  //   <tmp>/repo/cwd/             ← agent.cwd lives here, deeper than the file
  //   <tmp>/repo/cwd/back/src/Helpers/Reports/ReportTypes/TransactionsReportGenerator.php
  //                                ↑ duplicate at agent.cwd to verify priority
  let tmpRoot: string;
  let repoRoot: string;
  let agentCwd: string;
  let cwdHit: string;
  let gitHit: string;

  const REL_PATH = 'back/src/Helpers/Reports/ReportTypes/TransactionsReportGenerator.php';

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-resolver-'));
    repoRoot = path.join(tmpRoot, 'repo');
    agentCwd = path.join(repoRoot, 'cwd');
    fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    gitHit = path.join(repoRoot, REL_PATH);
    cwdHit = path.join(agentCwd, REL_PATH);
    fs.mkdirSync(path.dirname(gitHit), { recursive: true });
    fs.mkdirSync(path.dirname(cwdHit), { recursive: true });
    fs.writeFileSync(gitHit, '<?php // git-root copy ?>');
    fs.writeFileSync(cwdHit, '<?php // agent-cwd copy ?>');
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    _resetSuffixWalkCacheForTests();
  });

  it('picks the agent.cwd copy over the git-root copy when both exist', () => {
    const result = findFileWithFallbacks(REL_PATH, agentCwd);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // First parent-walk iteration anchors at agentCwd, so the cwd copy wins.
      expect(result.path).toBe(cwdHit);
      expect(result.strategy).toBe('exact');
    }
  });

  it('falls back to suffix-match for a deep nested path with renamed top segment', () => {
    // The trailing nested suffix is unique under agentCwd, but the leading
    // segment doesn't match — only suffix-match can recover it.
    const scrambled = 'totally/wrong/prefix/Reports/ReportTypes/TransactionsReportGenerator.php';
    const result = findFileWithFallbacks(scrambled, agentCwd);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe(cwdHit);
      expect(result.strategy).toBe('suffix-match');
    }
  });

  it('rejects a path-traversal request when no escaped target actually exists', () => {
    // baseDir is an empty temp dir; the request asks for an /etc-shaped path
    // that does NOT exist on disk. parent-walk WILL construct candidates that
    // resolve into /etc (existing permissive design — preserved). What MUST
    // hold: those candidates miss, suffix-match cannot surface a system file
    // because its walk is rooted at baseDir, and the result is 404.
    const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-resolver-traversal-'));
    try {
      const result = findFileWithFallbacks(
        '../../../../etc/passwd-tide-commander-no-such-file',
        fakeRoot,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(404);
        // Suffix-match must not have surfaced anything from outside baseDir.
        // Anything tried that's NOT under fakeRoot can only come from
        // parent-walk's `..` construction — never from suffix-match.
        const suffixTried = (result.tried ?? []).filter(c => c.startsWith('<suffix-match'));
        expect(suffixTried.length).toBe(0); // walk found nothing under empty fakeRoot
      }
    } finally {
      fs.rmSync(fakeRoot, { recursive: true, force: true });
    }
  });

  it('invalidates the suffix-walk cache after the TTL expires', () => {
    // First hit warms the cache, then we delete the file on disk. With cache
    // still warm, a stale path *might* still come back — but once the TTL
    // expires, the next call must rebuild the index and miss.
    const ttlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-resolver-ttl-'));
    try {
      const file = path.join(ttlRoot, 'a/b/c/Unique12345.php');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'x');

      const first = findFileWithFallbacks('zzz/c/Unique12345.php', ttlRoot);
      expect(first.ok).toBe(true);
      if (first.ok) expect(first.strategy).toBe('suffix-match');

      // Delete + advance time past the 30s TTL using vitest fake timers
      fs.rmSync(file);
      _resetSuffixWalkCacheForTests();
      vi.useFakeTimers();
      try {
        vi.setSystemTime(Date.now() + 31_000);
        const second = findFileWithFallbacks('zzz/c/Unique12345.php', ttlRoot);
        expect(second.ok).toBe(false);
        if (!second.ok) expect(second.status).toBe(404);
      } finally {
        vi.useRealTimers();
      }
    } finally {
      fs.rmSync(ttlRoot, { recursive: true, force: true });
    }
  });
});
