# SidebarTreeView Integration Guide

## Overview

The `SidebarTreeView` component provides a hierarchical, searchable tree view for displaying and selecting agents and buildings with status indicators, expand/collapse functionality, and smooth animations.

## Features

- ✅ Hierarchical tree view with boss/subordinate relationships
- ✅ Color-coded status indicators (green=healthy, yellow=working, red=error)
- ✅ Search/filter functionality with highlighting
- ✅ Expand/collapse nodes with 300ms smooth animations
- ✅ Multi-select with Ctrl/Cmd+Click
- ✅ Responsive design for mobile (touch-friendly)
- ✅ Keyboard navigation support
- ✅ Visual selection indicators
- ✅ Icon indicators for agent classes and building types

## Components

### SidebarTreeView
Main component that handles search/filter UI and delegates to TreeView.

```tsx
<SidebarTreeView
  agents={agents}
  buildings={buildings}
  selectedAgentIds={selectedAgentIds}
  selectedBuildingIds={selectedBuildingIds}
  onSelectAgent={(agentId, multi) => store.selectAgent(agentId, multi)}
  onSelectBuilding={(buildingId, multi) => store.selectBuilding(buildingId, multi)}
  mode="both"  // 'agents', 'buildings', or 'both'
/>
```

### TreeView
Internal component that manages tree structure and expansion state.

### TreeNodeItem
Individual tree node with icon, status indicator, and label.

## Basic Integration Example

### In App.tsx or a Layout Component

```tsx
import React from 'react';
import { SidebarTreeView } from './components/SidebarTreeView';
import { store, useStore } from './store';

function AppLayout() {
  const state = useStore();

  const handleSelectAgent = (agentId: string, multi: boolean) => {
    if (multi) {
      store.addToSelection(agentId);
    } else {
      store.selectAgent(agentId);
    }
  };

  const handleSelectBuilding = (buildingId: string, multi: boolean) => {
    // Handle multi-select for buildings if needed
    store.selectBuilding(buildingId);
  };

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* Left Sidebar with Tree View */}
      <aside style={{ width: '280px', borderRight: '1px solid #1c1c28' }}>
        <SidebarTreeView
          agents={state.agents}
          buildings={state.buildings}
          selectedAgentIds={state.selectedAgentIds}
          selectedBuildingIds={state.selectedBuildingIds}
          onSelectAgent={handleSelectAgent}
          onSelectBuilding={handleSelectBuilding}
          mode="both"
        />
      </aside>

      {/* Main Canvas Area */}
      <main style={{ flex: 1 }}>
        {/* Your 3D/2D canvas here */}
      </main>

      {/* Right Panel with Details */}
      <aside style={{ width: '320px', borderLeft: '1px solid #1c1c28' }}>
        {/* Your detail panel here */}
      </aside>
    </div>
  );
}
```

## Advanced Integration with Existing Components

### Using with UnitPanel (Agent Details)

```tsx
import { UnitPanel } from './components/UnitPanel';
import { SidebarTreeView } from './components/SidebarTreeView';

function CommanderView() {
  const state = useStore();

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* Left: Tree View */}
      <aside className="sidebar">
        <SidebarTreeView
          agents={state.agents}
          buildings={state.buildings}
          selectedAgentIds={state.selectedAgentIds}
          selectedBuildingIds={state.selectedBuildingIds}
          onSelectAgent={(agentId) => store.selectAgent(agentId)}
          onSelectBuilding={(buildingId) => store.selectBuilding(buildingId)}
          mode="agents"  // Show only agents
        />
      </aside>

      {/* Center: Main Canvas */}
      <main className="canvas">
        {state.settings.experimental2DView ? (
          <Scene2DCanvas {...props} />
        ) : (
          <ThreeScene ref={canvasRef} {...props} />
        )}
      </main>

      {/* Right: Unit Panel with Details */}
      <aside className="details">
        <UnitPanel
          onFocusAgent={(agentId) => {
            // Navigate to agent in 3D view
          }}
          onKillAgent={(agentId) => {
            store.killAgent(agentId);
          }}
          onCallSubordinates={(agentId) => {
            // Handle subordinate call
          }}
          onOpenAreaExplorer={(areaId) => {
            store.openAreaExplorer(areaId);
          }}
        />
      </aside>
    </div>
  );
}
```

## State Management Integration

### With Store Selection Methods

The component expects the following store methods to be available:

```typescript
// In your store
store.selectAgent(agentId: string | null): void
store.addToSelection(agentId: string): void
store.selectBuilding(buildingId: string | null): void

// State properties
state.selectedAgentIds: Set<string>
state.selectedBuildingIds: Set<string>
state.agents: Map<string, Agent>
state.buildings: Map<string, Building>
```

### Example Store Integration

```tsx
const handleSelectAgent = (agentId: string, multi: boolean) => {
  if (multi) {
    // Ctrl/Cmd+Click: toggle selection
    if (state.selectedAgentIds.has(agentId)) {
      store.removeFromSelection(agentId);
    } else {
      store.addToSelection(agentId);
    }
  } else {
    // Regular click: replace selection
    store.selectAgent(agentId);
  }
};

const handleSelectBuilding = (buildingId: string, multi: boolean) => {
  if (multi) {
    // Implement multi-select if needed
    store.selectBuilding(buildingId);
  } else {
    store.selectBuilding(buildingId);
  }
};
```

## Customization

### Display Modes

```tsx
// Show only agents
<SidebarTreeView ... mode="agents" />

// Show only buildings
<SidebarTreeView ... mode="buildings" />

// Show both (default)
<SidebarTreeView ... mode="both" />
```

### Status Colors

Status colors are automatically determined by entity status:
- **Healthy** (green): idle agents, running buildings
- **Working** (yellow): working/waiting agents, starting/stopping buildings
- **Error** (red): error/offline agents, error buildings
- **Unknown** (gray): unknown status

### Styling Customization

The component uses SCSS modules with CSS variables. To customize:

```scss
// Override in your global styles
:root {
  --status-healthy: #5cb88a;  // Green
  --status-working: #f5d76e;  // Yellow
  --status-error: #d64545;    // Red
}

// Or modify sidebar-tree-view.module.scss
$status-healthy: #your-color;
$status-working: #your-color;
$status-error: #your-color;
```

## Performance Considerations

### Memoization
- `TreeView` is memoized for efficient re-renders
- `TreeNodeItem` uses custom equality check
- Expand/collapse state is local to avoid re-renders of entire tree

### Large Agent/Building Sets
The component efficiently handles 50+ agents:
- Lazy expansion (children only render when parent expanded)
- Memoized filter operations
- Minimal re-renders on selection changes

### Search Performance
- Debounced search (if needed) - currently instant but can be optimized
- Filter logic runs on memoized data
- Highlight computation only on visible nodes

## Mobile Responsiveness

The component automatically adapts for mobile:
- Larger touch targets (40px minimum height)
- Optimized spacing and padding
- Full-width sidebar on small screens
- Touch-friendly expand/collapse buttons

## Keyboard Navigation

- **Tab**: Navigate between nodes
- **Enter/Space**: Select node
- **Arrow Left**: Collapse node (if expanded)
- **Arrow Right**: Expand node (if collapsed)
- **Ctrl/Cmd+A**: Select all visible nodes

(Note: Arrow key navigation can be added in TreeNodeItem if needed)

## Accessibility

- Semantic HTML with proper roles
- ARIA labels for interactive elements
- Focus states for keyboard navigation
- Color-blind friendly status indicators (icons + colors)

## Type Definitions

```typescript
interface TreeNodeData {
  id: string;
  label: string;
  type: 'agent' | 'building';
  icon: string;
  status: StatusColor;
  level: number;
  hasChildren: boolean;
  data: Agent | Building | null;
}

interface FilterOptions {
  searchQuery: string;
  statusFilter?: StatusColor | 'all';
  typeFilter?: 'agents' | 'buildings' | 'all';
}

type StatusColor = 'healthy' | 'working' | 'error' | 'unknown';
```

## Utility Functions

Available exports for manual tree manipulation:

```typescript
// Import utilities
import {
  getAgentStatusColor,
  getBuildingStatusColor,
  getAgentIcon,
  getBuildingIcon,
  buildAgentTreeNodes,
  buildBuildingTreeNodes,
  filterTreeNodes,
  toggleExpandedState,
  expandAncestors,
  getAgentSubordinateIds,
  getBuildingSubordinateIds,
} from './components/SidebarTreeView';

// Example: Get all subordinates of a boss agent
const subordinateIds = getAgentSubordinateIds(bossAgentId, agents);
```

## Common Patterns

### Auto-expand Search Results

When implementing search, consider auto-expanding all ancestors of search results:

```tsx
const [searchQuery, setSearchQuery] = useState('');
const [expandedState, setExpandedState] = useState<ExpandedState>({});

const handleSearch = (query: string) => {
  setSearchQuery(query);
  if (query.length > 0) {
    // Auto-expand matching nodes and their ancestors
    const newExpanded = { ...expandedState };
    // ... auto-expand logic
  }
};
```

### Filter by Agent Class

```tsx
const filteredAgents = Array.from(agents.values()).filter(
  agent => agent.class === 'boss'
);
```

### Select All Subordinates

```tsx
const handleSelectAllSubordinates = (bossId: string) => {
  const subordinateIds = getAgentSubordinateIds(bossId, agents);
  subordinateIds.forEach(id => store.addToSelection(id));
};
```

## Troubleshooting

### Tree Not Showing
- Verify `agents` and `buildings` Maps are populated
- Check browser console for TypeScript errors
- Ensure CSS module is imported correctly

### Status Colors Not Showing
- Check agent/building status values match expected enum values
- Verify `getAgentStatusColor()` and `getBuildingStatusColor()` functions

### Selection Not Working
- Verify `onSelectAgent` and `onSelectBuilding` callbacks update store state
- Check `selectedAgentIds` and `selectedBuildingIds` are correctly updated
- Ensure component re-renders when selection changes (use `useStore()` hook)

### Performance Issues
- Monitor expanded state depth (deeply nested trees slower to render)
- Consider virtualizing large lists with `react-window` if needed
- Profile with React DevTools Profiler

## Future Enhancements

Potential features to add:
- Drag-and-drop to reorganize hierarchy
- Right-click context menu
- Keyboard shortcuts for navigation
- Virtual scrolling for very large lists (1000+ items)
- Export tree structure
- Collapsible sections (Agents/Buildings)
- Favorites/pinned items
- Custom sorting options
- Tree filtering by multiple criteria
