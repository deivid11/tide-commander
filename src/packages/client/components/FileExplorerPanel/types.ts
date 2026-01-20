/**
 * Types for the FileExplorerPanel component family
 *
 * Centralized type definitions following ClaudeOutputPanel patterns.
 */

// ============================================================================
// TREE TYPES
// ============================================================================

export interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  extension: string;
  children?: TreeNode[];
}

// ============================================================================
// FILE TYPES
// ============================================================================

export interface FileData {
  path: string;
  filename: string;
  extension: string;
  content: string;
  size: number;
  modified: string;
}

// ============================================================================
// GIT TYPES
// ============================================================================

export type GitFileStatusType = 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';

export interface GitFileStatus {
  path: string;
  name: string;
  status: GitFileStatusType;
  oldPath?: string;
}

export interface GitStatusCounts {
  modified: number;
  added: number;
  deleted: number;
  untracked: number;
  renamed: number;
}

export interface GitStatus {
  isGitRepo: boolean;
  branch?: string;
  files: GitFileStatus[];
  counts?: GitStatusCounts;
}

// ============================================================================
// VIEW TYPES
// ============================================================================

export type ViewMode = 'files' | 'git';

// ============================================================================
// COMPONENT PROPS
// ============================================================================

export interface FileExplorerPanelProps {
  isOpen: boolean;
  areaId: string | null;
  onClose: () => void;
  onChangeArea?: (areaId: string) => void;
}

export interface TreeNodeProps {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  expandedPaths: Set<string>;
  onSelect: (node: TreeNode) => void;
  onToggle: (path: string) => void;
  searchQuery: string;
}

export interface FileViewerProps {
  file: FileData | null;
  loading: boolean;
  error: string | null;
}

export interface SearchResultsProps {
  results: TreeNode[];
  onSelect: (node: TreeNode) => void;
  selectedPath: string | null;
  query: string;
}

export interface GitChangesProps {
  gitStatus: GitStatus | null;
  loading: boolean;
  onFileSelect: (path: string, status: GitFileStatusType) => void;
  selectedPath: string | null;
  onRefresh: () => void;
}

// ============================================================================
// FOLDER TYPES
// ============================================================================

export interface FolderInfo {
  path: string;
  areaId: string;
  areaName: string;
  areaColor: string;
}

// ============================================================================
// HOOK RETURN TYPES
// ============================================================================

export interface UseFileTreeReturn {
  tree: TreeNode[];
  loading: boolean;
  expandedPaths: Set<string>;
  loadTree: () => Promise<void>;
  togglePath: (path: string) => void;
  setExpandedPaths: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export interface UseGitStatusReturn {
  gitStatus: GitStatus | null;
  loading: boolean;
  loadGitStatus: () => Promise<void>;
}

export interface UseFileContentReturn {
  file: FileData | null;
  loading: boolean;
  error: string | null;
  loadFile: (filePath: string) => Promise<void>;
  clearFile: () => void;
}
