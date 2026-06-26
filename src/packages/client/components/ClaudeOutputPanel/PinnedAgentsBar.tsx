import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import { store, useAgents, usePinnedAgentIds, useCustomAgentClassesArray, useAreas, useViewMode } from '../../store';
import { AgentIcon } from '../AgentIcon';
import type { Agent } from '../../../shared/types';

interface PinnedAgentsBarProps {
  /** The agent currently shown in this pane — its thumbnail is highlighted. */
  activeAgentId?: string;
}

/**
 * Quick-select strip of pinned agents, shown above the terminal input. Click a
 * thumbnail to switch the terminal to that agent; click its × (or right-click)
 * to unpin. Pins persist per-browser (see store.togglePinnedAgent). Hidden when
 * nothing is pinned. Mirrors the browser-extension cockpit's pinned-agents bar.
 */
export const PinnedAgentsBar = memo(function PinnedAgentsBar({ activeAgentId }: PinnedAgentsBarProps) {
  const pinnedIds = usePinnedAgentIds();
  const agents = useAgents();
  const customClasses = useCustomAgentClassesArray();
  const areas = useAreas();
  const viewMode = useViewMode();

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
  const pinned = pinnedIds.map((id) => agents.get(id)).filter((a): a is Agent => !!a);
  if (pinned.length === 0) return null;

  return (
    <div className="pinned-agents-bar" role="toolbar" aria-label="Pinned agents">
      {pinned.map((agent) => {
        const working = agent.status === 'working' || agent.status === 'waiting';
        const isActive = agent.id === activeAgentId;
        const areaColor = areaColorById.get(agent.id) ?? null;
        return (
          <button
            key={agent.id}
            type="button"
            draggable
            className={`pinned-agent${isActive ? ' active' : ''}${working ? ' working' : ''}${areaColor ? ' has-area' : ''}${
              draggingId === agent.id ? ' dragging' : ''
            }${dropTarget && dropTarget.id === agent.id ? (dropTarget.after ? ' drop-after' : ' drop-before') : ''}`}
            title={`${agent.name}${agent.status ? ` — ${agent.status}` : ''}`}
            style={areaColor ? ({ ['--area-color']: areaColor } as React.CSSProperties) : undefined}
            onClick={() => handleSelect(agent)}
            onContextMenu={(e) => handleUnpin(e, agent.id)}
            onDragStart={(e) => handleDragStart(e, agent.id)}
            onDragOver={(e) => handleDragOver(e, agent.id)}
            onDrop={(e) => handleDrop(e, agent.id)}
            onDragEnd={handleDragEnd}
          >
            <span className="pinned-agent-av">
              <AgentIcon classId={agent.class} size="100%" customClasses={customClasses} />
            </span>
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
      })}
    </div>
  );
});
