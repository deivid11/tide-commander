import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  findFileWithFallbacks,
  resolveAndValidateFilePath,
  isAbsolutePathCrossPlatform,
  parseByteRange,
  toPosixSeparators,
  _resetSuffixWalkCacheForTests,
  _resetAreaDirCacheForTests,
  _setAreaLoaderForTests,
} from './files';

describe('parseByteRange', () => {
  const SIZE = 1000;

  it('ignores a missing or unparseable header so the caller streams everything', () => {
    expect(parseByteRange(undefined, SIZE)).toBeNull();
    expect(parseByteRange('items=0-10', SIZE)).toBeNull();
    expect(parseByteRange('bytes=-', SIZE)).toBeNull();
    // Multi-range is valid HTTP but needs multipart; fall back to the full body.
    expect(parseByteRange('bytes=0-10,20-30', SIZE)).toBeNull();
  });

  it('parses an explicit window', () => {
    expect(parseByteRange('bytes=0-99', SIZE)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange('bytes=500-501', SIZE)).toEqual({ start: 500, end: 501 });
  });

  it('treats an open end as "to the last byte"', () => {
    // What a media element sends to start playback.
    expect(parseByteRange('bytes=0-', SIZE)).toEqual({ start: 0, end: 999 });
    expect(parseByteRange('bytes=900-', SIZE)).toEqual({ start: 900, end: 999 });
  });

  it('reads the suffix form as the last N bytes', () => {
    expect(parseByteRange('bytes=-200', SIZE)).toEqual({ start: 800, end: 999 });
    // A suffix longer than the file clamps to the whole file rather than a negative start.
    expect(parseByteRange('bytes=-5000', SIZE)).toEqual({ start: 0, end: 999 });
  });

  it('clamps an end past EOF', () => {
    expect(parseByteRange('bytes=990-99999', SIZE)).toEqual({ start: 990, end: 999 });
  });

  it('rejects ranges that cannot be satisfied', () => {
    expect(parseByteRange('bytes=1000-1200', SIZE)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=500-400', SIZE)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=-0', SIZE)).toBe('unsatisfiable');
  });

  it('ignores ranges against an empty file', () => {
    expect(parseByteRange('bytes=0-', 0)).toBeNull();
  });
});

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

  // Windows paths must be recognized as absolute even when the server runs on
  // POSIX — otherwise they'd be misclassified as relative and resolved into the
  // server cwd (a bogus path). These pass through unchanged on any platform.
  it('passes a Windows drive-letter path through unchanged (backslash)', () => {
    const result = resolveAndValidateFilePath('C:\\Users\\david\\project', '/home/user/project', FALLBACK);
    expect(result).toEqual({ ok: true, path: 'C:\\Users\\david\\project' });
  });

  it('passes a Windows drive-letter path through unchanged (forward slash)', () => {
    const result = resolveAndValidateFilePath('C:/Users/david/project', undefined, FALLBACK);
    expect(result).toEqual({ ok: true, path: 'C:/Users/david/project' });
  });

  it('passes a UNC path through unchanged', () => {
    const result = resolveAndValidateFilePath('\\\\server\\share\\dir', undefined, FALLBACK);
    expect(result).toEqual({ ok: true, path: '\\\\server\\share\\dir' });
  });

  it('does NOT treat a lone drive letter without separator as absolute', () => {
    // "C:" (no slash) is a drive-relative path on Windows — treat as relative.
    const result = resolveAndValidateFilePath('C:foo', '/home/user/project', FALLBACK);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path).not.toBe('C:foo');
  });
});

describe('isAbsolutePathCrossPlatform', () => {
  it('recognizes POSIX absolute paths', () => {
    expect(isAbsolutePathCrossPlatform('/home/user/x')).toBe(true);
  });
  it('recognizes Windows drive-letter absolute paths (both separators)', () => {
    expect(isAbsolutePathCrossPlatform('C:\\Users\\x')).toBe(true);
    expect(isAbsolutePathCrossPlatform('D:/data/x')).toBe(true);
    expect(isAbsolutePathCrossPlatform('z:\\lower')).toBe(true);
  });
  it('recognizes UNC absolute paths', () => {
    expect(isAbsolutePathCrossPlatform('\\\\server\\share')).toBe(true);
  });
  it('rejects relative paths and drive-relative paths', () => {
    expect(isAbsolutePathCrossPlatform('foo/bar')).toBe(false);
    expect(isAbsolutePathCrossPlatform('./foo')).toBe(false);
    expect(isAbsolutePathCrossPlatform('..\\foo')).toBe(false);
    expect(isAbsolutePathCrossPlatform('C:foo')).toBe(false); // drive-relative, no separator
  });
});

describe('toPosixSeparators', () => {
  it('converts backslashes to forward slashes', () => {
    expect(toPosixSeparators('C:\\Users\\david\\project\\src')).toBe('C:/Users/david/project/src');
  });
  it('is a no-op for POSIX paths', () => {
    expect(toPosixSeparators('/home/user/project/src')).toBe('/home/user/project/src');
  });
  it('handles mixed separators', () => {
    expect(toPosixSeparators('C:/Users\\david/project')).toBe('C:/Users/david/project');
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
    _resetAreaDirCacheForTests();
    _setAreaLoaderForTests(() => []);
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

  it('resolves via area-root when baseDir is the wrong root', () => {
    // Set up an area whose `directories[]` includes the actual project root,
    // simulating the user's reported case (agent.cwd was wrong, area knew the
    // right place).
    const areaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-resolver-area-'));
    const wrongCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-resolver-wrongcwd-'));
    const target = path.join(areaRoot, 'client/src/services/modelUtils/reportUtils.jsx');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'export const r = 1;');

    _setAreaLoaderForTests(() => [
      { id: 'a1', name: 'My Project', directories: [areaRoot] },
    ]);
    try {
      const result = findFileWithFallbacks(
        'client/src/services/modelUtils/reportUtils.jsx',
        wrongCwd,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.path).toBe(target);
        expect(result.strategy).toBe('area-root');
        expect(result.areaId).toBe('a1');
        expect(result.areaName).toBe('My Project');
      }
    } finally {
      _setAreaLoaderForTests(null);
      fs.rmSync(areaRoot, { recursive: true, force: true });
      fs.rmSync(wrongCwd, { recursive: true, force: true });
    }
  });

  it('resolves via area-suffix-match when leading segments do not match', () => {
    const areaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-resolver-areasuffix-'));
    const wrongCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-resolver-wrongcwd2-'));
    const target = path.join(areaRoot, 'deep/nested/UniqueAreaSuffixToken.tsx');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'export {};');

    _setAreaLoaderForTests(() => [
      { id: 'a2', name: 'Other Project', directories: [areaRoot] },
    ]);
    try {
      const result = findFileWithFallbacks(
        'totally/wrong/prefix/UniqueAreaSuffixToken.tsx',
        wrongCwd,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.path).toBe(target);
        expect(result.strategy).toBe('area-suffix-match');
        expect(result.areaId).toBe('a2');
        expect(result.areaName).toBe('Other Project');
      }
    } finally {
      _setAreaLoaderForTests(null);
      _resetSuffixWalkCacheForTests();
      fs.rmSync(areaRoot, { recursive: true, force: true });
      fs.rmSync(wrongCwd, { recursive: true, force: true });
    }
  });

  it('does not synthesize a hit from area paths for ../../etc/passwd-style requests', () => {
    // Area is an empty temp root. Suffix-match cannot escape it. Parent-walk
    // candidates that resolve into /etc miss because the file does not exist.
    const areaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-resolver-areasec-'));
    _setAreaLoaderForTests(() => [
      { id: 'sec', name: 'Sec', directories: [areaRoot] },
    ]);
    try {
      const result = findFileWithFallbacks(
        '../../../../etc/passwd-tide-no-such-file',
        undefined,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(404);
        for (const candidate of result.tried ?? []) {
          if (candidate.startsWith('<')) continue; // marker entries are safe
          // No candidate should be a real /etc file path the resolver hit.
          expect(candidate).not.toBe('/etc/passwd');
        }
      }
    } finally {
      _setAreaLoaderForTests(null);
      _resetSuffixWalkCacheForTests();
      fs.rmSync(areaRoot, { recursive: true, force: true });
    }
  });

  it('includes area paths in triedRoots when nothing matches', () => {
    const areaRoot1 = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-resolver-area-tr1-'));
    const areaRoot2 = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-resolver-area-tr2-'));
    _setAreaLoaderForTests(() => [
      { id: 'p1', name: 'P1', directories: [areaRoot1] },
      { id: 'p2', name: 'P2', directories: [areaRoot2] },
    ]);
    try {
      const result = findFileWithFallbacks('definitely/missing/file-x.ts', undefined);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const tried = result.tried ?? [];
        // area-root attempts add literal join candidates under each area dir.
        expect(tried.some(c => c.startsWith(areaRoot1))).toBe(true);
        expect(tried.some(c => c.startsWith(areaRoot2))).toBe(true);
      }
    } finally {
      _setAreaLoaderForTests(null);
      _resetSuffixWalkCacheForTests();
      fs.rmSync(areaRoot1, { recursive: true, force: true });
      fs.rmSync(areaRoot2, { recursive: true, force: true });
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

  it('reports a directory request as a directory instead of running the fallback walk', () => {
    const dir = path.dirname(gitHit); // an existing directory in the fixture tree
    const result = findFileWithFallbacks(dir, agentCwd);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe('Path is a directory');
      expect(result.requested).toBe(dir);
      // No futile candidate walk was performed (that was the "55 candidates" bug).
      expect(result.tried ?? []).toHaveLength(0);
    }
  });

  it('reports a directory request with a trailing slash as a directory', () => {
    const dir = path.dirname(gitHit) + path.sep;
    const result = findFileWithFallbacks(dir, agentCwd);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe('Path is a directory');
      expect(result.tried ?? []).toHaveLength(0);
    }
  });

  it('resolves a locally-linked package path that only exists inside node_modules', () => {
    // The suffix walk skips node_modules, so a path like `tide-api/src/foo.js`
    // that only lives under <workspace>/node_modules is unreachable without the
    // node-modules-match strategy.
    const nmRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-resolver-nm-'));
    try {
      const target = path.join(nmRoot, 'client/node_modules/tide-api/src/api-core.js');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'export const x = 1;');

      const result = findFileWithFallbacks('tide-api/src/api-core.js', nmRoot);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.path).toBe(target);
        expect(result.strategy).toBe('node-modules-match');
      }
    } finally {
      fs.rmSync(nmRoot, { recursive: true, force: true });
    }
  });
});
