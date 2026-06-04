/**
 * Regression tests for the v3 send-message-disappear bug.
 *
 * Bug: useHistoryLoader's reconnect-path dedup used to filter the
 *      *pre-fetch snapshot* and clearOutputs+re-add only what survived. Any
 *      output that arrived via WS during the in-flight fetch (the optimistic
 *      prompt from `command_started`, an assistant chunk) lived in the live
 *      store at .then() time but NOT in the snapshot, so it was silently
 *      deleted. User saw "send msg → it disappears immediately, until I
 *      switch tabs and come back" because the pane remount took a fresh
 *      snapshot that *did* include the optimistic.
 *
 * Fix: dedup against the live store at .then() time (the input now exposed
 *      via the pure helper `dedupeOutputsAgainstHistory`). The snapshot is
 *      only retained for the error-recovery path in the catch() block.
 *
 * These tests exercise the helper directly so the contract — "post-fetch
 * arrivals MUST be preserved" — is locked in independently of React.
 */

import { describe, it, expect } from 'vitest';
import {
  dedupeOutputsAgainstHistory,
  mergeOlderHistoryPage,
  shouldKeepOutput,
} from '../historyDedup';
import type { HistoryMessage } from '../types';
import type { ClaudeOutput } from '../../../store/types';

function makeOptimisticPrompt(text: string, ts: number): ClaudeOutput {
  return {
    text,
    isStreaming: false,
    timestamp: ts,
    isUserPrompt: true,
  };
}

function makeUuidOutput(text: string, ts: number, uuid: string): ClaudeOutput {
  return {
    text,
    isStreaming: false,
    timestamp: ts,
    uuid,
  };
}

function makeHistoryUserMsg(content: string, ts: number, uuid: string): HistoryMessage {
  return {
    type: 'user',
    content,
    timestamp: new Date(ts).toISOString(),
    uuid,
  };
}

describe('dedupeOutputsAgainstHistory — v3 regression', () => {
  it('preserves an optimistic prompt that arrived during the fetch (history empty)', () => {
    // Repro: reconnect fires, snapshot taken (empty), fetch in flight,
    // command_started arrives mid-fetch and adds optimistic to live store,
    // server hasn't yet flushed the prompt to JSONL → history is empty.
    // The optimistic MUST survive.
    const liveAtThenTime: ClaudeOutput[] = [
      makeOptimisticPrompt('hola, ¿revisas?', 1_700_000_500),
    ];
    const history: HistoryMessage[] = [];

    const { kept, changed } = dedupeOutputsAgainstHistory(liveAtThenTime, history);

    expect(kept).toHaveLength(1);
    expect(kept[0].text).toBe('hola, ¿revisas?');
    expect(changed).toBe(false);
  });

  it('preserves an optimistic prompt that arrived during the fetch even when history has older entries', () => {
    // Older history is irrelevant — the optimistic is a NEW prompt, not in
    // history yet. Must survive.
    const liveAtThenTime = [
      makeOptimisticPrompt('hola, ¿revisas?', 1_700_000_500),
    ];
    const history = [
      makeHistoryUserMsg('older unrelated', 1_600_000_000, 'old-uuid'),
    ];

    const { kept } = dedupeOutputsAgainstHistory(liveAtThenTime, history);
    expect(kept).toHaveLength(1);
    expect(kept[0].text).toBe('hola, ¿revisas?');
  });

  it('drops an optimistic prompt only when history actually has the matching content within the dedup window', () => {
    // After the JSONL flush catches up, the same prompt is in history with a
    // uuid. The optimistic should drop out so the canonical history version
    // takes over (renders from the history pipeline).
    const liveAtThenTime = [
      makeOptimisticPrompt('hola, ¿revisas?', 1_700_000_500),
    ];
    const history = [
      makeHistoryUserMsg('hola, ¿revisas?', 1_700_000_550, 'jsonl-uuid'),
    ];

    const { kept, changed } = dedupeOutputsAgainstHistory(liveAtThenTime, history);
    expect(kept).toHaveLength(0);
    expect(changed).toBe(true);
  });

  it('keeps uuid-bearing live outputs that the server JSONL has not caught up to', () => {
    // Streaming WS broadcast with a uuid — history has not yet persisted it.
    // Must NOT prune by timestamp; only by uuid match.
    const liveAtThenTime = [
      makeUuidOutput('partial assistant chunk', 1_700_000_700, 'wsuid-1'),
    ];
    const history = [
      makeHistoryUserMsg('older content', 1_700_000_000, 'older-uuid'),
    ];
    const { kept } = dedupeOutputsAgainstHistory(liveAtThenTime, history);
    expect(kept).toHaveLength(1);
    expect(kept[0].uuid).toBe('wsuid-1');
  });

  it('drops a live output whose uuid IS already in history', () => {
    const liveAtThenTime = [
      makeUuidOutput('already persisted', 1_700_000_800, 'matching-uuid'),
    ];
    const history = [
      makeHistoryUserMsg('already persisted', 1_700_000_800, 'matching-uuid'),
    ];
    const { kept, changed } = dedupeOutputsAgainstHistory(liveAtThenTime, history);
    expect(kept).toHaveLength(0);
    expect(changed).toBe(true);
  });

  it('mixed scenario — preserves new arrivals while dropping ones already in history', () => {
    // The exact scenario the v3 bug missed: snapshot was empty/stale,
    // a new optimistic arrived, AND an older live output is now in history.
    const liveAtThenTime = [
      makeUuidOutput('historic', 1_700_000_000, 'persisted-uuid'),
      makeOptimisticPrompt('brand new', 1_700_001_000),
    ];
    const history = [
      makeHistoryUserMsg('historic', 1_700_000_000, 'persisted-uuid'),
    ];
    const { kept } = dedupeOutputsAgainstHistory(liveAtThenTime, history);
    expect(kept).toHaveLength(1);
    expect(kept[0].text).toBe('brand new');
  });

  it('returns changed=false when nothing was filtered (no clearOutputs needed)', () => {
    const liveAtThenTime = [
      makeOptimisticPrompt('a', 1_700_000_000),
      makeOptimisticPrompt('b', 1_700_000_100),
    ];
    const history: HistoryMessage[] = [];
    const { kept, changed } = dedupeOutputsAgainstHistory(liveAtThenTime, history);
    expect(kept).toHaveLength(2);
    expect(changed).toBe(false);
  });

  it('handles empty live store and empty history without throwing', () => {
    const { kept, changed } = dedupeOutputsAgainstHistory([], []);
    expect(kept).toEqual([]);
    expect(changed).toBe(false);
  });
});

describe('mergeOlderHistoryPage — scroll-up pagination ordering', () => {
  const msg = (
    content: string,
    ts: number,
    uuid?: string,
    type: HistoryMessage['type'] = 'user',
  ): HistoryMessage => ({ type, content, timestamp: new Date(ts).toISOString(), uuid });

  it('prepends a non-overlapping older page in chronological order', () => {
    const existing = [msg('m3', 3000, 'u3'), msg('m4', 4000, 'u4')];
    const older = [msg('m1', 1000, 'u1'), msg('m2', 2000, 'u2')];
    expect(mergeOlderHistoryPage(older, existing).map((m) => m.uuid)).toEqual(['u1', 'u2', 'u3', 'u4']);
  });

  it('drops boundary duplicates when the older page overlaps existing (offset drift)', () => {
    const existing = [msg('m3', 3000, 'u3'), msg('m4', 4000, 'u4'), msg('m5', 5000, 'u5')];
    const older = [msg('m1', 1000, 'u1'), msg('m2', 2000, 'u2'), msg('m3', 3000, 'u3'), msg('m4', 4000, 'u4')];
    expect(mergeOlderHistoryPage(older, existing).map((m) => m.uuid)).toEqual(['u1', 'u2', 'u3', 'u4', 'u5']);
  });

  it('drops messages NEWER than the oldest loaded so current messages never interleave above older ones', () => {
    // The bug: offset drift makes the "older" page reach into the live/newer
    // region, returning u5/u6 (newer than the oldest loaded u3). They must not
    // be prepended above older history.
    const existing = [msg('m3', 3000, 'u3'), msg('m4', 4000, 'u4')];
    const older = [msg('m1', 1000, 'u1'), msg('m2', 2000, 'u2'), msg('m5', 5000, 'u5'), msg('m6', 6000, 'u6')];
    expect(mergeOlderHistoryPage(older, existing).map((m) => m.uuid)).toEqual(['u1', 'u2', 'u3', 'u4']);
  });

  it('falls back to key dedupe when timestamps are missing/unparseable', () => {
    const existing = [msg('m3', 3000, 'u3')];
    const older: HistoryMessage[] = [
      { type: 'user', content: 'm1', timestamp: 'not-a-date', uuid: 'u1' },
      msg('m3', 3000, 'u3'), // duplicate by uuid
    ];
    expect(mergeOlderHistoryPage(older, existing).map((m) => m.uuid)).toEqual(['u1', 'u3']);
  });

  it('dedupes uuid-less messages via the type/timestamp/content composite key', () => {
    const existing = [msg('same', 3000)];
    const older = [msg('older', 1000), msg('same', 3000)];
    expect(mergeOlderHistoryPage(older, existing).map((m) => m.content)).toEqual(['older', 'same']);
  });

  it('returns existing unchanged when the whole older page is dropped (no stall data corruption)', () => {
    const existing = [msg('m3', 3000, 'u3'), msg('m4', 4000, 'u4')];
    // Everything is either already present or newer than the oldest loaded.
    const older = [msg('m3', 3000, 'u3'), msg('m9', 9000, 'u9')];
    expect(mergeOlderHistoryPage(older, existing).map((m) => m.uuid)).toEqual(['u3', 'u4']);
  });
});

describe('shouldKeepOutput — v1 invariant still holds', () => {
  it('keeps uuid output that is not in history (regardless of older history timestamps)', () => {
    const historyUuidSet = new Set<string>(['other-uuid']);
    const latestHistoryTsByKey = new Map<string, number>([['user:hello', 1_700_000_000]]);
    const optimisticChip = {
      text: 'tool chip',
      isStreaming: true,
      timestamp: 0,
      uuid: 'live-only-uuid',
    } as ClaudeOutput;
    expect(shouldKeepOutput(optimisticChip, historyUuidSet, latestHistoryTsByKey)).toBe(true);
  });

  it('drops uuid output whose uuid is in history', () => {
    const historyUuidSet = new Set<string>(['x']);
    const latestHistoryTsByKey = new Map<string, number>();
    const live = { text: 't', isStreaming: false, timestamp: 0, uuid: 'x' } as ClaudeOutput;
    expect(shouldKeepOutput(live, historyUuidSet, latestHistoryTsByKey)).toBe(false);
  });

  it('drops no-uuid optimistic prompt that matches history within window', () => {
    const historyUuidSet = new Set<string>();
    const latestHistoryTsByKey = new Map<string, number>([['user:hi', 1_000_000_000]]);
    const live = makeOptimisticPrompt('hi', 1_000_000_500); // <2 min away
    expect(shouldKeepOutput(live, historyUuidSet, latestHistoryTsByKey)).toBe(false);
  });

  it('keeps no-uuid optimistic prompt when no matching history key', () => {
    const historyUuidSet = new Set<string>();
    const latestHistoryTsByKey = new Map<string, number>();
    const live = makeOptimisticPrompt('fresh', 1_000_000_000);
    expect(shouldKeepOutput(live, historyUuidSet, latestHistoryTsByKey)).toBe(true);
  });
});
