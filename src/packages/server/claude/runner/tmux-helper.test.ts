import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFileTailer } from './tmux-helper.js';

function makeTempLog(): string {
  return path.join(os.tmpdir(), `tc-tailer-test-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('waitFor timed out');
}

describe('createFileTailer (tmux log tailer)', () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTempLog();
    fs.writeFileSync(tmpPath, '');
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  });

  it('emits complete lines and buffers a trailing partial until the newline arrives', async () => {
    const received: string[] = [];
    const tailer = createFileTailer(tmpPath, (line) => received.push(line));
    tailer.start();

    // Write a complete line then a partial line (no trailing newline)
    fs.appendFileSync(tmpPath, '{"type":"turn.started"}\n{"type":"item.star');
    await waitFor(() => received.length >= 1);
    expect(received).toEqual(['{"type":"turn.started"}']);

    // Finish the partial line — it should now arrive as a single complete line
    fs.appendFileSync(tmpPath, 'ted","item":{"id":"item_1"}}\n');
    await waitFor(() => received.length >= 2);
    expect(received[1]).toBe('{"type":"item.started","item":{"id":"item_1"}}');

    tailer.stop();
  });

  it('never emits mid-line fragments for large (>20KB) JSON events that span multiple polls', async () => {
    const received: string[] = [];
    const tailer = createFileTailer(tmpPath, (line) => received.push(line));
    tailer.start();

    const bigPayload = 'x'.repeat(26_000);
    const longLine = `{"type":"item.completed","item":{"text":"${bigPayload}"}}`;

    // Write the long line in two chunks across a poll tick to exercise the
    // partial-line buffer. The poll interval is 100ms; sleeping 150ms between
    // chunks guarantees a poll happens mid-line.
    fs.appendFileSync(tmpPath, longLine.slice(0, 10_000));
    await new Promise((r) => setTimeout(r, 150));
    // Nothing should have been emitted yet — the line is incomplete.
    expect(received).toEqual([]);
    fs.appendFileSync(tmpPath, longLine.slice(10_000) + '\n');
    await waitFor(() => received.length >= 1);

    expect(received.length).toBe(1);
    expect(received[0]).toBe(longLine);
    // Ensure the emitted line parses as valid JSON — i.e. it was not split.
    expect(() => JSON.parse(received[0])).not.toThrow();

    tailer.stop();
  });

  it('recovers when the log file is truncated (size shrinks below current offset)', async () => {
    const received: string[] = [];
    const tailer = createFileTailer(tmpPath, (line) => received.push(line));
    tailer.start();

    // Write enough content that truncation is detectable by size alone.
    const padding = 'pad-'.repeat(50);
    fs.appendFileSync(tmpPath, `${padding}\nfirst\nsecond\n`);
    await waitFor(() => received.includes('second'));
    expect(received).toContain('first');
    expect(received).toContain('second');

    // Replace the file with a single short line — new size is far below the
    // tailer's current offset, so it must reset rather than stall.
    fs.writeFileSync(tmpPath, 'after-truncate\n');
    await waitFor(() => received.includes('after-truncate'));
    expect(received).toContain('after-truncate');

    tailer.stop();
  });

  it('handles a UTF-8 multibyte character split across a chunk boundary without corruption', async () => {
    const received: string[] = [];
    const tailer = createFileTailer(tmpPath, (line) => received.push(line));
    tailer.start();

    // "café" is 5 bytes in UTF-8: c(1) a(1) f(1) é(2). Split between the two
    // bytes of 'é' to force the decoder to hold the trailing continuation
    // byte across polls.
    const fullLine = 'café-event\n';
    const asBytes = Buffer.from(fullLine, 'utf8');
    const splitAt = 4; // middle of the 'é' sequence

    fs.appendFileSync(tmpPath, asBytes.subarray(0, splitAt));
    await new Promise((r) => setTimeout(r, 150));
    fs.appendFileSync(tmpPath, asBytes.subarray(splitAt));
    await waitFor(() => received.length >= 1);

    expect(received[0]).toBe('café-event');
    tailer.stop();
  });

  it('setOffset() clears the partial-line buffer so a reposition does not concatenate stale bytes', async () => {
    const received: string[] = [];
    const tailer = createFileTailer(tmpPath, (line) => received.push(line));
    tailer.start();

    fs.appendFileSync(tmpPath, 'partial');
    await new Promise((r) => setTimeout(r, 150));
    expect(received).toEqual([]);

    // Reposition past the partial bytes — they must be dropped, not prepended
    // to whatever arrives next.
    const size = fs.statSync(tmpPath).size;
    tailer.setOffset(size);

    fs.appendFileSync(tmpPath, 'fresh\n');
    await waitFor(() => received.length >= 1);
    expect(received[0]).toBe('fresh');
    tailer.stop();
  });
});
