/**
 * Custom hook for managing Spotlight search state including:
 * - Search query and results
 * - Fuse.js fuzzy search across agents, commands, areas, files, and activities
 * - Result highlighting and selection
 * - Keyboard navigation
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Fuse from 'fuse.js';
import { store, useAgents, useAreas, useBuildings, useFileChanges } from '../../store';
import { formatShortcut } from '../../store/shortcuts';
import type { Agent, DrawingArea } from '../../../shared/types';
import type { SearchResult, UseSpotlightSearchOptions, SpotlightSearchState } from './types';
import { getFileIconFromPath, getAgentIcon } from './utils';

// Category display order - must match SpotlightResults rendering
const categoryOrder = ['command', 'agent', 'building', 'area', 'modified-file', 'activity'];

export function useSpotlightSearch({
  isOpen,
  onClose,
  onOpenSpawnModal,
  onOpenCommanderView,
  onOpenToolbox,
  onOpenSupervisor,
  onOpenFileExplorer,
  onOpenPM2LogsModal,
  onOpenBossLogsModal,
  onOpenDatabasePanel,
}: UseSpotlightSearchOptions): SpotlightSearchState {
  // Granular selectors — only re-render when the specific slice changes
  const agents = useAgents();
  const areas = useAreas();
  const buildings = useBuildings();
  const fileChanges = useFileChanges();

  // Stable version string for supervisor history — only changes when entry counts change
  const supervisorHistoriesVersion = useMemo(() => {
    const histories = store.getState().supervisor.agentHistories;
    let version = '';
    for (const [id, entries] of histories) {
      version += `${id}:${entries.length},`;
    }
    return version;
  // Re-derive when agents change (new agent might have history)
  }, [agents]);

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
  const onOpenSupervisorRef = useRef(onOpenSupervisor);
  onOpenSupervisorRef.current = onOpenSupervisor;
  const onOpenFileExplorerRef = useRef(onOpenFileExplorer);
  onOpenFileExplorerRef.current = onOpenFileExplorer;
  const onOpenPM2LogsModalRef = useRef(onOpenPM2LogsModal);
  onOpenPM2LogsModalRef.current = onOpenPM2LogsModal;
  const onOpenBossLogsModalRef = useRef(onOpenBossLogsModal);
  onOpenBossLogsModalRef.current = onOpenBossLogsModal;
  const onOpenDatabasePanelRef = useRef(onOpenDatabasePanel);
  onOpenDatabasePanelRef.current = onOpenDatabasePanel;

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);

      // Request supervisor history for all agents that haven't had their full history fetched
      const agentValues = Array.from(agents.values());
      for (const agent of agentValues) {
        // Request history if not already fetched and not currently loading
        if (!store.hasHistoryBeenFetched(agent.id) && !store.isLoadingHistoryForAgent(agent.id)) {
          store.requestAgentSupervisorHistory(agent.id);
        }
      }
    }
  }, [isOpen, agents]);

  // Get shortcuts for display
  const shortcuts = store.getShortcuts();

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
        icon: '➕',
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
        icon: '📊',
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
        icon: '⚙️',
        action: () => {
          onCloseRef.current();
          onOpenToolboxRef.current();
        },
      },
      {
        id: 'cmd-supervisor',
        type: 'command',
        title: 'Supervisor Overview',
        subtitle: 'View agent analysis',
        icon: '🎖️',
        action: () => {
          onCloseRef.current();
          onOpenSupervisorRef.current();
        },
      },
    ];
  }, [isOpen, shortcuts]);

  // Build agent results with supervisor history, modified files, and user queries included in searchable text
  const agentResults: SearchResult[] = useMemo(() => {
    if (!isOpen) return [];

    return Array.from(agents.values()).map((agent: Agent) => {
      // Get ALL supervisor history for this agent (sorted by timestamp, newest first)
      const history = store.getAgentSupervisorHistory(agent.id);
      const latestEntry = history.length > 0 ? history[0] : null;

      // Build history entries array for searching (includes all entries)
      const historyEntries: { text: string; timestamp: number }[] = history.map((entry) => ({
        text: `${entry.analysis.statusDescription} ${entry.analysis.recentWorkSummary}`,
        timestamp: entry.timestamp,
      }));

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

      // Build searchable text including ALL supervisor history, file names, and user queries
      let searchableText = `${agent.name} ${subtitle}`;
      let activityText: string | undefined;
      let statusDescription: string | undefined;
      let lastStatusTime: number | undefined;

      // Add ALL history entries to searchable text (newest first for priority)
      for (const entry of historyEntries) {
        searchableText += ` ${entry.text}`;
      }

      if (latestEntry) {
        activityText = latestEntry.analysis.recentWorkSummary;
        statusDescription = latestEntry.analysis.statusDescription;
        lastStatusTime = latestEntry.timestamp;
      }

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
        statusDescription,
        activityText,
        matchedText: activityText,
        timeAway,
        lastStatusTime,
        icon: getAgentIcon(agent.class),
        // Include supervisor text, files, user queries, and history for searching
        _searchText: searchableText,
        _modifiedFiles: uniqueFiles,
        _userQueries: userQueries,
        _historyEntries: historyEntries,
        action: () => {
          onCloseRef.current();
          store.selectAgent(agent.id);
        },
      };
    });
  }, [isOpen, agents, supervisorHistoriesVersion, fileChanges]);

  // Build area results
  const areaResults: SearchResult[] = useMemo(() => {
    if (!isOpen) return [];

    return Array.from(areas.values()).map((area: DrawingArea) => ({
      id: `area-${area.id}`,
      type: 'area' as const,
      title: area.name,
      subtitle: `${area.assignedAgentIds.length} agents • ${area.directories?.length || 0} folders`,
      icon: '🗺️',
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
        const statusIcon = building.status === 'running' ? '🟢' : building.status === 'stopped' ? '🔴' : '🟡';
        const typeIcon = building.type === 'boss' ? '👑' : building.type === 'database' ? '🗄️' : '🖥️';
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
          icon: `${statusIcon} ${typeIcon}`,
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
        icon: change.action === 'deleted' ? '🗑️' : getFileIconFromPath(change.filePath),
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

  // Build activity results from supervisor history (searchable by status/summary text)
  const activityResults: SearchResult[] = useMemo(() => {
    if (!isOpen) return [];

    const results: SearchResult[] = [];
    const agentValues = Array.from(agents.values());

    for (const agent of agentValues) {
      const history = store.getAgentSupervisorHistory(agent.id);

      // Only include the most recent entry per agent for activity search
      if (history.length > 0) {
        const entry = history[0];
        const analysis = entry.analysis;

        results.push({
          id: `activity-${agent.id}-${entry.timestamp}`,
          type: 'activity',
          title: agent.name,
          subtitle: analysis.statusDescription,
          activityText: analysis.recentWorkSummary,
          matchedText: analysis.recentWorkSummary,
          icon: getAgentIcon(agent.class),
          action: () => {
            onCloseRef.current();
            store.selectAgent(agent.id);
          },
        });
      }
    }

    return results;
  }, [isOpen, agents, supervisorHistoriesVersion]);

  // Create Fuse instances for fuzzy search
  // ignoreLocation: true allows matching anywhere in the text (not just first 600 chars)
  // This is important for searching through all supervisor history entries
  const agentFuse = useMemo(
    () =>
      new Fuse(agentResults, {
        keys: ['title', 'subtitle', '_searchText', 'activityText', 'lastUserInput'],
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

  const activityFuse = useMemo(
    () =>
      new Fuse(activityResults, {
        keys: ['title', 'subtitle', 'matchedText', 'activityText'],
        threshold: 0.4,
        ignoreLocation: true,
        includeScore: true,
        includeMatches: true,
      }),
    [activityResults]
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

      // Show all agents, sorted by time away (shortest idle first = finished more recently)
      const sortedAgents = [...agentResults].sort((a, b) => {
        // Sort by timeAway ascending (agents idle shorter appear first)
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

    const lowerQuery = query.toLowerCase();

    // Search each category
    const matchedAgents = agentFuse.search(query).slice(0, 8);
    const matchedCommands = commandFuse.search(query).slice(0, 3);
    const matchedAreas = areaFuse.search(query).slice(0, 2);
    const matchedModifiedFiles = modifiedFileFuse.search(query).slice(0, 3);
    const matchedActivities = activityFuse.search(query).slice(0, 3);
    const matchedBuildings = buildingFuse
      .search(query)
      .filter((r) => {
        const score = r.score ?? 1;
        const searchable = `${r.item.title} ${r.item.subtitle || ''} ${r.item._searchText || ''}`.toLowerCase();
        // Keep direct text matches; only keep pure fuzzy matches if they are very strong.
        return searchable.includes(lowerQuery) || score <= 0.2;
      })
      .slice(0, 4);

    // Combine results
    const finalResults: SearchResult[] = [];

    const prioritizedAgents: SearchResult[] = [];
    const remainingAgents: SearchResult[] = [];

    // Agents - check for matching files and user queries
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
      // Find matching history entries (prioritize newest - they come first)
      if (item._historyEntries && item._historyEntries.length > 0) {
        const matchingEntry = item._historyEntries.find((entry) =>
          entry.text.toLowerCase().includes(lowerQuery)
        );
        if (matchingEntry) {
          // Truncate if too long, show context around match
          const maxLen = 250;
          if (matchingEntry.text.length > maxLen) {
            const matchIdx = matchingEntry.text.toLowerCase().indexOf(lowerQuery);
            const start = Math.max(0, matchIdx - 80);
            const end = Math.min(matchingEntry.text.length, matchIdx + lowerQuery.length + 120);
            item.matchedHistory = {
              text:
                (start > 0 ? '...' : '') +
                matchingEntry.text.slice(start, end) +
                (end < matchingEntry.text.length ? '...' : ''),
              timestamp: matchingEntry.timestamp,
            };
          } else {
            item.matchedHistory = matchingEntry;
          }
        }
      }
      const lowerTitle = item.title.toLowerCase();
      if (lowerTitle === lowerQuery || lowerTitle.startsWith(lowerQuery)) {
        prioritizedAgents.push(item);
      } else {
        remainingAgents.push(item);
      }
    }

    // If agent name is an exact/prefix match, prioritize it ahead of infrastructure hits.
    for (const item of prioritizedAgents) {
      finalResults.push(item);
    }

    // Buildings (servers and bosses)
    for (const r of matchedBuildings) {
      finalResults.push(r.item);
    }

    // Remaining agents
    for (const item of remainingAgents) {
      finalResults.push(item);
    }

    // Commands
    for (const r of matchedCommands) {
      finalResults.push(r.item);
    }

    // Areas
    for (const r of matchedAreas) {
      finalResults.push(r.item);
    }

    // Modified files
    for (const r of matchedModifiedFiles) {
      finalResults.push(r.item);
    }

    // Activities (only if not already covered by agents)
    const agentIdsInResults = new Set(matchedAgents.map((r) => r.item.id));
    for (const r of matchedActivities) {
      const activityAgentId = r.item.id.replace('activity-', '').split('-')[0];
      if (!agentIdsInResults.has(`agent-${activityAgentId}`)) {
        finalResults.push(r.item);
      }
    }

    // Sort by categoryOrder so the flat array index matches the visual render order.
    // Stable sort preserves the relative order within each category.
    const categoryIndex: Record<string, number> = {};
    categoryOrder.forEach((cat, i) => { categoryIndex[cat] = i; });
    finalResults.sort((a, b) => (categoryIndex[a.type] ?? 999) - (categoryIndex[b.type] ?? 999));

    return finalResults;
  }, [query, agentFuse, commandFuse, areaFuse, modifiedFileFuse, activityFuse, commands, agentResults, areaResults]);

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
