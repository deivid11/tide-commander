import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { store, useAgents, usePinnedAgentIds, useCustomAgentClassesArray, useAreas, useViewMode, useAgentsWithUnseenOutput } from '../../store';
import { AgentIcon } from '../AgentIcon';
import { STORAGE_KEYS, getStorage, getStorageString, setStorageString } from '../../utils/storage';
import { prefetchAgentHistory } from './useHistoryLoader';
import type { Agent } from '../../../shared/types';

/** Past this many pinned agents the chips collapse to icon-only miniatures (no
 * name) to save horizontal space. Configurable + persisted (see readMiniatureThreshold). */
const DEFAULT_PINNED_MINIATURE_THRESHOLD = 6;
function readMiniatureThreshold(): number {
  const v = getStorage<number>(STORAGE_KEYS.PINNED_MINIATURE_THRESHOLD, DEFAULT_PINNED_MINIATURE_THRESHOLD);
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : DEFAULT_PINNED_MINIATURE_THRESHOLD;
}

interface PinnedAgentsBarProps {
  /** The agent currently shown in this pane — its thumbnail is highlighted. */
  activeAgentId?: string;
}

/** How the pinned chips are laid out. Persisted in localStorage. */
type GroupMode = 'none' | 'status' | 'area';
const GROUP_MODES: GroupMode[] = ['none', 'status', 'area'];
const MODE_LABEL: Record<GroupMode, string> = { none: 'Flat', status: 'Status', area: 'Area' };

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

interface PinGroup {
  key: string;
  label: string;
  color: string | null;
  agents: Agent[];
}

/**
 * Quick-select strip of pinned agents, shown above the terminal input. Click a
 * thumbnail to switch the terminal to that agent; click its × (or right-click)
 * to unpin. Pins persist per-browser (see store.togglePinnedAgent). Hidden when
 * nothing is pinned. Mirrors the browser-extension cockpit's pinned-agents bar.
 *
 * A leading toggle cycles the layout: Flat (default) → by Status → by Area. In
 * a grouped layout the chips are split into inline sections, each led by a small
 * label+count header; the chip rendering itself is identical across modes.
 */
export const PinnedAgentsBar = memo(function PinnedAgentsBar({ activeAgentId }: PinnedAgentsBarProps) {
  const pinnedIds = usePinnedAgentIds();
  const agents = useAgents();
  const customClasses = useCustomAgentClassesArray();
  const areas = useAreas();
  const viewMode = useViewMode();
  // Agents whose finished work the user hasn't opened yet (same source as the
  // AgentBar triangle and the tracking-board "!" bubble). The store adds an id
  // when an agent goes working→idle unviewed and clears it on select/open, so
  // the badge appears and disappears with no extra bookkeeping here.
  const unseenAgents = useAgentsWithUnseenOutput();

  const [groupMode, setGroupMode] = useState<GroupMode>(() => {
    const saved = getStorageString(STORAGE_KEYS.PINNED_GROUP_MODE, 'none');
    return saved === 'status' || saved === 'area' ? saved : 'none';
  });
  const cycleGroupMode = useCallback(() => {
    setGroupMode((prev) => {
      const next = GROUP_MODES[(GROUP_MODES.indexOf(prev) + 1) % GROUP_MODES.length];
      setStorageString(STORAGE_KEYS.PINNED_GROUP_MODE, next);
      return next;
    });
  }, []);

  // Configurable miniature threshold (localStorage, default 6). Re-read on the
  // cross-tab `storage` event so a change (devtools / a future Settings control)
  // reflects without a reload.
  const [miniatureThreshold, setMiniatureThreshold] = useState<number>(readMiniatureThreshold);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.PINNED_MINIATURE_THRESHOLD) setMiniatureThreshold(readMiniatureThreshold());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Resolve each pinned agent's area color (by spatial position, like the board).
  // `areas` is a dep so the tint re-resolves when areas move/recolor.
  const areaColorById = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const id of pinnedIds) {
      if (agents.get(id)) m.set(id, store.getAreaForAgent(id)?.color ?? null);
    }
    return m;
  }, [areas, pinnedIds, agents]);

  const handleSelect = useCallback((agent: Agent) => {
    store.setLastSelectionViaDirectClick(true);
    store.selectAgent(agent.id);
    // FlatView drives its own inline chat column from the same selection; opening
    // the Guake terminal here would stack a SECOND chat overlay on top of it
    // (mirrors the `!isFlat` guard in store.openTerminalOnMobile).
    if (viewMode !== 'flat') store.setTerminalOpen(true);
  }, [viewMode]);

  const handleUnpin = useCallback((e: React.MouseEvent, agentId: string) => {
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

  // ── drag-to-reorder ──
  // `dragId` (ref) drives the reorder math without stale-closure risk; the two
  // states only exist to paint the dimmed source and the insertion indicator.
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

  // Resolve in pin order; skip ids whose agent no longer exists.
  const pinned = useMemo(
    () => pinnedIds.map((id) => agents.get(id)).filter((a): a is Agent => !!a),
    [pinnedIds, agents],
  );

  // Build the grouped sections (null in flat mode). Group membership derives from
  // live status/area; within each group the flat pin order is preserved, so
  // drag-to-reorder still orders chips inside a group.
  const groups = useMemo<PinGroup[] | null>(() => {
    if (groupMode === 'none') return null;
    const byKey = new Map<string, PinGroup>();
    const push = (key: string, label: string, color: string | null, agent: Agent) => {
      let g = byKey.get(key);
      if (!g) {
        g = { key, label, color, agents: [] };
        byKey.set(key, g);
      }
      g.agents.push(agent);
    };
    for (const agent of pinned) {
      if (groupMode === 'status') {
        const b = statusBucket(agent);
        push(b, STATUS_LABEL[b], null, agent);
      } else {
        const area = store.getAreaForAgent(agent.id);
        if (area) push(`area:${area.id}`, area.name, area.color ?? null, agent);
        else push('noarea', 'No area', null, agent);
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
        return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
      });
    }
    return list;
    // `areas` dep keeps the by-area headers (name + color) fresh when an area is
    // renamed/recolored/moved without the pin set itself changing.
  }, [groupMode, pinned, areas]);

  const renderChip = useCallback(
    (agent: Agent) => {
      const working = agent.status === 'working' || agent.status === 'waiting';
      const isActive = agent.id === activeAgentId;
      const areaColor = areaColorById.get(agent.id) ?? null;
      const hasUnread = unseenAgents.has(agent.id);
      const isBoss = agent.class === 'boss' || !!agent.isBoss;
      return (
        <button
          key={agent.id}
          type="button"
          draggable
          className={`pinned-agent${isActive ? ' active' : ''}${working ? ' working' : ''}${isBoss ? ' is-boss' : ''}${areaColor ? ' has-area' : ''}${
            hasUnread ? ' has-unread' : ''
          }${draggingId === agent.id ? ' dragging' : ''}${dropTarget && dropTarget.id === agent.id ? (dropTarget.after ? ' drop-after' : ' drop-before') : ''}`}
          title={`${agent.name}${agent.status ? ` — ${agent.status}` : ''}${hasUnread ? ' — new output' : ''}`}
          // Keep an accessible name even in miniature mode, where the visible
          // name label is hidden via CSS.
          aria-label={`${agent.name}${hasUnread ? ', new output' : ''}`}
          style={areaColor ? ({ ['--area-color']: areaColor } as React.CSSProperties) : undefined}
          onClick={() => handleSelect(agent)}
          // Warm the history cache during hover so the switch on click paints
          // the conversation in its first frame (no-op when already cached).
          onMouseEnter={() => prefetchAgentHistory(agent.id)}
          onContextMenu={(e) => handleUnpin(e, agent.id)}
          onDragStart={(e) => handleDragStart(e, agent.id)}
          onDragOver={(e) => handleDragOver(e, agent.id)}
          onDrop={(e) => handleDrop(e, agent.id)}
          onDragEnd={handleDragEnd}
        >
          <span className="pinned-agent-av">
            <AgentIcon classId={agent.class} size="100%" customClasses={customClasses} />
          </span>
          {hasUnread && <span className="pinned-agent-notif" aria-hidden="true" />}
          <span className="pinned-agent-name">{agent.name}</span>
          <span
            className="pinned-agent-unpin"
            role="button"
            aria-label="Unpin agent"
            title="Unpin"
            onClick={(e) => handleUnpin(e, agent.id)}
          >
            ×
          </span>
        </button>
      );
    },
    [activeAgentId, areaColorById, unseenAgents, draggingId, dropTarget, customClasses, handleSelect, handleUnpin, handleDragStart, handleDragOver, handleDrop, handleDragEnd],
  );

  if (pinned.length === 0) return null;

  // Criterion: TOTAL pinned count > threshold → icon-only miniatures. In grouped
  // mode it's still the total (not per-group), so the whole bar switches at once.
  const miniature = pinned.length > miniatureThreshold;

  return (
    <div ref={barRef} className={`pinned-agents-bar${miniature ? ' miniature' : ''}`} role="toolbar" aria-label="Pinned agents">
      <button
        type="button"
        className="pinned-group-toggle"
        title={`Group pinned agents: ${MODE_LABEL[groupMode]} — click to change`}
        aria-label={`Grouping: ${MODE_LABEL[groupMode]}. Click to change.`}
        onClick={cycleGroupMode}
      >
        <span className="pgt-icon" aria-hidden="true">⊞</span>
        <span className="pgt-label">{MODE_LABEL[groupMode]}</span>
      </button>
      {groups
        ? groups.map((g) => (
            <div className="pinned-group" key={g.key}>
              <span
                className={`pinned-group-label${g.color ? ' has-area' : ''}`}
                style={g.color ? ({ ['--area-color']: g.color } as React.CSSProperties) : undefined}
                title={`${g.label} · ${g.agents.length}`}
              >
                <span className="pinned-group-name">{g.label}</span>
                <span className="pinned-group-count">{g.agents.length}</span>
              </span>
              <div className="pinned-group-chips">{g.agents.map(renderChip)}</div>
            </div>
          ))
        : pinned.map(renderChip)}
    </div>
  );
});
