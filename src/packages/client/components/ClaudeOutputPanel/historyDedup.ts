/**
 * Pure dedup helpers shared by useHistoryLoader (Guake) and re-usable for
 * tests. Keeping these out of useHistoryLoader.ts proper avoids pulling
 * the React/store/websocket transitive imports into unit-test environments
 * (`window is not defined` from websocket/state.ts).
 */

import type { ClaudeOutput } from '../../store/types';
import type { HistoryMessage } from './types';

const HISTORY_LIVE_DEDUP_WINDOW_MS = 120_000;

function normalizeMessage(text: string): string {
  return text.trim().replace(/\r\n/g, '\n');
}

export function buildOutputHistoryKey(type: 'user' | 'assistant', content: string): string {
  return `${type}:${normalizeMessage(content)}`;
}

/**
 * Stable identity key for a history message, used to dedupe overlapping
 * pagination pages. Prefers the session uuid; falls back to type+toolUseId, then
 * a type/timestamp/content composite for entries the session file didn't tag.
 */
export function historyMessageKey(m: HistoryMessage): string {
  if (typeof m.uuid === 'string' && m.uuid.length > 0) return `u:${m.uuid}`;
  if (typeof m.toolUseId === 'string' && m.toolUseId.length > 0) return `t:${m.type}:${m.toolUseId}`;
  return `c:${m.type}:${m.timestamp}:${normalizeMessage(m.content)}`;
}

/**
 * Merge a freshly-fetched OLDER page in front of the existing history.
 *
 * The server paginates by offset-from-end against the *current* message count
 * (see loadSession: `endIndex = totalCount - offset`). When the session grows
 * between page loads — the agent keeps working, or a history-refresh fires — the
 * offset the client sends drifts, so the fetched "older" page can:
 *   1. overlap messages already on screen (duplicates), and
 *   2. when growth exceeds a page, reach into the NEWER/live region, returning
 *      messages that are actually newer than what's loaded.
 *
 * To keep older messages strictly above current ones with no interleaving we
 * therefore: drop any fetched message already present (dedupe by key) AND drop
 * any whose timestamp is newer than the current oldest loaded message (those
 * belong to the live region, not older history). The survivors are prepended in
 * order. Gaps the drift introduces are filled by the next scroll-up page; the
 * caller advances the offset by the fetched page size so it can't stall even
 * when an entire page is dropped here.
 */
export function mergeOlderHistoryPage(
  olderPage: HistoryMessage[],
  existing: HistoryMessage[],
): HistoryMessage[] {
  const existingKeys = new Set<string>();
  for (const m of existing) existingKeys.add(historyMessageKey(m));

  // Oldest currently-loaded timestamp; fetched messages newer than this are not
  // older-history and must not be prepended above it.
  const oldestTs = existing.length > 0 ? Date.parse(existing[0].timestamp) : Number.POSITIVE_INFINITY;

  const seen = new Set<string>();
  const prepend: HistoryMessage[] = [];
  for (const m of olderPage) {
    const key = historyMessageKey(m);
    if (seen.has(key) || existingKeys.has(key)) continue;
    const ts = Date.parse(m.timestamp);
    // Only filter when both timestamps are valid; otherwise fall back to key
    // dedupe so messages with missing/odd timestamps are still merged.
    if (Number.isFinite(ts) && Number.isFinite(oldestTs) && ts > oldestTs) continue;
    seen.add(key);
    prepend.push(m);
  }

  return [...prepend, ...existing];
}

export function shouldKeepOutput(
  output: ClaudeOutput,
  historyUuidSet: Set<string>,
  latestHistoryTsByKey: Map<string, number>,
  historyUserMessages?: Array<{ content: string; ts: number }>,
): boolean {
  // UUID-bearing live output: keep unless the same UUID is already in history.
  // Pruning by timestamp here would silently kill optimistic chips/messages
  // whenever an earlier already-persisted JSONL entry makes the latest history
  // timestamp newer than this output's client-side timestamp.
  if (output.uuid) {
    return !historyUuidSet.has(output.uuid);
  }

  const outputType: 'user' | 'assistant' = output.isUserPrompt ? 'user' : 'assistant';
  const key = buildOutputHistoryKey(outputType, output.text);
  const outputTs = output.timestamp || 0;
  const historyTs = latestHistoryTsByKey.get(key);

  if (historyTs !== undefined && Math.abs(outputTs - historyTs) <= HISTORY_LIVE_DEDUP_WINDOW_MS) {
    return false;
  }

  // A live user prompt can have a history twin whose persisted text WRAPS the
  // raw prompt this client rendered — the OpenCode/Codex first-turn instruction
  // block ("Follow all instructions…## User Request…<raw>"), boss context, or
  // expanded [@file:] mentions. The UI unwraps that twin for display
  // (parseInjectedInstructions), so it renders identically to the raw live row
  // while the exact-key check above (keyed on the full wrapped text) misses it
  // → two identical rows. Match by containment within the dedup window so the
  // live row drops out and the canonical history twin takes over.
  //   - pendingEcho (command_started never arrived): any containing twin
  //     confirms it, including an exact-length one (a lost plain echo).
  //   - confirmed (echo already cleared pendingEcho): only a STRICTLY LARGER
  //     wrapper twin. An exact-length match is a distinct identical send and is
  //     already handled by the exact-key path above; cancelling it here would
  //     let two legitimately-identical prompts erase each other.
  if (output.isUserPrompt && historyUserMessages) {
    const raw = normalizeMessage(output.text);
    if (raw.length > 0) {
      for (const m of historyUserMessages) {
        if (Math.abs(outputTs - m.ts) > HISTORY_LIVE_DEDUP_WINDOW_MS) continue;
        if (!m.content.includes(raw)) continue;
        if (output.pendingEcho || m.content.length > raw.length) return false;
      }
    }
  }

  return true;
}

export interface DedupedOutputsResult {
  kept: ClaudeOutput[];
  changed: boolean;
}

/**
 * Filter the *live* outputs against the freshly-fetched history.
 *
 * IMPORTANT: callers MUST pass `store.getOutputs(agentId)` (the live store at
 * .then() time), NOT a snapshot taken at effect-fire time. The fetch
 * in-flight window is long enough that WS events (the optimistic prompt
 * from `command_started`, assistant streaming chunks, tool events) can
 * arrive between snapshot and re-add — filtering a stale snapshot would
 * silently delete them. That bug was the v3 send-message-disappear
 * regression; see useHistoryLoaderDedup.test.ts for the locked-in contract.
 */
export function dedupeOutputsAgainstHistory(
  currentOutputs: ClaudeOutput[],
  historyMessages: HistoryMessage[],
): DedupedOutputsResult {
  const historyUuidSet = new Set<string>();
  const latestHistoryTsByKey = new Map<string, number>();
  const historyUserMessages: Array<{ content: string; ts: number }> = [];
  for (const m of historyMessages) {
    if (typeof m.uuid === 'string' && m.uuid.length > 0) historyUuidSet.add(m.uuid);
    if (typeof m.toolUseId === 'string' && m.toolUseId.length > 0) historyUuidSet.add(m.toolUseId);
    if (m.type !== 'user' && m.type !== 'assistant') continue;
    const key = buildOutputHistoryKey(m.type, m.content);
    const msgTs = m.timestamp ? new Date(m.timestamp).getTime() : 0;
    const prev = latestHistoryTsByKey.get(key) ?? 0;
    if (msgTs > prev) latestHistoryTsByKey.set(key, msgTs);
    if (m.type === 'user') {
      historyUserMessages.push({ content: normalizeMessage(m.content), ts: msgTs });
    }
  }
  const kept = currentOutputs.filter((output) => shouldKeepOutput(
    output,
    historyUuidSet,
    latestHistoryTsByKey,
    historyUserMessages,
  ));
  return { kept, changed: kept.length !== currentOutputs.length };
}
