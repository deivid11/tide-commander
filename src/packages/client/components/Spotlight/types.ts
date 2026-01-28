/**
 * Types and constants for the Spotlight component family
 */

import type { Agent, DrawingArea } from '../../../shared/types';

// Search result types
export type SearchResultType = 'agent' | 'command' | 'area' | 'activity' | 'modified-file' | 'building';

export interface SearchResult {
  id: string;
  type: SearchResultType;
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
  // Internal fields for searching
  _searchText?: string;
  _modifiedFiles?: string[];
  _userQueries?: string[];
  _historyEntries?: { text: string; timestamp: number }[];
}

// Props for the main Spotlight component
export interface SpotlightProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSpawnModal: () => void;
  onOpenCommanderView: () => void;
  onOpenToolbox: () => void;
  onOpenSupervisor: () => void;
  onOpenFileExplorer: (areaId: string) => void;
  onOpenPM2LogsModal: (buildingId: string) => void;
  onOpenBossLogsModal: (buildingId: string) => void;
}

// Options for the useSpotlightSearch hook
export interface UseSpotlightSearchOptions {
  isOpen: boolean;
  onClose: () => void;
  onOpenSpawnModal: () => void;
  onOpenCommanderView: () => void;
  onOpenToolbox: () => void;
  onOpenSupervisor: () => void;
  onOpenFileExplorer: (areaId: string) => void;
  onOpenPM2LogsModal: (buildingId: string) => void;
  onOpenBossLogsModal: (buildingId: string) => void;
}

// Return type for useSpotlightSearch hook
export interface SpotlightSearchState {
  // Query state
  query: string;
  setQuery: (value: string) => void;

  // Selection state
  selectedIndex: number;
  setSelectedIndex: (value: number | ((prev: number) => number)) => void;

  // Results
  results: SearchResult[];

  // Navigation handlers
  handleKeyDown: (e: React.KeyboardEvent) => void;

  // Highlighting
  highlightMatch: (text: string, searchQuery: string) => React.ReactNode;
}

// File icons for modified files
export const FILE_ICONS: Record<string, string> = {
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
