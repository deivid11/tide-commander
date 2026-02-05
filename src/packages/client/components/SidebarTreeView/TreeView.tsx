import React, { useState, useMemo, useCallback, ReactNode } from 'react';
import { Agent, Building } from '@packages/shared/types';
import { TreeNodeItem } from './TreeNodeItem';
import { TreeNodeData, ExpandedState, FilterOptions } from './types';
import {
  buildAgentTreeNodes,
  buildBuildingTreeNodes,
  filterTreeNodes,
  toggleExpandedState,
} from './utils';
import styles from './sidebar-tree-view.module.scss';

interface TreeViewProps {
  agents: Map<string, Agent>;
  buildings: Map<string, Building>;
  selectedAgentIds: Set<string>;
  selectedBuildingIds: Set<string>;
  onSelectAgent: (agentId: string, multi: boolean) => void;
  onSelectBuilding: (buildingId: string, multi: boolean) => void;
  filters: FilterOptions;
  mode: 'agents' | 'buildings' | 'both';
}

/**
 * Main tree view container that manages expanded state and rendering
 */
export const TreeView = React.memo(
  ({
    agents,
    buildings,
    selectedAgentIds,
    selectedBuildingIds,
    onSelectAgent,
    onSelectBuilding,
    filters,
    mode,
  }: TreeViewProps) => {
    const [expandedState, setExpandedState] = useState<ExpandedState>({});

    // Build tree nodes for agents and buildings
    const agentNodes = useMemo(
      () => buildAgentTreeNodes(agents, selectedAgentIds),
      [agents, selectedAgentIds]
    );

    const buildingNodes = useMemo(
      () => buildBuildingTreeNodes(buildings, selectedBuildingIds),
      [buildings, selectedBuildingIds]
    );

    // Filter nodes based on search and status filters
    const filteredAgentNodes = useMemo(
      () => (mode === 'agents' || mode === 'both' ? filterTreeNodes(agentNodes, filters) : []),
      [agentNodes, filters, mode]
    );

    const filteredBuildingNodes = useMemo(
      () => (mode === 'buildings' || mode === 'both' ? filterTreeNodes(buildingNodes, filters) : []),
      [buildingNodes, filters, mode]
    );

    const handleToggleExpand = useCallback((nodeId: string) => {
      setExpandedState((prev) => toggleExpandedState(nodeId, prev));
    }, []);

    const handleSelect = useCallback(
      (nodeId: string, type: 'agent' | 'building', multi: boolean) => {
        if (type === 'agent') {
          onSelectAgent(nodeId, multi);
        } else {
          onSelectBuilding(nodeId, multi);
        }
      },
      [onSelectAgent, onSelectBuilding]
    );

    // Recursively render tree nodes with children
    const renderNode = (
      node: TreeNodeData,
      allAgents: Map<string, Agent>,
      allBuildings: Map<string, Building>
    ): ReactNode => {
      const isExpanded = expandedState[node.id] !== false;
      const isSelected =
        node.type === 'agent'
          ? selectedAgentIds.has(node.id)
          : selectedBuildingIds.has(node.id);

      let childNodes: TreeNodeData[] = [];

      if (node.type === 'agent' && node.data) {
        const agent = node.data as Agent;
        if (agent.subordinateIds) {
          childNodes = agent.subordinateIds
            .map((id) => {
              const subAgent = allAgents.get(id);
              if (!subAgent) return null;

              return {
                id: subAgent.id,
                label: subAgent.name,
                type: 'agent' as const,
                icon: node.icon,
                status: 'working' as const,
                level: node.level + 1,
                hasChildren: (subAgent.subordinateIds || []).length > 0,
                data: subAgent,
              };
            })
            .filter((n): n is TreeNodeData => n !== null);
        }
      }

      if (node.type === 'building' && node.data) {
        const building = node.data as Building;
        if (building.subordinateBuildingIds) {
          childNodes = building.subordinateBuildingIds
            .map((id) => {
              const subBuilding = allBuildings.get(id);
              if (!subBuilding) return null;

              return {
                id: subBuilding.id,
                label: subBuilding.name,
                type: 'building' as const,
                icon: node.icon,
                status: 'working' as const,
                level: node.level + 1,
                hasChildren: (subBuilding.subordinateBuildingIds || []).length > 0,
                data: subBuilding,
              };
            })
            .filter((n): n is TreeNodeData => n !== null);
        }
      }

      return (
        <div key={node.id}>
          <TreeNodeItem
            node={node}
            isExpanded={isExpanded}
            isSelected={isSelected}
            onToggleExpand={handleToggleExpand}
            onSelect={handleSelect}
            searchHighlight={filters.searchQuery}
          >
            {childNodes.length > 0 &&
              childNodes.map((child) => renderNode(child, allAgents, allBuildings))}
          </TreeNodeItem>
        </div>
      );
    };

    return (
      <div className={styles['sidebar-tree-view__container']}>
        {/* Agents Section */}
        {(mode === 'agents' || mode === 'both') && filteredAgentNodes.length > 0 && (
          <div className={styles['sidebar-tree-view__section']}>
            <h3 className={styles['sidebar-tree-view__section-title']}>Agents</h3>
            <div className={styles['sidebar-tree-view__section-content']}>
              {filteredAgentNodes.map((node) => renderNode(node, agents, buildings))}
            </div>
          </div>
        )}

        {/* Buildings Section */}
        {(mode === 'buildings' || mode === 'both') && filteredBuildingNodes.length > 0 && (
          <div className={styles['sidebar-tree-view__section']}>
            <h3 className={styles['sidebar-tree-view__section-title']}>Buildings</h3>
            <div className={styles['sidebar-tree-view__section-content']}>
              {filteredBuildingNodes.map((node) => renderNode(node, agents, buildings))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {filteredAgentNodes.length === 0 && filteredBuildingNodes.length === 0 && (
          <div className={styles['sidebar-tree-view__empty']}>
            No results found
          </div>
        )}
      </div>
    );
  }
);

TreeView.displayName = 'TreeView';
