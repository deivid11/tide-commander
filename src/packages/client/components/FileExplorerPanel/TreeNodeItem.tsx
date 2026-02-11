/**
 * TreeNodeItem - File tree node component
 *
 * Renders a single node in the file tree with expansion support.
 * Following ClaudeOutputPanel's component decomposition pattern.
 */

import React, { memo, useMemo } from 'react';
import type { TreeNode, TreeNodeProps, GitFileStatusType } from './types';
import { getFileIcon, findMatchIndices } from './fileUtils';

// ============================================================================
// GIT STATUS COLOR MAPPING
// ============================================================================

function getGitStatusColor(status?: GitFileStatusType): string | undefined {
  switch (status) {
    case 'modified': return '#c89a5a';   // Muted orange
    case 'added': return '#5cb88a';      // Muted green
    case 'deleted': return '#c85a5a';    // Muted red
    case 'untracked': return '#6ab8c8';  // Muted cyan
    case 'renamed': return '#9a80c0';    // Muted purple
    default: return undefined;
  }
}

/**
 * Sort nodes: folders first, then files, both alphabetically (case-insensitive)
 */
function sortChildren(children: TreeNode[]): TreeNode[] {
  return [...children].sort((a, b) => {
    // Folders first
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    // Alphabetical (case-insensitive)
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

// ============================================================================
// HIGHLIGHT MATCH COMPONENT
// ============================================================================

interface HighlightMatchProps {
  text: string;
  query: string;
}

function HighlightMatch({ text, query }: HighlightMatchProps) {
  const match = findMatchIndices(text, query);

  if (!match) return <>{text}</>;

  return (
    <>
      {text.slice(0, match.start)}
      <mark className="search-highlight">
        {text.slice(match.start, match.end)}
      </mark>
      {text.slice(match.end)}
    </>
  );
}

// ============================================================================
// TREE NODE COMPONENT
// ============================================================================

function TreeNodeItemComponent({
  node,
  depth,
  selectedPath,
  expandedPaths,
  onSelect,
  onToggle,
  searchQuery,
}: TreeNodeProps) {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;
  const gitStatusColor = getGitStatusColor(node.gitStatus);

  // Memoize sorted children to avoid re-sorting on every render
  const sortedChildren = useMemo(
    () => (node.children ? sortChildren(node.children) : []),
    [node.children]
  );

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.isDirectory) {
      onToggle(node.path);
    } else {
      onSelect(node);
    }
  };

  return (
    <div className="tree-node-wrapper">
      <div
        className={`tree-node ${isSelected ? 'selected' : ''} ${
          node.isDirectory ? 'directory' : 'file'
        } ${isExpanded ? 'expanded' : ''}`}
        style={{ paddingLeft: `${depth * 16}px` }}
        onClick={handleClick}
        data-path={node.path}
      >
        {node.isDirectory ? (
          <>
            <span className={`tree-arrow ${isExpanded ? 'expanded' : ''}`}>
              ▸
            </span>
            <img
              className="tree-folder-icon"
              src={isExpanded ? '/assets/vscode-icons/default_folder_opened.svg' : '/assets/vscode-icons/default_folder.svg'}
              alt="folder"
            />
          </>
        ) : (
          <>
            <span className="tree-arrow-spacer" />
            <img className="tree-icon" src={getFileIcon(node)} alt="file" />
          </>
        )}
        <span className="tree-name" style={gitStatusColor ? { color: gitStatusColor } : undefined}>
          <HighlightMatch text={node.name} query={searchQuery} />
        </span>
      </div>

      {node.isDirectory && isExpanded && sortedChildren.length > 0 && (
        <div className="tree-children">
          {sortedChildren.map((child) => (
            <TreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onSelect={onSelect}
              onToggle={onToggle}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Memoized TreeNodeItem component
 * Prevents unnecessary re-renders when other parts of the tree change
 */
export const TreeNodeItem = memo(TreeNodeItemComponent, (prev, next) => {
  // Re-render if:
  // 1. The node itself changes
  // 2. Selection state changes for this node
  // 3. Expansion state changes for this node (if directory)
  // 4. Search query changes
  // 5. expandedPaths reference changes (to propagate to children)

  if (prev.node !== next.node) return false;
  if (prev.depth !== next.depth) return false;
  if (prev.searchQuery !== next.searchQuery) return false;

  // Check if this node's selection changed
  const wasSelected = prev.selectedPath === prev.node.path;
  const isSelected = next.selectedPath === next.node.path;
  if (wasSelected !== isSelected) return false;

  // Check if this node's expansion changed (for directories)
  if (prev.node.isDirectory) {
    const wasExpanded = prev.expandedPaths.has(prev.node.path);
    const isExpanded = next.expandedPaths.has(next.node.path);
    if (wasExpanded !== isExpanded) return false;

    // If this node is expanded, we need to re-render when expandedPaths changes
    // so children can receive the updated Set
    if (isExpanded && prev.expandedPaths !== next.expandedPaths) {
      return false;
    }
  }

  return true;
});

TreeNodeItem.displayName = 'TreeNodeItem';
