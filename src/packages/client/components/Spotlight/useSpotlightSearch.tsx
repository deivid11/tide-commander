/**
 * Custom hook for managing Spotlight search state including:
 * - Search query and results
 * - Fuse.js fuzzy search across agents, commands, areas, files
 * - Result highlighting and selection
 * - Keyboard navigation
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Fuse from 'fuse.js';
import { store, useAgents, useAreas, useBuildings, useFileChanges } from '../../store';
import { formatShortcut } from '../../store/shortcuts';
import type { Agent, DrawingArea } from '../../../shared/types';
import type { SearchResult, UseSpotlightSearchOptions, SpotlightSearchState } from './types';
import { getFileIconFromPath, getRecentAgentIds, recordRecentAgent, recentAgentRank } from './utils';
import { Icon, type IconName } from '../Icon';
import { AgentIcon } from '../AgentIcon';

// Category display order - must match SpotlightResults rendering
const categoryOrder = ['command', 'agent', 'building', 'area', 'modified-file'];

export function useSpotlightSearch({
  isOpen,
  onClose,
  onOpenSpawnModal,
  onOpenCommanderView,
  onOpenToolbox,
  onOpenFileExplorer,
  onOpenPM2LogsModal,
  onOpenBossLogsModal,
  onOpenDatabasePanel,
  onOpenMonitoringModal,
}: UseSpotlightSearchOptions): SpotlightSearchState {
  // Granular selectors — only re-render when the specific slice changes
  const agents = useAgents();
  const areas = useAreas();
  const buildings = useBuildings();
  const fileChanges = useFileChanges();

  // Stabilize callback props via refs to remove them from useMemo dependency arrays.
  // Actions inside search results capture these via ref so the data arrays don't
  // recreate when a parent re-render produces new callback identities.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onOpenSpawnModalRef = useRef(onOpenSpawnModal);
  onOpenSpawnModalRef.current = onOpenSpawnModal;
  const onOpenCommanderViewRef = useRef(onOpenCommanderView);
  onOpenCommanderViewRef.current = onOpenCommanderView;
  const onOpenToolboxRef = useRef(onOpenToolbox);
  onOpenToolboxRef.current = onOpenToolbox;
  const onOpenFileExplorerRef = useRef(onOpenFileExplorer);
  onOpenFileExplorerRef.current = onOpenFileExplorer;
  const onOpenPM2LogsModalRef = useRef(onOpenPM2LogsModal);
  onOpenPM2LogsModalRef.current = onOpenPM2LogsModal;
  const onOpenBossLogsModalRef = useRef(onOpenBossLogsModal);
  onOpenBossLogsModalRef.current = onOpenBossLogsModal;
  const onOpenDatabasePanelRef = useRef(onOpenDatabasePanel);
  onOpenDatabasePanelRef.current = onOpenDatabasePanel;
  const onOpenMonitoringModalRef = useRef(onOpenMonitoringModal);
  onOpenMonitoringModalRef.current = onOpenMonitoringModal;

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Get shortcuts for display
  const shortcuts = store.getShortcuts();

  // MRU list of agents recently selected from Spotlight (newest first).
  // Re-read from localStorage every time the modal opens so a fresh selection
  // is reflected on the next open. Used as the primary recency sort key below.
  const recentAgentIds = useMemo(() => (isOpen ? getRecentAgentIds() : []), [isOpen]);

  // Build command results
  const commands: SearchResult[] = useMemo(() => {
    if (!isOpen) return [];

    const spawnShortcut = shortcuts.find((s) => s.id === 'spawn-agent');
    const commanderShortcut = shortcuts.find((s) => s.id === 'toggle-commander');

    return [
      {
        id: 'cmd-spawn',
        type: 'command',
        title: 'Spawn New Agent',
        subtitle: spawnShortcut ? formatShortcut(spawnShortcut) : 'Alt+N',
        icon: <Icon name="plus" size={16} />,
        action: () => {
          onCloseRef.current();
          onOpenSpawnModalRef.current();
        },
      },
      {
        id: 'cmd-commander',
        type: 'command',
        title: 'Commander View',
        subtitle: commanderShortcut ? formatShortcut(commanderShortcut) : 'Ctrl+K',
        icon: <Icon name="dashboard" size={16} />,
        action: () => {
          onCloseRef.current();
          onOpenCommanderViewRef.current();
        },
      },
      {
        id: 'cmd-settings',
        type: 'command',
        title: 'Settings & Tools',
        subtitle: 'Configure Tide Commander',
        icon: <Icon name="gear" size={16} />,
        action: () => {
          onCloseRef.current();
          onOpenToolboxRef.current();
        },
      },
      {
        id: 'cmd-monitoring',
        type: 'command',
        title: 'Monitoring & Logs',
        subtitle: 'Triggers, workflows, events',
        icon: <Icon name="chart-line" size={16} />,
        action: () => {
          onCloseRef.current();
          onOpenMonitoringModalRef.current?.();
        },
      },
    ];
  }, [isOpen, shortcuts]);

  // Build agent results with modified files and user queries included in searchable text
  const agentResults: SearchResult[] = useMemo(() => {
    if (!isOpen) return [];

    return Array.from(agents.values()).map((agent: Agent) => {
      // Get modified files for this agent
      const agentFiles = (fileChanges || []).filter((fc) => fc.agentId === agent.id).map((fc) => fc.filePath);
      // Get unique file names for search
      const uniqueFiles = [...new Set(agentFiles)];
      const fileNames = uniqueFiles.map((fp) => fp.split('/').pop() || fp);

      // Get user queries (lastAssignedTask)
      const userQueries: string[] = [];
      if (agent.lastAssignedTask) {
        userQueries.push(agent.lastAssignedTask);
      }

      // Build subtitle with basic info
      const subtitle = `${agent.class} • ${agent.status} • ${agent.cwd}`;

      // Build searchable text including file names and user queries
      let searchableText = `${agent.name} ${subtitle}`;

      // Add file names to searchable text
      if (fileNames.length > 0) {
        searchableText += ` ${fileNames.join(' ')} ${uniqueFiles.join(' ')}`;
      }

      // Add user queries to searchable text
      if (userQueries.length > 0) {
        searchableText += ` ${userQueries.join(' ')}`;
      }

      // Calculate time away (time since last activity)
      const timeAway = Date.now() - agent.lastActivity;

      // Get last user input (truncate if too long, but keep more characters)
      let lastUserInput: string | undefined;
      if (agent.lastAssignedTask) {
        const maxLen = 150;
        if (agent.lastAssignedTask.length > maxLen) {
          lastUserInput = agent.lastAssignedTask.slice(0, maxLen) + '...';
        } else {
          lastUserInput = agent.lastAssignedTask;
        }
      }

      return {
        id: `agent-${agent.id}`,
        type: 'agent' as const,
        title: agent.name,
        subtitle,
        lastUserInput,
        timeAway,
        icon: <AgentIcon agent={agent} size={20} />,
        _searchText: searchableText,
        _modifiedFiles: uniqueFiles,
        _userQueries: userQueries,
        _agentId: agent.id,
        action: () => {
          onCloseRef.current();
          // Remember this pick so it floats to the top on the next Spotlight open.
          recordRecentAgent(agent.id);
          store.selectAgent(agent.id);
          if (store.getState().viewMode !== 'flat') {
            store.requestTerminalExpand();
          }
        },
      };
    });
  }, [isOpen, agents, fileChanges]);

  // Build area results
  const areaResults: SearchResult[] = useMemo(() => {
    if (!isOpen) return [];

    return Array.from(areas.values()).map((area: DrawingArea) => ({
      id: `area-${area.id}`,
      type: 'area' as const,
      title: area.name,
      subtitle: `${area.assignedAgentIds.length} agents • ${area.directories?.length || 0} folders`,
      icon: <Icon name="map" size={16} />,
      action: () => {
        onCloseRef.current();
        store.selectArea(area.id);
      },
    }));
  }, [isOpen, areas]);

  // Build building results (server, boss, and database buildings)
  const buildingResults: SearchResult[] = useMemo(() => {
    if (!isOpen) return [];

    return Array.from(buildings.values())
      .filter((building) => building.type === 'server' || building.type === 'boss' || building.type === 'database')
      .map((building) => {
        const statusColor = building.status === 'running' ? '#4ade80' : building.status === 'stopped' ? '#f87171' : '#facc15';
        const typeIconName: IconName = building.type === 'boss' ? 'crown' : building.type === 'database' ? 'database' : 'desktop';
        const typeLabel = building.type === 'boss' ? 'Boss' : building.type === 'database' ? 'Database' : 'Server';

        // Build subtitle with connection info for database buildings
        let subtitle = `${typeLabel} • ${building.status}`;
        if (building.type === 'database' && building.database?.connections?.length) {
          const conn = building.database.connections[0];
          subtitle += ` • ${conn.engine} @ ${conn.host}`;
        } else if (building.cwd) {
          subtitle += ` • ${building.cwd}`;
        }

        // Build search text including database connection details
        let searchText = `${building.name} ${building.type} ${building.status} ${building.cwd || ''} ${building.pm2?.name || ''}`;
        if (building.type === 'database' && building.database?.connections) {
          for (const conn of building.database.connections) {
            searchText += ` ${conn.name} ${conn.engine} ${conn.host} ${conn.database || ''} mysql postgresql sql`;
          }
        }

        return {
          id: `building-${building.id}`,
          type: 'building' as const,
          title: building.name,
          subtitle,
          icon: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icon name="status-pending" size={10} weight="fill" color={statusColor} />
              <Icon name={typeIconName} size={16} />
            </span>
          ),
          _searchText: searchText,
          action: () => {
            onCloseRef.current();
            if (building.type === 'boss') {
              onOpenBossLogsModalRef.current(building.id);
            } else if (building.type === 'database') {
              onOpenDatabasePanelRef.current(building.id);
            } else if (building.pm2?.enabled) {
              onOpenPM2LogsModalRef.current(building.id);
            }
          },
        };
      });
  }, [isOpen, buildings]);

  // Build modified files results from file changes
  const modifiedFileResults: SearchResult[] = useMemo(() => {
    if (!isOpen) return [];

    const fc = fileChanges || [];
    const seenPaths = new Set<string>();
    const results: SearchResult[] = [];

    // Get unique file paths with their most recent change
    for (const change of fc) {
      if (seenPaths.has(change.filePath)) continue;
      seenPaths.add(change.filePath);

      const fileName = change.filePath.split('/').pop() || change.filePath;
      const actionLabel =
        change.action === 'created'
          ? 'Created'
          : change.action === 'modified'
            ? 'Modified'
            : change.action === 'deleted'
              ? 'Deleted'
              : 'Read';

      results.push({
        id: `modified-${change.filePath}-${change.timestamp}`,
        type: 'modified-file',
        title: fileName,
        subtitle: `${actionLabel} by ${change.agentName} • ${change.filePath}`,
        matchedText: change.filePath,
        icon: change.action === 'deleted' ? <Icon name="trash" size={16} /> : getFileIconFromPath(change.filePath),
        action: () => {
          onCloseRef.current();
          // Try to find an area that contains this file (read live from store)
          const currentAreas = Array.from(store.getState().areas.values());
          for (const area of currentAreas) {
            for (const dir of area.directories || []) {
              if (change.filePath.startsWith(dir)) {
                store.setFileViewerPath(change.filePath);
                onOpenFileExplorerRef.current(area.id);
                return;
              }
            }
          }
          // If no area found, just select the agent
          store.selectAgent(change.agentId);
        },
      });

      // Limit to 50 unique files
      if (results.length >= 50) break;
    }

    return results;
  }, [isOpen, fileChanges]);

  // Create Fuse instances for fuzzy search
  const agentFuse = useMemo(
    () =>
      new Fuse(agentResults, {
        keys: ['title', 'subtitle', '_searchText', 'lastUserInput'],
        threshold: 0.4,
        ignoreLocation: true,
        includeScore: true,
        includeMatches: true,
      }),
    [agentResults]
  );

  const commandFuse = useMemo(
    () =>
      new Fuse(commands, {
        keys: ['title', 'subtitle'],
        threshold: 0.4,
        includeScore: true,
        includeMatches: true,
      }),
    [commands]
  );

  const areaFuse = useMemo(
    () =>
      new Fuse(areaResults, {
        keys: ['title', 'subtitle'],
        threshold: 0.4,
        includeScore: true,
        includeMatches: true,
      }),
    [areaResults]
  );

  const modifiedFileFuse = useMemo(
    () =>
      new Fuse(modifiedFileResults, {
        keys: ['title', 'subtitle', 'matchedText'],
        threshold: 0.4,
        ignoreLocation: true,
        includeScore: true,
        includeMatches: true,
      }),
    [modifiedFileResults]
  );

  const buildingFuse = useMemo(
    () =>
      new Fuse(buildingResults, {
        keys: ['title', 'subtitle', '_searchText'],
        threshold: 0.4,
        ignoreLocation: true,
        includeScore: true,
        includeMatches: true,
      }),
    [buildingResults]
  );

  // Compute search results
  const results = useMemo(() => {
    if (!query.trim()) {
      // Show recent/suggested items when no query - prioritize buildings, then agents
      const suggested: SearchResult[] = [];

      // Show buildings first (servers/bosses) - most likely what user wants to access quickly
      suggested.push(...buildingResults);

      // Show all agents: recently-used-in-Spotlight first (MRU), then by time away
      // (shortest idle first = finished more recently) for everything else.
      const sortedAgents = [...agentResults].sort((a, b) => {
        const rankA = recentAgentRank(a._agentId, recentAgentIds);
        const rankB = recentAgentRank(b._agentId, recentAgentIds);
        if (rankA !== rankB) return rankA - rankB;
        const timeA = a.timeAway ?? 0;
        const timeB = b.timeAway ?? 0;
        return timeA - timeB;
      });
      suggested.push(...sortedAgents);

      // Show first few commands
      suggested.push(...commands.slice(0, 2));

      // Show first few areas
      suggested.push(...areaResults.slice(0, 2));

      // Sort by categoryOrder so the flat array index matches the visual render order.
      const categoryIndex: Record<string, number> = {};
      categoryOrder.forEach((cat, i) => { categoryIndex[cat] = i; });
      suggested.sort((a, b) => (categoryIndex[a.type] ?? 999) - (categoryIndex[b.type] ?? 999));

      return suggested;
    }

    const lowerQuery = query.trim().toLowerCase();

    // Search each category (retrieval — per-category limits and the building
    // fuzzy-noise filter are preserved; ranking happens afterwards).
    const matchedAgents = agentFuse.search(query).slice(0, 8);
    const matchedCommands = commandFuse.search(query).slice(0, 3);
    const matchedAreas = areaFuse.search(query).slice(0, 2);
    const matchedModifiedFiles = modifiedFileFuse.search(query).slice(0, 3);
    const matchedBuildings = buildingFuse
      .search(query)
      .filter((r) => {
        const score = r.score ?? 1;
        const searchable = `${r.item.title} ${r.item.subtitle || ''} ${r.item._searchText || ''}`.toLowerCase();
        // Keep direct text matches; only keep pure fuzzy matches if they are very strong.
        return searchable.includes(lowerQuery) || score <= 0.2;
      })
      .slice(0, 4);

    // ---- Match-quality ranking ------------------------------------------------
    // Match QUALITY is the primary sort key; entity-type weight is only a modest
    // tiebreaker. This lets a strong (exact / prefix / whole-word) match on a
    // building or db-server outrank a weak fuzzy match on an agent, while agents
    // still win whenever the query genuinely matches an agent name best.

    // Per-entity base weight — agents biased highest. Deliberately small so it
    // can only break ties WITHIN a match-quality tier, never jump across tiers.
    const TYPE_WEIGHT: Record<SearchResult['type'], number> = {
      agent: 5,
      building: 4,
      command: 3,
      area: 2,
      'modified-file': 1,
    };

    // Tiered match quality (higher = better):
    //   6 exact title  ·  5 prefix  ·  4 whole-word  ·  3 title substring
    //   2 other-field substring  ·  1 fuzzy/subsequence only.
    const matchTier = (item: SearchResult): number => {
      if (!lowerQuery) return 1;
      const title = item.title.toLowerCase();
      if (title === lowerQuery) return 6;
      if (title.startsWith(lowerQuery)) return 5;
      if (title.split(/[^a-z0-9]+/i).includes(lowerQuery)) return 4;
      if (title.includes(lowerQuery)) return 3;
      const haystack = `${(item.subtitle || '')} ${(item._searchText || '')} ${(item.matchedText || '')}`.toLowerCase();
      if (haystack.includes(lowerQuery)) return 2;
      return 1; // matched only by Fuse fuzzy/subsequence, no literal substring
    };

    // combinedScore = tier*100 (dominant, gaps of 100) + typeWeight*5 (≤25) +
    // fuse refinement (<4). The weight/refinement terms only reorder items that
    // already share the same match tier.
    const scoreOf = (item: SearchResult, fuseScore: number | undefined): number => {
      const refine = (1 - Math.min(1, fuseScore ?? 1)) * 4; // [0, 4)
      return matchTier(item) * 100 + (TYPE_WEIGHT[item.type] ?? 0) * 5 + refine;
    };

    type Scored = { item: SearchResult; score: number };
    const scoredByCategory = new Map<SearchResult['type'], Scored[]>();
    const pushScored = (item: SearchResult, fuseScore: number | undefined) => {
      const arr = scoredByCategory.get(item.type);
      const entry = { item, score: scoreOf(item, fuseScore) };
      if (arr) arr.push(entry);
      else scoredByCategory.set(item.type, [entry]);
    };

    // Agents - check for matching files and user queries (enrichment preserved)
    for (const r of matchedAgents) {
      const item = { ...r.item };
      // Find files that match the query
      if (item._modifiedFiles && item._modifiedFiles.length > 0) {
        const matchingFiles = item._modifiedFiles.filter((fp) => {
          const fileName = fp.split('/').pop()?.toLowerCase() || '';
          const fullPath = fp.toLowerCase();
          return fileName.includes(lowerQuery) || fullPath.includes(lowerQuery);
        });
        if (matchingFiles.length > 0) {
          item.matchedFiles = matchingFiles;
        }
      }
      // Find user queries that match the search
      if (item._userQueries && item._userQueries.length > 0) {
        const matchingQuery = item._userQueries.find((q) => q.toLowerCase().includes(lowerQuery));
        if (matchingQuery) {
          // Truncate the query if it's too long (show context around match)
          const maxLen = 200;
          if (matchingQuery.length > maxLen) {
            const matchIdx = matchingQuery.toLowerCase().indexOf(lowerQuery);
            const start = Math.max(0, matchIdx - 60);
            const end = Math.min(matchingQuery.length, matchIdx + lowerQuery.length + 100);
            item.matchedQuery =
              (start > 0 ? '...' : '') +
              matchingQuery.slice(start, end) +
              (end < matchingQuery.length ? '...' : '');
          } else {
            item.matchedQuery = matchingQuery;
          }
        }
      }
      pushScored(item, r.score);
    }

    for (const r of matchedBuildings) pushScored(r.item, r.score);
    for (const r of matchedCommands) pushScored(r.item, r.score);
    for (const r of matchedAreas) pushScored(r.item, r.score);
    for (const r of matchedModifiedFiles) pushScored(r.item, r.score);

    // Sort WITHIN each category. For AGENTS the user wants matching agents to
    // surface most-recently-USED first: relevance TIER stays the primary key
    // (an exact/prefix match still ranks above a weaker fuzzy match), but WITHIN
    // the same tier we boost by recency. Agents recently selected from Spotlight
    // (MRU) float to the top, then by recent activity (smallest timeAway). Fuse
    // score is only the final tiebreaker. Non-agent categories keep the plain
    // combined-score ordering.
    for (const [type, arr] of scoredByCategory) {
      if (type === 'agent') {
        arr.sort((a, b) => {
          const tierA = matchTier(a.item);
          const tierB = matchTier(b.item);
          if (tierB !== tierA) return tierB - tierA;
          const rankA = recentAgentRank(a.item._agentId, recentAgentIds);
          const rankB = recentAgentRank(b.item._agentId, recentAgentIds);
          if (rankA !== rankB) return rankA - rankB;
          const awayA = a.item.timeAway ?? Number.POSITIVE_INFINITY;
          const awayB = b.item.timeAway ?? Number.POSITIVE_INFINITY;
          if (awayA !== awayB) return awayA - awayB;
          return b.score - a.score;
        });
      } else {
        arr.sort((a, b) => b.score - a.score);
      }
    }

    // Order category BLOCKS by their strongest member's score so the category
    // holding the best match renders first. Each category stays contiguous, so
    // SpotlightResults still shows exactly one header per category. The flat
    // index therefore matches the visual render order (needed for keyboard nav).
    // Use the category's MAX score (not arr[0]) so the recency-based reordering
    // of agents above cannot change which category block ranks first.
    const blockScore = (arr: Scored[]): number => arr.reduce((max, s) => Math.max(max, s.score), -1);
    const finalResults: SearchResult[] = [];
    Array.from(scoredByCategory.values())
      .sort((a, b) => blockScore(b) - blockScore(a))
      .forEach((arr) => {
        for (const s of arr) finalResults.push(s.item);
      });

    return finalResults;
  }, [query, agentFuse, commandFuse, areaFuse, modifiedFileFuse, buildingFuse, commands, agentResults, areaResults, buildingResults, recentAgentIds]);

  // Clamp selected index to valid range
  useEffect(() => {
    if (selectedIndex >= results.length) {
      setSelectedIndex(Math.max(0, results.length - 1));
    }
  }, [results.length, selectedIndex]);

  // Keyboard navigation - handles Alt+N/P for navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Alt+P = previous (up), Alt+N = next (down)
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'p' || e.key === 'n' || e.key === 'P' || e.key === 'N')) {
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        const keyLower = e.key.toLowerCase();
        if (keyLower === 'p') {
          setSelectedIndex((i) => (i > 0 ? i - 1 : results.length - 1));
        } else {
          setSelectedIndex((i) => (i < results.length - 1 ? i + 1 : 0));
        }
        return;
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onCloseRef.current();
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => (i > 0 ? i - 1 : results.length - 1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => (i < results.length - 1 ? i + 1 : 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (results[selectedIndex]) {
            results[selectedIndex].action();
          }
          break;
      }
    },
    [results, selectedIndex]
  );

  // Highlight matching text - improved version that highlights all occurrences
  const highlightMatch = useCallback(
    (text: string, searchQuery: string): React.ReactNode => {
      if (!searchQuery || !text) return text;

      const lowerText = text.toLowerCase();
      const lowerSearchQuery = searchQuery.toLowerCase();
      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      let idx = lowerText.indexOf(lowerSearchQuery);
      let keyCounter = 0;

      while (idx !== -1) {
        // Add text before match
        if (idx > lastIndex) {
          parts.push(text.slice(lastIndex, idx));
        }
        // Add highlighted match
        parts.push(
          React.createElement(
            'mark',
            { key: keyCounter++, className: 'spotlight-highlight' },
            text.slice(idx, idx + searchQuery.length)
          )
        );
        lastIndex = idx + searchQuery.length;
        idx = lowerText.indexOf(lowerSearchQuery, lastIndex);
      }

      // Add remaining text
      if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
      }

      return parts.length > 0 ? React.createElement(React.Fragment, null, ...parts) : text;
    },
    []
  );

  return {
    query,
    setQuery,
    selectedIndex,
    setSelectedIndex,
    results,
    handleKeyDown,
    highlightMatch,
  };
}
