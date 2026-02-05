# DashboardView Integration Guide

## Quick Integration

### 1. Import Component

```tsx
import { DashboardView } from '@packages/client/components/DashboardView';
import { useStore, store } from '@packages/client/store';
```

### 2. Use in Layout

```tsx
function MyLayout() {
  const state = useStore();

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* Other panels */}
      <main style={{ flex: 1 }}>
        <DashboardView
          agents={state.agents}
          buildings={state.buildings}
          selectedAgentIds={state.selectedAgentIds}
          selectedBuildingIds={state.selectedBuildingIds}
          onSelectAgent={(id) => store.selectAgent(id)}
          onSelectBuilding={(id) => store.selectBuilding(id)}
        />
      </main>
    </div>
  );
}
```

## Full-Featured Integration

```tsx
import { DashboardView } from '@packages/client/components/DashboardView';
import { store, useStore } from '@packages/client/store';

function DashboardPage() {
  const state = useStore();

  const handleSelectAgent = (agentId: string) => {
    // Navigate to agent in 3D view
    store.selectAgent(agentId);
  };

  const handleSelectBuilding = (buildingId: string) => {
    // Show building details
    store.selectBuilding(buildingId);
  };

  const handleOpenAgentDetails = (agentId: string) => {
    // Open detailed view/terminal
    store.selectAgent(agentId);
    store.setTerminalOpen(true);
  };

  return (
    <DashboardView
      agents={state.agents}
      buildings={state.buildings}
      selectedAgentIds={state.selectedAgentIds}
      selectedBuildingIds={state.selectedBuildingIds}
      onSelectAgent={handleSelectAgent}
      onSelectBuilding={handleSelectBuilding}
      onOpenAgentDetails={handleOpenAgentDetails}
    />
  );
}
```

## Integration with SidebarTreeView

```tsx
function CommanderLayout() {
  const state = useStore();

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* Left: Tree View */}
      <aside style={{ width: '280px', borderRight: '1px solid #1c1c28' }}>
        <SidebarTreeView
          agents={state.agents}
          buildings={state.buildings}
          selectedAgentIds={state.selectedAgentIds}
          selectedBuildingIds={state.selectedBuildingIds}
          onSelectAgent={(id) => store.selectAgent(id)}
          onSelectBuilding={(id) => store.selectBuilding(id)}
          mode="both"
        />
      </aside>

      {/* Center: Dashboard */}
      <main style={{ flex: 1, overflow: 'hidden' }}>
        <DashboardView
          agents={state.agents}
          buildings={state.buildings}
          selectedAgentIds={state.selectedAgentIds}
          selectedBuildingIds={state.selectedBuildingIds}
          onSelectAgent={(id) => store.selectAgent(id)}
          onSelectBuilding={(id) => store.selectBuilding(id)}
          onOpenAgentDetails={(id) => store.selectAgent(id)}
        />
      </main>

      {/* Right: Details */}
      <aside style={{ width: '320px', borderLeft: '1px solid #1c1c28' }}>
        <UnitPanel />
      </aside>
    </div>
  );
}
```

## Individual Component Usage

### Using MetricsDisplay Only

```tsx
import { MetricsDisplay, calculateMetrics } from '@packages/client/components/DashboardView';
import { useStore } from '@packages/client/store';

function MetricsPanel() {
  const state = useStore();
  const metrics = calculateMetrics(state.agents, state.buildings, []);

  return <MetricsDisplay metrics={metrics} />;
}
```

### Using AgentStatusCards

```tsx
import { AgentStatusCards } from '@packages/client/components/DashboardView';
import { useStore, store } from '@packages/client/store';

function AgentsPanel() {
  const state = useStore();

  return (
    <AgentStatusCards
      agents={state.agents}
      filters={{
        showOnlyActive: false,
        showOnlyErrors: false,
        agentClassFilter: 'all',
        buildingTypeFilter: 'all',
      }}
      selectedAgentIds={state.selectedAgentIds}
      onSelectAgent={(id) => store.selectAgent(id)}
      onFocusAgent={(id) => {
        store.selectAgent(id);
        // Focus in 3D view
      }}
    />
  );
}
```

### Using BuildingStatusOverview

```tsx
import { BuildingStatusOverview } from '@packages/client/components/DashboardView';
import { useStore, store } from '@packages/client/store';

function BuildingsPanel() {
  const state = useStore();

  return (
    <BuildingStatusOverview
      buildings={state.buildings}
      filters={{
        showOnlyActive: false,
        showOnlyErrors: false,
        agentClassFilter: 'all',
        buildingTypeFilter: 'all',
      }}
      selectedBuildingIds={state.selectedBuildingIds}
      onSelectBuilding={(id) => store.selectBuilding(id)}
    />
  );
}
```

### Using EventsTimeline

```tsx
import { EventsTimeline, generateRecentEvents } from '@packages/client/components/DashboardView';
import { useStore } from '@packages/client/store';

function TimelinePanel() {
  const state = useStore();
  const events = generateRecentEvents(state.agents, state.buildings);

  return (
    <EventsTimeline
      events={events}
      maxVisible={10}
      onEventClick={(event) => {
        if (event.agentId) {
          // Focus agent
        }
      }}
    />
  );
}
```

## Advanced: Custom Error Tracking

```tsx
import { DashboardView } from '@packages/client/components/DashboardView';
import { DashboardError } from '@packages/client/components/DashboardView';
import { useStore, store } from '@packages/client/store';

function DashboardWithErrors() {
  const state = useStore();
  const [errors, setErrors] = useState<DashboardError[]>([]);

  // Track errors from agent outputs
  useEffect(() => {
    const newErrors: DashboardError[] = [];

    state.agents.forEach((agent) => {
      const outputs = state.agentOutputs.get(agent.id) || [];
      const lastOutput = outputs[outputs.length - 1];

      if (lastOutput && lastOutput.text.toLowerCase().includes('error')) {
        newErrors.push({
          id: `${agent.id}-${lastOutput.timestamp}`,
          agentId: agent.id,
          agentName: agent.name,
          message: lastOutput.text.slice(0, 100),
          timestamp: lastOutput.timestamp,
          resolved: false,
        });
      }
    });

    setErrors(newErrors);
  }, [state.agents, state.agentOutputs]);

  return (
    <DashboardView
      agents={state.agents}
      buildings={state.buildings}
      selectedAgentIds={state.selectedAgentIds}
      selectedBuildingIds={state.selectedBuildingIds}
      recentErrors={errors}
      onSelectAgent={(id) => store.selectAgent(id)}
      onSelectBuilding={(id) => store.selectBuilding(id)}
    />
  );
}
```

## With View Mode Toggle

```tsx
import { DashboardView } from '@packages/client/components/DashboardView';
import { useStore, store } from '@packages/client/store';

function MainView() {
  const state = useStore();

  return (
    <>
      {/* Mode Toggle */}
      <div style={{ padding: '12px', borderBottom: '1px solid #1c1c28' }}>
        <button onClick={() => store.setViewMode('2d')}>2D View</button>
        <button onClick={() => store.setViewMode('3d')}>3D View</button>
        <button onClick={() => store.setViewMode('dashboard')}>Dashboard</button>
      </div>

      {/* Content */}
      {state.viewMode === 'dashboard' ? (
        <DashboardView
          agents={state.agents}
          buildings={state.buildings}
          selectedAgentIds={state.selectedAgentIds}
          selectedBuildingIds={state.selectedBuildingIds}
          onSelectAgent={(id) => store.selectAgent(id)}
          onSelectBuilding={(id) => store.selectBuilding(id)}
        />
      ) : state.viewMode === '2d' ? (
        <Scene2DCanvas {...props} />
      ) : (
        <ThreeScene {...props} />
      )}
    </>
  );
}
```

## Mobile Responsive Integration

```tsx
function ResponsiveDashboard() {
  const state = useStore();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isMobile ? (
    // Mobile: Full-screen dashboard
    <div style={{ height: '100vh', overflow: 'auto' }}>
      <DashboardView
        agents={state.agents}
        buildings={state.buildings}
        selectedAgentIds={state.selectedAgentIds}
        selectedBuildingIds={state.selectedBuildingIds}
        onSelectAgent={(id) => store.selectAgent(id)}
        onSelectBuilding={(id) => store.selectBuilding(id)}
      />
    </div>
  ) : (
    // Desktop: Layout with sidebar
    <div style={{ display: 'flex', height: '100vh' }}>
      <aside style={{ width: '280px' }}>
        <SidebarTreeView {...props} />
      </aside>
      <main style={{ flex: 1 }}>
        <DashboardView {...props} />
      </main>
    </div>
  );
}
```

## With Custom Styling

```tsx
// Override colors in your global styles
:root {
  --dashboard-color-healthy: #5cb88a;
  --dashboard-color-working: #f5d76e;
  --dashboard-color-error: #d64545;
}

// Or modify the SCSS module directly
```

## With Real-Time Updates

```tsx
import { DashboardView } from '@packages/client/components/DashboardView';
import { useStore } from '@packages/client/store';

function LiveDashboard() {
  const state = useStore();

  // Dashboard will automatically update when:
  // - state.agents changes
  // - state.buildings changes
  // - state.selectedAgentIds changes
  // - state.selectedBuildingIds changes

  return (
    <DashboardView
      agents={state.agents}
      buildings={state.buildings}
      selectedAgentIds={state.selectedAgentIds}
      selectedBuildingIds={state.selectedBuildingIds}
      onSelectAgent={(id) => store.selectAgent(id)}
      onSelectBuilding={(id) => store.selectBuilding(id)}
    />
  );
}
```

## Common Patterns

### Focus Agent in 3D View

```tsx
const handleFocusAgent = (agentId: string) => {
  store.selectAgent(agentId);
  // Center camera on agent in 3D view
  const agent = state.agents.get(agentId);
  if (agent && sceneRef.current) {
    sceneRef.current.camera.position.set(
      agent.position.x,
      agent.position.y + 5,
      agent.position.z + 5
    );
  }
};
```

### Kill Agent with Confirmation

```tsx
const handleKillAgent = (agentId: string) => {
  const agent = state.agents.get(agentId);
  if (!agent) return;

  if (confirm(`Kill agent "${agent.name}"?`)) {
    store.killAgent(agentId);
  }
};
```

### Open Building Logs

```tsx
const handleOpenBuildingDetails = (buildingId: string) => {
  store.selectBuilding(buildingId);
  store.startStreamingBuildingLogs(buildingId);
};
```

### Filter to Errors

```tsx
const [showOnlyErrors, setShowOnlyErrors] = useState(false);

// In filter update:
{
  showOnlyActive: false,
  showOnlyErrors,
  agentClassFilter: 'all',
  buildingTypeFilter: 'all',
}
```

## Type Safety

All components have full TypeScript support:

```tsx
import {
  DashboardViewProps,
  DashboardMetrics,
  AgentCardData,
  BuildingCardData,
  RecentEvent,
  DashboardError,
  DashboardFilters,
} from '@packages/client/components/DashboardView';

// Use types in your components
const metrics: DashboardMetrics = calculateMetrics(...);
const cards: AgentCardData[] = ...;
```

## Troubleshooting Integration Issues

### Dashboard not showing data
```tsx
// Verify store state is populated
const state = useStore();
console.log('Agents:', state.agents.size);
console.log('Buildings:', state.buildings.size);
```

### Selection not updating
```tsx
// Ensure callback updates store
const handleSelect = (id: string) => {
  store.selectAgent(id);  // Must update store
  console.log('Selected:', id);
};
```

### Performance issues with many entities
```tsx
// Use filtering to reduce visible items
<DashboardView
  filters={{
    showOnlyActive: true,      // Show only active
    showOnlyErrors: false,
    agentClassFilter: 'all',
    buildingTypeFilter: 'all',
  }}
/>
```

## Next Steps

1. Copy DashboardView to your layout
2. Wire up store callbacks
3. Test with real agent/building data
4. Customize colors/styling if needed
5. Add additional features (logs, charts, etc)
6. Integration testing with full app flow

## Support

For issues:
1. Check README.md for component documentation
2. Review type definitions in types.ts
3. Check utility functions in utils.ts
4. Open browser DevTools console for errors
