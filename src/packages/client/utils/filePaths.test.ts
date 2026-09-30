import { describe, expect, it } from 'vitest';
import { decodePercentEncodedPath, parseFilePathReference, resolveAgentFileReference } from './filePaths';

describe('parseFilePathReference', () => {
  it('parses path:line notation', () => {
    expect(parseFilePathReference('src/packages/server/claude/backend.ts:129')).toEqual({
      path: 'src/packages/server/claude/backend.ts',
      line: 129,
    });
  });

  it('parses path:line:column notation', () => {
    expect(parseFilePathReference('src/packages/server/codex/backend.ts:35:4')).toEqual({
      path: 'src/packages/server/codex/backend.ts',
      line: 35,
    });
  });

  it('parses #L line notation', () => {
    expect(parseFilePathReference('src/packages/server/claude/backend.ts#L16')).toEqual({
      path: 'src/packages/server/claude/backend.ts',
      line: 16,
    });
  });

  it('returns path as-is when no line is present', () => {
    expect(parseFilePathReference('src/packages/server/claude/backend.ts')).toEqual({
      path: 'src/packages/server/claude/backend.ts',
    });
  });

  it('parses path:line with trailing punctuation', () => {
    expect(parseFilePathReference('src/packages/server/claude/backend.ts:129,')).toEqual({
      path: 'src/packages/server/claude/backend.ts',
      line: 129,
    });
  });

  it('parses backtick wrapped path:line', () => {
    expect(parseFilePathReference('`src/packages/server/claude/backend.ts:129`')).toEqual({
      path: 'src/packages/server/claude/backend.ts',
      line: 129,
    });
  });
});

describe('resolveAgentFileReference', () => {
  it('resolves relative path against cwd and keeps line', () => {
    expect(resolveAgentFileReference('src/packages/server/claude/backend.ts:16', '/home/riven/d/tide-commander')).toEqual({
      path: '/home/riven/d/tide-commander/src/packages/server/claude/backend.ts',
      line: 16,
    });
  });
});

describe('decodePercentEncodedPath', () => {
  it('decodes the markdown-encoded link destination back to the file name on disk', () => {
    expect(decodePercentEncodedPath(
      '/home/riven/d/tc-playground/mdo-wind-release-review/matriz-opm/Matriz%20de%20pruebas,%20integrador%20MDS%20API%20-%20TIDE%20WIND%20APP%20(llena%202026-09-23).xlsx',
    )).toBe('/home/riven/d/tc-playground/mdo-wind-release-review/matriz-opm/Matriz de pruebas, integrador MDS API - TIDE WIND APP (llena 2026-09-23).xlsx');
    expect(decodePercentEncodedPath('docs/informe-an%C3%A1lisis.pdf')).toBe('docs/informe-análisis.pdf');
  });

  it('leaves plain paths and malformed escapes untouched', () => {
    expect(decodePercentEncodedPath('/tmp/plain name.xlsx')).toBe('/tmp/plain name.xlsx');
    expect(decodePercentEncodedPath('/tmp/100%.txt')).toBe('/tmp/100%.txt');
    expect(decodePercentEncodedPath('/tmp/bad%E0%A4.txt')).toBe('/tmp/bad%E0%A4.txt');
  });
});
