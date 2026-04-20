/**
 * Types and constants for the Spotlight component family
 */

// Types imported but used via SearchResultType and SearchResult interface
import type {} from '../../../shared/types';
import type React from 'react';
import type { IconName } from '../Icon';

// Search result types
export type SearchResultType = 'agent' | 'command' | 'area' | 'modified-file' | 'building';

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle?: string;
  lastUserInput?: string; // Last user input/task for agents (always shown)
  activityText?: string; // Last activity text
  matchedText?: string; // The text that matched the search query
  matchedFiles?: string[]; // Files that matched the search query (for agents)
  matchedQuery?: string; // User query that matched the search
  timeAway?: number; // Time away in milliseconds (for agents)
  icon: React.ReactNode;
  action: () => void;
  // Internal fields for searching
  _searchText?: string;
  _modifiedFiles?: string[];
  _userQueries?: string[];
}

// Props for the main Spotlight component
export interface SpotlightProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSpawnModal: () => void;
  onOpenCommanderView: () => void;
  onOpenToolbox: () => void;
  onOpenFileExplorer: (areaId: string) => void;
  onOpenPM2LogsModal: (buildingId: string) => void;
  onOpenBossLogsModal: (buildingId: string) => void;
  onOpenDatabasePanel: (buildingId: string) => void;
  onOpenMonitoringModal?: () => void;
}

// Options for the useSpotlightSearch hook
export interface UseSpotlightSearchOptions {
  isOpen: boolean;
  onClose: () => void;
  onOpenSpawnModal: () => void;
  onOpenCommanderView: () => void;
  onOpenToolbox: () => void;
  onOpenFileExplorer: (areaId: string) => void;
  onOpenPM2LogsModal: (buildingId: string) => void;
  onOpenBossLogsModal: (buildingId: string) => void;
  onOpenDatabasePanel: (buildingId: string) => void;
  onOpenMonitoringModal?: () => void;
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

// Semantic icon names for modified files by extension, rendered via <Icon>
export const FILE_ICON_NAMES: Record<string, IconName> = {
  '.ts': 'file-code',
  '.tsx': 'atom',
  '.js': 'file-code',
  '.jsx': 'atom',
  '.py': 'file-code',
  '.rs': 'file-code',
  '.go': 'file-code',
  '.md': 'file-text',
  '.json': 'clipboard',
  '.yaml': 'gear',
  '.yml': 'gear',
  '.css': 'palette',
  '.scss': 'palette',
  '.html': 'globe',
  '.sql': 'database',
  '.sh': 'terminal',
  '.env': 'lock',
  '.toml': 'gear',
  '.lock': 'lock',
  default: 'file-text',
};
