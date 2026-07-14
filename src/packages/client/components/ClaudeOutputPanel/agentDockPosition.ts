/**
 * Where the agent activity dock is mounted.
 *
 * The dock renders in exactly one place, so every possible host reads this and
 * only the matching one renders it:
 *
 * - `overview` — its own strip at the bottom of the agent overview panel (default).
 * - `composer` — no separate strip at all: the working / recently-active agents
 *   are appended to the pinned-agents row above the composer, which already
 *   shows the same avatars with the same status marks. See PinnedAgentsBar's
 *   `includeActiveAgents`.
 * - `hidden` — nowhere.
 */

import { useEffect, useState } from 'react';
import { STORAGE_KEYS, getStorageString, setStorageString } from '../../utils/storage';

export type AgentDockPosition = 'overview' | 'composer' | 'hidden';

export const AGENT_DOCK_POSITIONS: readonly AgentDockPosition[] = ['overview', 'composer', 'hidden'];

export const AGENT_DOCK_POSITION_LABELS: Record<AgentDockPosition, string> = {
  overview: 'Overview panel',
  composer: 'In the pinned agents row',
  hidden: 'Hidden',
};

const DEFAULT_POSITION: AgentDockPosition = 'overview';

/** Fired on the window so hosts in THIS tab re-read — `storage` only fires in other tabs. */
const CHANGE_EVENT = 'tide:agent-dock-position';

export function getAgentDockPosition(): AgentDockPosition {
  const stored = getStorageString(STORAGE_KEYS.AGENT_DOCK_POSITION) as AgentDockPosition;
  return AGENT_DOCK_POSITIONS.includes(stored) ? stored : DEFAULT_POSITION;
}

export function setAgentDockPosition(position: AgentDockPosition): void {
  setStorageString(STORAGE_KEYS.AGENT_DOCK_POSITION, position);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** The live dock position — re-reads on changes from this tab and from others. */
export function useAgentDockPosition(): AgentDockPosition {
  const [position, setPosition] = useState<AgentDockPosition>(getAgentDockPosition);

  useEffect(() => {
    const sync = () => setPosition(getAgentDockPosition());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return position;
}
