/**
 * Incremental watcher for an interactive agent's session-transcript JSONL.
 *
 * Reuses the battle-tested `createFileTailer` (byte-offset tracking, partial-
 * line buffering, multibyte-safe decoding, truncation reset, 100ms poll) and
 * feeds each complete line through the InteractiveJsonlTranslator. Tolerates the
 * file not existing yet (claude creates it lazily on first submit).
 */

import * as fs from 'fs';
import { createFileTailer, type TmuxFileTailer } from '../runner/tmux-helper.js';
import { InteractiveJsonlTranslator } from './interactive-jsonl-translator.js';
import type { StandardEvent } from '../types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('Interactive');

export interface InteractiveWatcherOptions {
  agentId: string;
  jsonlPath: string;
  /** Resume → skip the existing transcript and only emit lines appended after now. */
  startAtEnd: boolean;
  /**
   * Explicit byte offset to resume from (takes precedence over startAtEnd). Used
   * on commander restart to replay exactly the lines written while we were down,
   * with no gap and no full-history replay.
   */
  startOffset?: number;
  /** Called per translated event, in order. */
  onEvent: (event: StandardEvent) => void;
  /** Called once per new JSONL line (before translation) for activity tracking. */
  onActivity: () => void;
}

export class InteractiveJsonlWatcher {
  private tailer: TmuxFileTailer | null = null;
  private readonly translator = new InteractiveJsonlTranslator();

  constructor(private readonly opts: InteractiveWatcherOptions) {}

  start(): void {
    if (this.tailer) return;
    this.tailer = createFileTailer(this.opts.jsonlPath, (line) => this.onLine(line));
    if (this.opts.startOffset !== undefined) {
      // Reconnect after restart: resume from exactly where we left off.
      this.tailer.setOffset(this.opts.startOffset);
    } else if (this.opts.startAtEnd) {
      // Resume: jump to the current end of file so prior history isn't re-emitted
      // (the client loads history separately). For a fresh session the file does
      // not exist yet → offset 0, and we pick up lines as claude writes them.
      let size = 0;
      try {
        size = fs.statSync(this.opts.jsonlPath).size;
      } catch {
        size = 0;
      }
      this.tailer.setOffset(size);
    }
    this.tailer.start();
    log.log(`Watching transcript ${this.opts.jsonlPath} (agent ${this.opts.agentId.slice(0, 8)}, startAtEnd=${this.opts.startAtEnd}, startOffset=${this.opts.startOffset ?? 'n/a'})`);
  }

  /** Current byte offset reached in the transcript (for persistence). */
  getOffset(): number {
    return this.tailer?.getOffset() ?? this.opts.startOffset ?? 0;
  }

  private onLine(line: string): void {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      return; // ignore non-JSON / partial garbage
    }
    this.opts.onActivity();
    const events = this.translator.translate(record);
    for (const event of events) {
      this.opts.onEvent(event);
    }
  }

  /** Synchronously read any unread bytes (use before stop() to catch a trailing end_turn). */
  drain(): void {
    this.tailer?.drain();
  }

  stop(): void {
    this.tailer?.stop();
    this.tailer = null;
  }
}
