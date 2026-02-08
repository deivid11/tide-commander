/**
 * Example Usage of SidebarTreeView Component
 *
 * This example shows how to integrate SidebarTreeView into your application
 * with proper store integration and event handling.
 */

import React from 'react';
import { store, useStore } from '../../store';
import { SidebarTreeView } from './SidebarTreeView';

/**
 * Minimal integration example - just plug in the component
 */
export function MinimalExample() {
  const state = useStore();

  return (
    <div style={{ width: '280px', height: '100vh' }}>
      <SidebarTreeView
        agents={state.agents}
        buildings={state.buildings}
        selectedAgentIds={state.selectedAgentIds}
        selectedBuildingIds={state.selectedBuildingIds}
        onSelectAgent={(agentId) => store.selectAgent(agentId)}
        onSelectBuilding={(buildingId) => store.selectBuilding(buildingId)}
        mode="both"
      />
    </div>
  );
}

/**
 * Full-featured layout example matching the reference screenshot
 * Shows SidebarTreeView with canvas and details panel
 */
export function FullLayoutExample() {
  const state = useStore();

  const handleSelectAgent = (agentId: string, multi: boolean) => {
    if (multi) {
      // Multi-select with Ctrl/Cmd+Click
      if (state.selectedAgentIds.has(agentId)) {
        store.addToSelection(agentId);
      } else {
        store.addToSelection(agentId);
      }
    } else {
      // Single select
      store.selectAgent(agentId);
    }
  };

  const handleSelectBuilding = (buildingId: string, multi: boolean) => {
    // For buildings, typically single select unless multi-select is needed
    store.selectBuilding(multi ? null : buildingId);
  };

  return (
    <div style={styles.container}>
      {/* Left Sidebar with Tree View */}
      <aside style={styles.sidebar}>
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

      {/* Center Canvas Area */}
      <main style={styles.mainContent}>
        {/* Your 3D/2D canvas component goes here */}
        <div style={styles.canvas}>
          {/* Placeholder for Scene2DCanvas or ThreeScene */}
          <p style={{ color: '#8a8a98', textAlign: 'center', paddingTop: '20px' }}>
            Canvas Area (3D/2D View)
          </p>
        </div>
      </main>

      {/* Right Panel with Details */}
      <aside style={styles.detailsPanel}>
        <div style={styles.detailsHeader}>Details</div>
        <div style={styles.detailsContent}>
          {state.selectedAgentIds.size > 0 && (
            <div>
              <h4 style={{ color: '#d0d0d8', marginBottom: '8px' }}>
                Selected Agents: {state.selectedAgentIds.size}
              </h4>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {Array.from(state.selectedAgentIds).map((agentId) => {
                  const agent = state.agents.get(agentId);
                  return (
                    <li
                      key={agentId}
                      style={{
                        padding: '4px 8px',
                        fontSize: '12px',
                        color: '#a0a0a8',
                        borderBottom: '1px solid #1c1c28',
                      }}
                    >
                      {agent?.name || agentId}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {state.selectedBuildingIds.size > 0 && (
            <div style={{ marginTop: '12px' }}>
              <h4 style={{ color: '#d0d0d8', marginBottom: '8px' }}>
                Selected Buildings: {state.selectedBuildingIds.size}
              </h4>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {Array.from(state.selectedBuildingIds).map((buildingId) => {
                  const building = state.buildings.get(buildingId);
                  return (
                    <li
                      key={buildingId}
                      style={{
                        padding: '4px 8px',
                        fontSize: '12px',
                        color: '#a0a0a8',
                        borderBottom: '1px solid #1c1c28',
                      }}
                    >
                      {building?.name || buildingId}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {state.selectedAgentIds.size === 0 && state.selectedBuildingIds.size === 0 && (
            <p style={{ color: '#8a8a98', fontSize: '12px', textAlign: 'center', paddingTop: '20px' }}>
              Select an agent or building to see details
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

/**
 * Sidebar-only with agents filter example
 */
export function AgentsOnlyExample() {
  const state = useStore();

  return (
    <div style={{ width: '280px', height: '100vh' }}>
      <SidebarTreeView
        agents={state.agents}
        buildings={new Map()}  // Empty buildings map
        selectedAgentIds={state.selectedAgentIds}
        selectedBuildingIds={new Set()}  // Empty selection
        onSelectAgent={(agentId) => store.selectAgent(agentId)}
        onSelectBuilding={() => {}}  // No-op
        mode="agents"
      />
    </div>
  );
}

/**
 * Sidebar-only with buildings filter example
 */
export function BuildingsOnlyExample() {
  const state = useStore();

  return (
    <div style={{ width: '280px', height: '100vh' }}>
      <SidebarTreeView
        agents={new Map()}  // Empty agents map
        buildings={state.buildings}
        selectedAgentIds={new Set()}  // Empty selection
        selectedBuildingIds={state.selectedBuildingIds}
        onSelectAgent={() => {}}  // No-op
        onSelectBuilding={(buildingId) => store.selectBuilding(buildingId)}
        mode="buildings"
      />
    </div>
  );
}

/**
 * Mobile-responsive layout example
 */
export function MobileResponsiveExample() {
  const state = useStore();
  const [sidebarVisible, setSidebarVisible] = React.useState(false);

  const handleSelectAgent = (agentId: string, _multi: boolean) => {
    store.selectAgent(agentId);
    // Collapse sidebar after selection on mobile
    if (window.innerWidth < 768) {
      setSidebarVisible(false);
    }
  };

  return (
    <div style={styles.mobileContainer}>
      {/* Mobile Toggle Button */}
      <button
        onClick={() => setSidebarVisible(!sidebarVisible)}
        style={{
          position: 'fixed',
          top: '10px',
          left: '10px',
          zIndex: 999,
          padding: '8px 12px',
          backgroundColor: '#0d0d14',
          border: '1px solid #1c1c28',
          color: '#d0d0d8',
          borderRadius: '4px',
          cursor: 'pointer',
        }}
      >
        ☰ Menu
      </button>

      {/* Mobile Sidebar (overlay) */}
      {sidebarVisible && (
        <aside
          style={{
            ...styles.mobileSidebar,
            display: 'block',
          }}
        >
          <button
            onClick={() => setSidebarVisible(false)}
            style={{
              position: 'absolute',
              top: '10px',
              right: '10px',
              padding: '4px 8px',
              backgroundColor: 'transparent',
              border: 'none',
              color: '#d0d0d8',
              cursor: 'pointer',
              fontSize: '18px',
            }}
          >
            ✕
          </button>
          <SidebarTreeView
            agents={state.agents}
            buildings={state.buildings}
            selectedAgentIds={state.selectedAgentIds}
            selectedBuildingIds={state.selectedBuildingIds}
            onSelectAgent={handleSelectAgent}
            onSelectBuilding={(buildingId) => store.selectBuilding(buildingId)}
            mode="both"
          />
        </aside>
      )}

      {/* Main Content */}
      <main style={styles.mobileMainContent}>
        <p style={{ color: '#8a8a98', textAlign: 'center', paddingTop: '20px' }}>
          Canvas Area (3D/2D View)
        </p>
      </main>
    </div>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = {
  container: {
    display: 'flex',
    height: '100vh',
    backgroundColor: '#0d0d14',
    color: '#d0d0d8',
  },
  sidebar: {
    width: '280px',
    borderRight: '1px solid #1c1c28',
    backgroundColor: '#14141e',
    overflow: 'hidden',
  },
  mainContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    backgroundColor: '#0d0d14',
  },
  canvas: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a24',
    position: 'relative' as const,
  },
  detailsPanel: {
    width: '320px',
    borderLeft: '1px solid #1c1c28',
    backgroundColor: '#14141e',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  detailsHeader: {
    padding: '12px 16px',
    borderBottom: '1px solid #1c1c28',
    fontSize: '14px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    color: '#8a8a98',
  },
  detailsContent: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '12px',
  },
  mobileContainer: {
    position: 'relative' as const,
    width: '100%',
    height: '100vh',
    backgroundColor: '#0d0d14',
  },
  mobileSidebar: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    width: '100%',
    height: '100vh',
    backgroundColor: '#14141e',
    zIndex: 1000,
    overflow: 'auto',
  },
  mobileMainContent: {
    width: '100%',
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};

export default {
  MinimalExample,
  FullLayoutExample,
  AgentsOnlyExample,
  BuildingsOnlyExample,
  MobileResponsiveExample,
};
