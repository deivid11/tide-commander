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

interface CompactChain {
  displayName: string;
  terminalNode: TreeNode;
  expansionPath: string;
}

function getCompactChain(node: TreeNode): CompactChain {
  if (!node.isDirectory) {
    return {
      displayName: node.name,
      terminalNode: node,
      expansionPath: node.path,
    };
  }

  const names = [node.name];
  let terminalNode = node;

  // IntelliJ-style compaction: collapse A/B/C when each directory has exactly one directory child.
  while (
    terminalNode.children &&
    terminalNode.children.length === 1 &&
    terminalNode.children[0]?.isDirectory
  ) {
    terminalNode = terminalNode.children[0];
    names.push(terminalNode.name);
  }

  return {
    displayName: names.join('/'),
    terminalNode,
    expansionPath: terminalNode.path,
  };
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
  onContextMenu,
  searchQuery,
}: TreeNodeProps) {
  const compactChain = useMemo(() => getCompactChain(node), [node]);
  const isExpanded = expandedPaths.has(compactChain.expansionPath);
  const isSelected = selectedPath === node.path || selectedPath === compactChain.expansionPath;
  const gitStatusColor = getGitStatusColor(node.gitStatus);

  // Memoize sorted children to avoid re-sorting on every render
  const sortedChildren = useMemo(
    () => (compactChain.terminalNode.children ? sortChildren(compactChain.terminalNode.children) : []),
    [compactChain]
  );

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.isDirectory) {
      onToggle(compactChain.expansionPath);
    } else {
      onSelect(node);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!onContextMenu) return;
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e, compactChain.terminalNode);
  };

  return (
    <div className="tree-node-wrapper">
      <div
        className={`tree-node ${isSelected ? 'selected' : ''} ${
          node.isDirectory ? 'directory' : 'file'
        } ${isExpanded ? 'expanded' : ''}`}
        style={{ paddingLeft: `${depth * 16}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        data-path={node.path}
      >
        {node.isDirectory ? (
          <>
            <span className={`tree-arrow ${isExpanded ? 'expanded' : ''}`}>
              ▸
            </span>
            <span className="tree-folder-icon-wrapper">
              <span
                className="tree-folder-icon"
                style={{
                  backgroundImage: `url('${isExpanded ? '/assets/vscode-icons/default_folder_opened.svg' : '/assets/vscode-icons/default_folder.svg'}')`,
                }}
                role="img"
                aria-label="folder"
              />
              {node.hasGitChanges && (
                <span
                  className="tree-folder-git-dot"
                  style={{ backgroundColor: getGitStatusColor(node.gitStatus) || '#c89a5a' }}
                />
              )}
            </span>
          </>
        ) : (
          <>
            <span className="tree-arrow-spacer" />
            <span
              className="tree-icon"
              style={{
                backgroundImage: `url('${getFileIcon(node)}')`,
              }}
              role="img"
              aria-label="file"
            />
          </>
        )}
        <span className="tree-name" style={gitStatusColor ? { color: gitStatusColor } : undefined}>
          <HighlightMatch text={compactChain.displayName} query={searchQuery} />
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
              onContextMenu={onContextMenu}
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
  if (prev.onContextMenu !== next.onContextMenu) return false;

  // Check if this node's selection changed
  const prevExpansionPath = getCompactChain(prev.node).expansionPath;
  const nextExpansionPath = getCompactChain(next.node).expansionPath;
  const wasSelected = prev.selectedPath === prev.node.path || prev.selectedPath === prevExpansionPath;
  const isSelected = next.selectedPath === next.node.path || next.selectedPath === nextExpansionPath;
  if (wasSelected !== isSelected) return false;

  // Check if this node's expansion changed (for directories)
  if (prev.node.isDirectory) {
    const wasExpanded = prev.expandedPaths.has(prevExpansionPath);
    const isExpanded = next.expandedPaths.has(nextExpansionPath);
    if (wasExpanded !== isExpanded) return false;

    // If this node is expanded, we need to re-render when expandedPaths or
    // selectedPath changes so children can receive the updated values
    if (isExpanded) {
      if (prev.expandedPaths !== next.expandedPaths) return false;
      if (prev.selectedPath !== next.selectedPath) return false;
    }
  }

  return true;
});

TreeNodeItem.displayName = 'TreeNodeItem';
