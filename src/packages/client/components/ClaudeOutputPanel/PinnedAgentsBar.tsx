import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { store, useAgents, usePinnedAgentIds, useCustomAgentClassesArray, useAreas, useViewMode, useAgentsWithUnseenOutput } from '../../store';
import { AgentIcon } from '../AgentIcon';
import { STORAGE_KEYS, getStorage, getStorageString, setStorageString, removeStorage } from '../../utils/storage';
import { isAgentVisibleInWorkspace, useWorkspaceFilter } from '../WorkspaceSwitcher';
import { prefetchAgentHistory } from './useHistoryLoader';
import { useDockRoster, useWorkRecency } from './useDockRoster';
import { useDockFlip } from './useDockFlip';
import type { Agent } from '../../../shared/types';

/**
 * Past this many pinned agents the chips collapse to icon-only miniatures (no
 * name) to save horizontal space. Configurable + persisted (see
 * readMiniatureThreshold).
 *
 * Defaults to 0 — i.e. always icon-only. Names are what made the strip
 * saturating: they cost ~5x an icon's width for information the avatar and the
 * tooltip already carry. Raise it in localStorage to bring them back below N pins.
 */
const DEFAULT_PINNED_MINIATURE_THRESHOLD = 0;
function readMiniatureThreshold(): number {
  const v = getStorage<number>(STORAGE_KEYS.PINNED_MINIATURE_THRESHOLD, DEFAULT_PINNED_MINIATURE_THRESHOLD);
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : DEFAULT_PINNED_MINIATURE_THRESHOLD;
}

/**
 * "Active only" keeps a pin whose last activity is within this window. Long
 * enough to still cover the agent you were reading a few minutes ago, short
 * enough that a 14-pin strip actually collapses to what is live.
 */
const PINNED_ACTIVE_WINDOW_MS = 10 * 60 * 1000;

const NO_AGENTS: Agent[] = [];

/**
 * The bar's single control cycles through these on each click: every pin flat →
 * grouped by status → grouped by area → only the working / recently-active
 * pins. One button carries all the filter features. Persisted in localStorage.
 */
type BarMode = 'none' | 'status' | 'area' | 'active';
const BAR_MODES: BarMode[] = ['none', 'status', 'area', 'active'];
const MODE_LABEL: Record<BarMode, string> = { none: 'All', status: 'Status', area: 'Area', active: 'Active' };

/** Coarse status buckets for "group by status". The live AgentStatus union is
 * `idle | working | waiting | waiting_permission | error | offline | orphaned`.
 * Anything actively running (or blocked awaiting permission) is "Working"; a
 * clean stopped agent is "Idle"; error/offline/orphaned fall to "Offline". */
type StatusBucket = 'working' | 'idle' | 'offline';
const STATUS_RANK: Record<StatusBucket, number> = { working: 0, idle: 1, offline: 2 };
const STATUS_LABEL: Record<StatusBucket, string> = { working: 'Working', idle: 'Idle', offline: 'Offline' };
function statusBucket(a: Agent): StatusBucket {
  switch (a.status) {
    case 'working':
    case 'waiting':
    case 'waiting_permission':
      return 'working';
    case 'idle':
      return 'idle';
    default: // error, offline, orphaned
      return 'offline';
  }
}

interface PinnedAgentsBarProps {
  /** The agent currently shown in this pane — its chip is ringed. */
  activeAgentId?: string;
  /**
   * Append the agents that are working / recently active but NOT pinned. This is
   * the `composer` agent-dock position (see agentDockPosition.ts); when it is
   * off, the row is purely your pins and the dock lives elsewhere.
   */
  includeActiveAgents?: boolean;
}

/** One chip in the row. `pinned` drives the × badge, the border and dragging. */
interface RowEntry {
  agent: Agent;
  pinned: boolean;
}

/** One rendered section: `label === null` means flat (chips inline, no header). */
interface ChipGroup {
  key: string;
  label: string | null;
  color: string | null;
  entries: RowEntry[];
}

/**
 * Quick-select strip above the terminal input: one row, each agent exactly once.
 *
 * Your pins come first, in the order you dragged them, followed (when
 * `includeActiveAgents` is on) by the agents that are working or recently active
 * without being pinned. Click a chip to switch to that agent; right-click to
 * pin/unpin it. Pins persist per-browser (see store.togglePinnedAgent).
 *
 * A single control leads the row and cycles the view on each click: All (flat)
 * → by Status → by Area (small label+count header per section) → Active (only
 * the working / recently-active pins).
 *
 * The load-bearing rule: POSITION MEANS YOUR MANUAL ORDER, NEVER RECENCY. Status
 * is painted onto the chip (working pulse, unread dot, open ring) and never
 * sorts it — an agent's `lastActivity` is restamped by any updateAgent,
 * including ones provoked by merely opening it, so recency-sorting made chips
 * move under the cursor. Grouping may MOVE a chip between sections when its
 * status/area genuinely changes (that is what grouping means), but within a
 * section the order is always pin order, and unpinned chips hold their slots
 * (see dockRoster.ts).
 */
export const PinnedAgentsBar = memo(function PinnedAgentsBar({ activeAgentId, includeActiveAgents = false }: PinnedAgentsBarProps) {
  const pinnedIds = usePinnedAgentIds();
  const agents = useAgents();
  const customClasses = useCustomAgentClassesArray();
  const areas = useAreas();
  const viewMode = useViewMode();
  const [activeWorkspace] = useWorkspaceFilter();
  // Agents whose finished work the user hasn't opened yet (same source as the
  // AgentBar triangle and the tracking-board "!" bubble). The store adds an id
  // when an agent goes working→idle unviewed and clears it on select/open, so
  // the badge appears and disappears with no extra bookkeeping here.
  const unseenAgents = useAgentsWithUnseenOutput();

  const [barMode, setBarMode] = useState<BarMode>(() => {
    // Migration: "active only" used to be a separate toggle on its own key —
    // fold it into the mode cycle once; only PINNED_GROUP_MODE is written now.
    if (getStorage<boolean>(STORAGE_KEYS.PINNED_ACTIVE_ONLY, false) === true) return 'active';
    const saved = getStorageString(STORAGE_KEYS.PINNED_GROUP_MODE, 'none');
    return (BAR_MODES as string[]).includes(saved) ? (saved as BarMode) : 'none';
  });
  const cycleBarMode = useCallback(() => {
    setBarMode((prev) => {
      const next = BAR_MODES[(BAR_MODES.indexOf(prev) + 1) % BAR_MODES.length];
      setStorageString(STORAGE_KEYS.PINNED_GROUP_MODE, next);
      removeStorage(STORAGE_KEYS.PINNED_ACTIVE_ONLY);
      return next;
    });
  }, []);
  const activeOnly = barMode === 'active';
  const groupMode = barMode === 'status' || barMode === 'area' ? barMode : 'none';

  // Configurable miniature threshold (localStorage, default 0 = always icons).
  // Re-read on the cross-tab `storage` event so a change reflects without a reload.
  const [miniatureThreshold, setMiniatureThreshold] = useState<number>(readMiniatureThreshold);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.PINNED_MINIATURE_THRESHOLD) setMiniatureThreshold(readMiniatureThreshold());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // ── The row ──
  // Click-immune recency over ALL agents (not just the row): the same tracker
  // feeds the "active only" filter and the unpinned-actives roster, and it
  // survives pin/unpin (an agent moving between the two sides keeps its value).
  const allAgentsArray = useMemo(() => Array.from(agents.values()), [agents]);
  // Scoped: AgentTerminalPane is keyed by agent id, so every selection remounts
  // this bar — without the scope, recency/slots/holds would reset on each click
  // and the row would reshuffle (the exact bug this design exists to prevent).
  const workRecency = useWorkRecency(allAgentsArray, 'pinned-bar');

  // Resolve in pin order; skip ids whose agent no longer exists.
  const allPinned = useMemo(
    () => pinnedIds.map((id) => agents.get(id)).filter((a): a is Agent => !!a),
    [pinnedIds, agents],
  );

  /**
   * "Active only" narrows the pins to exactly those working or recently active —
   * nothing else survives, not even the agent currently open. "Recently active"
   * is judged on workRecency, NOT lastActivity: the server restamps
   * lastActivity on selection-provoked updates, so keying on it made every
   * click resurrect the clicked pin into the filtered row. Deliberately NOT on
   * a timer: it re-evaluates on the agent updates that stream in anyway, so a
   * pin ages out on the next tick.
   */
  const pinned = useMemo(() => {
    if (!activeOnly) return allPinned;
    const now = Date.now();
    return allPinned.filter((agent) => statusBucket(agent) === 'working' || now - (workRecency.get(agent.id) ?? 0) < PINNED_ACTIVE_WINDOW_MS);
  }, [allPinned, activeOnly, workRecency]);

  // Candidates for the trailing section: never a pin (each agent appears once),
  // and never outside the active workspace.
  const unpinnedCandidates = useMemo(() => {
    if (!includeActiveAgents) return NO_AGENTS;
    const pinnedSet = new Set(pinnedIds);
    return Array.from(agents.values()).filter((agent) => {
      if (pinnedSet.has(agent.id)) return false;
      if (!activeWorkspace) return true;
      return isAgentVisibleInWorkspace(store.getAreaForAgent(agent.id)?.id ?? null);
    });
  }, [includeActiveAgents, pinnedIds, agents, activeWorkspace]);

  const { entries: dockEntries, exitingIds } = useDockRoster(unpinnedCandidates, { recency: workRecency, scope: 'pinned-bar' });

  // Build the sections. Flat mode is a single header-less group. Grouped modes
  // bucket the PINS by live status/area; within every bucket the order is pin
  // order — deliberately NOT re-sorted by lastActivity (that re-sort was the
  // chips-move-under-the-cursor bug). The unpinned actives always form their own
  // trailing "Active" section, so grouping and the dock compose without
  // duplicating anyone.
  const groups = useMemo<ChipGroup[]>(() => {
    const unpinnedEntries = dockEntries.map(({ agent }): RowEntry => ({ agent, pinned: false }));
    const pinnedEntries = pinned.map((agent): RowEntry => ({ agent, pinned: true }));

    if (groupMode === 'none') {
      return [{ key: '__flat__', label: null, color: null, entries: [...pinnedEntries, ...unpinnedEntries] }];
    }

    const byKey = new Map<string, ChipGroup>();
    const push = (key: string, label: string, color: string | null, entry: RowEntry) => {
      let g = byKey.get(key);
      if (!g) {
        g = { key, label, color, entries: [] };
        byKey.set(key, g);
      }
      g.entries.push(entry);
    };
    for (const entry of pinnedEntries) {
      if (groupMode === 'status') {
        const b = statusBucket(entry.agent);
        push(b, STATUS_LABEL[b], null, entry);
      } else {
        const area = store.getAreaForAgent(entry.agent.id);
        if (area) push(`area:${area.id}`, area.name, area.color ?? null, entry);
        else push('noarea', 'No area', null, entry);
      }
    }

    const list = Array.from(byKey.values());
    if (groupMode === 'status') {
      list.sort((a, b) => (STATUS_RANK[a.key as StatusBucket] ?? 9) - (STATUS_RANK[b.key as StatusBucket] ?? 9));
    } else {
      // Alphabetical by area name; the catch-all "No area" always trails.
      list.sort((a, b) => {
        if (a.key === 'noarea') return 1;
        if (b.key === 'noarea') return -1;
        return (a.label ?? '').localeCompare(b.label ?? '', undefined, { sensitivity: 'base' });
      });
    }

    if (unpinnedEntries.length > 0) {
      list.push({ key: '__active__', label: 'Active', color: null, entries: unpinnedEntries });
    }
    return list;
    // `areas` dep keeps the by-area headers (name + color) fresh when an area is
    // renamed/recolored/moved without the pin set itself changing.
  }, [groupMode, pinned, dockEntries, areas]);

  const row = useMemo(() => groups.flatMap((g) => g.entries), [groups]);

  // Chips glide to their new slot when one leaves, changes section, or you drop
  // a drag — rather than teleporting. Keyed on the row's identity so it never
  // measures for nothing.
  const rowSignature = useMemo(() => row.map((entry) => entry.agent.id).join(','), [row]);
  const { registerItem } = useDockFlip(rowSignature, exitingIds);

  // In flat mode a plain gap separates the pins from the unpinned actives; in
  // grouped modes the "Active" section header does that job.
  const firstUnpinnedId = useMemo(() => {
    if (groupMode !== 'none') return null;
    const idx = row.findIndex((entry) => !entry.pinned);
    return idx > 0 ? row[idx].agent.id : null;
  }, [groupMode, row]);

  // Resolve each chip's area color (by spatial position, like the board).
  // `areas` is a dep so the tint re-resolves when areas move/recolor.
  const areaColorById = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const { agent } of row) m.set(agent.id, store.getAreaForAgent(agent.id)?.color ?? null);
    return m;
  }, [areas, row]);

  const handleSelect = useCallback((agent: Agent) => {
    store.setLastSelectionViaDirectClick(true);
    store.selectAgent(agent.id);
    // FlatView drives its own inline chat column from the same selection; opening
    // the Guake terminal here would stack a SECOND chat overlay on top of it
    // (mirrors the `!isFlat` guard in store.openTerminalOnMobile).
    if (viewMode !== 'flat') store.setTerminalOpen(true);
  }, [viewMode]);

  /** Right-click / × — pins an unpinned chip, unpins a pinned one. */
  const handleTogglePin = useCallback((e: React.MouseEvent, agentId: string) => {
    e.preventDefault();
    e.stopPropagation();
    // On mobile the chip is icon-only with no × — a tap/long-press must never
    // unpin; removal is only via the input-area pin button.
    if (window.matchMedia('(max-width: 768px)').matches) return;
    store.togglePinnedAgent(agentId);
  }, []);

  // Publish the bar's live height to the enclosing terminal as a CSS var so the
  // mobile chat can reserve exactly enough bottom scroll clearance to never sit
  // under this floating pill — regardless of miniature / grouping / row count.
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const target = (el.closest('.guake-terminal') as HTMLElement | null) ?? document.documentElement;
    const apply = () => target.style.setProperty('--pinned-agents-bar-height', `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      target.style.removeProperty('--pinned-agents-bar-height');
    };
  }, []);

  // ── drag-to-reorder (pins only — an unpinned chip has no manual order) ──
  // Reordering edits the global pin order, so it works the same in grouped
  // modes. `dragId` (ref) drives the reorder math without stale-closure risk;
  // the two states only exist to paint the dimmed source and the insertion
  // indicator.
  const dragId = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, agentId: string) => {
    dragId.current = agentId;
    setDraggingId(agentId);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', agentId); // some browsers need a payload
    } catch {
      /* ignore */
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, agentId: string) => {
    if (!dragId.current || dragId.current === agentId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = e.currentTarget.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    setDropTarget((prev) => (prev && prev.id === agentId && prev.after === after ? prev : { id: agentId, after }));
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, agentId: string) => {
    e.preventDefault();
    const src = dragId.current;
    if (src && src !== agentId) {
      const r = e.currentTarget.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      store.reorderPinnedAgent(src, agentId, after);
    }
    dragId.current = null;
    setDraggingId(null);
    setDropTarget(null);
  }, []);

  const handleDragEnd = useCallback(() => {
    dragId.current = null;
    setDraggingId(null);
    setDropTarget(null);
  }, []);

  const renderChip = useCallback(({ agent, pinned: isPinned }: RowEntry) => {
    const working = statusBucket(agent) === 'working';
    const isActive = agent.id === activeAgentId;
    const areaColor = areaColorById.get(agent.id) ?? null;
    const hasUnread = unseenAgents.has(agent.id);
    const isBoss = agent.class === 'boss' || !!agent.isBoss;
    return (
      <button
        key={agent.id}
        ref={registerItem(agent.id)}
        type="button"
        draggable={isPinned}
        className={`pinned-agent${isActive ? ' active' : ''}${working ? ' working' : ''}${isBoss ? ' is-boss' : ''}${areaColor ? ' has-area' : ''}${
          hasUnread ? ' has-unread' : ''
        }${isPinned ? '' : ' pinned-agent--unpinned'}${agent.id === firstUnpinnedId ? ' starts-active-group' : ''}${
          exitingIds.has(agent.id) ? ' exiting' : ''
        }${draggingId === agent.id ? ' dragging' : ''}${dropTarget && dropTarget.id === agent.id ? (dropTarget.after ? ' drop-after' : ' drop-before') : ''}`}
        title={`${agent.name} — ${agent.status}${hasUnread ? ' — new output' : ''}${isPinned ? '' : ' — not pinned (right-click to pin)'}`}
        // Keep an accessible name even in miniature mode, where the visible
        // name label is hidden via CSS.
        aria-label={`${agent.name}${hasUnread ? ', new output' : ''}${isPinned ? '' : ', not pinned'}`}
        style={areaColor ? ({ ['--area-color']: areaColor } as React.CSSProperties) : undefined}
        onClick={() => handleSelect(agent)}
        // Warm the history cache during hover so the switch on click paints
        // the conversation in its first frame (no-op when already cached).
        onMouseEnter={() => prefetchAgentHistory(agent.id)}
        onContextMenu={(e) => handleTogglePin(e, agent.id)}
        onDragStart={isPinned ? (e) => handleDragStart(e, agent.id) : undefined}
        onDragOver={isPinned ? (e) => handleDragOver(e, agent.id) : undefined}
        onDrop={isPinned ? (e) => handleDrop(e, agent.id) : undefined}
        onDragEnd={isPinned ? handleDragEnd : undefined}
      >
        <span className="pinned-agent-av">
          <AgentIcon classId={agent.class} size="100%" customClasses={customClasses} />
        </span>
        {hasUnread && <span className="pinned-agent-notif" aria-hidden="true" />}
        <span className="pinned-agent-name">{agent.name}</span>
        {isPinned && (
          <span
            className="pinned-agent-unpin"
            role="button"
            aria-label="Unpin agent"
            title="Unpin"
            onClick={(e) => handleTogglePin(e, agent.id)}
          >
            ×
          </span>
        )}
      </button>
    );
  }, [activeAgentId, areaColorById, unseenAgents, firstUnpinnedId, exitingIds, draggingId, dropTarget, customClasses, registerItem, handleSelect, handleTogglePin, handleDragStart, handleDragOver, handleDrop, handleDragEnd]);

  // Hide only when nothing COULD render in any mode. If the current mode merely
  // filtered everything out, the bar must survive — it hosts the only button
  // that cycles back out of that mode.
  if (allPinned.length === 0 && dockEntries.length === 0) return null;

  // Icon-only miniatures past the threshold. Judged on the TOTAL pin count as
  // well as the row, so the "active only" filter can never WIDEN the bar by
  // dropping the visible count back under the threshold.
  const miniature = allPinned.length > miniatureThreshold || row.length > miniatureThreshold;

  return (
    <div ref={barRef} className={`pinned-agents-bar${miniature ? ' miniature' : ''}`} role="toolbar" aria-label="Agents">
      <button
        type="button"
        className={`pinned-mode-toggle${activeOnly ? ' on' : ''}`}
        title={activeOnly
          ? `Active: showing ${pinned.length}/${allPinned.length} pins (working or active in the last ${PINNED_ACTIVE_WINDOW_MS / 60000}min) — click for All`
          : `View: ${MODE_LABEL[barMode]} — click cycles All → Status → Area → Active`}
        aria-label={`View mode: ${MODE_LABEL[barMode]}. Click to change.`}
        onClick={cycleBarMode}
      >
        {MODE_LABEL[barMode]}
      </button>
      {groups.map((g) => (
        g.label === null
          ? <React.Fragment key={g.key}>{g.entries.map(renderChip)}</React.Fragment>
          : (
            <div className="pinned-group" key={g.key}>
              <span
                className={`pinned-group-label${g.color ? ' has-area' : ''}`}
                style={g.color ? ({ ['--area-color']: g.color } as React.CSSProperties) : undefined}
                title={`${g.label} · ${g.entries.length}`}
              >
                <span className="pinned-group-name">{g.label}</span>
                <span className="pinned-group-count">{g.entries.length}</span>
              </span>
              <div className="pinned-group-chips">{g.entries.map(renderChip)}</div>
            </div>
          )
      ))}
    </div>
  );
});
