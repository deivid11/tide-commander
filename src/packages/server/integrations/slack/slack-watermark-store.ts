/**
 * SlackWatermarkStore
 *
 * Per-channel high-water mark of the latest Slack `ts` we've already
 * dispatched, persisted to ~/.local/share/tide-commander/slack-watermarks.json.
 *
 * Used by the polling-mode inbound client (xoxp- user tokens) so that:
 *   - Each `conversations.history` call uses `oldest=lastTs` and only sees
 *     messages newer than what we've already processed.
 *   - Across server restarts we resume where we left off (no replay storm,
 *     no missed messages within the channel-history retention window).
 *
 * Writes are atomic: write to `*.tmp` then `rename` (POSIX atomic on the
 * same filesystem). A corrupt or missing file is treated as "no watermarks"
 * and the polling client applies its first-run backfill cap instead.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export interface ChannelWatermark {
  /** Slack message ts (string) — canonical id, exclusive lower bound for next fetch. */
  lastTs: string;
  /** Wall-clock ms when we last updated this channel. Diagnostic only. */
  lastSeenAt: number;
}

interface WatermarkFile {
  version: 1;
  channels: Record<string, ChannelWatermark>;
}

const FILE_VERSION = 1;

export interface WatermarkStoreOptions {
  /** Absolute path to the JSON file. */
  filePath: string;
  /** Override for tests; defaults to Date.now. */
  now?: () => number;
}

/**
 * Async, file-backed store. Holds the full state in memory after the first
 * `load()` and writes the whole file atomically on each `set()`. The state
 * is small (one entry per channel), so full-file rewrites are simpler and
 * safer than incremental updates.
 */
export class SlackWatermarkStore {
  private readonly filePath: string;
  private readonly now: () => number;
  private state: WatermarkFile = { version: FILE_VERSION, channels: {} };
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(opts: WatermarkStoreOptions) {
    this.filePath = opts.filePath;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Load state from disk. Missing or unparseable files are treated as
   * "no state" — we start fresh and the polling client falls back to the
   * first-run backfill cap.
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<WatermarkFile>;
      if (parsed && parsed.version === FILE_VERSION && parsed.channels && typeof parsed.channels === 'object') {
        this.state = {
          version: FILE_VERSION,
          channels: { ...parsed.channels },
        };
      }
    } catch {
      // Missing or corrupt → keep the empty default.
    }
    this.loaded = true;
  }

  /** Return the watermark for a channel, or undefined if we've never seen it. */
  get(channelId: string): ChannelWatermark | undefined {
    return this.state.channels[channelId];
  }

  /** True iff we've persisted a watermark for this channel before. */
  has(channelId: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.state.channels, channelId);
  }

  /**
   * Set a channel's watermark to `ts` only if it's strictly newer than what
   * we already have. Slack ts is a numeric string ("seconds.microseconds"),
   * lexicographic compare on equal-length strings is correct, but a numeric
   * compare via parseFloat is safer across length differences.
   *
   * Returns true if we updated state and queued a disk write, false if the
   * incoming ts was older or equal.
   */
  async set(channelId: string, ts: string): Promise<boolean> {
    if (!ts) return false;
    const current = this.state.channels[channelId];
    if (current && parseFloat(ts) <= parseFloat(current.lastTs)) {
      return false;
    }
    this.state.channels[channelId] = {
      lastTs: ts,
      lastSeenAt: this.now(),
    };
    await this.flush();
    return true;
  }

  /** Forget a channel — used when the user leaves it or it's archived. */
  async forget(channelId: string): Promise<void> {
    if (!this.has(channelId)) return;
    delete this.state.channels[channelId];
    await this.flush();
  }

  /** All channel ids currently tracked. */
  channels(): string[] {
    return Object.keys(this.state.channels);
  }

  /**
   * Atomic write: serialize state, write to `<file>.tmp`, then rename. The
   * rename is atomic on POSIX so a crash mid-write can never leave a
   * truncated JSON file at the canonical path.
   *
   * Concurrent calls are serialized via a promise chain so two parallel
   * `set()` calls can't interleave their writes.
   */
  private flush(): Promise<void> {
    const next = this.writeChain.then(() => this.writeFile());
    // Don't propagate write errors into the chain itself — if one write fails,
    // the next one should still be attempted.
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  private async writeFile(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    const body = JSON.stringify(this.state, null, 2);
    await fs.writeFile(tmp, body, 'utf-8');
    await fs.rename(tmp, this.filePath);
  }
}
