import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useStore, store, type FileChange } from '../store';
import { formatShortcut } from '../store/shortcuts';
import Fuse from 'fuse.js';
import { AGENT_CLASSES, type Agent, type DrawingArea } from '../../shared/types';

interface SpotlightProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSpawnModal: () => void;
  onOpenCommanderView: () => void;
  onOpenToolbox: () => void;
  onOpenSupervisor: () => void;
  onOpenFileExplorer: (areaId: string) => void;
}

interface SearchResult {
  id: string;
  type: 'agent' | 'command' | 'area' | 'activity' | 'modified-file';
  title: string;
  subtitle?: string;
  lastUserInput?: string; // Last user input/task for agents (always shown)
  statusDescription?: string; // Supervisor status description
  activityText?: string; // Last activity text (recentWorkSummary)
  matchedText?: string; // The text that matched the search query
  matchedFiles?: string[]; // Files that matched the search query (for agents)
  matchedQuery?: string; // User query that matched the search
  matchedHistory?: { text: string; timestamp: number }; // Matched supervisor history entry
  timeAway?: number; // Time away in milliseconds (for agents)
  lastStatusTime?: number; // Timestamp of last status update
  icon: string;
  action: () => void;
  _searchText?: string; // Internal field for searching
  _modifiedFiles?: string[]; // Internal field for file search
  _userQueries?: string[]; // Internal field for user query search (lastAssignedTask)
  _historyEntries?: { text: string; timestamp: number }[]; // All supervisor history entries for search
}

// File icons for modified files
const FILE_ICONS: Record<string, string> = {
  '.ts': '📘',
  '.tsx': '⚛️',
  '.js': '📒',
  '.jsx': '⚛️',
  '.py': '🐍',
  '.rs': '🦀',
  '.go': '🔷',
  '.md': '📝',
  '.json': '📋',
  '.yaml': '⚙️',
  '.yml': '⚙️',
  '.css': '🎨',
  '.scss': '🎨',
  '.html': '🌐',
  '.sql': '🗃️',
  '.sh': '💻',
  '.env': '🔐',
  '.toml': '⚙️',
  '.lock': '🔒',
  default: '📄',
};

function getFileIconFromPath(path: string): string {
  const ext = '.' + path.split('.').pop()?.toLowerCase();
  return FILE_ICONS[ext] || FILE_ICONS.default;
}

function getAgentIcon(agentClass: string): string {
  const classInfo = AGENT_CLASSES[agentClass as keyof typeof AGENT_CLASSES];
  return classInfo?.icon || '🤖';
}

// Format duration in human readable form
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ago`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

// Format timestamp to relative time
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  return formatDuration(diff);
}

export function Spotlight({
  isOpen,
  onClose,
  onOpenSpawnModal,
  onOpenCommanderView,
  onOpenToolbox,
  onOpenSupervisor,
  onOpenFileExplorer,
}: SpotlightProps) {
  const state = useStore();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      // Focus input after a small delay to ensure modal is rendered
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);

      // Request supervisor history for all agents that haven't had their full history fetched
      const agents = Array.from(state.agents.values());
      for (const agent of agents) {
        // Request history if not already fetched and not currently loading
        if (!store.hasHistoryBeenFetched(agent.id) && !store.isLoadingHistoryForAgent(agent.id)) {
          store.requestAgentSupervisorHistory(agent.id);
        }
      }
    }
  }, [isOpen, state.agents]);

  // Capture Alt+N/P at window level to prevent global shortcuts (like spawn agent)
  useEffect(() => {
    if (!isOpen) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Capture Alt+N/P to prevent global shortcuts from firing
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'n' || e.key === 'p' || e.key === 'N' || e.key === 'P')) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    };

    // Add with capture to intercept before global shortcut handlers
    window.addEventListener('keydown', handleGlobalKeyDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, { capture: true });
    };
  }, [isOpen]);

  // Get shortcuts for display
  const shortcuts = store.getShortcuts();

  // Build command results
  const commands: SearchResult[] = useMemo(() => {
    const spawnShortcut = shortcuts.find(s => s.id === 'spawn-agent');
    const commanderShortcut = shortcuts.find(s => s.id === 'toggle-commander');

    return [
      {
        id: 'cmd-spawn',
        type: 'command',
        title: 'Spawn New Agent',
        subtitle: spawnShortcut ? formatShortcut(spawnShortcut) : 'Alt+N',
        icon: '➕',
        action: () => {
          onClose();
          onOpenSpawnModal();
        },
      },
      {
        id: 'cmd-commander',
        type: 'command',
        title: 'Commander View',
        subtitle: commanderShortcut ? formatShortcut(commanderShortcut) : 'Ctrl+K',
        icon: '📊',
        action: () => {
          onClose();
          onOpenCommanderView();
        },
      },
      {
        id: 'cmd-settings',
        type: 'command',
        title: 'Settings & Tools',
        subtitle: 'Configure Tide Commander',
        icon: '⚙️',
        action: () => {
          onClose();
          onOpenToolbox();
        },
      },
      {
        id: 'cmd-supervisor',
        type: 'command',
        title: 'Supervisor Overview',
        subtitle: 'View agent analysis',
        icon: '🎖️',
        action: () => {
          onClose();
          onOpenSupervisor();
        },
      },
    ];
  }, [shortcuts, onClose, onOpenSpawnModal, onOpenCommanderView, onOpenToolbox, onOpenSupervisor]);

  // Build agent results with supervisor history, modified files, and user queries included in searchable text
  const agentResults: SearchResult[] = useMemo(() => {
    const fileChanges = state.fileChanges || [];

    return Array.from(state.agents.values()).map((agent: Agent) => {
      // Get ALL supervisor history for this agent (sorted by timestamp, newest first)
      const history = store.getAgentSupervisorHistory(agent.id);
      const latestEntry = history.length > 0 ? history[0] : null;

      // Build history entries array for searching (includes all entries)
      const historyEntries: { text: string; timestamp: number }[] = history.map(entry => ({
        text: `${entry.analysis.statusDescription} ${entry.analysis.recentWorkSummary}`,
        timestamp: entry.timestamp,
      }));

      // Get modified files for this agent
      const agentFiles = fileChanges
        .filter(fc => fc.agentId === agent.id)
        .map(fc => fc.filePath);
      // Get unique file names for search
      const uniqueFiles = [...new Set(agentFiles)];
      const fileNames = uniqueFiles.map(fp => fp.split('/').pop() || fp);

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
          onClose();
          store.selectAgent(agent.id);
        },
      };
    });
  }, [state.agents, state.supervisor.agentHistories, state.fileChanges, onClose]);

  // Build area results
  const areaResults: SearchResult[] = useMemo(() => {
    return Array.from(state.areas.values()).map((area: DrawingArea) => ({
      id: `area-${area.id}`,
      type: 'area' as const,
      title: area.name,
      subtitle: `${area.assignedAgentIds.length} agents • ${area.directories?.length || 0} folders`,
      icon: '🗺️',
      action: () => {
        onClose();
        store.selectArea(area.id);
      },
    }));
  }, [state.areas, onClose]);

  // Build modified files results from file changes
  const modifiedFileResults: SearchResult[] = useMemo(() => {
    const fileChanges = state.fileChanges || [];
    const seenPaths = new Set<string>();
    const results: SearchResult[] = [];

    // Get unique file paths with their most recent change
    for (const change of fileChanges) {
      if (seenPaths.has(change.filePath)) continue;
      seenPaths.add(change.filePath);

      const fileName = change.filePath.split('/').pop() || change.filePath;
      const actionLabel = change.action === 'created' ? 'Created' :
                          change.action === 'modified' ? 'Modified' :
                          change.action === 'deleted' ? 'Deleted' : 'Read';

      results.push({
        id: `modified-${change.filePath}-${change.timestamp}`,
        type: 'modified-file',
        title: fileName,
        subtitle: `${actionLabel} by ${change.agentName} • ${change.filePath}`,
        matchedText: change.filePath,
        icon: change.action === 'deleted' ? '🗑️' : getFileIconFromPath(change.filePath),
        action: () => {
          onClose();
          // Try to find an area that contains this file
          const areas = Array.from(state.areas.values());
          for (const area of areas) {
            for (const dir of area.directories || []) {
              if (change.filePath.startsWith(dir)) {
                store.setFileViewerPath(change.filePath);
                onOpenFileExplorer(area.id);
                return;
              }
            }
          }
          // If no area found, just select the agent
          const agent = state.agents.get(change.agentId);
          if (agent) {
            store.selectAgent(change.agentId);
          }
        },
      });

      // Limit to 50 unique files
      if (results.length >= 50) break;
    }

    return results;
  }, [state.fileChanges, state.areas, state.agents, onClose, onOpenFileExplorer]);

  // Build activity results from supervisor history (searchable by status/summary text)
  const activityResults: SearchResult[] = useMemo(() => {
    const results: SearchResult[] = [];
    const agents = Array.from(state.agents.values());

    for (const agent of agents) {
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
            onClose();
            store.selectAgent(agent.id);
          },
        });
      }
    }

    return results;
  }, [state.agents, state.supervisor.agentHistories, onClose]);

  // Create Fuse instances for fuzzy search
  // ignoreLocation: true allows matching anywhere in the text (not just first 600 chars)
  // This is important for searching through all supervisor history entries
  const agentFuse = useMemo(() => new Fuse(agentResults, {
    keys: ['title', 'subtitle', '_searchText', 'activityText', 'lastUserInput'],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
    includeMatches: true,
  }), [agentResults]);

  const commandFuse = useMemo(() => new Fuse(commands, {
    keys: ['title', 'subtitle'],
    threshold: 0.4,
    includeScore: true,
    includeMatches: true,
  }), [commands]);

  const areaFuse = useMemo(() => new Fuse(areaResults, {
    keys: ['title', 'subtitle'],
    threshold: 0.4,
    includeScore: true,
    includeMatches: true,
  }), [areaResults]);

  const modifiedFileFuse = useMemo(() => new Fuse(modifiedFileResults, {
    keys: ['title', 'subtitle', 'matchedText'],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
    includeMatches: true,
  }), [modifiedFileResults]);

  const activityFuse = useMemo(() => new Fuse(activityResults, {
    keys: ['title', 'subtitle', 'matchedText', 'activityText'],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
    includeMatches: true,
  }), [activityResults]);

  // Compute search results
  const results = useMemo(() => {
    if (!query.trim()) {
      // Show recent/suggested items when no query - prioritize agents
      const suggested: SearchResult[] = [];

      // Show all agents first, sorted by time away (shortest idle first = finished more recently)
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

      return suggested;
    }

    // Search each category
    const matchedAgents = agentFuse.search(query).slice(0, 8);
    const matchedCommands = commandFuse.search(query).slice(0, 3);
    const matchedAreas = areaFuse.search(query).slice(0, 2);
    const matchedModifiedFiles = modifiedFileFuse.search(query).slice(0, 3);
    const matchedActivities = activityFuse.search(query).slice(0, 3);

    // Combine results - AGENTS FIRST (priority)
    const finalResults: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    // Agents first - check for matching files and user queries
    for (const r of matchedAgents) {
      const item = { ...r.item };
      // Find files that match the query
      if (item._modifiedFiles && item._modifiedFiles.length > 0) {
        const matchingFiles = item._modifiedFiles.filter(fp => {
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
        const matchingQuery = item._userQueries.find(q =>
          q.toLowerCase().includes(lowerQuery)
        );
        if (matchingQuery) {
          // Truncate the query if it's too long (show context around match)
          const maxLen = 200;
          if (matchingQuery.length > maxLen) {
            const matchIdx = matchingQuery.toLowerCase().indexOf(lowerQuery);
            const start = Math.max(0, matchIdx - 60);
            const end = Math.min(matchingQuery.length, matchIdx + lowerQuery.length + 100);
            item.matchedQuery = (start > 0 ? '...' : '') + matchingQuery.slice(start, end) + (end < matchingQuery.length ? '...' : '');
          } else {
            item.matchedQuery = matchingQuery;
          }
        }
      }
      // Find matching history entries (prioritize newest - they come first)
      if (item._historyEntries && item._historyEntries.length > 0) {
        const matchingEntry = item._historyEntries.find(entry =>
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
              text: (start > 0 ? '...' : '') + matchingEntry.text.slice(start, end) + (end < matchingEntry.text.length ? '...' : ''),
              timestamp: matchingEntry.timestamp,
            };
          } else {
            item.matchedHistory = matchingEntry;
          }
        }
      }
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
    const agentIdsInResults = new Set(matchedAgents.map(r => r.item.id));
    for (const r of matchedActivities) {
      const activityAgentId = r.item.id.replace('activity-', '').split('-')[0];
      if (!agentIdsInResults.has(`agent-${activityAgentId}`)) {
        finalResults.push(r.item);
      }
    }

    return finalResults;
  }, [query, agentFuse, commandFuse, areaFuse, modifiedFileFuse, activityFuse, commands, agentResults, areaResults]);

  // Clamp selected index to valid range
  useEffect(() => {
    if (selectedIndex >= results.length) {
      setSelectedIndex(Math.max(0, results.length - 1));
    }
  }, [results.length, selectedIndex]);

  // Scroll selected item into view
  useEffect(() => {
    if (!resultsRef.current) return;
    const selectedEl = resultsRef.current.querySelector('.spotlight-item.selected');
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  // Keyboard navigation - handles Alt+N/P for navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Alt+P = previous (up), Alt+N = next (down)
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'p' || e.key === 'n' || e.key === 'P' || e.key === 'N')) {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      const keyLower = e.key.toLowerCase();
      if (keyLower === 'p') {
        setSelectedIndex(i => (i > 0 ? i - 1 : results.length - 1));
      } else {
        setSelectedIndex(i => (i < results.length - 1 ? i + 1 : 0));
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => (i > 0 ? i - 1 : results.length - 1));
        break;
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => (i < results.length - 1 ? i + 1 : 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (results[selectedIndex]) {
          results[selectedIndex].action();
        }
        break;
    }
  }, [onClose, results, selectedIndex]);

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Highlight matching text - improved version that highlights all occurrences
  const highlightMatch = (text: string, searchQuery: string): React.ReactNode => {
    if (!searchQuery || !text) return text;

    const lowerText = text.toLowerCase();
    const lowerQuery = searchQuery.toLowerCase();
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let idx = lowerText.indexOf(lowerQuery);
    let keyCounter = 0;

    while (idx !== -1) {
      // Add text before match
      if (idx > lastIndex) {
        parts.push(text.slice(lastIndex, idx));
      }
      // Add highlighted match
      parts.push(
        <mark key={keyCounter++} className="spotlight-highlight">
          {text.slice(idx, idx + searchQuery.length)}
        </mark>
      );
      lastIndex = idx + searchQuery.length;
      idx = lowerText.indexOf(lowerQuery, lastIndex);
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts.length > 0 ? <>{parts}</> : text;
  };

  // Get type label for display
  const getTypeLabel = (type: SearchResult['type']) => {
    switch (type) {
      case 'agent': return 'Agent';
      case 'command': return 'Command';
      case 'area': return 'Area';
      case 'activity': return 'Activity';
      case 'modified-file': return 'Changed';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="spotlight-overlay" onClick={handleBackdropClick}>
      <div className="spotlight-modal" onKeyDown={handleKeyDown}>
        <div className="spotlight-input-wrapper">
          <span className="spotlight-search-icon">🔍</span>
          <input
            ref={inputRef}
            type="text"
            className="spotlight-input"
            placeholder="Search agents, commands, activity..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <span className="spotlight-shortcut-hint">Alt+P</span>
        </div>

        <div className="spotlight-results" ref={resultsRef}>
          {results.length === 0 ? (
            <div className="spotlight-empty">
              No results found
            </div>
          ) : (
            results.map((result, index) => (
              <div
                key={result.id}
                className={`spotlight-item ${index === selectedIndex ? 'selected' : ''} ${result.activityText ? 'has-activity' : ''}`}
                onClick={() => result.action()}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className="spotlight-item-icon">{result.icon}</span>
                <div className="spotlight-item-content">
                  <div className="spotlight-item-header">
                    <span className="spotlight-item-title">
                      {highlightMatch(result.title, query)}
                    </span>
                    {result.lastUserInput && (
                      <span className="spotlight-item-last-input">
                        {highlightMatch(result.lastUserInput, query)}
                      </span>
                    )}
                  </div>
                  {result.subtitle && (
                    <span className="spotlight-item-subtitle">
                      {highlightMatch(result.subtitle, query)}
                    </span>
                  )}
                  {result.statusDescription && (
                    <span className="spotlight-item-status">
                      {highlightMatch(result.statusDescription, query)}
                    </span>
                  )}
                  {result.activityText && (
                    <span className="spotlight-item-activity">
                      {highlightMatch(result.activityText, query)}
                    </span>
                  )}
                  {result.matchedFiles && result.matchedFiles.length > 0 && (
                    <span className="spotlight-item-files">
                      📁 {result.matchedFiles.map((fp, i) => (
                        <span key={fp}>
                          {i > 0 && ', '}
                          {highlightMatch(fp.split('/').pop() || fp, query)}
                        </span>
                      ))}
                    </span>
                  )}
                  {result.matchedQuery && (
                    <span className="spotlight-item-query">
                      💬 {highlightMatch(result.matchedQuery, query)}
                    </span>
                  )}
                  {result.matchedHistory && (
                    <span className="spotlight-item-history">
                      📜 {highlightMatch(result.matchedHistory.text, query)}
                      <span className="spotlight-history-time">
                        {formatRelativeTime(result.matchedHistory.timestamp)}
                      </span>
                    </span>
                  )}
                  {(result.timeAway !== undefined || result.lastStatusTime !== undefined) && (
                    <span className="spotlight-item-time">
                      {result.timeAway !== undefined && (
                        <span className="spotlight-time-away">
                          ⏱️ {formatDuration(result.timeAway)}
                        </span>
                      )}
                      {result.lastStatusTime !== undefined && (
                        <span className="spotlight-status-time">
                          📊 Status {formatRelativeTime(result.lastStatusTime)}
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <span className={`spotlight-item-type ${result.type}`}>{getTypeLabel(result.type)}</span>
              </div>
            ))
          )}
        </div>

        <div className="spotlight-footer">
          <span className="spotlight-footer-hint">
            <kbd>↑↓</kbd> or <kbd>Alt</kbd>+<kbd>P/N</kbd> Navigate
          </span>
          <span className="spotlight-footer-hint">
            <kbd>Enter</kbd> Select
          </span>
          <span className="spotlight-footer-hint">
            <kbd>Esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
}
