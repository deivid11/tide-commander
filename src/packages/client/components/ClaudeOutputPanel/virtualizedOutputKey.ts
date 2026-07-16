/**
 * Stable virtualizer keys for the merged history+live output list.
 *
 * Hard rule: every distinct item in the merged array gets a UNIQUE key.
 * `@tanstack/react-virtual` caches by key but tracks indices separately —
 * if two distinct indices ever return the same key (real-data duplicate
 * content, optimistic→history overlap, etc.) the virtualizer re-emits the
 * same virtual row at multiple positions and the user sees stacked dupes.
 * So: prefer uuid (always unique per JSONL entry / WS broadcast); fall
 * back to a content+timestamp signature only for optimistic, no-uuid items.
 *
 * Keys are agent-scoped to keep cross-agent isolation watertight even when
 * the virtualizer instance is somehow reused.
 */

import type { EnrichedHistoryMessage } from './types';
import type { ClaudeOutput } from '../../store';

export type TaggedHistoryItem = { kind: 'history'; item: EnrichedHistoryMessage; originalIndex: number };
export type TaggedLiveItem = { kind: 'live'; item: ClaudeOutput; originalIndex: number };
export type TaggedItem = TaggedHistoryItem | TaggedLiveItem;

function shortText(text: string | undefined): string {
  return (text || '').replace(/\s+/g, ' ').trim().slice(0, 64);
}

export function buildItemKey(tagged: TaggedItem, agentId: string, liveOrdinal?: number): string {
  if (tagged.kind === 'history') {
    const m = tagged.item;
    if (m.uuid) return `${agentId}:h:u:${m.uuid}`;
    if (m.toolUseId) return `${agentId}:h:t:${m.toolUseId}`;
    // No uuid/toolUseId — disambiguate by type+timestamp+content.
    return `${agentId}:h:s:${m.type}:${m.timestamp ?? ''}:${shortText(m.content)}`;
  }
  const o = tagged.item;
  if (o.uuid) {
    // Live output UUIDs are not guaranteed to be unique per rendered row:
    // Claude streaming chunks reuse the assistant message UUID, and tool
    // start/input rows can share a tool_use id. Add a row-local discriminator
    // so distinct live rows do not collide while merged streaming rows keep a
    // stable key as their text grows.
    //
    // The discriminator must be STABLE across history refreshes: it only has
    // to separate rows sharing the same uuid+timestamp, so callers pass a
    // per-(uuid,timestamp) ordinal (VirtualizedOutputList computes it over
    // the sorted merged array). The originalIndex fallback (offset by the
    // history length) shifted on EVERY refresh that changed the history
    // count, remounting the whole live tail — markdown re-parse + stream-fade
    // restart — a per-refresh blink while an agent streamed.
    return `${agentId}:o:u:${o.uuid}:${o.timestamp ?? 0}:${liveOrdinal ?? tagged.originalIndex}`;
  }
  // Optimistic / no-uuid live: timestamp + text. Two optimistic adds with
  // the exact same text at the exact same Date.now() ms would still collide;
  // de-dup pass in VirtualizedOutputList catches that defensively.
  return `${agentId}:o:s:${o.timestamp ?? 0}:${shortText(o.text)}`;
}

/**
 * Stable identity shared by a live row and its persisted history twin, used
 * to bridge MEASURED HEIGHTS across the live→history identity swap.
 *
 * When a session refresh replaces a live row with its history twin, the
 * virtualizer key changes (live keys carry ts+index discriminators — see
 * buildItemKey), so the per-key size cache treats the twin as a brand-new row
 * and falls back to the type estimate. The freshly-measured tail of the
 * conversation — exactly what's on screen right after load — collapses to
 * estimates and re-measures: a visible reflow after the reveal, repeated on
 * every mid-stream refresh. Estimating the twin through these ids keeps the
 * swap layout-neutral.
 *
 * Identity mapping: text rows share the JSONL entry uuid on both sides. Live
 * TOOL rows are broadcast with uuid = tool_use_id, which on the history side
 * is `toolUseId` (the entry uuid differs) — bridge those through a
 * type-scoped tool id so a tool_use chip and its tool_result stay distinct.
 * Ids are approximate by design (estimates are estimates); the virtualizer's
 * measurement pass still owns the truth.
 */
export function bridgeIdsFor(tagged: TaggedItem): string[] {
  if (tagged.kind === 'history') {
    const m = tagged.item;
    const ids: string[] = [];
    if (m.uuid) ids.push(`u:${m.uuid}`);
    if (m.toolUseId && m.type === 'tool_use') ids.push(`t:use:${m.toolUseId}`);
    if (m.toolUseId && m.type === 'tool_result') ids.push(`t:res:${m.toolUseId}`);
    return ids;
  }
  const o = tagged.item;
  if (!o.uuid) return [];
  const text = o.text || '';
  if (text.startsWith('Using tool:')) return [`t:use:${o.uuid}`];
  if (text.startsWith('Tool result:') || text.startsWith('Bash output:')) return [`t:res:${o.uuid}`];
  return [`u:${o.uuid}`];
}
