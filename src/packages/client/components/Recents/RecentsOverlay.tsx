/**
 * RecentsOverlay — a Ctrl+L / Cmd+L command palette that lists recently-accessed
 * AGENTS and BUILDINGS in one combined list, most-recently-accessed first, with a
 * text filter at the top.
 *
 * This is a DISTINCT overlay from Spotlight (different shortcut, different intent:
 * "jump back to what I was just on"), but it deliberately reuses Spotlight's
 * SearchResult shape, SpotlightItem row, recency helpers, and `.spotlight-*`
 * styles so it looks and feels consistent.
 *
 * Recency:
 *  - agents:    max(agent.lastActivity, last Spotlight/Recents pick) — same unified
 *               recency Spotlight uses (getRecentAgentTimes + agentRecency).
 *  - buildings: max(building.lastActivity, last open recorded in localStorage)
 *               via the building MRU added alongside the agent one.
 */

import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { useAgentsArray, useBuildings } from '../../store/selectors';
import { store } from '../../store';
import { Icon } from '../Icon';
import { getBuildingTypeIcon } from '../DashboardView/utils';
import { SpotlightItem } from '../Spotlight/SpotlightItem';
import type { SearchResult } from '../Spotlight/types';
import {
  getAgentIcon,
  agentRecency,
  getRecentAgentTimes,
  recordRecentAgent,
  getRecentBuildingTimes,
  recordRecentBuilding,
} from '../Spotlight/utils';

type RecentsTab = 'all' | 'agents' | 'buildings';
const RECENTS_TABS: readonly RecentsTab[] = ['all', 'agents', 'buildings'];
const RECENTS_TAB_LABELS: Record<RecentsTab, string> = {
  all: 'All',
  agents: 'Agents',
  buildings: 'Buildings',
};

// Cap the rendered list so a large fleet doesn't produce an unwieldy palette;
// the filter narrows the full set, the sort floats the most recent to the top.
const MAX_RESULTS = 50;

interface RecentsOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  /** Open/focus a building the same way a normal building click does. */
  onOpenBuilding: (buildingId: string) => void;
}

/** Case-insensitive substring highlight, reusing Spotlight's `.spotlight-highlight` style. */
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query || !text) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let last = 0;
  let idx = lower.indexOf(q);
  let key = 0;
  while (idx !== -1) {
    if (idx > last) parts.push(text.slice(last, idx));
    parts.push(
      <mark key={key++} className="spotlight-highlight">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    last = idx + q.length;
    idx = lower.indexOf(q, last);
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function RecentsOverlay({ isOpen, onClose, onOpenBuilding }: RecentsOverlayProps) {
  const agents = useAgentsArray();
  const buildings = useBuildings();

  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<RecentsTab>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset transient state each time the overlay opens. Recency snapshots are
  // read once per open so the order is stable while the palette is visible.
  const recentAgentTimes = useMemo(() => (isOpen ? getRecentAgentTimes() : {}), [isOpen]);
  const recentBuildingTimes = useMemo(() => (isOpen ? getRecentBuildingTimes() : {}), [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveTab('all');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Build the combined, recency-sorted result list.
  const results = useMemo<SearchResult[]>(() => {
    if (!isOpen) return [];

    type Entry = { result: SearchResult; recency: number };
    const entries: Entry[] = [];

    if (activeTab === 'all' || activeTab === 'agents') {
      for (const a of agents) {
        entries.push({
          recency: agentRecency(a.id, a.lastActivity, recentAgentTimes),
          result: {
            id: `recent-agent:${a.id}`,
            type: 'agent',
            title: a.name,
            subtitle: `${a.class} • ${a.cwd}`,
            icon: getAgentIcon(a.class),
            _status: a.status,
            _agentId: a.id,
            _lastActivity: a.lastActivity,
            _taskLabel: a.taskLabel,
            action: () => {
              onClose();
              recordRecentAgent(a.id);
              store.selectAgent(a.id);
              if (store.getState().viewMode !== 'flat') {
                store.requestTerminalExpand();
              }
            },
          },
        });
      }
    }

    if (activeTab === 'all' || activeTab === 'buildings') {
      for (const b of buildings.values()) {
        entries.push({
          recency: agentRecency(b.id, b.lastActivity, recentBuildingTimes),
          result: {
            id: `recent-building:${b.id}`,
            type: 'building',
            title: b.name,
            subtitle: `${b.type} • ${b.status}`,
            icon: <Icon name={getBuildingTypeIcon(b.type)} size={16} />,
            action: () => {
              onClose();
              recordRecentBuilding(b.id);
              onOpenBuilding(b.id);
            },
          },
        });
      }
    }

    // Filter by the typed query (substring on name + subtitle).
    const q = query.trim().toLowerCase();
    const filtered = q
      ? entries.filter(
          (e) =>
            e.result.title.toLowerCase().includes(q) ||
            (e.result.subtitle?.toLowerCase().includes(q) ?? false),
        )
      : entries;

    // Most-recently-accessed first; stable tiebreak by name.
    filtered.sort((x, y) => {
      if (y.recency !== x.recency) return y.recency - x.recency;
      return x.result.title.localeCompare(y.result.title);
    });

    return filtered.slice(0, MAX_RESULTS).map((e) => e.result);
  }, [isOpen, activeTab, agents, buildings, query, recentAgentTimes, recentBuildingTimes, onClose, onOpenBuilding]);

  // Keep the selection in range as the list shrinks/grows.
  useEffect(() => {
    setSelectedIndex((i) => (results.length === 0 ? 0 : Math.min(i, results.length - 1)));
  }, [results.length]);

  // Scroll the selected row into view.
  useEffect(() => {
    const el = resultsRef.current?.querySelector('.spotlight-item.selected');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, results]);

  const cycleTab = useCallback((dir: 1 | -1) => {
    setActiveTab((cur) => {
      const i = RECENTS_TABS.indexOf(cur);
      const next = (i + dir + RECENTS_TABS.length) % RECENTS_TABS.length;
      return RECENTS_TABS[next];
    });
    setSelectedIndex(0);
  }, []);

  // Escape / Tab captured at window level so global shortcuts don't intercept.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onClose();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        cycleTab(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [isOpen, onClose, cycleTab]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (i < results.length - 1 ? i + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (i > 0 ? i - 1 : results.length - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        results[selectedIndex]?.action();
      }
    },
    [results, selectedIndex],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  if (!isOpen) return null;

  return (
    <div ref={overlayRef} className="spotlight-overlay" onClick={handleBackdropClick}>
      <div className="spotlight-modal">
        <div className="spotlight-input-wrapper">
          <span className="spotlight-search-icon" aria-hidden="true">⏱</span>
          <input
            ref={inputRef}
            type="text"
            className="spotlight-input"
            placeholder="Filter recent agents & buildings…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            autoFocus
            spellCheck={false}
          />
          <div className="spotlight-input-hints">
            <span className="spotlight-shortcut-hint">↑↓</span>
            <span className="spotlight-shortcut-hint">Enter</span>
            <span className="spotlight-shortcut-hint">Esc</span>
          </div>
        </div>

        <div className="spotlight-tabs" role="tablist" aria-label="Recents filter">
          {RECENTS_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={tab === activeTab}
              tabIndex={-1}
              className={`spotlight-tab${tab === activeTab ? ' active' : ''}`}
              onClick={() => {
                setActiveTab(tab);
                setSelectedIndex(0);
              }}
            >
              {RECENTS_TAB_LABELS[tab]}
            </button>
          ))}
          <span className="spotlight-tabs-hint">
            <kbd>Tab</kbd>
          </span>
        </div>

        <div className="spotlight-results" ref={resultsRef}>
          {results.length === 0 ? (
            <div className="spotlight-empty">No recent items</div>
          ) : (
            results.map((result, index) => (
              <SpotlightItem
                key={result.id}
                result={result}
                isSelected={index === selectedIndex}
                query={query}
                highlightMatch={highlightMatch}
                onClick={() => result.action()}
                onMouseEnter={() => setSelectedIndex(index)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default RecentsOverlay;
