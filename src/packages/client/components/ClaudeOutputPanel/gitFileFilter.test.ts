import { describe, it, expect } from 'vitest';
import {
  parseFileFilter,
  scoreFile,
  filterFiles,
  highlightRanges,
  type FilterableFile,
} from './gitFileFilter';

const file = (path: string, status: FilterableFile['status'] = 'modified'): FilterableFile => ({
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  status,
});

const FILES: FilterableFile[] = [
  file('src/packages/server/claude/runner.ts'),
  file('src/packages/server/claude/backend.ts'),
  file('src/packages/client/components/ClaudeOutputPanel/GuakeGitPanel.tsx', 'added'),
  file('src/packages/client/components/Icon.tsx'),
  file('src/packages/client/utils/outputRendering.test.ts', 'untracked'),
  file('README.md', 'deleted'),
];

const paths = (files: FilterableFile[]) => files.map((f) => f.path);
const matches = (query: string) => paths(filterFiles(parseFileFilter(query), FILES));

// ── parsing ─────────────────────────────────────────────────────────────────
describe('parseFileFilter', () => {
  it('treats blank input as empty', () => {
    expect(parseFileFilter('   ').isEmpty).toBe(true);
    expect(parseFileFilter('').isEmpty).toBe(true);
  });

  it('classifies term kinds', () => {
    const parsed = parseFileFilter('runner server/claude .tsx "exact one"');
    expect(parsed.include.map((t) => t.kind)).toEqual(['fuzzy', 'path', 'ext', 'exact']);
    expect(parsed.include[3].text).toBe('exact one');
  });

  it('strips the star from *.ext', () => {
    const parsed = parseFileFilter('*.tsx');
    expect(parsed.include[0]).toMatchObject({ kind: 'ext', text: '.tsx' });
  });

  it('collects positive and negated statuses', () => {
    const parsed = parseFileFilter('status:mod !s:untracked');
    expect([...parsed.statuses!]).toEqual(['modified']);
    expect([...parsed.excludedStatuses!]).toEqual(['untracked']);
    expect(parsed.include).toHaveLength(0);
  });

  it('falls back to a text term for an unknown status alias', () => {
    const parsed = parseFileFilter('s:omething');
    expect(parsed.statuses).toBeNull();
    expect(parsed.include[0].text).toBe('s:omething');
  });

  it('is smart-case', () => {
    expect(parseFileFilter('panel').include[0]).toMatchObject({ caseSensitive: false, text: 'panel' });
    expect(parseFileFilter('Panel').include[0]).toMatchObject({ caseSensitive: true, text: 'Panel' });
  });
});

// ── matching ────────────────────────────────────────────────────────────────
describe('filterFiles', () => {
  it('returns everything for an empty filter', () => {
    expect(filterFiles(parseFileFilter(''), FILES)).toHaveLength(FILES.length);
  });

  it('fuzzy-matches the filename', () => {
    expect(matches('runner')).toEqual(['src/packages/server/claude/runner.ts']);
    expect(matches('ggp')).toContain(
      'src/packages/client/components/ClaudeOutputPanel/GuakeGitPanel.tsx'
    );
  });

  it('ranks contiguous filename hits above scattered ones', () => {
    const ranked = matches('icon');
    expect(ranked[0]).toBe('src/packages/client/components/Icon.tsx');
  });

  it('does not scatter a bare term across the whole path', () => {
    // "icon" must not reach .../client/components/... via a subsequence hit.
    expect(matches('icon')).toEqual(['src/packages/client/components/Icon.tsx']);
  });

  it('matches a path term against the full path only', () => {
    expect(matches('server/claude')).toEqual([
      'src/packages/server/claude/runner.ts',
      'src/packages/server/claude/backend.ts',
    ]);
    expect(matches('server/claude')).not.toContain('README.md');
  });

  it('filters by extension', () => {
    // Equal term scores, so the shallower path ranks first.
    expect(matches('.tsx')).toEqual([
      'src/packages/client/components/Icon.tsx',
      'src/packages/client/components/ClaudeOutputPanel/GuakeGitPanel.tsx',
    ]);
    expect(matches('*.md')).toEqual(['README.md']);
  });

  it('ANDs multiple terms', () => {
    expect(matches('client .tsx icon')).toEqual(['src/packages/client/components/Icon.tsx']);
    expect(matches('runner .tsx')).toEqual([]);
  });

  it('excludes with !', () => {
    expect(matches('.ts !test')).toEqual([
      'src/packages/server/claude/runner.ts',
      'src/packages/server/claude/backend.ts',
    ]);
  });

  it('filters by status', () => {
    expect(matches('status:untracked')).toEqual([
      'src/packages/client/utils/outputRendering.test.ts',
    ]);
    expect(matches('.ts !status:untracked')).toEqual([
      'src/packages/server/claude/runner.ts',
      'src/packages/server/claude/backend.ts',
    ]);
  });

  it('honours smart-case', () => {
    expect(matches('icon')).toContain('src/packages/client/components/Icon.tsx');
    expect(matches('ICON')).toEqual([]);
  });

  it('treats a quoted term as a contiguous substring', () => {
    expect(matches('"GuakeGit"')).toEqual([
      'src/packages/client/components/ClaudeOutputPanel/GuakeGitPanel.tsx',
    ]);
    // The same letters scattered do not satisfy a quoted term.
    expect(matches('"gkgt"')).toEqual([]);
    expect(matches('gkgt')).toContain(
      'src/packages/client/components/ClaudeOutputPanel/GuakeGitPanel.tsx'
    );
  });
});

describe('scoreFile', () => {
  it('scores a filename prefix above an inner match', () => {
    const filter = parseFileFilter('run');
    const prefix = scoreFile(filter, file('a/runner.ts'))!;
    const inner = scoreFile(filter, file('a/prerun.ts'))!;
    expect(prefix).toBeGreaterThan(inner);
  });

  it('scores a filename hit above a path-only hit', () => {
    const filter = parseFileFilter('server');
    const inName = scoreFile(filter, file('a/server.ts'))!;
    const inPath = scoreFile(filter, file('server/a.ts'))!;
    expect(inName).toBeGreaterThan(inPath);
  });

  it('returns null when any term misses', () => {
    expect(scoreFile(parseFileFilter('zzz'), file('a/runner.ts'))).toBeNull();
  });
});

// ── highlighting ────────────────────────────────────────────────────────────
describe('highlightRanges', () => {
  it('marks a contiguous substring', () => {
    expect(highlightRanges(parseFileFilter('run'), 'runner.ts')).toEqual([[0, 3]]);
  });

  it('merges adjacent fuzzy characters into one run', () => {
    expect(highlightRanges(parseFileFilter('rts'), 'runner.ts')).toEqual([[0, 1], [7, 9]]);
  });

  it('marks the extension suffix', () => {
    expect(highlightRanges(parseFileFilter('.ts'), 'runner.ts')).toEqual([[6, 9]]);
  });

  it('returns nothing for terms that do not apply to the text', () => {
    expect(highlightRanges(parseFileFilter('server/claude'), 'runner.ts')).toEqual([]);
    expect(highlightRanges(parseFileFilter(''), 'runner.ts')).toEqual([]);
    expect(highlightRanges(parseFileFilter('status:mod'), 'runner.ts')).toEqual([]);
  });
});
