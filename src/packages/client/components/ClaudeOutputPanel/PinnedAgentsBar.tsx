import React, { memo, useCallback } from 'react';
import { store, useAgents, usePinnedAgentIds, useCustomAgentClassesArray } from '../../store';
import { AgentIcon } from '../AgentIcon';
import { getAgentStatusColor } from '../../utils/colors';
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

  const handleSelect = useCallback((agent: Agent) => {
    store.setLastSelectionViaDirectClick(true);
    store.selectAgent(agent.id);
    store.setTerminalOpen(true);
  }, []);

  const handleUnpin = useCallback((e: React.MouseEvent, agentId: string) => {
    e.preventDefault();
    e.stopPropagation();
    store.togglePinnedAgent(agentId);
  }, []);

  // Resolve in pin order; skip ids whose agent no longer exists.
  const pinned = pinnedIds.map((id) => agents.get(id)).filter((a): a is Agent => !!a);
  if (pinned.length === 0) return null;

  return (
    <div className="pinned-agents-bar" role="toolbar" aria-label="Pinned agents">
      {pinned.map((agent) => {
        const working = agent.status === 'working' || agent.status === 'waiting';
        const isActive = agent.id === activeAgentId;
        return (
          <button
            key={agent.id}
            type="button"
            className={`pinned-agent${isActive ? ' active' : ''}${working ? ' working' : ''}`}
            title={`${agent.name}${agent.status ? ` — ${agent.status}` : ''}`}
            onClick={() => handleSelect(agent)}
            onContextMenu={(e) => handleUnpin(e, agent.id)}
          >
            <span className="pinned-agent-av">
              <AgentIcon classId={agent.class} size="100%" customClasses={customClasses} />
              <span className="pinned-agent-status" style={{ backgroundColor: getAgentStatusColor(agent.status) }} />
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
