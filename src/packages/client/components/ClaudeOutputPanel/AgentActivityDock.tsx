/**
 * Agent Activity Dock
 *
 * A strip of thumbnails at the bottom of the agent overview panel: agents that
 * worked recently, then agents working right now. Click one to jump to it.
 *
 * This is the `overview` dock position. The `composer` position is NOT this
 * component — there, the same agents are appended to the pinned-agents row
 * instead of getting a strip of their own (see PinnedAgentsBar's
 * `includeActiveAgents`, and agentDockPosition.ts for why).
 *
 * The roster is deliberately smoothed rather than read live; dockRoster.ts
 * explains why the raw agent signals are too noisy to render directly.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useAgentsArray, useAgentsWithUnseenOutput, useCustomAgentClassesArray, useViewMode, store } from '../../store';
import { STORAGE_KEYS, getStorage, setStorage } from '../../utils/storage';
import { isAgentVisibleInWorkspace, useWorkspaceFilter } from '../WorkspaceSwitcher';
import { AgentIcon } from '../AgentIcon';
import { Icon } from '../Icon';
import { Tooltip } from '../shared/Tooltip';
import { providerAssetUrl } from '../../utils/providerDisplay';
import { prefetchAgentHistory } from './useHistoryLoader';
import { useDockRoster } from './useDockRoster';
import { useDockFlip } from './useDockFlip';

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

  // Scoped so the roster survives host remounts (see DockScopeState).
  const { entries, exitingIds, workingIds, layoutSignature } = useDockRoster(agents, { scope: 'overview-dock' });

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

  const { registerItem } = useDockFlip(layoutSignature, exitingIds);

  return (
    <div
      className={`aop-working-strip${workingIds.size === 0 ? ' no-working' : ''}${expanded ? '' : ' collapsed'}`}
      role="toolbar"
      aria-label="Recent and working agents"
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
        const opensWorkingLane = isWorking && entryIndex > 0 && entries[entryIndex - 1].lane === 'recent';
        return (
          // Keyed by agent id alone, across both lanes: an agent that finishes
          // work keeps its DOM node, so it glides across the divider and
          // crossfades its styling instead of popping out and back in.
          <React.Fragment key={agent.id}>
            {opensWorkingLane && <span className="aop-working-strip-divider" aria-hidden="true" />}
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
                ref={registerItem(agent.id)}
                type="button"
                className={`aop-working-thumb${isWorking ? '' : ' recent'}${isActive ? ' active' : ''}${isExiting ? ' exiting' : ''}`}
                style={areaColor ? ({ '--aop-thumb-area': areaColor } as React.CSSProperties) : undefined}
                aria-label={`Open ${agent.name}, ${isWorking ? 'working' : 'recently active'}`}
                onClick={() => selectAgent(agent.id)}
                onMouseEnter={() => prefetchAgentHistory(agent.id)}
              >
                <AgentIcon agent={agent} size="100%" customClasses={customClasses} />
                <img src={providerAssetUrl(agent.provider, import.meta.env.BASE_URL)} alt="" className="aop-working-thumb-provider" />
                {hasUnread && <span className="aop-working-thumb-unread" aria-hidden="true" />}
              </button>
            </Tooltip>
          </React.Fragment>
        );
      })}
    </div>
  );
}
