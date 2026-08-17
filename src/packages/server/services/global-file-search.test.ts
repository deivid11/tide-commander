import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  excludeDirsFromInput,
  searchFileContentsGlobal,
  searchFilesGlobal,
} from './global-file-search';
import { DEFAULT_FILE_SEARCH_EXCLUDE_DIRS } from '../../shared/file-search';

function makeTree(root: string, files: string[]): void {
  for (const rel of files) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'x');
  }
}

describe('excludeDirsFromInput', () => {
  it('uses the shared default list when the value is omitted', () => {
    const set = excludeDirsFromInput(undefined, true);
    expect(set.has('node_modules')).toBe(true);
    expect(set.has('vendor')).toBe(true);
    expect(set.has('.git')).toBe(true);
    for (const name of DEFAULT_FILE_SEARCH_EXCLUDE_DIRS) {
      expect(set.has(name)).toBe(true);
    }
  });

  it('parses a comma-separated list and drops path-like names', () => {
    const set = excludeDirsFromInput('node_modules, vendor, ../etc, foo/bar, .git', true);
    expect([...set].sort()).toEqual(['.git', 'node_modules', 'vendor']);
  });

  it('treats an explicit empty string as no excludes', () => {
    const set = excludeDirsFromInput('', true);
    expect(set.size).toBe(0);
  });
});

describe('searchFilesGlobal', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  function tmpProject(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  }

  it('finds files across every configured area directory and tags the project', async () => {
    const alpha = tmpProject('tc-fs-alpha-');
    const beta = tmpProject('tc-fs-beta-');
    makeTree(alpha, ['src/App.tsx', 'README.md']);
    makeTree(beta, ['lib/util.ts', 'src/App.test.ts']);

    const hits = await searchFilesGlobal({
      query: 'App',
      areas: [
        { id: 'area-work', name: 'Work', directories: [alpha] },
        { id: 'area-side', name: 'Side', directories: [beta] },
      ],
    });

    const names = hits.map((h) => h.name).sort();
    expect(names).toContain('App.tsx');
    expect(names).toContain('App.test.ts');

    const app = hits.find((h) => h.name === 'App.tsx');
    expect(app?.areaId).toBe('area-work');
    expect(app?.areaName).toBe('Work');
    expect(app?.projectName).toBe(path.basename(alpha));
    expect(app?.relativePath).toBe('src/App.tsx');
  });

  it('skips excluded folder names such as node_modules, vendor and .git', async () => {
    const proj = tmpProject('tc-fs-skip-');
    makeTree(proj, [
      'src/Widget.ts',
      'node_modules/pkg/Widget.ts',
      'vendor/lib/Widget.ts',
      '.git/hooks/Widget.ts',
    ]);

    const hits = await searchFilesGlobal({
      query: 'Widget',
      areas: [{ id: 'a1', name: 'Main', directories: [proj] }],
    });

    expect(hits.map((h) => h.relativePath)).toEqual(['src/Widget.ts']);
  });

  it('honors a custom exclude list from settings', async () => {
    const proj = tmpProject('tc-fs-custom-');
    makeTree(proj, ['src/Keep.ts', 'tmp/Keep.ts', 'node_modules/Keep.ts']);

    const hits = await searchFilesGlobal({
      query: 'Keep',
      exclude: 'tmp',
      areas: [{ id: 'a1', name: 'Main', directories: [proj] }],
    });

    const rels = hits.map((h) => h.relativePath).sort();
    expect(rels).toContain('src/Keep.ts');
    expect(rels).toContain('node_modules/Keep.ts');
    expect(rels).not.toContain('tmp/Keep.ts');
  });

  it('skips archived areas and returns nothing for short queries', async () => {
    const proj = tmpProject('tc-fs-arch-');
    makeTree(proj, ['Hello.ts']);

    const archived = await searchFilesGlobal({
      query: 'Hello',
      areas: [{ id: 'old', name: 'Old', archived: true, directories: [proj] }],
    });
    expect(archived).toEqual([]);

    const short = await searchFilesGlobal({
      query: 'H',
      areas: [{ id: 'live', name: 'Live', directories: [proj] }],
    });
    expect(short).toEqual([]);
  });

  it('ranks an exact filename match above a path substring', async () => {
    const proj = tmpProject('tc-fs-rank-');
    makeTree(proj, ['src/config/util.ts', 'config.ts']);

    const hits = await searchFilesGlobal({
      query: 'config',
      areas: [{ id: 'a1', name: 'Main', directories: [proj] }],
    });

    expect(hits[0]?.name).toBe('config.ts');
  });

  it('finds content across projects with line metadata and respects excludes', async () => {
    const alpha = tmpProject('tc-content-alpha-');
    const beta = tmpProject('tc-content-beta-');
    makeTree(alpha, ['src/Alpha.ts', 'node_modules/pkg/Hidden.ts']);
    makeTree(beta, ['lib/Beta.ts']);
    fs.writeFileSync(path.join(alpha, 'src/Alpha.ts'), 'first line\nunique spotlight phrase\n');
    fs.writeFileSync(path.join(alpha, 'node_modules/pkg/Hidden.ts'), 'unique spotlight phrase\n');
    fs.writeFileSync(path.join(beta, 'lib/Beta.ts'), 'const value = "unique spotlight phrase";\n');

    const hits = await searchFileContentsGlobal({
      query: 'unique spotlight phrase',
      areas: [
        { id: 'alpha', name: 'Alpha', directories: [alpha] },
        { id: 'beta', name: 'Beta', directories: [beta] },
      ],
    });

    expect(hits.map((hit) => hit.relativePath).sort()).toEqual(['lib/Beta.ts', 'src/Alpha.ts']);
    const alphaHit = hits.find((hit) => hit.name === 'Alpha.ts');
    expect(alphaHit?.areaName).toBe('Alpha');
    expect(alphaHit?.matches[0]).toMatchObject({ line: 2, content: 'unique spotlight phrase' });
  });
});
