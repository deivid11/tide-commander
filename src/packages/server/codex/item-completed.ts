/**
 * Codex's `event_msg` → `item_completed` records (2026-11 Codex builds).
 *
 * Newer Codex writes one of these per finished item, with PascalCase item
 * types, NEXT TO the records Tide Commander already renders:
 *   - AgentMessage / UserMessage / Reasoning duplicate the `response_item`
 *     message / reasoning entries;
 *   - CommandExecution / FileChange are the commands and patches run inside the
 *     `exec` custom tool call, which already renders as its own row.
 * Unrecognised, every one of them was dumped as raw `[codex-event]` JSON — 135
 * blocks in one review session. The only kind with information found nowhere
 * else is `Extension` / `web.search` (earlier builds sent it as
 * `web_search_call`), which becomes a WebSearch row.
 *
 * Shared by the live parser (json-event-parser.ts) and the history loader
 * (session-loader.ts) so both render the same thing.
 */

export type CodexItemCompletedAction =
  | { kind: 'skip' }
  | {
      kind: 'web_search';
      callId: string;
      query?: string;
      action?: { type?: string; query?: string; queries?: string[]; url?: string };
    };

/** Payload types of `event_msg` records that carry nothing to display. */
export const SILENT_CODEX_EVENT_MSG_TYPES: ReadonlySet<string> = new Set([
  'thread_settings_applied',
]);

/**
 * Payload types of `response_item` records that carry nothing to display:
 * `additional_tools` is the tool catalogue Codex hands the model (developer
 * role) — a multi-KB description dump, not conversation.
 */
export const SILENT_CODEX_RESPONSE_ITEM_TYPES: ReadonlySet<string> = new Set([
  'additional_tools',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function classifyCodexItemCompleted(payload: unknown): CodexItemCompletedAction {
  const item = isRecord(payload) && isRecord(payload.item) ? payload.item : null;
  if (!item) return { kind: 'skip' };
  if (item.type === 'Extension' && item.kind === 'web.search') {
    const action = isRecord(item.action) ? item.action : {};
    const queries = Array.isArray(action.queries) && action.queries.every((q) => typeof q === 'string')
      ? action.queries as string[]
      : undefined;
    return {
      kind: 'web_search',
      callId: typeof item.id === 'string' ? item.id : '',
      query: typeof item.query === 'string' ? item.query : undefined,
      action: {
        type: typeof action.type === 'string' ? action.type : undefined,
        query: typeof action.query === 'string' ? action.query : undefined,
        queries,
        url: typeof action.url === 'string' ? action.url : undefined,
      },
    };
  }
  // Everything else is either a duplicate of an already-rendered record (see
  // above) or a kind Tide Commander doesn't know yet — never a raw JSON dump.
  return { kind: 'skip' };
}
