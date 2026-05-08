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

export function shouldKeepOutput(
  output: ClaudeOutput,
  historyUuidSet: Set<string>,
  latestHistoryTsByKey: Map<string, number>,
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
  for (const m of historyMessages) {
    if (typeof m.uuid === 'string' && m.uuid.length > 0) historyUuidSet.add(m.uuid);
    if (typeof m.toolUseId === 'string' && m.toolUseId.length > 0) historyUuidSet.add(m.toolUseId);
    if (m.type !== 'user' && m.type !== 'assistant') continue;
    const key = buildOutputHistoryKey(m.type, m.content);
    const msgTs = m.timestamp ? new Date(m.timestamp).getTime() : 0;
    const prev = latestHistoryTsByKey.get(key) ?? 0;
    if (msgTs > prev) latestHistoryTsByKey.set(key, msgTs);
  }
  const kept = currentOutputs.filter((output) => shouldKeepOutput(
    output,
    historyUuidSet,
    latestHistoryTsByKey,
  ));
  return { kept, changed: kept.length !== currentOutputs.length };
}
