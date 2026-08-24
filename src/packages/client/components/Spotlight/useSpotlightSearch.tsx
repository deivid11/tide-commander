/**
 * Custom hook for managing Spotlight search state including:
 * - Search query and results
 * - Fuse.js fuzzy search across agents, commands, areas, folders, files
 * - Result highlighting and selection
 * - Keyboard navigation
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Fuse from 'fuse.js';
import { store, useAgents, useAreas, useBuildings, useToolExecutions, useAgentsWithUnseenOutput, useSettings } from '../../store';
import { formatShortcut } from '../../store/shortcuts';
import { makeAgentOverviewComparator, type AgentSortMode } from '../ClaudeOutputPanel/agentOverviewSort';
import { STORAGE_KEYS, getStorage, setStorage, getStorageString, setStorageString } from '../../utils/storage';
import type { Agent, DrawingArea } from '../../../shared/types';
import type { SearchResult, UseSpotlightSearchOptions, SpotlightSearchState, SpotlightTab, SpotlightAreaSection } from './types';
import { SPOTLIGHT_TABS } from './types';
import { getFileIconFromPath, getRecentAgentTimes, recordRecentAgent, agentRecency } from './utils';
import { tokenizeQuery, searchAllTokens, matchTierForQuery, escapeRegExp } from './multiTokenSearch';
import { mergeExtracts } from './matchedExtracts';
import { Icon, type IconName } from '../Icon';
import { AgentIcon } from '../AgentIcon';
import { searchFolders, type FolderSearchResult } from '../../api/folders';
import {
  searchFilesGlobal,
  searchFileContentsGlobal,
  type GlobalFileSearchHit,
  type GlobalFileContentSearchHit,
} from '../../api/files';
import { searchGlobalSessions, type GlobalSessionMatch } from '../../api/sessions';
import { DEFAULT_FILE_SEARCH_EXCLUDE_DIRS } from '../../../shared/file-search';
import { SETTINGS_SEARCH_SECTIONS, searchSettingsSections } from '../toolbox/settingsSearch';

// Fixed category display order for the All tab. Commands remain available in
// their dedicated tab, but do not interrupt navigation/search results.
const ALL_CATEGORY_ORDER: readonly SearchResult['type'][] = [
  'agent',
  'session',
  'building',
  'setting',
  'file',
  'file-content',
  'folder',
  'area',
];

// Minimum query length before hitting the folder-search endpoint (matches the
// server's MIN_QUERY — folders are never shown for the empty/recent view).
const FOLDER_MIN_QUERY = 2;

// Filename search across area project trees. Same floor as folders so a single
// character never walks every configured repo.
const FILE_MIN_QUERY = 2;
const FILE_RESULT_LIMIT = 50;
const FILE_ALL_TAB_LIMIT = 10;
const CONTENT_MIN_QUERY = 3;
const CONTENT_RESULT_LIMIT = 30;
const CONTENT_ALL_TAB_LIMIT = 8;
const SETTINGS_ALL_TAB_LIMIT = 8;

// Minimum query length before full-text searching every session's JSONL. At 2
// chars nearly every conversation matches — pure noise below the fold.
const SESSION_MIN_QUERY = 3;
// Fetch more than the collapsed view shows: the surplus feeds the agent
// promotion (ownership through session history) and the "Show all" row.
const SESSION_RESULT_LIMIT = 15;
const SESSION_DISPLAY_LIMIT = 5;
const AGENT_DISPLAY_LIMIT = 5;

// Load the persisted tab, falling back to 'all' for unknown/legacy values.
function loadPersistedTab(): SpotlightTab {
  const stored = getStorage<SpotlightTab>(STORAGE_KEYS.SPOTLIGHT_TAB, 'all');
  return SPOTLIGHT_TABS.includes(stored) ? stored : 'all';
}

// The last query is remembered so reopening Spotlight restores it (pre-selected,
// so typing immediately replaces it — handled in the Spotlight container).
function loadPersistedQuery(): string {
  return getStorageString(STORAGE_KEYS.SPOTLIGHT_QUERY, '');
}

// Read the Agent Overview panel's persisted sort mode so the Spotlight "Areas"
// tab orders agents the same way the overview currently shows them.
function getOverviewSortMode(): AgentSortMode {
  const cfg = getStorage<{ sortMode?: string }>(STORAGE_KEYS.AOP_CONFIG, {});
  return cfg.sortMode === 'name' || cfg.sortMode === 'status' || cfg.sortMode === 'recent'
    ? cfg.sortMode
    : 'recent';
}

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
  onOpenSessionFinder,
  onOpenFileDetail,
}: UseSpotlightSearchOptions): SpotlightSearchState {
  // Granular selectors — only re-render when the specific slice changes
  const agents = useAgents();
  const areas = useAreas();
  const buildings = useBuildings();
  const settings = useSettings();
  // Used to order agents in the "Areas" tab exactly like the Agent Overview panel.
  const toolExecutions = useToolExecutions();
  const agentsWithUnseenOutput = useAgentsWithUnseenOutput();

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
  const onOpenSessionFinderRef = useRef(onOpenSessionFinder);
  onOpenSessionFinderRef.current = onOpenSessionFinder;
  const onOpenFileDetailRef = useRef(onOpenFileDetail);
  onOpenFileDetailRef.current = onOpenFileDetail;

  const [query, setQueryState] = useState<string>(loadPersistedQuery);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Last-used tab restored from localStorage so reopening starts where the user left off.
  const [activeTab, setActiveTabState] = useState<SpotlightTab>(loadPersistedTab);
  // Folder/git-repo results fetched from the server (debounced, query-gated).
  const [folderData, setFolderData] = useState<FolderSearchResult[]>([]);
  // Filename hits across every area directory (debounced, query-gated).
  const [fileData, setFileData] = useState<GlobalFileSearchHit[]>([]);
  const [contentData, setContentData] = useState<GlobalFileContentSearchHit[]>([]);
  const [isFolderLoading, setIsFolderLoading] = useState(false);
  const [isFileLoading, setIsFileLoading] = useState(false);
  const [isContentLoading, setIsContentLoading] = useState(false);
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  // Session full-text hits (debounced, query-gated). The query they were
  // fetched FOR rides along so click actions can prefill the Session Finder
  // with exactly what produced the hit.
  const [sessionData, setSessionData] = useState<{ query: string; rows: GlobalSessionMatch[] }>({ query: '', rows: [] });
  // Agents / conversations display caps — collapsed to a few rows with a
  // "Show all" row when more matched; expansion is per-query (reset on typing
  // and on reopen).
  const [showAllAgents, setShowAllAgents] = useState(false);
  const [showAllSessions, setShowAllSessions] = useState(false);
  useEffect(() => {
    setShowAllAgents(false);
    setShowAllSessions(false);
  }, [query, isOpen]);

  // Persisting query setter so the last search is remembered across opens.
  const setQuery = useCallback((value: string) => {
    setQueryState(value);
    setStorageString(STORAGE_KEYS.SPOTLIGHT_QUERY, value);
  }, []);

  // On open, restore the last query (the Spotlight container pre-selects it so
  // typing replaces it) and reset the highlighted row. The active tab is kept.
  useEffect(() => {
    if (isOpen) {
      setQueryState(loadPersistedQuery());
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Debounced folder/git-repo search. Gated on a non-empty query (enumerating
  // every folder on an empty query would be huge) and only while open. The
  // server bounds depth/results, so this stays cheap.
  useEffect(() => {
    if (!isOpen) {
      setFolderData([]);
      setIsFolderLoading(false);
      return;
    }
    const q = query.trim();
    if (q.length < FOLDER_MIN_QUERY) {
      setFolderData([]);
      setIsFolderLoading(false);
      return;
    }
    setFolderData([]);
    setIsFolderLoading(true);
    let cancelled = false;
    const handle = setTimeout(() => {
      searchFolders(q)
        .then((folders) => {
          if (!cancelled) setFolderData(folders);
        })
        .catch(() => {
          if (!cancelled) setFolderData([]);
        })
        .finally(() => {
          if (!cancelled) setIsFolderLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [isOpen, query]);

  // Debounced filename search across every folder configured on areas.
  const excludeDirsKey = (settings.fileSearchExcludeDirs ?? DEFAULT_FILE_SEARCH_EXCLUDE_DIRS).join(',');
  useEffect(() => {
    if (!isOpen) {
      setFileData([]);
      setIsFileLoading(false);
      return;
    }
    const q = query.trim();
    if (q.length < FILE_MIN_QUERY) {
      setFileData([]);
      setIsFileLoading(false);
      return;
    }
    setFileData([]);
    setIsFileLoading(true);
    let cancelled = false;
    const handle = setTimeout(() => {
      searchFilesGlobal(q, {
        exclude: settings.fileSearchExcludeDirs ?? [...DEFAULT_FILE_SEARCH_EXCLUDE_DIRS],
        limit: FILE_RESULT_LIMIT,
      })
        .then((files) => {
          if (!cancelled) setFileData(files);
        })
        .catch(() => {
          if (!cancelled) setFileData([]);
        })
        .finally(() => {
          if (!cancelled) setIsFileLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [isOpen, query, excludeDirsKey, settings.fileSearchExcludeDirs]);

  // Debounced full-text search across every area project. Kept separate from
  // filename hits so both blocks can stream their own loading/result state.
  useEffect(() => {
    if (!isOpen) {
      setContentData([]);
      setIsContentLoading(false);
      return;
    }
    const q = query.trim();
    if (q.length < CONTENT_MIN_QUERY) {
      setContentData([]);
      setIsContentLoading(false);
      return;
    }
    setContentData([]);
    setIsContentLoading(true);
    const controller = new AbortController();
    const handle = setTimeout(() => {
      searchFileContentsGlobal(q, {
        exclude: settings.fileSearchExcludeDirs ?? [...DEFAULT_FILE_SEARCH_EXCLUDE_DIRS],
        limit: CONTENT_RESULT_LIMIT,
        signal: controller.signal,
      })
        .then((files) => {
          if (!controller.signal.aborted) setContentData(files);
        })
        .catch(() => {
          if (!controller.signal.aborted) setContentData([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsContentLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [isOpen, query, excludeDirsKey, settings.fileSearchExcludeDirs]);

  // Debounced full-text session search (the rg-engined /api/sessions/search —
  // fast enough for per-keystroke use; the server cancels superseded scans).
  useEffect(() => {
    if (!isOpen) {
      setSessionData({ query: '', rows: [] });
      setIsSessionLoading(false);
      return;
    }
    const q = query.trim();
    if (q.length < SESSION_MIN_QUERY) {
      setSessionData({ query: '', rows: [] });
      setIsSessionLoading(false);
      return;
    }
    setSessionData({ query: '', rows: [] });
    setIsSessionLoading(true);
    let cancelled = false;
    const handle = setTimeout(() => {
      searchGlobalSessions(q, { limit: SESSION_RESULT_LIMIT })
        .then((rows) => {
          if (!cancelled) setSessionData({ query: q, rows });
        })
        .catch(() => {
          if (!cancelled) setSessionData({ query: '', rows: [] });
        })
        .finally(() => {
          if (!cancelled) setIsSessionLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [isOpen, query]);

  // Persisting tab setter. Used by the tab bar and Tab-key cycling.
  const setActiveTab = useCallback((tab: SpotlightTab) => {
    setActiveTabState(tab);
    setStorage(STORAGE_KEYS.SPOTLIGHT_TAB, tab);
  }, []);

  // Cycle forward (1) or backward (-1) through the tabs, wrapping around.
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const cycleTab = useCallback((direction: 1 | -1) => {
    const idx = SPOTLIGHT_TABS.indexOf(activeTabRef.current);
    const next = SPOTLIGHT_TABS[(idx + direction + SPOTLIGHT_TABS.length) % SPOTLIGHT_TABS.length];
    setActiveTab(next);
  }, [setActiveTab]);

  // Switching tabs changes the visible list — reset the highlighted row.
  useEffect(() => {
    setSelectedIndex(0);
  }, [activeTab]);

  // Get shortcuts for display
  const shortcuts = store.getShortcuts();

  // Map of agentId -> last Spotlight-selection time (epoch ms). Re-read from
  // localStorage every time the modal opens so a fresh selection is reflected on
  // the next open. Combined with agent.lastActivity into a single recency key.
  const recentAgentTimes = useMemo(() => (isOpen ? getRecentAgentTimes() : {}), [isOpen]);

  // Build command results
  const commands: SearchResult[] = useMemo(() => {
    if (!isOpen) return [];

    // Keyboard-shortcut subtitles are meaningless on touch devices
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    const spawnShortcut = shortcuts.find((s) => s.id === 'spawn-agent');
    const commanderShortcut = shortcuts.find((s) => s.id === 'toggle-commander');

    return [
      {
        id: 'cmd-spawn',
        type: 'command',
        title: 'Spawn New Agent',
        subtitle: coarsePointer ? '' : (spawnShortcut ? formatShortcut(spawnShortcut) : 'Alt+N'),
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
        subtitle: coarsePointer ? '' : (commanderShortcut?.key ? formatShortcut(commanderShortcut) : 'Tab'),
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

  // Reuse the exact Settings panel index so Spotlight and the sidebar never
  // disagree about which sections a query should reveal.
  const settingResults: SearchResult[] = useMemo(() => {
    if (!isOpen) return [];
    const trimmedQuery = query.trim();
    const sections = trimmedQuery ? searchSettingsSections(trimmedQuery) : SETTINGS_SEARCH_SECTIONS;

    return sections.map((section) => ({
      id: `setting-${section.id}`,
      type: 'setting' as const,
      title: section.title,
      subtitle: trimmedQuery ? `Settings section • ${trimmedQuery}` : 'Settings section',
      icon: <Icon name="gear" size={16} />,
      _searchText: `${section.title} ${section.keywords.join(' ')}`,
      action: () => {
        onCloseRef.current();
        // Forward the original query so the panel opens already filtered and
        // highlighted. With an empty query, use the selected section title.
        onOpenToolboxRef.current(trimmedQuery || section.title);
      },
    }));
  }, [isOpen, query]);

  // agentId -> the area it currently sits in (position-based membership, the same
  // rule the Agent Overview panel uses). One pass over the subscribed areas map
  // instead of store.getAreaForAgent per agent, which re-reads store state and
  // re-looks-up the agent on every call. Feeds BOTH the agent search text (so an
  // agent is findable by its area's name) and the "Areas" tab grouping below.
  const areaByAgentId = useMemo(() => {
    const map = new Map<string, DrawingArea>();
    if (!isOpen) return map;
    const areaList = Array.from(areas.values());
    for (const agent of agents.values()) {
      for (const area of areaList) {
        if (store.isPositionInArea({ x: agent.position.x, z: agent.position.z }, area)) {
          map.set(agent.id, area);
          break;
        }
      }
    }
    return map;
  }, [isOpen, agents, areas]);

  // Build agent results with user queries included in searchable text.
  const agentResults: SearchResult[] = useMemo(() => {
    if (!isOpen) return [];

    return Array.from(agents.values()).map((agent: Agent) => {
      // Get user queries (lastAssignedTask)
      const userQueries: string[] = [];
      if (agent.lastAssignedTask) {
        userQueries.push(agent.lastAssignedTask);
      }

      // Build subtitle with basic info. Status is shown as a colored chip
      // (see _status below), so it is omitted from the subtitle text to avoid
      // duplication — but kept in the searchable text so it stays findable.
      const subtitle = `${agent.class} • ${agent.cwd}`;

      // The area the agent is parked in — searchable (so typing an area name
      // surfaces every agent inside it, even when neither the agent's name nor
      // its cwd mentions the area) and rendered as a colored badge on the row.
      const agentArea = areaByAgentId.get(agent.id);
      const areaName = agentArea?.name || '';

      // Build searchable text including status, task label, area and user queries.
      let searchableText = `${agent.name} ${agent.class} ${agent.status} ${agent.cwd}`;
      if (agent.taskLabel) {
        searchableText += ` ${agent.taskLabel}`;
      }
      if (areaName) {
        searchableText += ` ${areaName}`;
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
        _userQueries: userQueries,
        _agentId: agent.id,
        _lastActivity: agent.lastActivity,
        _taskLabel: agent.taskLabel,
        _status: agent.status,
        _provider: agent.provider ?? 'claude',
        _piModel: agent.piModel,
        _piModelProvider: agent.piModelProvider,
        _areaName: areaName || undefined,
        _areaColor: agentArea?.color,
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
  }, [isOpen, agents, areaByAgentId]);

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

  // ---- "Areas" tab data ----------------------------------------------------
  // Map agentId -> its agent SearchResult so each area's agent list can reuse the
  // exact same result objects (and their select actions) built above.
  const agentResultById = useMemo(() => {
    const map = new Map<string, SearchResult>();
    for (const r of agentResults) {
      if (r._agentId) map.set(r._agentId, r);
    }
    return map;
  }, [agentResults]);

  // Group agents by the (non-archived) area they sit in, reusing the single
  // membership pass built above.
  const agentsByAreaId = useMemo(() => {
    const map = new Map<string, Agent[]>();
    if (!isOpen) return map;
    for (const agent of agents.values()) {
      const area = areaByAgentId.get(agent.id);
      if (!area || area.archived) continue;
      const list = map.get(area.id);
      if (list) list.push(agent);
      else map.set(area.id, [agent]);
    }
    return map;
  }, [isOpen, agents, areaByAgentId]);

  // Latest tool-execution timestamp per agent (newest first), mirroring the
  // AgentOverviewPanel's toolsByAgent[0] lookup used by its 'recent' sort.
  const latestToolTimestamp = useMemo(() => {
    const map = new Map<string, number>();
    for (const exec of toolExecutions) {
      if (!map.has(exec.agentId)) map.set(exec.agentId, exec.timestamp);
    }
    return map;
  }, [toolExecutions]);

  // Build the per-area sections shown in the "Areas" tab. Each area's agents are
  // ordered identically to the Agent Overview panel ('recent' mode).
  const areaSections: SpotlightAreaSection[] = useMemo(() => {
    if (!isOpen) return [];
    const q = query.trim().toLowerCase();
    // Multi-word queries split roles: words matching the area NAME select the
    // area, the leftover words narrow the agents INSIDE it — "daisy designer"
    // keeps the DaisySeed section but only shows its "Designer 3D print" agent.
    const tokens = tokenizeQuery(q);
    const comparator = makeAgentOverviewComparator({
      sortMode: getOverviewSortMode(),
      agentsWithUnseenOutput,
      getLatestToolTimestamp: (id) => latestToolTimestamp.get(id),
    });

    const candidateAreas = Array.from(areas.values())
      .filter((area) => !area.archived)
      .filter((area) => {
        if (tokens.length === 0) return true;
        const name = area.name.toLowerCase();
        return tokens.some((t) => name.includes(t));
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    const sections: SpotlightAreaSection[] = [];
    for (const area of candidateAreas) {
      const name = area.name.toLowerCase();
      const leftoverTokens = tokens.filter((t) => !name.includes(t));
      const areaAgents = (agentsByAreaId.get(area.id) || []).slice().sort(comparator);
      let agentResultsForArea = areaAgents
        .map((a) => agentResultById.get(a.id))
        .filter((r): r is SearchResult => !!r);
      if (leftoverTokens.length > 0) {
        agentResultsForArea = agentResultsForArea.filter((r) => {
          const searchable = `${r.title} ${r.subtitle || ''} ${r._searchText || ''}`.toLowerCase();
          return leftoverTokens.every((t) => searchable.includes(t));
        });
        // Every leftover word must land on at least one agent, else the area
        // is only a partial match for the query.
        if (agentResultsForArea.length === 0) continue;
      }
      // No query: hide empty areas to reduce noise. With a query fully covered
      // by the area name: keep it visible even when it currently holds no agents.
      if (!q && agentResultsForArea.length === 0) continue;
      sections.push({ areaId: area.id, areaName: area.name, areaColor: area.color, agents: agentResultsForArea });
    }
    return sections;
  }, [isOpen, query, areas, agentsByAreaId, agentResultById, agentsWithUnseenOutput, latestToolTimestamp]);

  // Build building results (server, boss, and database buildings)
  const buildingResults: SearchResult[] = useMemo(() => {
    if (!isOpen) return [];

    return Array.from(buildings.values())
      .filter((building) => building.type === 'server' || building.type === 'boss' || building.type === 'database' || building.type === 'tests')
      .map((building) => {
        const statusColor = building.status === 'running' ? '#4ade80' : building.status === 'stopped' ? '#f87171' : '#facc15';
        const typeIconName: IconName = building.type === 'boss' ? 'crown' : building.type === 'database' ? 'database' : building.type === 'tests' ? 'flask' : 'desktop';
        const typeLabel = building.type === 'boss' ? 'Boss' : building.type === 'database' ? 'Database' : building.type === 'tests' ? 'Tests' : 'Server';

        // Build subtitle with connection info for database buildings
        let subtitle = `${typeLabel} • ${building.status}`;
        if (building.type === 'database' && building.database?.connections?.length) {
          const conn = building.database.connections[0];
          subtitle += ` • ${conn.engine} @ ${conn.host}`;
        } else if (building.type === 'tests' && building.folderPath) {
          subtitle = `${typeLabel} • ${building.folderPath}`;
        } else if (building.cwd) {
          subtitle += ` • ${building.cwd}`;
        }

        // Auto-detected listening ports (servers) — shown as clickable links.
        const ports = building.pm2Status?.ports || [];

        // Build search text including database connection details and ports
        let searchText = `${building.name} ${building.type} ${building.status} ${building.cwd || ''} ${building.pm2?.name || ''}`;
        if (building.type === 'tests') {
          searchText += ` ${building.folderPath || ''} tests junit maven`;
        }
        if (ports.length > 0) {
          searchText += ` ${ports.join(' ')}`;
        }
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
          _ports: ports,
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
            } else if (building.type === 'tests') {
              store.openTestsBuilding(building.id);
            } else if (building.type === 'http') {
              store.openHttpBuilding(building.id);
            } else if (building.pm2?.enabled) {
              onOpenPM2LogsModalRef.current(building.id);
            }
          },
        };
      });
  }, [isOpen, buildings]);

  // Build folder/git-repo results from the debounced server fetch. The list is
  // already query-filtered + ranked server-side, so it needs no Fuse instance.
  const folderResults: SearchResult[] = useMemo(() => {
    if (!isOpen) return [];

    return folderData.map((folder) => {
      const subtitle = folder.isGitRepo && folder.gitBranch
        ? `${folder.path} • ${folder.gitBranch}`
        : folder.path;
      return {
        id: `folder-${folder.path}`,
        type: 'folder' as const,
        title: folder.name,
        subtitle,
        matchedText: folder.path,
        icon: <Icon name={folder.isGitRepo ? 'git-branch' : 'folder'} size={16} />,
        _searchText: `${folder.name} ${folder.path}`,
        _isGitRepo: folder.isGitRepo,
        _gitBranch: folder.gitBranch,
        action: () => {
          onCloseRef.current();
          // Open the File Explorer panel rooted at this folder (direct-folder mode).
          store.openFileExplorer(folder.path);
        },
      };
    });
  }, [isOpen, folderData]);

  // Filename hits from the debounced global search. Already query-filtered
  // and ranked server-side. Clicking opens the big file explorer on the
  // project root and reveals the file in the tree.
  const fileResults: SearchResult[] = useMemo(() => {
    if (!isOpen) return [];

    return fileData.map((file) => {
      const projectLabel = file.areaName && file.areaName !== file.projectName
        ? `${file.projectName} · ${file.areaName}`
        : file.projectName;
      return {
        id: `file-${file.path}`,
        type: 'file' as const,
        title: file.name,
        subtitle: file.relativePath,
        matchedText: `${file.path} ${projectLabel}`,
        icon: getFileIconFromPath(file.path),
        _searchText: `${file.name} ${file.relativePath} ${file.path} ${file.projectName} ${file.areaName}`,
        _projectName: file.projectName,
        _areaName: file.areaName,
        action: () => {
          onCloseRef.current();
          onOpenFileDetailRef.current({
            filePath: file.path,
            projectRoot: file.projectRoot,
            searchQuery: query.trim(),
          });
        },
      };
    });
  }, [isOpen, fileData, query]);

  const contentResults: SearchResult[] = useMemo(() => {
    if (!isOpen) return [];
    return contentData.map((file) => {
      const firstMatch = file.matches[0];
      const projectLabel = file.areaName && file.areaName !== file.projectName
        ? `${file.projectName} · ${file.areaName}`
        : file.projectName;
      return {
        id: `file-content-${file.path}`,
        type: 'file-content' as const,
        title: file.name,
        subtitle: `${file.relativePath}${firstMatch?.line ? `:${firstMatch.line}` : ''}`,
        matchedQuery: firstMatch?.content,
        matchedText: `${file.path} ${projectLabel}`,
        icon: getFileIconFromPath(file.path),
        _projectName: file.projectName,
        _areaName: file.areaName,
        _lineNumber: firstMatch?.line,
        action: () => {
          onCloseRef.current();
          onOpenFileDetailRef.current({
            filePath: file.path,
            projectRoot: file.projectRoot,
            targetLine: firstMatch?.line,
            searchQuery: query.trim(),
          });
        },
      };
    });
  }, [isOpen, contentData, query]);

  // Build session results from the debounced full-text search (rg-engined
  // server side, relevance-ranked: nearby all-word hits × recency). Clicking
  // jumps straight to the
  // agent that currently HOLDS the conversation, or opens the Session Finder
  // prefilled to restore it. The agent is resolved again at CLICK time —
  // sessions can attach/detach while the palette is open.
  const sessionResults: SearchResult[] = useMemo(() => {
    if (!isOpen) return [];

    const timeAgo = (iso: string): string => {
      const diff = Date.now() - new Date(iso).getTime();
      if (!Number.isFinite(diff) || diff < 0) return '';
      if (diff < 3600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m`;
      if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
      return `${Math.floor(diff / 86400_000)}d`;
    };

    return sessionData.rows.map((row) => {
      const attachedNow = Array.from(agents.values()).find((a) => a.sessionId === row.sessionId);
      // Ownership through archived session HISTORY too (server-resolved): an
      // agent that rotated to a new session still owns its old conversations,
      // so the hit can surface as that agent instead of an anonymous archive.
      const ownerAgent = attachedNow ?? (row.agentId ? agents.get(row.agentId) : undefined);
      const title = (row.firstPrompt || row.snippet || row.sessionId).slice(0, 90);
      const parts = [row.projectPath || row.projectDir];
      if (ownerAgent) parts.push(`→ ${ownerAgent.name}${attachedNow ? '' : ' (past session)'}`);
      const when = timeAgo(row.lastModified);
      if (when) parts.push(when);
      parts.push(`${row.totalMatches}×`);
      return {
        id: `session-${row.sessionId}`,
        type: 'session' as const,
        title,
        subtitle: parts.join(' • '),
        matchedQuery: row.snippet || undefined,
        matchedExtracts: row.extracts && row.extracts.length > 0 ? row.extracts : undefined,
        // Set when an agent owns this conversation (current OR archived) —
        // allResults uses it to surface the hit as an AGENT row instead of an
        // archive row.
        _agentId: ownerAgent?.id,
        _sessionMatches: row.totalMatches,
        _sessionNearbyMatches: row.nearbyMatches,
        // The conversation's harness — shown as a logo badge on the row.
        _provider: row.provider || 'claude',
        icon: ownerAgent
          ? <AgentIcon agent={ownerAgent} size={20} />
          : <Icon name="history" size={16} />,
        action: () => {
          onCloseRef.current();
          const attached = Array.from(store.getState().agents.values()).find((a) => a.sessionId === row.sessionId);
          if (attached) {
            recordRecentAgent(attached.id);
            store.selectAgent(attached.id);
            if (store.getState().viewMode !== 'flat') {
              store.requestTerminalExpand();
            }
            // Land INSIDE the conversation: the pane consumes this and opens
            // its in-thread search prefilled — highlights + jump to the match.
            store.requestTerminalSearch(attached.id, sessionData.query);
          } else {
            onOpenSessionFinderRef.current?.({
              initialQuery: sessionData.query,
              initialSessionKey: `${row.projectPath}::${row.sessionId}`,
            });
          }
        },
      };
    });
  }, [isOpen, sessionData, agents]);

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

  // Compute the full (All-tab) search results
  const allResults = useMemo(() => {
    if (!query.trim()) {
      // Show recent/suggested items in the same fixed order as query results.
      const suggested: SearchResult[] = [];

      // Collection order does not matter here; the fixed category sort below
      // determines the rendered order.
      suggested.push(...buildingResults);

      // Show all agents most-recently-used first. Recency = the later of the
      // agent's server-side last activity and its last explicit Spotlight pick,
      // so an agent the user is actively working with — or just opened — floats
      // to the top, newest first.
      const sortedAgents = [...agentResults].sort((a, b) => {
        const recA = agentRecency(a._agentId, a._lastActivity, recentAgentTimes);
        const recB = agentRecency(b._agentId, b._lastActivity, recentAgentTimes);
        return recB - recA;
      });
      suggested.push(...sortedAgents);

      // Show first few areas
      suggested.push(...areaResults.slice(0, 2));

      // Sort by the fixed All-tab category order so keyboard navigation matches
      // the visual grouping.
      const categoryIndex: Record<string, number> = {};
      ALL_CATEGORY_ORDER.forEach((cat, i) => { categoryIndex[cat] = i; });
      suggested.sort((a, b) => (categoryIndex[a.type] ?? 999) - (categoryIndex[b.type] ?? 999));

      return suggested;
    }

    const lowerQuery = query.trim().toLowerCase();
    // Words of the query. Multi-word queries match with AND-of-words semantics
    // (each word may hit a different field — "daisy designer" = the "Designer
    // 3D print" agent inside the "DaisySeed" area), which plain Fuse cannot do:
    // it fuzzy-matches the whole phrase as one contiguous pattern.
    const queryTokens = tokenizeQuery(lowerQuery);

    // Search each category (retrieval — per-category limits and the building
    // fuzzy-noise filter are preserved; ranking happens afterwards).
    //
    // Agents keep their fuzzy matches (typo tolerance) — the tier ranking
    // sends fuzzy-only hits to the BOTTOM of the agents block (an AND-fuzzy
    // pair over a long task text matches almost anything), and the display
    // cap + "Show all" row below keeps them out of sight unless expanded.
    const matchedAgents = searchAllTokens(agentFuse, query).slice(0, 30);
    const matchedAreas = searchAllTokens(areaFuse, query).slice(0, 2);
    // Folders are already query-filtered + ranked server-side (no Fuse needed).
    const matchedFolders = folderResults.slice(0, 8);
    const matchedFiles = fileResults.slice(0, FILE_ALL_TAB_LIMIT);
    const matchedSettings = settingResults.slice(0, SETTINGS_ALL_TAB_LIMIT);
    const matchedBuildings = searchAllTokens(buildingFuse, query)
      .filter((r) => {
        const score = r.score ?? 1;
        const searchable = `${r.item.title} ${r.item.subtitle || ''} ${r.item._searchText || ''}`.toLowerCase();
        // Keep direct text matches (every word present); only keep pure fuzzy
        // matches if they are very strong.
        return queryTokens.every((t) => searchable.includes(t)) || score <= 0.2;
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
      agent: 6,
      building: 5,
      folder: 4,
      file: 4,
      'file-content': 4,
      setting: 4,
      command: 3,
      area: 2,
      'modified-file': 1,
      // Sessions never enter the scored blocks (appended as a trailing block
      // below) — the weight only exists to satisfy the exhaustive record.
      session: 0,
    };

    // Tiered match quality (higher = better):
    //   6 exact title  ·  5 prefix  ·  4 whole-word  ·  3 title substring
    //   2 other-field substring  ·  1 fuzzy/subsequence only.
    // Multi-word queries tier the full phrase first, then fall back to the
    // weakest word — so a cross-field match ("daisy designer") lands at tier
    // ≥ 2 instead of the fuzzy-only floor. See matchTierForQuery.
    const matchTier = (item: SearchResult): number =>
      matchTierForQuery(
        lowerQuery,
        item.title,
        `${(item.subtitle || '')} ${(item._searchText || '')} ${(item.matchedText || '')}`
      );

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

    // Full-text session hits whose conversation is currently HELD by a live
    // agent surface the AGENT itself ("find the agent that talked about X"),
    // not an archive row: they enrich an already-matched agent, or add the
    // agent to this category below, and are dropped from the trailing
    // Past Conversations block. First hit per agent wins (best-ranked).
    const sessionHitByAgentId = new Map<string, SearchResult>();
    for (const s of sessionResults) {
      if (s._agentId && !sessionHitByAgentId.has(s._agentId)) sessionHitByAgentId.set(s._agentId, s);
    }

    // Agents - check for matching files and user queries (enrichment preserved)
    for (const r of matchedAgents) {
      const item = { ...r.item };
      // Find user queries that match the search (any word)
      if (item._userQueries && item._userQueries.length > 0) {
        const matchingQuery = item._userQueries.find((q) =>
          queryTokens.some((t) => q.toLowerCase().includes(t))
        );
        if (matchingQuery) {
          // The word that hit, used to center the context window below. The
          // full phrase is preferred when it is present verbatim.
          const lowerMatching = matchingQuery.toLowerCase();
          const matchedNeedle = lowerMatching.includes(lowerQuery)
            ? lowerQuery
            : queryTokens.find((t) => lowerMatching.includes(t)) ?? lowerQuery;
          // Truncate the query if it's too long (show context around match)
          const maxLen = 200;
          if (matchingQuery.length > maxLen) {
            const matchIdx = lowerMatching.indexOf(matchedNeedle);
            const start = Math.max(0, matchIdx - 60);
            const end = Math.min(matchingQuery.length, matchIdx + matchedNeedle.length + 100);
            item.matchedQuery =
              (start > 0 ? '...' : '') +
              matchingQuery.slice(start, end) +
              (end < matchingQuery.length ? '...' : '');
          } else {
            item.matchedQuery = matchingQuery;
          }
        }
      }
      // A conversation hit upgrades the row: show the snippet (unless a task
      // match already claimed the slot) and land INSIDE the conversation at
      // the match on click instead of merely selecting the agent.
      const sessionHit = item._agentId ? sessionHitByAgentId.get(item._agentId) : undefined;
      if (sessionHit) {
        if (!item.matchedQuery) item.matchedQuery = sessionHit.matchedQuery;
        // Extracts: a store-side user-query match (already a user prompt)
        // leads, the conversation's ranked extracts fill the remaining slots
        // — deduped so the same prompt doesn't show twice.
        // The store match is an ANY-token hit (weak for short words like
        // "pi"); it leads only when it genuinely contains every query word.
        const storeMatch = item.matchedQuery;
        const storeMatchLower = storeMatch?.toLowerCase() ?? '';
        item.matchedExtracts = mergeExtracts(
          storeMatch && queryTokens.every((t) => storeMatchLower.includes(t)) ? storeMatch : undefined,
          sessionHit.matchedExtracts,
        );
        item.action = sessionHit.action;
        item._sessionMatches = sessionHit._sessionMatches;
        item._sessionNearbyMatches = sessionHit._sessionNearbyMatches;
        // The conversation verifiably contains every query word (the server
        // counted real occurrences) — reflect that in the tiered text so the
        // content match ranks as a substring hit (tier ≥ 2), above
        // fuzzy-only leftovers, instead of the fuzzy floor.
        item._searchText = `${item._searchText || ''} ${sessionHit.matchedQuery || ''} ${lowerQuery}`;
      }
      pushScored(item, r.score);
    }

    // Agents whose CONVERSATION matched but whose name/fields didn't: add them
    // to the agent category. They tier as content matches, so they rank below
    // direct name/field matches but inside the agents block — which is where
    // the user looks for them.
    for (const [agentId, sessionHit] of sessionHitByAgentId) {
      if (matchedAgents.some((r) => r.item._agentId === agentId)) continue;
      const base = agentResultById.get(agentId);
      if (!base) continue;
      pushScored({
        ...base,
        matchedQuery: sessionHit.matchedQuery,
        matchedExtracts: sessionHit.matchedExtracts,
        action: sessionHit.action,
        _sessionMatches: sessionHit._sessionMatches,
        _sessionNearbyMatches: sessionHit._sessionNearbyMatches,
        // See the enrichment above: verified content match → substring tier.
        _searchText: `${base._searchText || ''} ${sessionHit.matchedQuery || ''} ${lowerQuery}`,
      }, undefined);
    }

    for (const r of matchedBuildings) pushScored(r.item, r.score);
    for (const r of matchedAreas) pushScored(r.item, r.score);
    for (const item of matchedSettings) pushScored(item, undefined);
    for (const item of matchedFolders) pushScored(item, undefined);
    for (const item of matchedFiles) pushScored(item, undefined);
    for (const item of contentResults.slice(0, CONTENT_ALL_TAB_LIMIT)) pushScored(item, undefined);

    // Sort WITHIN each category. For AGENTS: relevance TIER stays the primary
    // key (an exact/prefix name match still ranks above everything weaker);
    // WITHIN a tier, blend HOW MUCH the agent matches with HOW RECENTLY it was
    // used — verified conversation hits plus an activity-recency decay (24h
    // half-life; the later of last activity and last Spotlight pick). For a
    // multi-word query, nearby all-token mentions dominate huge raw counts from
    // unrelated boilerplate/tool lines, matching the server's session ranking.
    // Agents without content hits keep pure most-recent-first order (the decay
    // is monotonic in recency). Fuse score is the final tiebreak.
    // Non-agent categories keep the plain combined-score ordering.
    const AGENT_RECENCY_HALF_LIFE_MS = 24 * 3600_000;
    const nowMs = Date.now();
    const agentBlend = (s: Scored): number => {
      const rec = agentRecency(s.item._agentId, s.item._lastActivity, recentAgentTimes);
      const decay = Math.exp((-Math.LN2 * Math.max(0, nowMs - rec)) / AGENT_RECENCY_HALF_LIFE_MS);
      const rawMatches = s.item._sessionMatches ?? 0;
      const rawEvidence = Math.log2(1 + rawMatches);
      const nearbyMatches = s.item._sessionNearbyMatches;
      const conversationEvidence = nearbyMatches === undefined
        ? rawEvidence
        : nearbyMatches > 0
          ? 8 + Math.log2(1 + nearbyMatches) + rawEvidence * 0.1
          : rawEvidence * 0.2;
      return conversationEvidence + 4 * decay;
    };
    for (const [type, arr] of scoredByCategory) {
      if (type === 'agent') {
        arr.sort((a, b) => {
          const tierA = matchTier(a.item);
          const tierB = matchTier(b.item);
          if (tierB !== tierA) return tierB - tierA;
          const blendA = agentBlend(a);
          const blendB = agentBlend(b);
          if (blendB !== blendA) return blendB - blendA;
          return b.score - a.score;
        });
      } else {
        arr.sort((a, b) => b.score - a.score);
      }
    }

    // Assemble contiguous blocks in the product-defined order. Match quality
    // only ranks results within a category; it never moves whole categories.
    const finalResults: SearchResult[] = [];
    for (const type of ALL_CATEGORY_ORDER) {
      if (type === 'session') {
        if (!showAllSessions && sessionResults.length > SESSION_DISPLAY_LIMIT) {
          finalResults.push(...sessionResults.slice(0, SESSION_DISPLAY_LIMIT));
          finalResults.push({
            id: 'session-show-all',
            type: 'session',
            title: `Show all conversations (${sessionResults.length})`,
            subtitle: `${sessionResults.length - SESSION_DISPLAY_LIMIT} more matches`,
            icon: <Icon name="arrow-down" size={16} />,
            action: () => setShowAllSessions(true),
          });
        } else {
          finalResults.push(...sessionResults);
        }
        continue;
      }
      const arr = scoredByCategory.get(type);
      if (!arr) continue;
      // Agents collapse to the top AGENT_DISPLAY_LIMIT with a "Show all"
      // row: the tail is mostly weak fuzzy matches, useful on demand but
      // noise by default.
      // The row is a regular agent-typed result so grouping and keyboard
      // navigation treat it like any other row; activating it expands the
      // list in place (no close).
      if (type === 'agent' && !showAllAgents && arr.length > AGENT_DISPLAY_LIMIT) {
        for (const s of arr.slice(0, AGENT_DISPLAY_LIMIT)) finalResults.push(s.item);
        finalResults.push({
          id: 'agent-show-all',
          type: 'agent',
          title: `Show all agents (${arr.length})`,
          subtitle: `${arr.length - AGENT_DISPLAY_LIMIT} more matches`,
          icon: <Icon name="arrow-down" size={16} />,
          action: () => setShowAllAgents(true),
        });
        continue;
      }
      for (const s of arr) finalResults.push(s.item);
    }

    return finalResults;
  }, [query, agentFuse, areaFuse, buildingFuse, agentResults, agentResultById, areaResults, buildingResults, settingResults, folderResults, fileResults, contentResults, sessionResults, recentAgentTimes, showAllAgents, showAllSessions]);

  // Filter the flat result list to the active tab. 'all' shows everything;
  // 'buildings'/'commands' filter by type; 'areas' is the flattened agent list
  // from the area sections (used for keyboard navigation + Enter).
  const results = useMemo(() => {
    switch (activeTab) {
      case 'agents':
        return allResults.filter((r) => r.type === 'agent');
      case 'buildings':
        return allResults.filter((r) => r.type === 'building');
      case 'commands':
        return query.trim()
          ? searchAllTokens(commandFuse, query).slice(0, 3).map((r) => r.item)
          : commands;
      case 'folders':
        return allResults.filter((r) => r.type === 'folder');
      case 'files':
        return fileResults;
      case 'contents':
        return contentResults;
      case 'settings':
        return settingResults;
      case 'areas':
        return areaSections.flatMap((s) => s.agents);
      case 'all':
      default:
        return allResults;
    }
  }, [activeTab, allResults, areaSections, fileResults, contentResults, settingResults, query, commandFuse, commands]);

  const loadingTypes = useMemo(() => {
    const loading: SearchResult['type'][] = [];
    if (isSessionLoading) loading.push('session');
    if (isFileLoading) loading.push('file');
    if (isContentLoading) loading.push('file-content');
    if (isFolderLoading) loading.push('folder');
    if (activeTab === 'all') return loading;
    const typeForTab: Partial<Record<SpotlightTab, SearchResult['type']>> = {
      buildings: 'building', folders: 'folder', files: 'file', contents: 'file-content',
      agents: 'agent', settings: 'setting', commands: 'command',
    };
    const type = typeForTab[activeTab];
    return type && loading.includes(type) ? [type] : [];
  }, [activeTab, isSessionLoading, isFileLoading, isContentLoading, isFolderLoading]);

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

  // Highlight matching text — every occurrence of every query WORD is marked
  // (a multi-word query highlights each word independently, matching the
  // AND-of-words retrieval above).
  const highlightMatch = useCallback(
    (text: string, searchQuery: string): React.ReactNode => {
      if (!searchQuery || !text) return text;

      const tokens = tokenizeQuery(searchQuery);
      if (tokens.length === 0) return text;
      // Longer words first so overlapping alternatives prefer the longest match.
      const pattern = new RegExp(
        tokens.map(escapeRegExp).sort((a, b) => b.length - a.length).join('|'),
        'gi'
      );

      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      let keyCounter = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(text)) !== null) {
        // Add text before match
        if (match.index > lastIndex) {
          parts.push(text.slice(lastIndex, match.index));
        }
        // Add highlighted match
        parts.push(
          React.createElement(
            'mark',
            { key: keyCounter++, className: 'spotlight-highlight' },
            match[0]
          )
        );
        lastIndex = match.index + match[0].length;
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
    loadingTypes,
    activeTab,
    setActiveTab,
    cycleTab,
    areaSections,
    handleKeyDown,
    highlightMatch,
  };
}
