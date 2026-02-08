import { describe, expect, it } from 'vitest';
import { parseFilePathReference, resolveAgentFileReference } from './filePaths';

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
