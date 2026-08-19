/**
 * Agent Activity Dock
 *
 * A strip of thumbnails at the bottom of the agent overview panel: agents
 * working right now first, then agents that worked recently. Click one to
 * jump to it.
 *
 * This is the `overview` dock position. The `composer` position is NOT this
 * component — there, the same agents are appended to the pinned-agents row
 * instead of getting a strip of their own (see PinnedAgentsBar's
 * `includeActiveAgents`, and agentDockPosition.ts for why).
 *
 * The roster is deliberately smoothed rather than read live; dockRoster.ts
 * explains why the raw agent signals are too noisy to render directly.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAgentsArray, useAgentsWithUnseenOutput, useCustomAgentClassesArray, useViewMode, store } from '../../store';
import { STORAGE_KEYS, getStorage, setStorage } from '../../utils/storage';
import { isAgentVisibleInWorkspace, useWorkspaceFilter } from '../WorkspaceSwitcher';
import { AgentIcon } from '../AgentIcon';
import { Icon } from '../Icon';
import { Tooltip } from '../shared/Tooltip';
import { ProviderIcon } from '../ProviderIcon';
import { prefetchAgentHistory } from './useHistoryLoader';
import { useDockRoster } from './useDockRoster';
import { useAgentDockRecentSize } from './agentDockPosition';

interface AgentActivityDockProps {
  /** The agent the host surface is showing — its thumb is highlighted. */
  activeAgentId?: string;
  /** Defaults to the pinned-bar behaviour: select the agent, open the terminal. */
  onSelectAgent?: (agentId: string) => void;
}

export function AgentActivityDock({ activeAgentId, onSelectAgent }: AgentActivityDockProps) {
  const allAgents = useAgentsArray();
  const [activeWorkspace] = useWorkspaceFilter();
  const agentsWithUnseenOutput = useAgentsWithUnseenOutput();
  const customClasses = useCustomAgentClassesArray();
  const viewMode = useViewMode();

  const agents = useMemo(() => {
    if (!activeWorkspace) return allAgents;
    return allAgents.filter((agent) => isAgentVisibleInWorkspace(store.getAreaForAgent(agent.id)?.id ?? null));
  }, [allAgents, activeWorkspace]);

  const recentSize = useAgentDockRecentSize();
  // Scoped so the roster survives host remounts (see DockScopeState).
  const { entries: liveEntries, exitingIds: liveExitingIds, workingIds } = useDockRoster(agents, { scope: 'overview-dock', recentSize });

  const [expanded, setExpanded] = useState<boolean>(() => getStorage<boolean>(STORAGE_KEYS.AGENT_DOCK_COLLAPSED, false) !== true);
  const toggleExpanded = useCallback(() => {
    setExpanded(!expanded);
    setStorage(STORAGE_KEYS.AGENT_DOCK_COLLAPSED, expanded);
  }, [expanded]);

  const selectAgent = useCallback((agentId: string) => {
    if (onSelectAgent) {
      onSelectAgent(agentId);
      return;
    }
    store.setLastSelectionViaDirectClick(true);
    store.selectAgent(agentId);
    // FlatView drives its own inline chat from the same selection; opening the
    // Guake terminal there would stack a second chat on top of it.
    if (viewMode !== 'flat') store.setTerminalOpen(true);
  }, [onSelectAgent, viewMode]);

  // Keep a live status/recency update from moving a thumbnail after the user
  // has already pressed it. The press-time id is also retained for synthetic
  // mobile clicks, which can be dispatched after the roster DOM has changed.
  const [rosterInteractionLocked, setRosterInteractionLocked] = useState(false);
  const frozenEntriesRef = useRef(liveEntries);
  const frozenExitingIdsRef = useRef(liveExitingIds);
  if (!rosterInteractionLocked) {
    frozenEntriesRef.current = liveEntries;
    frozenExitingIdsRef.current = liveExitingIds;
  }
  const entries = rosterInteractionLocked ? frozenEntriesRef.current : liveEntries;
  const exitingIds = rosterInteractionLocked ? frozenExitingIdsRef.current : liveExitingIds;
  const pressedAgentRef = useRef<{ id: string; at: number } | null>(null);
  const interactionReleaseTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (interactionReleaseTimerRef.current !== null) {
      window.clearTimeout(interactionReleaseTimerRef.current);
    }
  }, []);

  const lockRosterForPointer = useCallback(() => {
    frozenEntriesRef.current = liveEntries;
    frozenExitingIdsRef.current = liveExitingIds;
    setRosterInteractionLocked(true);
  }, [liveEntries, liveExitingIds]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || e.button !== 0) return;
    const thumb = (e.target as Element).closest<HTMLElement>('.aop-working-thumb[data-agent-id]');
    if (!thumb?.dataset.agentId) return;
    frozenEntriesRef.current = liveEntries;
    frozenExitingIdsRef.current = liveExitingIds;
    setRosterInteractionLocked(true);
    pressedAgentRef.current = { id: thumb.dataset.agentId, at: Date.now() };
  }, [liveEntries, liveExitingIds]);

  const releaseAfterPointer = useCallback(() => {
    if (interactionReleaseTimerRef.current !== null) {
      window.clearTimeout(interactionReleaseTimerRef.current);
    }
    interactionReleaseTimerRef.current = window.setTimeout(() => {
      interactionReleaseTimerRef.current = null;
      pressedAgentRef.current = null;
      setRosterInteractionLocked(false);
    }, 0);
  }, []);

  const releaseImmediately = useCallback(() => {
    pressedAgentRef.current = null;
    setRosterInteractionLocked(false);
  }, []);

  const handleThumbClick = useCallback((agentId: string) => {
    const pressed = pressedAgentRef.current;
    pressedAgentRef.current = null;
    const targetAgentId = pressed && Date.now() - pressed.at <= 1500 ? pressed.id : agentId;
    if (!store.getState().agents.has(targetAgentId)) return;
    selectAgent(targetAgentId);
  }, [selectAgent]);

  return (
    <div
      className={`aop-working-strip${workingIds.size === 0 ? ' no-working' : ''}${expanded ? '' : ' collapsed'}`}
      role="toolbar"
      aria-label="Recent and working agents"
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') lockRosterForPointer(); }}
      onPointerDownCapture={handlePointerDown}
      onPointerUpCapture={releaseAfterPointer}
      onPointerCancel={releaseImmediately}
      onPointerLeave={releaseImmediately}
    >
      <Tooltip
        content={expanded ? 'Hide agent activity dock' : 'Show agent activity dock'}
        position="top"
        delay={120}
        triggerStyle={{ display: 'contents' }}
      >
        <button
          type="button"
          className="aop-working-strip-toggle"
          onClick={toggleExpanded}
          aria-label={expanded ? 'Hide agent activity dock' : 'Show agent activity dock'}
          aria-expanded={expanded}
        >
          <Icon name={expanded ? 'caret-down' : 'caret-up'} size={11} />
        </button>
      </Tooltip>
      {expanded && entries.map((entry, entryIndex) => {
        const { agent, lane } = entry;
        const isWorking = lane === 'working';
        const isActive = agent.id === activeAgentId;
        const isExiting = exitingIds.has(agent.id);
        const hasUnread = agentsWithUnseenOutput.has(agent.id);
        const area = store.getAreaForAgent(agent.id);
        const areaColor = area?.color;
        const opensRecentLane = !isWorking && entryIndex > 0 && entries[entryIndex - 1].lane === 'working';
        return (
          // Keyed by agent id alone across both lanes so a status change keeps
          // the existing DOM node even though its position updates immediately.
          <React.Fragment key={agent.id}>
            {opensRecentLane && <span className="aop-working-strip-divider" aria-hidden="true" />}
            <Tooltip
              position="top"
              delay={120}
              maxWidth={240}
              triggerStyle={{ display: 'contents' }}
              content={(
                <div className="aop-dock-tooltip">
                  <strong>{agent.name}</strong>
                  <span className={`aop-dock-tooltip-status ${isWorking ? 'working' : 'recent'}`}>
                    {isWorking ? 'Working now' : 'Recently active'}
                  </span>
                  <small>{agent.provider}{area?.name ? ` · ${area.name}` : ''}</small>
                  {hasUnread && <span className="aop-dock-tooltip-unread">Unread output</span>}
                </div>
              )}
            >
              <button
                type="button"
                data-agent-id={agent.id}
                className={`aop-working-thumb${isWorking ? '' : ' recent'}${isActive ? ' active' : ''}${isExiting ? ' exiting' : ''}`}
                style={areaColor ? ({ '--aop-thumb-area': areaColor } as React.CSSProperties) : undefined}
                aria-label={`Open ${agent.name}, ${isWorking ? 'working' : 'recently active'}`}
                onClick={() => handleThumbClick(agent.id)}
                onMouseEnter={() => prefetchAgentHistory(agent.id)}
              >
                <AgentIcon agent={agent} size="100%" customClasses={customClasses} />
                <ProviderIcon agent={agent} alt="" className="aop-working-thumb-provider" />
                {hasUnread && <span className="aop-working-thumb-unread" aria-hidden="true" />}
              </button>
            </Tooltip>
          </React.Fragment>
        );
      })}
    </div>
  );
}
