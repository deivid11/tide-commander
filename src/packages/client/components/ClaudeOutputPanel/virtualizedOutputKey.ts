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

export function buildItemKey(tagged: TaggedItem, agentId: string): string {
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
    // start/input rows can share a tool_use id. Add row-local discriminators
    // so distinct live rows do not collide while merged streaming rows keep a
    // stable key as their text grows.
    return `${agentId}:o:u:${o.uuid}:${o.timestamp ?? 0}:${tagged.originalIndex}`;
  }
  // Optimistic / no-uuid live: timestamp + text. Two optimistic adds with
  // the exact same text at the exact same Date.now() ms would still collide;
  // de-dup pass in VirtualizedOutputList catches that defensively.
  return `${agentId}:o:s:${o.timestamp ?? 0}:${shortText(o.text)}`;
}
