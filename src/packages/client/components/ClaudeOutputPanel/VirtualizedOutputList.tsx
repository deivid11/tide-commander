/**
 * VirtualizedOutputList - Efficient virtualized rendering for terminal output
 *
 * Uses @tanstack/react-virtual for sliding window rendering.
 * Only renders visible items plus overscan buffer, reducing DOM nodes from 200+ to ~30.
 */

import React, { useRef, useEffect, useLayoutEffect, useCallback, useMemo, useState, memo } from 'react';
import { useVirtualizer, defaultRangeExtractor, type Range } from '@tanstack/react-virtual';
import { HistoryLine } from './HistoryLine';
import { OutputLine } from './OutputLine';
import { ToolChipEnter } from './ToolChipEnter';
import type { EnrichedHistoryMessage, EditData } from './types';
import type { ClaudeOutput } from '../../store';
import type { ExecTask, Subagent } from '../../../shared/types';
import type { TestRunHandle, HttpRunHandle } from '../../store';
import { buildItemKey, bridgeIdsFor } from './virtualizedOutputKey';
import { buildPromptMarkers, type PromptMarker } from './promptMarkers';
import { PromptMarkersRail } from './PromptMarkersRail';
import { BackgroundTasksRail } from './BackgroundTasksRail';
export { buildItemKey } from './virtualizedOutputKey';
export type { TaggedItem, TaggedHistoryItem, TaggedLiveItem } from './virtualizedOutputKey';

// Enriched output type from useFilteredOutputs
type EnrichedOutput = ClaudeOutput & {
  _toolKeyParam?: string;
  _editData?: EditData;
  _todoInput?: string;
  _bashOutput?: string;
  _bashCommand?: string;
  _isRunning?: boolean;
};

interface VirtualizedOutputListProps {
  // Data
  historyMessages: EnrichedHistoryMessage[];
  liveOutputs: EnrichedOutput[];
  agentId: string;
  execTasks?: ExecTask[];
  testRunHandles?: TestRunHandle[];
  httpRunHandles?: HttpRunHandle[];
  subagents?: Map<string, Subagent>;

  // UI state
  viewMode: 'simple' | 'chat' | 'advanced';
  /** Index of the active search match to scroll to */
  searchActiveIndex?: number | null;
  /** Note rendered inside the active match's row when its hit text is not
   *  visible there (truncated preview / collapsed section). */
  searchHiddenNote?: React.ReactNode;
  /** Height (px) of the search results panel overlaying the top of the output,
   *  so the scrolled-to match can be nudged clear of it. 0 when no panel. */
  searchPanelHeight?: number;

  // Message navigation
  selectedMessageIndex: number | null;
  isMessageSelected: (index: number) => boolean;

  /**
   * Notifies the parent that a prompt-rail marker was clicked (so it can mark
   * the row as the nav selection / highlight it). The scroll itself is
   * performed here — this component is the single scroll writer.
   */
  onPromptMarkerJump?: (index: number) => void;

  // Callbacks
  onImageClick?: (url: string, name: string) => void;
  onFileClick?: (path: string, editData?: EditData | { highlightRange: { offset: number; limit: number } }) => void;
  onBashClick?: (command: string, output: string) => void;
  onViewMarkdown?: (content: string) => void;

  // Scroll control
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onScrollTopReached?: () => void;
  isLoadingMore?: boolean;
  hasMore?: boolean;

  // Auto-scroll control
  shouldAutoScroll: boolean;
  onUserScroll?: () => void;

  /**
   * When true, the list will actively "pin" itself to the bottom (for agent switching / initial load),
   * keeping the viewport at the latest message even while row heights are still being measured.
   */
  pinToBottom?: boolean;
  /** Optional callback when the user scrolls during pin mode (so the parent can cancel pinning). */
  onPinCancel?: () => void;

  // History loading state (used only to avoid pinning while fetch is active)
  isLoadingHistory?: boolean;

  /**
   * Cumulative scrollTop movement (px) applied by virtual-core anchor
   * corrections, shared with the parent pane so BOTH scroll classifiers can
   * subtract it before deciding "the user scrolled up". Never reset — each
   * listener diffs against its own baseline, so listener order doesn't matter.
   */
  anchorCorrectionsRef?: React.MutableRefObject<number>;
}

// Estimated heights for different message types (used for initial sizing)
const ESTIMATED_HEIGHTS = {
  user: 100,
  assistant: 80,
  thinking: 56,
  tool_use: 32,
  tool_result: 40,
  default: 48,
};

// ── Measurement warm-up ──
// virtual-core applies a scrollTop "correction" whenever a row ABOVE the
// viewport measures different from its estimate (via the row's initial
// ResizeObserver fire — a path NOT gated on user scrolling). Any programmatic
// scroll write kills fling momentum on mobile, so scrolling up through
// never-measured rows right after an agent switch (the per-agent remount
// empties the size cache) stuttered for seconds until the page was measured.
// The corrections themselves must stay (they are the anchor — see
// project_virtualized_prepend_anchor), so instead we make them no-ops:
// mount a small slice of rows at a time from bottom to top during idle
// frames (extra indexes via rangeExtractor), letting them measure while the
// user is stationary. Once warmed, re-mounting during a fling yields
// delta=0 → no correction → momentum survives.
const WARMUP_SLICE = 6;
// Background warm-up mounted offscreen rows for 1–2 seconds after a cold
// switch. Their measurements repeatedly changed total size and made the
// bottom-pinned viewport tremble. Normal overscan still measures rows before
// they enter view and the per-agent cache preserves those measurements.
const ENABLE_MEASUREMENT_WARMUP = false;
// Bound retained for an easy, measured opt-in if browser behavior changes.
const WARMUP_MAX_ROWS = 120;
const INITIAL_VIEWPORT_HEIGHT = 800;

interface AgentMeasurementCache {
  heights: Map<string, number>;
  warmupComplete: boolean;
  measuredWidth: number | null;
}

// Preserve measured heights across the per-agent virtualizer remount. Revisiting
// an agent should reuse the work from its previous visit instead of remounting
// up to WARMUP_MAX_ROWS solely to rebuild an identical size cache.
const MAX_AGENT_MEASUREMENT_CACHES = 100;
const MAX_HEIGHT_ENTRIES_PER_AGENT = 3000;
const measurementCaches = new Map<string, AgentMeasurementCache>();

function getAgentMeasurementCache(agentId: string): AgentMeasurementCache {
  const existing = measurementCaches.get(agentId);
  if (existing) return existing;
  const cache: AgentMeasurementCache = { heights: new Map(), warmupComplete: false, measuredWidth: null };
  measurementCaches.set(agentId, cache);
  if (measurementCaches.size > MAX_AGENT_MEASUREMENT_CACHES) {
    const oldest = measurementCaches.keys().next().value as string | undefined;
    if (oldest !== undefined) measurementCaches.delete(oldest);
  }
  return cache;
}

function rememberHeight(cache: AgentMeasurementCache, key: string, height: number): void {
  if (!cache.heights.has(key) && cache.heights.size >= MAX_HEIGHT_ENTRIES_PER_AGENT) {
    const oldest = cache.heights.keys().next().value as string | undefined;
    if (oldest !== undefined) cache.heights.delete(oldest);
  }
  cache.heights.set(key, height);
}

// Tagged wrapper so the merged history+live array can be sorted while still
// telling each renderer which component to use (HistoryLine vs OutputLine).
// (Type aliases re-exported above are the source of truth — the local copies
// only narrow the live item to EnrichedOutput so render code can read tool
// enrichment fields without an extra cast.)
type _TaggedHistoryItem = { kind: 'history'; item: EnrichedHistoryMessage; originalIndex: number };
type _TaggedLiveItem = { kind: 'live'; item: EnrichedOutput; originalIndex: number };
type TaggedItem = _TaggedHistoryItem | _TaggedLiveItem;

/** Canonical 'created at' in epoch ms — bridges history's ISO strings and live's number ts. */
// History rows carry ISO timestamps; the merge memo below runs on every live
// chunk (~20×/s while streaming) over the WHOLE history, so the Date parse is
// cached per message object (history objects are stable between refreshes).
const historyTsCache = new WeakMap<object, number>();
function getCanonicalTimestampMs(tagged: TaggedItem): number {
  if (tagged.kind === 'history') {
    const cached = historyTsCache.get(tagged.item);
    if (cached !== undefined) return cached;
    const ts = tagged.item.timestamp;
    let ms = 0;
    if (ts) {
      const parsed = new Date(ts).getTime();
      ms = Number.isFinite(parsed) ? parsed : 0;
    }
    historyTsCache.set(tagged.item, ms);
    return ms;
  }
  return tagged.item.timestamp ?? 0;
}

function getCanonicalUuid(tagged: TaggedItem): string {
  if (tagged.kind === 'history') {
    return tagged.item.uuid ?? tagged.item.toolUseId ?? '';
  }
  return tagged.item.uuid ?? '';
}

function getEstimatedHeight(tagged: TaggedItem): number {
  if (tagged.kind === 'history') {
    const m = tagged.item;
    return ESTIMATED_HEIGHTS[m.type as keyof typeof ESTIMATED_HEIGHTS] || ESTIMATED_HEIGHTS.default;
  }
  const output = tagged.item;
  if (output.isUserPrompt) return ESTIMATED_HEIGHTS.user;
  if (output.text?.startsWith('Using tool:')) return ESTIMATED_HEIGHTS.tool_use;
  if (output.text?.startsWith('Tool result:')) return ESTIMATED_HEIGHTS.tool_result;
  if (output.text?.startsWith('[thinking]')) return ESTIMATED_HEIGHTS.thinking;
  return ESTIMATED_HEIGHTS.assistant;
}

// Individual row renderer - memoized for performance
const VirtualRow = memo(function VirtualRow({
  item,
  isHistory,
  agentId,
  execTasks,
  testRunHandles,
  httpRunHandles,
  subagents,
  simpleView,
  isSelected,
  isSearchActive,
  messageIndex,
  searchHiddenNote,
  onImageClick,
  onFileClick,
  onBashClick,
  onViewMarkdown,
}: {
  item: EnrichedHistoryMessage | EnrichedOutput;
  isHistory: boolean;
  agentId: string;
  execTasks: ExecTask[];
  testRunHandles: TestRunHandle[];
  httpRunHandles: HttpRunHandle[];
  subagents?: Map<string, Subagent>;
  simpleView: boolean;
  isSelected: boolean;
  isSearchActive?: boolean;
  messageIndex: number;
  searchHiddenNote?: React.ReactNode;
  onImageClick?: (url: string, name: string) => void;
  onFileClick?: (path: string, editData?: EditData | { highlightRange: { offset: number; limit: number } }) => void;
  onBashClick?: (command: string, output: string) => void;
  onViewMarkdown?: (content: string) => void;
}) {
  // Stable id for chip enter animation (uuid preferred; fall back to index).
  const enterId = (() => {
    if (isHistory) {
      const m = item as EnrichedHistoryMessage;
      return m.uuid || `history-${messageIndex}`;
    }
    const o = item as EnrichedOutput;
    return o.uuid || `live-${messageIndex}`;
  })();

  return (
    <div
      data-message-index={messageIndex}
      className={`message-nav-wrapper ${isSelected ? 'message-selected' : ''}${isSearchActive ? ' search-active' : ''}`}
    >
      {/* History: no enter animation. Live only: soft fade new chips/answers. */}
      <ToolChipEnter
        enterId={`${agentId}:${isHistory ? 'h' : 'l'}:${enterId}`}
        animate={!isHistory}
        staggerMs={0}
      >
        {isHistory ? (
          <HistoryLine
            message={item as EnrichedHistoryMessage}
            agentId={agentId}
            simpleView={simpleView}
            searchReveal={isSearchActive}
            subagents={subagents}
            execTasks={execTasks}
            testRunHandles={testRunHandles}
            httpRunHandles={httpRunHandles}
            onImageClick={onImageClick}
            onFileClick={onFileClick}
            onBashClick={onBashClick}
            onViewMarkdown={onViewMarkdown}
          />
        ) : (
          <OutputLine
            output={item as EnrichedOutput}
            agentId={agentId}
            execTasks={execTasks}
            testRunHandles={testRunHandles}
            httpRunHandles={httpRunHandles}
            subagents={subagents}
            searchReveal={isSearchActive}
            onImageClick={onImageClick}
            onFileClick={onFileClick}
            onBashClick={onBashClick}
            onViewMarkdown={onViewMarkdown}
          />
        )}
      </ToolChipEnter>
      {isSearchActive && searchHiddenNote}
    </div>
  );
});

export const VirtualizedOutputList = memo(function VirtualizedOutputList({
  historyMessages,
  liveOutputs,
  agentId,
  execTasks = [],
  testRunHandles = [],
  httpRunHandles = [],
  subagents,
  viewMode,
  searchActiveIndex,
  searchHiddenNote,
  searchPanelHeight = 0,
  selectedMessageIndex,
  isMessageSelected,
  onPromptMarkerJump,
  onImageClick,
  onFileClick,
  onBashClick,
  onViewMarkdown,
  scrollContainerRef,
  onScrollTopReached,
  isLoadingMore,
  hasMore,
  shouldAutoScroll,
  onUserScroll,
  pinToBottom = false,
  onPinCancel,
  isLoadingHistory,
  anchorCorrectionsRef,
}: VirtualizedOutputListProps) {
  // Merge history + live into ONE chronologically sorted array. This is the
  // single authoritative ordering for the rendered list — without it, history
  // (server-sorted) and live outputs sit in separate concatenated blocks, so
  // a live event whose timestamp predates the newest history entry visually
  // appears AFTER it.
  //
  // Stable sort: ascending canonical timestamp, then uuid lex ascending,
  // then original insertion order (history-block first, then live-block).
  // History half of the merge, decorated ONCE per historyMessages identity:
  // the merge below runs on every live chunk (~20×/s while streaming) and the
  // history part (thousands of rows on long sessions) is identical each time —
  // only the live tail changes. Keys for history rows never depend on order,
  // so they are precomputed here too.
  const historyDecorated = useMemo(() => {
    const out: Array<{ tagged: TaggedItem; tsMs: number; uuid: string; key: string }> = new Array(historyMessages.length);
    for (let i = 0; i < historyMessages.length; i++) {
      const tagged: TaggedItem = { kind: 'history', item: historyMessages[i], originalIndex: i };
      out[i] = { tagged, tsMs: getCanonicalTimestampMs(tagged), uuid: getCanonicalUuid(tagged), key: buildItemKey(tagged, agentId) };
    }
    return out;
  }, [historyMessages, agentId]);

  const { allItems, allKeys } = useMemo(() => {
    // Decorate: precompute the canonical timestamp (a Date parse for history
    // rows) and uuid ONCE per item — the comparator previously re-derived
    // both per comparison (~2·N·logN Date parses per streamed chunk).
    const decorated: Array<{ tagged: TaggedItem; tsMs: number; uuid: string; key?: string }> = historyDecorated.slice();
    for (let i = 0; i < liveOutputs.length; i++) {
      const tagged: TaggedItem = { kind: 'live', item: liveOutputs[i], originalIndex: historyMessages.length + i };
      decorated.push({ tagged, tsMs: getCanonicalTimestampMs(tagged), uuid: getCanonicalUuid(tagged) });
    }
    // Fast path: history is server-sorted and live outputs stream in order, so
    // the merged array is usually already sorted — one O(N) pass confirms it
    // and skips the sort. originalIndex ascends by construction, so a pair is
    // in comparator order iff tsMs ascends, with uuid breaking ties.
    let isSorted = true;
    for (let i = 1; i < decorated.length; i++) {
      const prev = decorated[i - 1];
      const curr = decorated[i];
      if (prev.tsMs > curr.tsMs || (prev.tsMs === curr.tsMs && prev.uuid > curr.uuid)) {
        isSorted = false;
        break;
      }
    }
    if (!isSorted) {
      decorated.sort((a, b) => {
        if (a.tsMs !== b.tsMs) return a.tsMs - b.tsMs;
        if (a.uuid !== b.uuid) return a.uuid < b.uuid ? -1 : 1;
        return a.tagged.originalIndex - b.tagged.originalIndex;
      });
    }
    // Defensive de-dup: collapse any items that resolve to the same
    // virtualizer key. Without this, duplicate-key items (real-data dupes
    // from the source, optimistic+history coexisting briefly) cause
    // @tanstack/react-virtual to re-emit the same virtual row at multiple
    // indices, which the user sees as stacked bubbles in one position.
    //
    // Keys are computed HERE, once, in final sorted order — live uuid-bearing
    // rows get a per-(uuid,timestamp) ordinal discriminator that stays stable
    // when the history count changes (see buildItemKey); getItemKey below
    // just reads the aligned keys array.
    const seen = new Set<string>();
    const items: TaggedItem[] = [];
    const keys: string[] = [];
    const liveOrdinals = new Map<string, number>();
    for (const entry of decorated) {
      const { tagged } = entry;
      let key: string;
      if (entry.key !== undefined) {
        key = entry.key; // history row — precomputed
      } else if (tagged.kind === 'live' && tagged.item.uuid) {
        const group = `${tagged.item.uuid}:${tagged.item.timestamp ?? 0}`;
        const ordinal = liveOrdinals.get(group) ?? 0;
        liveOrdinals.set(group, ordinal + 1);
        key = buildItemKey(tagged, agentId, ordinal);
      } else {
        key = buildItemKey(tagged, agentId);
      }
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(tagged);
      keys.push(key);
    }
    return { allItems: items, allKeys: keys };
  }, [historyDecorated, historyMessages.length, liveOutputs, agentId]);

  // One marker per user prompt, in merged order — feeds the overview rail.
  const prevPromptMarkersRef = useRef<PromptMarker[]>([]);
  const promptMarkers = useMemo(() => {
    const next = buildPromptMarkers(allItems, allKeys, prevPromptMarkersRef.current);
    prevPromptMarkersRef.current = next;
    return next;
  }, [allItems, allKeys]);

  // Track if we're programmatically scrolling (to avoid triggering onUserScroll)
  const isProgrammaticScrollRef = useRef(false);
  const pinToBottomRef = useRef(pinToBottom);
  pinToBottomRef.current = pinToBottom;

  // Ref callbacks run in the commit phase before paint. Put the scroll element
  // at the real DOM bottom as soon as the virtual spacer mounts; waiting for a
  // layout/effect-driven scroll exposed one frame with bottom-index rows laid
  // out below a scrollTop of 0, followed by the visible forced jump.
  const handleVirtualContentMount = useCallback((element: HTMLDivElement | null) => {
    if (!element || !pinToBottomRef.current) return;
    // Descendant refs attach before the parent output ref, so defer to the
    // commit's microtask checkpoint. This is still before the browser's paint.
    queueMicrotask(() => {
      if (!element.isConnected || !pinToBottomRef.current) return;
      const container = scrollContainerRef.current;
      if (!container) return;
      isProgrammaticScrollRef.current = true;
      container.scrollTop = container.scrollHeight;
    });
  }, [scrollContainerRef]);

  // THE auto-scroll contract: follow the stream ONLY while the viewport sits at
  // the very bottom. Latched synchronously in handleScroll at the very bottom,
  // unlatched ONLY on a correction-adjusted genuine user up-scroll (any-event
  // unlatching let a growth/correction collision park the view a few px above
  // the bottom with every follow write refused). Checked at WRITE time by the
  // auto-scroll effects below — immune to state-machine races: the moment the
  // user scrolls up even a few px, the next write is refused no matter what
  // shouldAutoScroll says. The pin path (agent switch / send / history load)
  // bypasses it on purpose.
  const stickyBottomRef = useRef(true);

  // ── Anchor-correction accounting ──
  // virtual-core shifts scrollTop when a row above the viewport re-measures
  // (the prepend/warm-up anchor). Those shifts are indistinguishable from user
  // scrolling in raw position reads: a correction coalesced into the same
  // scroll event as content growth below reads as "moved up while above the
  // bottom" — the user-scroll signature — which cancelled the open pin and
  // killed auto-follow. Fold every correction's ACTUAL applied movement into a
  // cumulative counter so the classifiers can subtract it. Actual movement,
  // not intended delta: clamped/stale-offset writes apply less than delta, and
  // over-counting biased the classifiers into swallowing genuine up-scrolls.
  const localCorrectionsRef = useRef(0);
  const correctionsRef = anchorCorrectionsRef ?? localCorrectionsRef;
  // This component remounts per agent (key={agentId}) while the shared counter
  // lives on — baseline starts at the counter's current value, not 0.
  const correctionsBaselineRef = useRef(correctionsRef.current);
  // scrollTop captured at the current task's FIRST correction; a microtask
  // reads the task's net effect (microtasks run before the browser delivers
  // the resulting scroll event, so the counter is current when it's needed).
  const correctionTaskBaseRef = useRef<number | null>(null);
  const prevItemCountRef = useRef(allItems.length);
  const agentSwitchGraceRef = useRef(false);
  // Ref for allItems count so scrollToBottom can read it without being recreated
  const allItemsCountRef = useRef(allItems.length);
  allItemsCountRef.current = allItems.length;
  // Refs let stable virtualizer callbacks resolve the item and key currently
  // occupying a measured index.
  const allItemsRef = useRef(allItems);
  allItemsRef.current = allItems;
  const allKeysRef = useRef(allKeys);
  allKeysRef.current = allKeys;
  const measurementCache = useMemo(() => getAgentMeasurementCache(agentId), [agentId]);
  // Track virtual content height to detect remeasurement changes.
  const prevTotalSizeRef = useRef(0);

  const estimateItemSize = useCallback((index: number) => {
    const tagged = allItems[index];
    if (!tagged) return ESTIMATED_HEIGHTS.default;
    const itemKey = allKeys[index];
    if (itemKey) {
      const measured = measurementCache.heights.get(`k:${itemKey}`);
      if (measured !== undefined) return measured;
    }
    for (const id of bridgeIdsFor(tagged)) {
      const bridged = measurementCache.heights.get(`b:${id}`);
      if (bridged !== undefined) return bridged;
    }
    return getEstimatedHeight(tagged);
  }, [allItems, allKeys, measurementCache]);

  // Start the virtualizer at its estimated bottom on a keyed pane mount. The
  // old offset=0 first range rendered the oldest rows, then swapped them for
  // the newest range 1–2 frames later when scrollToIndex settled — the exact
  // content flash seen during agent selection. The browser clamps this offset
  // to the real maximum once the scroll element is connected.
  const initialBottomOffsetRef = useRef<number | null>(null);
  if (initialBottomOffsetRef.current === null) {
    let total = 0;
    for (let i = 0; i < allItems.length; i++) total += estimateItemSize(i);
    initialBottomOffsetRef.current = Math.max(0, total - INITIAL_VIEWPORT_HEIGHT);
  }

  // Warm-up walk state: exclusive upper bound of the next slice to mount
  // ([warmupFront - WARMUP_SLICE, warmupFront)); null = not walking.
  const [warmupFront, setWarmupFront] = useState<number | null>(null);
  const warmupDoneRef = useRef(measurementCache.warmupComplete);
  const warmupHasStartedRef = useRef(false);

  const rangeExtractor = useCallback((range: Range) => {
    const defaults = defaultRangeExtractor(range);
    if (!ENABLE_MEASUREMENT_WARMUP || warmupFront === null) return defaults;
    const top = Math.min(warmupFront, allItemsCountRef.current);
    const sliceStart = Math.max(0, top - WARMUP_SLICE);
    if (sliceStart >= top) return defaults;
    const merged = new Set<number>();
    for (let i = sliceStart; i < top; i++) {
      const key = allKeysRef.current[i];
      // A revisited agent already has this row's height. Advancing over it
      // without mounting avoids repeated markdown parsing and detached DOM.
      if (!key || !measurementCache.heights.has(`k:${key}`)) merged.add(i);
    }
    for (const i of defaults) merged.add(i);
    return Array.from(merged).sort((a, b) => a - b);
  }, [measurementCache, warmupFront]);

  // Create virtualizer
  // initialRect prevents the first render from having outerSize=0 (which yields
  // zero visible items until a scroll event triggers a re-measure).
  const virtualizer = useVirtualizer({
    count: allItems.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: estimateItemSize,
    initialOffset: initialBottomOffsetRef.current,
    // Two-phase overscan. While pinned (pane mount / agent switch) keep it
    // small — every overscanned row is a markdown-parsed OutputLine/HistoryLine
    // mounted synchronously, and that mount is the main cost of the switch.
    // Once settled, widen the window so scrolling reaches pre-mounted rows
    // instead of blank container background. The extra rows mount in the
    // unpin commit, while the content is still faded out.
    overscan: pinToBottom ? 8 : 16,
    rangeExtractor,
    initialRect: { width: 500, height: INITIAL_VIEWPORT_HEIGHT },
    // Stable per-item key, precomputed (with live ordinals) in the merge memo
    // above. agentId is part of the key so identical content across agents
    // can never collide.
    getItemKey: (index) => allKeys[index] ?? index,
    measureElement: (element) => {
      // Measure actual rendered height for accurate positioning.
      const rect = element.getBoundingClientRect();
      const height = rect.height;
      // Cached heights are width-dependent (especially markdown/code). Drop a
      // previous visit's values after a meaningful pane resize.
      if (measurementCache.measuredWidth !== null && Math.abs(measurementCache.measuredWidth - rect.width) > 8) {
        measurementCache.heights.clear();
        measurementCache.warmupComplete = false;
        warmupDoneRef.current = false;
      }
      measurementCache.measuredWidth = rect.width;
      // Feed both the stable per-row cache (agent revisits) and the
      // live→history identity bridge.
      const idxAttr = element.getAttribute('data-index');
      if (idxAttr !== null) {
        const index = Number(idxAttr);
        const tagged = allItemsRef.current[index];
        const itemKey = allKeysRef.current[index];
        if (itemKey) rememberHeight(measurementCache, `k:${itemKey}`, height);
        if (tagged) {
          for (const id of bridgeIdsFor(tagged)) {
            rememberHeight(measurementCache, `b:${id}`, height);
          }
        }
      }
      return height;
    },
  });

  // Anchor corrections: when a row whose start sits above the viewport
  // re-measures, virtual-core shifts scrollTop by the delta so the visible
  // content stays put (required for prepends/warm-up — see
  // project_virtualized_prepend_anchor). EXCEPT the LAST row, unconditionally:
  // reading inside it, a streaming response grows at its BOTTOM (below the
  // reading point) while its start is above the viewport top, so the default
  // dragged the view down every chunk; following AT the bottom, the follow
  // effects own the anchor — and a correction computed from the virtualizer's
  // stale cached offset landed a transient wrong-position write that the
  // follow snapped back from, a per-chunk flicker while streaming.
  // (Instance property in this virtual-core version, not a constructor option.)
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
    // At the bottom, pin/auto-follow is the sole scroll writer. Letting
    // virtual-core also apply anchor corrections for offscreen measurements
    // produced a correction → bottom snap race that looked like shaking.
    if (pinToBottomRef.current || stickyBottomRef.current) return false;
    if (item.index === allItemsCountRef.current - 1) {
      return false;
    }
    // Replicate the library default. getScrollOffset/scrollAdjustments are
    // private in the types but present at runtime (the default condition is
    // `item.start < getScrollOffset() + scrollAdjustments`).
    const inst = instance as unknown as {
      getScrollOffset?: () => number;
      scrollAdjustments?: number;
    };
    const offset = inst.getScrollOffset ? inst.getScrollOffset() : (instance.scrollOffset ?? 0);
    const willAdjust = item.start < offset + (inst.scrollAdjustments ?? 0);
    if (willAdjust) {
      // Account the ACTUAL scrollTop movement this task's corrections apply
      // (virtual-core writes scrollTop synchronously inside resizeItem).
      const container = scrollContainerRef.current;
      if (container && correctionTaskBaseRef.current === null) {
        correctionTaskBaseRef.current = container.scrollTop;
        queueMicrotask(() => {
          const base = correctionTaskBaseRef.current;
          correctionTaskBaseRef.current = null;
          const el = scrollContainerRef.current;
          if (base === null || !el) return;
          correctionsRef.current += el.scrollTop - base;
        });
      }
    }
    return willAdjust;
  };

  // Release all DOM element references held by the virtualizer's internal
  // elementsCache when this component unmounts.  @tanstack/virtual-core's
  // cleanup() disconnects the ResizeObserver but does NOT clear elementsCache,
  // so detached DOM nodes accumulate until the virtualizer is GC'd.
  useEffect(() => {
    return () => {
      virtualizer.elementsCache.clear();
    };
  }, [virtualizer]);

  // Start the warm-up walk once the post-switch pin has released and there is
  // content. One pass per mount (per agent, thanks to key={agentId}); prepends
  // re-arm it below.
  useEffect(() => {
    if (!ENABLE_MEASUREMENT_WARMUP) return;
    if (pinToBottom || isLoadingHistory) return;
    if (allItems.length === 0) return;
    if (warmupDoneRef.current || warmupFront !== null) return;
    setWarmupFront(allItems.length);
  }, [pinToBottom, isLoadingHistory, allItems.length, warmupFront]);

  // Advance only during real browser idle time. The previous two-rAF loop ran
  // at normal priority while users rapidly switched/scrolled agents; each
  // slice could parse rich markdown and turn a click into a long task.
  useEffect(() => {
    if (warmupFront === null) return;
    if (pinToBottom) return; // paused; resumes when the pin releases
    let cancelled = false;
    let rafId: number | null = null;
    let idleId: number | null = null;
    let timeoutId: number | null = null;

    const advance = () => {
      if (cancelled) return;
      if (virtualizer.isScrolling) {
        rafId = requestAnimationFrame(scheduleIdleAdvance);
        return;
      }
      warmupHasStartedRef.current = true;
      const floor = Math.max(0, allItemsCountRef.current - WARMUP_MAX_ROWS);
      if (warmupFront <= floor) {
        warmupDoneRef.current = true;
        measurementCache.warmupComplete = true;
        React.startTransition(() => setWarmupFront(null));
        return;
      }
      const nextFront = Math.max(floor, warmupFront - WARMUP_SLICE);
      React.startTransition(() => setWarmupFront(nextFront));
    };

    function scheduleIdleAdvance() {
      if (cancelled) return;
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(advance, { timeout: 750 });
      } else {
        // Safari/WebView fallback: retain the old two-frame measurement gap.
        rafId = requestAnimationFrame(() => {
          rafId = requestAnimationFrame(advance);
        });
      }
    }

    // Let the visible conversation settle before beginning speculative work.
    // Subsequent slices use idle callbacks immediately.
    const delay = warmupHasStartedRef.current ? 0 : 250;
    timeoutId = window.setTimeout(scheduleIdleAdvance, delay);

    return () => {
      cancelled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [measurementCache, warmupFront, pinToBottom, virtualizer]);

  // A history prepend (load-more) shifts every index up and introduces a page
  // of unmeasured rows exactly where the user is about to scroll — re-arm the
  // walk over them. Detected by the first item's key changing while the count
  // grew (appends keep the first key; same-size refreshes keep the count).
  // Size caches are keyed by item key, so surviving rows stay warm through
  // the index shift.
  const firstItemKey = allKeys.length > 0 ? allKeys[0] : null;
  const prevFirstKeyRef = useRef<string | null>(null);
  const prevCountForPrependRef = useRef(0);
  useEffect(() => {
    if (!ENABLE_MEASUREMENT_WARMUP) return;
    const prevKey = prevFirstKeyRef.current;
    const prevCount = prevCountForPrependRef.current;
    prevFirstKeyRef.current = firstItemKey;
    prevCountForPrependRef.current = allItems.length;
    if (prevKey === null || firstItemKey === null) return;
    if (firstItemKey === prevKey || allItems.length <= prevCount) return;
    const delta = allItems.length - prevCount;
    warmupDoneRef.current = false;
    measurementCache.warmupComplete = false;
    setWarmupFront((front) => (front === null ? delta : front + delta));
  }, [firstItemKey, allItems.length, measurementCache]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const count = allItemsCountRef.current;
    if (count <= 0) return;
    // Use both the virtualizer and direct scrollTop for robustness.
    virtualizer.scrollToIndex(count - 1, { align: 'end' });
    container.scrollTop = container.scrollHeight;
  }, [scrollContainerRef, virtualizer]);

  // Jump to a user prompt from the overview rail. Scrolling lives HERE (this
  // component is the single scroll writer); the parent only receives the index
  // to sync the message-nav selection/highlight. A second pass one frame later
  // re-targets after never-measured rows above settle from estimates to real
  // heights — without it a long jump can land a few rows off.
  const handlePromptMarkerJump = useCallback((marker: PromptMarker) => {
    isProgrammaticScrollRef.current = true;
    virtualizer.scrollToIndex(marker.index, { align: 'center' });
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(marker.index, { align: 'center' });
      requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false;
      });
    });
    onPromptMarkerJump?.(marker.index);
  }, [virtualizer, onPromptMarkerJump]);

  // Which marker (position in promptMarkers) is "current" — drives the rail's
  // blue dot. Held in STATE and refreshed from scroll events (plus content
  // growth below): a render-time read went stale at the bottom, because scroll
  // events that don't change the virtual range don't re-render this component.
  //
  // Selection uses a READING LINE that sweeps the viewport with scroll
  // progress: at the top of the conversation it sits at the viewport's top
  // edge, at the bottom at its bottom edge. A fixed midline could never reach
  // prompts packed inside the first/last half-viewport (their dots never lit),
  // and clustered prompts got skipped. The sweep crosses every row start
  // exactly once across the full scroll range, so every dot gets its band.
  const [activeMarkerPos, setActiveMarkerPos] = useState(-1);
  const promptMarkersRef = useRef(promptMarkers);
  promptMarkersRef.current = promptMarkers;
  const updateActiveMarker = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const markers = promptMarkersRef.current;
    if (markers.length === 0) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const maxScroll = Math.max(0, scrollHeight - clientHeight);
    let pos = -1;
    if (maxScroll - scrollTop <= 8) {
      // At the very bottom the newest prompt is current, no matter what.
      pos = markers.length - 1;
    } else {
      const progress = maxScroll > 0 ? Math.min(1, Math.max(0, scrollTop / maxScroll)) : 1;
      const readingLine = scrollTop + progress * clientHeight;
      // Raw measured starts (NOT getOffsetForIndex, which clamps to the max
      // scroll offset and would collapse every prompt inside the last
      // viewport-height of content onto one value, re-introducing the skip).
      for (let i = 0; i < markers.length; i++) {
        const start = virtualizer.measurementsCache[markers[i].index]?.start ?? Number.POSITIVE_INFINITY;
        if (start <= readingLine) pos = i;
        else break;
      }
    }
    setActiveMarkerPos((prev) => (prev === pos ? prev : pos));
  }, [scrollContainerRef, virtualizer]);

  // Pin-to-bottom mode (used for agent switching / initial load).
  // Immediate synchronous scroll before first paint.
  useLayoutEffect(() => {
    if (!pinToBottom) return;
    if (isLoadingHistory) return;
    if (allItems.length === 0) return;
    isProgrammaticScrollRef.current = true;
    agentSwitchGraceRef.current = true;
    scrollToBottom();
  }, [pinToBottom, isLoadingHistory, allItems.length, scrollToBottom]);

  // Continuous scroll enforcement while pinned — the virtualizer re-measures
  // items across multiple frames which changes scrollHeight.  A one-shot
  // scrollToBottom isn't enough; keep calling virtualizer.scrollToIndex +
  // raw scrollTop on every frame so we track measurement updates.
  useEffect(() => {
    if (!pinToBottom) {
      isProgrammaticScrollRef.current = false;
      agentSwitchGraceRef.current = false;
      return;
    }
    if (isLoadingHistory) return;
    if (allItems.length === 0) return;

    // Only WRITE when the content grew or the view drifted off the bottom.
    // The pin re-arms on every background history refresh while the viewed
    // agent streams, so this loop is effectively always on for a working
    // agent — an unconditional scrollTop write per frame fired a scroll event
    // → virtualizer reconcile → style recalc + repaint at 60 fps even when
    // nothing had changed. Reads on a clean layout are cheap.
    // Checked EVERY frame: the check is reads only (a forced layout only when
    // something dirtied it — and then the frame was going to lay out anyway);
    // the write is what's conditional. A throttled check (every 3rd frame)
    // let the just-mounted rows of an agent switch settle 1–2 frames off the
    // bottom before the correction landed — visible as a flicker.
    let rafId: number;
    let lastScrollHeight = -1;
    const enforce = () => {
      const container = scrollContainerRef.current;
      if (container) {
        const { scrollTop, scrollHeight, clientHeight } = container;
        const atBottom = scrollHeight - scrollTop - clientHeight <= 1;
        if (scrollHeight !== lastScrollHeight || !atBottom) {
          lastScrollHeight = scrollHeight;
          isProgrammaticScrollRef.current = true;
          scrollToBottom();
        }
      }
      rafId = requestAnimationFrame(enforce);
    };
    rafId = requestAnimationFrame(enforce);
    return () => cancelAnimationFrame(rafId);
  }, [pinToBottom, isLoadingHistory, allItems.length, scrollToBottom, scrollContainerRef]);

  // Auto-scroll to bottom when new items arrive.
  // useLayoutEffect, not useEffect: a scroll correction applied AFTER the
  // browser paints means the frame with the uncorrected offset is shown first,
  // and the eye reads that one-frame offset as the content jumping. Running
  // pre-paint lands the DOM change and its compensation in the same frame.
  useLayoutEffect(() => {
    if (!shouldAutoScroll) return;
    if (allItems.length === 0) return;
    if (allItems.length <= prevItemCountRef.current) {
      prevItemCountRef.current = allItems.length;
      return;
    }

    prevItemCountRef.current = allItems.length;

    // Write-time position gate: never move the viewport unless it was at the
    // very bottom. New rows while the user reads just grow the scrollbar.
    if (!stickyBottomRef.current) return;

    // Normal streaming case: scroll to bottom once when new content arrives.
    isProgrammaticScrollRef.current = true;
    scrollToBottom();
    requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
    });
  }, [allItems.length, shouldAutoScroll, scrollToBottom]);

  // Auto-scroll when virtualizer remeasures items and total content height grows.
  // The item-count effect above only fires when new items are added, but the
  // virtualizer can also grow the content when it measures actual heights that
  // exceed the estimates (e.g. during streaming or after initial render).
  // Without this, the scroll "jumps up" because the content grows under the viewport
  // but nothing pushes scrollTop to follow.
  // Pre-paint for the same reason as the item-count effect above — and it
  // matters most here: on a cold open every row measures for the first time, so
  // this fires dozens of times in the first second and each post-paint
  // correction was one visible jump of the conversation.
  const totalSize = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    const prev = prevTotalSizeRef.current;
    prevTotalSizeRef.current = totalSize;

    if (!shouldAutoScroll) return;
    if (pinToBottom) return; // pinToBottom has its own RAF loop
    if (totalSize <= prev) return; // only care about growth
    if (totalSize - prev < 2) return; // ignore sub-pixel changes
    // Write-time position gate — see stickyBottomRef.
    if (!stickyBottomRef.current) return;

    isProgrammaticScrollRef.current = true;
    scrollToBottom();
    requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
    });
  }, [totalSize, shouldAutoScroll, pinToBottom, scrollToBottom]);

  // Detect scroll to top for loading more history
  const lastScrollTopRef = useRef(0);
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const prevScrollTop = lastScrollTopRef.current;
    lastScrollTopRef.current = scrollTop;

    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    // "Position tells the truth" means CORRECTION-ADJUSTED position: subtract
    // the anchor-correction movement applied since the last event so a
    // correction coalesced with growth below can't impersonate the user.
    const correctionDelta = correctionsRef.current - correctionsBaselineRef.current;
    correctionsBaselineRef.current = correctionsRef.current;
    const scrolledUp = scrollTop - prevScrollTop - correctionDelta < -1;

    // Sticky-bottom write gate: latch at the very bottom, unlatch ONLY on a
    // genuine user up-scroll — see stickyBottomRef.
    if (distanceFromBottom <= 8) {
      stickyBottomRef.current = true;
    } else if (scrolledUp && distanceFromBottom > 4) {
      stickyBottomRef.current = false;
    }

    // Cancel pin mode on a genuine user scroll so we don't fight their finger.
    // isProgrammaticScrollRef cannot make that call here: the pin enforce loop
    // holds it true for the entire pin, so every scroll event during pin —
    // including the user's — used to be classified programmatic and the loop
    // kept dragging them back to the bottom (worst on mobile, where slow row
    // measurement keeps the pin alive longest). Position tells the truth
    // instead: every programmatic pin write lands AT the bottom (shrink-clamps
    // included) and content growth never decreases scrollTop, so "moved up AND
    // meaningfully above the bottom" can only be the user.
    if (pinToBottom && scrolledUp && distanceFromBottom > 4) {
      onPinCancel?.();
      onUserScroll?.();
    }

    // Disable auto-scroll only on a genuine UPWARD user scroll (scrollTop
    // decreased while meaningfully above the bottom). When new content grows
    // under the viewport, distanceFromBottom grows without scrollTop
    // decreasing — that must NOT count as "user scrolled up". Programmatic
    // writes always land AT the bottom (shrink-clamps included), so >4px is
    // enough to identify the user; the old >150px dead zone made escaping a
    // word-stream impossible (each ~100px wheel tick was yanked back to the
    // bottom by the next chunk before a second tick could land).
    if (scrolledUp && distanceFromBottom > 4 && !isProgrammaticScrollRef.current && !agentSwitchGraceRef.current && onUserScroll) {
      onUserScroll();
    }

    // Check if scrolled to top for loading more
    if (scrollTop < 200 && hasMore && !isLoadingMore && onScrollTopReached) {
      onScrollTopReached();
    }

    // Keep the prompt rail's "current prompt" dot in sync with the viewport.
    updateActiveMarker();
  }, [hasMore, isLoadingMore, onScrollTopReached, onUserScroll, scrollContainerRef, pinToBottom, onPinCancel, updateActiveMarker]);

  // Attach scroll listener
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll, scrollContainerRef]);

  // Fix: sync virtualizer scroll offset after container resize.
  // The virtualizer tracks scroll offset only via scroll events. After a CSS grid
  // reflow (e.g. filter change alters agent count), the browser may clamp scrollTop
  // without firing a scroll event, leaving the virtualizer with a stale offset that
  // produces zero visible items. Dispatching a scroll event forces the re-read.
  //
  // Bottom-follow on container shrink: chrome mounting/animating AROUND the
  // chat right after open (GuakeTaskBanner appearing for a working agent, dock
  // strip roster changes, the WAAPI-animated bottom-panel shell restoring a
  // persisted height) SHRINKS the container after the pin settles. A shrink
  // grows distanceFromBottom with NO content growth, so no follow effect fires
  // and the chat parks exactly that height above the bottom. While the sticky
  // gate is latched, re-anchor to the bottom on any container HEIGHT change
  // (width churn must not add scroll writes); a scrolled-up reader is
  // untouched. This also re-anchors a display:none→visible chat.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let lastHeight = container.clientHeight;
    const observer = new ResizeObserver(() => {
      const height = container.clientHeight;
      const heightChanged = height !== lastHeight;
      lastHeight = height;
      isProgrammaticScrollRef.current = true;
      if (heightChanged && stickyBottomRef.current) {
        container.scrollTop = container.scrollHeight;
      }
      container.dispatchEvent(new Event('scroll'));
      requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false;
      });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [scrollContainerRef]);

  // Scroll to selected message when navigating
  useEffect(() => {
    if (selectedMessageIndex !== null && selectedMessageIndex >= 0 && selectedMessageIndex < allItems.length) {
      isProgrammaticScrollRef.current = true;
      virtualizer.scrollToIndex(selectedMessageIndex, { align: 'center' });
      const timer = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [selectedMessageIndex, virtualizer, allItems.length]);

  // Scroll to active search match. The search results panel overlays the top
  // of the output, so after centring we nudge the row down if it landed behind
  // the panel — keeping the clicked match visible on screen.
  useEffect(() => {
    if (searchActiveIndex !== null && searchActiveIndex !== undefined && searchActiveIndex >= 0 && searchActiveIndex < allItems.length) {
      isProgrammaticScrollRef.current = true;
      virtualizer.scrollToIndex(searchActiveIndex, { align: 'center' });

      const raf = requestAnimationFrame(() => {
        const container = scrollContainerRef.current;
        if (container && searchPanelHeight > 0) {
          const row = container.querySelector<HTMLElement>(`[data-index="${searchActiveIndex}"]`);
          if (row) {
            const rowTop = row.getBoundingClientRect().top - container.getBoundingClientRect().top;
            const minVisibleTop = searchPanelHeight + 12;
            if (rowTop < minVisibleTop) {
              // Scroll up so the row clears the panel (clamped at 0 by the browser).
              container.scrollTop -= minVisibleTop - rowTop;
              // Keep the virtualizer window in sync after a manual scrollTop write.
              container.dispatchEvent(new Event('scroll'));
            }
          }
        }
      });

      const timer = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 120);
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
      };
    }
  }, [searchActiveIndex, virtualizer, allItems.length, searchPanelHeight, scrollContainerRef]);

  // Cover the paths that never fire a scroll event: initial mount of a
  // conversation shorter than the viewport, and content growing/measuring
  // at the bottom while the view is pinned there.
  useEffect(() => {
    updateActiveMarker();
  }, [updateActiveMarker, totalSize, allItems.length]);

  const virtualItems = virtualizer.getVirtualItems();
  const simpleView = viewMode !== 'advanced';

  return (
    <div
      ref={handleVirtualContentMount}
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        width: '100%',
        position: 'relative',
      }}
    >
      {promptMarkers.length >= 2 && (
        <div className="prompt-markers-anchor">
          <PromptMarkersRail
            markers={promptMarkers}
            activePos={activeMarkerPos}
            scrollContainerRef={scrollContainerRef}
            onJump={handlePromptMarkerJump}
          />
        </div>
      )}
      <div className="bg-tasks-anchor">
        <BackgroundTasksRail agentId={agentId} scrollContainerRef={scrollContainerRef} />
      </div>
      {virtualItems.map((virtualRow) => {
        const tagged = allItems[virtualRow.index];
        if (!tagged) return null;
        const isHistory = tagged.kind === 'history';

        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <VirtualRow
              item={tagged.item}
              isHistory={isHistory}
              agentId={agentId}
              execTasks={execTasks}
              testRunHandles={testRunHandles}
              httpRunHandles={httpRunHandles}
              subagents={subagents}
              simpleView={simpleView}
              isSelected={isMessageSelected(virtualRow.index)}
              isSearchActive={searchActiveIndex != null && virtualRow.index === searchActiveIndex}
              messageIndex={virtualRow.index}
              searchHiddenNote={searchActiveIndex != null && virtualRow.index === searchActiveIndex ? searchHiddenNote : undefined}
              onImageClick={onImageClick}
              onFileClick={onFileClick}
              onBashClick={onBashClick}
              onViewMarkdown={onViewMarkdown}
            />
          </div>
        );
      })}
    </div>
  );
});

export default VirtualizedOutputList;
