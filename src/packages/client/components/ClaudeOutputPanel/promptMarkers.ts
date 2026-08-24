/**
 * promptMarkers - Pure helpers for the user-prompt overview rail.
 *
 * Scans the merged history+live list (the same array the virtualizer renders)
 * and yields one marker per genuine user prompt: the merged index (scroll
 * target), a stable key and a compact text preview for the hover tooltip.
 *
 * Deliberately free of React/DOM and of any runtime store import so it can be
 * unit-tested under vitest's node environment. Runtime imports here must stay
 * limited to pure modules (shared types/constants, slashCommands catalog).
 */

import { BOSS_CONTEXT_START, BOSS_CONTEXT_END } from '../../../shared/agent-types';
import { getSlashCommandInfo } from '../../utils/slashCommands';
import type { TaggedItem } from './virtualizedOutputKey';
import { parseRenameAgentRequest } from '../../plugins/rename-agent/renameAgentRequest';

export interface PromptMarker {
  /** Index into the merged allItems array — the virtualizer scroll target. */
  index: number;
  /** Stable virtualizer key for the marker's row (React key for the rail). */
  key: string;
  /** Cleaned, truncated prompt text for the hover tooltip. */
  preview: string;
  /** Epoch ms of the prompt (0 when unknown/unparseable). */
  timestampMs: number;
}

const PREVIEW_MAX_CHARS = 160;

/** Rail cap: only the most recent prompts get a dot/panel row. */
export const MAX_PROMPT_MARKERS = 15;

const USER_REQUEST_HEADER = '## User Request';

/**
 * Whole-message slash-command shape: a leading `/token` with no second `/` in
 * the token, so absolute paths (`/home/...`) don't match. Catalog commands are
 * also matched exactly via getSlashCommandInfo for the argument-less case.
 */
const SLASH_COMMAND_RE = /^\/[a-zA-Z][\w:-]*(\s|$)/;

/**
 * Reduce a raw user-role message to the text the user actually typed.
 * Returns null when the row shouldn't get a marker at all: slash-command runs,
 * interruption notices and system-generated user-role rows (task reports,
 * task notifications, session-continuation preambles).
 */
export function extractPromptPreview(raw: string): string | null {
  let text = (raw || '').replace(/\r\n/g, '\n').trim();
  if (!text) return null;

  // Internal plugin orchestration is rendered as a dedicated status card and
  // must not appear as if the user typed a giant prompt.
  if (parseRenameAgentRequest(text)) return null;

  // Slash commands are actions on the session, not something said to the agent.
  if (getSlashCommandInfo(text) || SLASH_COMMAND_RE.test(text)) return null;
  // History form of a slash-command run.
  if (text.includes('<command-name>')) return null;
  if (text.startsWith('<local-command-stdout>')) return null;
  if (/^\[Request interrupted/i.test(text)) return null;
  // Session-continuation preamble injected by the CLI, not typed by the user.
  if (text.startsWith('Caveat: The messages below')) return null;

  // Boss-context wrapper: the prompt is whatever follows the context block.
  if (text.startsWith(BOSS_CONTEXT_START)) {
    const endIdx = text.lastIndexOf(BOSS_CONTEXT_END);
    if (endIdx !== -1) text = text.slice(endIdx + BOSS_CONTEXT_END.length).trim();
  }

  // Codex injected-instructions wrapper (mirrors parseInjectedInstructions):
  // keep only what follows the last "## User Request" header.
  const userRequestIdx = text.lastIndexOf(USER_REQUEST_HEADER);
  if (userRequestIdx !== -1) {
    const remainder = text.slice(userRequestIdx + USER_REQUEST_HEADER.length).trim();
    if (remainder) text = remainder;
  }

  // Agent-to-agent completion reports render as their own card, not a prompt.
  if (/^\[TASK REPORT/i.test(text)) return null;

  // Background-task notifications: strip the block; if nothing else remains
  // the row is purely system-generated.
  text = text.replace(/<task-notification>[\s\S]*?<\/task-notification>/g, ' ').trim();
  if (!text) return null;

  // Delegated tasks ARE the prompt for the receiving agent — drop the header.
  text = text.replace(/^\[DELEGATED TASK[^\]]*\]\s*/i, '');

  // Non-typed payloads: reminder blocks and attachment placeholders.
  text = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/\[Image[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;

  if (text.length > PREVIEW_MAX_CHARS) {
    const slice = text.slice(0, PREVIEW_MAX_CHARS);
    const lastSpace = slice.lastIndexOf(' ');
    text = (lastSpace > PREVIEW_MAX_CHARS * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd() + '…';
  }
  return text;
}

/**
 * Build the marker list for the rail. `items`/`keys` are the aligned arrays
 * VirtualizedOutputList already computes (sorted + deduped), so marker.index
 * is directly usable with virtualizer.scrollToIndex.
 */
// Per-message preview memo. The merged list is rebuilt on every live chunk
// (~20×/s while streaming) but its message objects are stable (history rows
// and WeakMap-cached enrichment), so the regex-heavy extractPromptPreview
// runs once per prompt instead of once per prompt per chunk.
const previewCache = new WeakMap<object, string | null>();
function previewFor(item: object, raw: string): string | null {
  const hit = previewCache.get(item);
  if (hit !== undefined) return hit;
  const preview = extractPromptPreview(raw);
  previewCache.set(item, preview);
  return preview;
}

export function buildPromptMarkers(items: TaggedItem[], keys: string[], previous?: PromptMarker[]): PromptMarker[] {
  const markers: PromptMarker[] = [];
  for (let i = 0; i < items.length; i++) {
    const tagged = items[i];
    let raw: string;
    let timestampMs = 0;
    if (tagged.kind === 'history') {
      if (tagged.item.type !== 'user') continue;
      raw = tagged.item.content || '';
      if (tagged.item.timestamp) {
        const parsed = new Date(tagged.item.timestamp).getTime();
        if (Number.isFinite(parsed)) timestampMs = parsed;
      }
    } else {
      if (!tagged.item.isUserPrompt) continue;
      raw = tagged.item.text || '';
      timestampMs = tagged.item.timestamp ?? 0;
    }
    const preview = previewFor(tagged.item, raw);
    if (preview === null) continue;
    markers.push({ index: i, key: keys[i] ?? String(i), preview, timestampMs });
  }
  // Keep only the newest prompts so the rail stays readable on long sessions.
  const result = markers.length > MAX_PROMPT_MARKERS ? markers.slice(-MAX_PROMPT_MARKERS) : markers;
  // Same markers as last time → return the previous array so the rail's memo
  // holds (it re-rendered per chunk on a fresh-but-identical array before).
  if (previous && previous.length === result.length && previous.every((m, i) => {
    const n = result[i];
    return m.index === n.index && m.key === n.key && m.preview === n.preview && m.timestampMs === n.timestampMs;
  })) {
    return previous;
  }
  return result;
}
