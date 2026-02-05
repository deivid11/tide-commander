import React, { ReactNode } from 'react';
import { TreeNodeData } from './types';
import styles from './sidebar-tree-view.module.scss';

interface TreeNodeItemProps {
  node: TreeNodeData;
  isExpanded: boolean;
  isSelected: boolean;
  onToggleExpand: (nodeId: string) => void;
  onSelect: (nodeId: string, type: 'agent' | 'building', multi: boolean) => void;
  children?: ReactNode;
  searchHighlight?: string;
}

/**
 * Individual tree node item with icon, status indicator, and expand/collapse arrow
 */
export const TreeNodeItem = React.memo(
  ({
    node,
    isExpanded,
    isSelected,
    onToggleExpand,
    onSelect,
    children,
    searchHighlight,
  }: TreeNodeItemProps) => {
    const handleToggleExpand = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (node.hasChildren) {
        onToggleExpand(node.id);
      }
    };

    const handleSelect = (e: React.MouseEvent) => {
      e.stopPropagation();
      const isMultiSelect = e.ctrlKey || e.metaKey;
      const entityType = node.type === 'agent' || node.type === 'boss-subordinates' ? 'agent' : 'building';
      onSelect(node.id, entityType, isMultiSelect);
    };

    const statusClass = `sidebar-tree-view__node--status-${node.status}`;
    const nodeClass = `${styles['sidebar-tree-view__node']} ${
      isSelected ? styles['sidebar-tree-view__node--selected'] : ''
    } ${statusClass}`;

    // Highlight search matches in label
    let displayLabel: ReactNode = node.label;
    if (searchHighlight) {
      const query = searchHighlight.toLowerCase();
      const labelLower = node.label.toLowerCase();
      if (labelLower.includes(query)) {
        const parts = node.label.split(new RegExp(`(${searchHighlight})`, 'gi'));
        displayLabel = (
          <>
            {parts.map((part, i) =>
              part.toLowerCase() === query.toLowerCase() ? (
                <span key={i} className={styles['sidebar-tree-view__highlight']}>
                  {part}
                </span>
              ) : (
                part
              )
            )}
          </>
        );
      }
    }

    return (
      <>
        <div
          className={nodeClass}
          onClick={handleSelect}
          style={{ paddingLeft: `${node.level * 16 + 8}px` }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              handleSelect(e as any);
            }
          }}
        >
          {/* Expand/Collapse Arrow */}
          {node.hasChildren ? (
            <button
              className={`${styles['sidebar-tree-view__expand-btn']} ${
                isExpanded ? styles['sidebar-tree-view__expand-btn--expanded'] : ''
              }`}
              onClick={handleToggleExpand}
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
              tabIndex={-1}
            >
              <span className={styles['sidebar-tree-view__arrow']}>▸</span>
            </button>
          ) : (
            <div className={styles['sidebar-tree-view__expand-placeholder']} />
          )}

          {/* Status Indicator */}
          <span
            className={`${styles['sidebar-tree-view__status-indicator']} ${styles[statusClass]}`}
            aria-label={`Status: ${node.status}`}
            title={`Status: ${node.status}`}
          />

          {/* Icon */}
          <span className={styles['sidebar-tree-view__icon']}>{node.icon}</span>

          {/* Label */}
          <span className={styles['sidebar-tree-view__label']}>{displayLabel}</span>
        </div>

        {/* Children */}
        {isExpanded && children && (
          <div className={styles['sidebar-tree-view__children']}>
            {children}
          </div>
        )}
      </>
    );
  },
  (prevProps, nextProps) => {
    // Custom equality check for memoization
    return (
      prevProps.node.id === nextProps.node.id &&
      prevProps.isExpanded === nextProps.isExpanded &&
      prevProps.isSelected === nextProps.isSelected &&
      prevProps.searchHighlight === nextProps.searchHighlight &&
      prevProps.children === nextProps.children
    );
  }
);

TreeNodeItem.displayName = 'TreeNodeItem';
