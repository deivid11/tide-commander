import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { diagnoseMissingFile, rankSimilarNames, snapshotsFromJsonlLines } from './file-recovery';

const line = (entry: unknown) => JSON.stringify(entry);
const toolUse = (id: string, name: string, input: Record<string, unknown>, timestamp = '2026-09-28T16:00:00.000Z') =>
  line({ type: 'assistant', timestamp, message: { content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id: string, toolUseResult: unknown, timestamp = '2026-09-28T16:00:01.000Z') =>
  line({ type: 'user', timestamp, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'x' }] }, toolUseResult });

describe('rankSimilarNames', () => {
  it('keeps close variants and drops unrelated names', () => {
    const ranked = rankSimilarNames('montage.png', ['montage.jpg', 'Montage.png', 'montage-2.png', 'guia.html', 'prev-1.png', 'montag.png']);
    expect(ranked[0]).toBe('Montage.png');
    expect(ranked).toContain('montage.jpg');
    expect(ranked).toContain('montage-2.png');
    expect(ranked).toContain('montag.png');
    expect(ranked).not.toContain('guia.html');
    expect(ranked).not.toContain('prev-1.png');
  });
});

describe('snapshotsFromJsonlLines', () => {
  const target = '/pg/release/montage.png';

  it('keeps every distinct image version a Read recorded, even though result lines never name the path', async () => {
    const lines = [
      toolUse('r1', 'Read', { file_path: target }),
      toolResult('r1', { type: 'image', file: { base64: 'AAAA', type: 'image/png' } }, '2026-09-28T16:05:40.000Z'),
      // Re-reading the same bytes is not a new version.
      toolUse('r1b', 'Read', { file_path: target }),
      toolResult('r1b', { type: 'image', file: { base64: 'AAAA', type: 'image/png' } }, '2026-09-28T16:06:00.000Z'),
      toolUse('r2', 'Read', { file_path: target }),
      toolResult('r2', { type: 'image', file: { base64: 'BBBB', type: 'image/jpeg' } }, '2026-09-28T16:15:55.000Z'),
    ];
    expect(await snapshotsFromJsonlLines(lines, target)).toEqual([
      { kind: 'image', mediaType: 'image/png', dataB64: 'AAAA', timestamp: '2026-09-28T16:06:00.000Z' },
      { kind: 'image', mediaType: 'image/jpeg', dataB64: 'BBBB', timestamp: '2026-09-28T16:15:55.000Z' },
    ]);
  });

  it('replays Edits on top of a Write and flags edits that no longer apply', async () => {
    const file = '/pg/notes.md';
    const lines = [
      toolUse('w', 'Write', { file_path: file, content: 'alpha beta beta' }),
      toolUse('e1', 'Edit', { file_path: file, old_string: 'alpha', new_string: 'ALPHA' }),
      toolUse('e2', 'Edit', { file_path: file, old_string: 'beta', new_string: 'B', replace_all: true }),
      toolUse('e3', 'Edit', { file_path: file, old_string: 'missing', new_string: 'x' }),
      toolUse('other', 'Write', { file_path: '/pg/other.md', content: 'nope' }),
    ];
    const versions = await snapshotsFromJsonlLines(lines, file);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ kind: 'text', content: 'ALPHA B B', base: 'Write', edits: 2, incomplete: true });
  });

  it('uses a Read as a text base only when it covered the whole file', async () => {
    const file = '/pg/a.ts';
    const partial = [
      toolUse('p', 'Read', { file_path: file, offset: 10, limit: 5 }),
      toolResult('p', { type: 'text', file: { filePath: file, content: 'mid', startLine: 10, numLines: 5, totalLines: 90 } }),
    ];
    expect(await snapshotsFromJsonlLines(partial, file)).toEqual([]);

    const full = [
      toolUse('f', 'Read', { file_path: file }),
      toolResult('f', { type: 'text', file: { filePath: file, content: 'whole\nfile', startLine: 1, numLines: 2, totalLines: 2 } }),
    ];
    expect((await snapshotsFromJsonlLines(full, file))[0]).toMatchObject({ kind: 'text', content: 'whole\nfile', base: 'Read' });
  });
});

describe('diagnoseMissingFile', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-recovery-'));
    fs.writeFileSync(path.join(dir, 'montage-2.png'), 'x');
    fs.writeFileSync(path.join(dir, 'guia.html'), 'x');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reports a deleted file with its surviving siblings', () => {
    const diagnosis = diagnoseMissingFile(path.join(dir, 'montage.png'));
    expect(diagnosis.kind).toBe('deleted');
    expect(diagnosis.parentDir).toBe(dir);
    expect(diagnosis.nearestExistingDir).toBe(dir);
    expect(diagnosis.similar.map((entry) => entry.name)).toEqual(['montage-2.png']);
  });

  it('reports a vanished folder and the closest ancestor that still exists', () => {
    const diagnosis = diagnoseMissingFile(path.join(dir, 'gone', 'deeper', 'x.txt'));
    expect(diagnosis.kind).toBe('folder-missing');
    expect(diagnosis.nearestExistingDir).toBe(dir);
    expect(diagnosis.similar).toEqual([]);
  });
});
