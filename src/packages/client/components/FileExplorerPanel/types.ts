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
  gitStatus?: GitFileStatusType;
}

// ============================================================================
// FILE TYPES
// ============================================================================

export type FileType = 'text' | 'image' | 'pdf' | 'binary';

export interface FileData {
  path: string;
  filename: string;
  extension: string;
  content: string;
  size: number;
  modified: string;
  fileType: FileType;
  // For images/binary, this is a data URL or blob URL
  dataUrl?: string;
}

// ============================================================================
// FILE TAB TYPES
// ============================================================================

export interface FileTab {
  path: string;
  filename: string;
  extension: string;
  // Cache the file data so switching tabs is instant
  data?: FileData;
}

export interface FileTabsProps {
  tabs: FileTab[];
  activeTabPath: string | null;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
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
  // Direct folder path (for opening without an area, e.g., from folder buildings)
  folderPath?: string | null;
}

export interface TreeNodeProps {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  expandedPaths: Set<string>;
  onSelect: (node: TreeNode) => void;
  onToggle: (path: string) => void | Promise<void>;
  searchQuery: string;
}

export interface FileViewerProps {
  file: FileData | null;
  loading: boolean;
  error: string | null;
  onRevealInTree?: (path: string) => void;
  scrollToLine?: number;
}

export interface SearchResultsProps {
  results: TreeNode[];
  onSelect: (node: TreeNode) => void;
  selectedPath: string | null;
  query: string;
}

// ============================================================================
// CONTENT SEARCH TYPES
// ============================================================================

export interface ContentMatch {
  path: string;
  name: string;
  extension: string;
  matches: {
    line: number;
    content: string;
    context?: { before: string; after: string };
  }[];
}

export interface ContentSearchResultsProps {
  results: ContentMatch[];
  onSelect: (path: string, line?: number) => void;
  selectedPath: string | null;
  query: string;
}

export interface GitChangesProps {
  gitStatus: GitStatus | null;
  loading: boolean;
  onFileSelect: (path: string, status: GitFileStatusType) => void;
  selectedPath: string | null;
  onRefresh: () => void;
  onStageFiles: (paths: string[]) => Promise<void>;
  stagingPaths: Set<string>;
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
  togglePath: (path: string) => void | Promise<void>;
  setExpandedPaths: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export interface UseGitStatusReturn {
  gitStatus: GitStatus | null;
  loading: boolean;
  loadGitStatus: () => Promise<void>;
}

// ============================================================================
// GIT BRANCH TYPES
// ============================================================================

export interface GitBranch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  remote?: string;
  lastCommit?: string;
  lastMessage?: string;
}

export interface GitBranchListResponse {
  branches: GitBranch[];
  currentBranch: string;
  remotes: string[];
}

export interface GitBranchOperationResult {
  success: boolean;
  error?: string;
  branch?: string;
  output?: string;
}

export interface UseGitBranchesReturn {
  branches: GitBranch[];
  loading: boolean;
  error: string | null;
  operationInProgress: string | null;
  loadBranches: (directory: string) => Promise<void>;
  checkoutBranch: (directory: string, branch: string) => Promise<GitBranchOperationResult>;
  createBranch: (directory: string, name: string, startPoint?: string) => Promise<GitBranchOperationResult>;
  pullFromRemote: (directory: string) => Promise<GitBranchOperationResult>;
  pushToRemote: (directory: string) => Promise<GitBranchOperationResult>;
}

export interface UseFileContentReturn {
  file: FileData | null;
  loading: boolean;
  error: string | null;
  loadFile: (filePath: string) => Promise<void>;
  clearFile: () => void;
}
