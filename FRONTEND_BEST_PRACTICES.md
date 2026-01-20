# Frontend Best Practices - Tide Commander

This document outlines coding standards and best practices for the Tide Commander frontend codebase, based on patterns established during refactoring efforts.

## File Size Guidelines

**Target: Keep files under 500 lines.** Files exceeding 800 lines should be considered for refactoring.

| Size | Status | Action |
|------|--------|--------|
| < 500 lines | ✅ Good | Maintainable |
| 500-800 lines | ⚠️ Warning | Consider splitting |
| > 800 lines | ❌ Too large | Refactor required |

## Module Decomposition Patterns

### 1. Extract Types First

Always start by extracting types into a dedicated `types.ts` file:

```typescript
// types.ts
export type FloorStyle = 'none' | 'concrete' | 'galactic' | 'metal';

export interface TimeConfig {
  phase: TimePhase;
  sunPosition: THREE.Vector3;
  // ...
}
```

### 2. Group by Responsibility

Split code into logical modules based on what they do, not what they are:

```
scene/environment/
├── Battlefield.ts      # Main class (orchestrator)
├── types.ts            # Type definitions
├── celestial.ts        # Sun, moon, stars
├── terrain.ts          # Trees, bushes, house, lamps
├── timeConfig.ts       # Day/night cycle logic
├── floorTextures.ts    # Procedural textures
├── galacticFloor.ts    # Space floor effects
└── index.ts            # Barrel exports
```

### 3. Barrel Exports for Backwards Compatibility

Always provide an `index.ts` that re-exports everything:

```typescript
// index.ts
export { Battlefield } from './Battlefield';
export type { FloorStyle, TimeConfig } from './types';
export { createSun, createMoon } from './celestial';
```

This allows existing imports to continue working:
```typescript
// Both work after refactoring
import { Battlefield } from './scene/environment';
import { Battlefield } from './scene/environment/Battlefield';
```

## Zustand Store Patterns

### 1. Split Store by Domain

```
store/
├── index.ts           # Main store combining slices
├── types.ts           # Shared store types
├── selectors.ts       # Memoized selectors
├── agents.ts          # Agent state slice
├── buildings.ts       # Building state slice
├── outputs.ts         # Output state slice
└── permissions.ts     # Permission state slice
```

### 2. Use Slice Pattern

```typescript
// agents.ts
export interface AgentSlice {
  agents: Map<string, Agent>;
  selectedAgentId: string | null;
  addAgent: (agent: Agent) => void;
  removeAgent: (id: string) => void;
}

export const createAgentSlice: StateCreator<StoreState, [], [], AgentSlice> = (set) => ({
  agents: new Map(),
  selectedAgentId: null,
  addAgent: (agent) => set((state) => {
    const newAgents = new Map(state.agents);
    newAgents.set(agent.id, agent);
    return { agents: newAgents };
  }),
  // ...
});
```

### 3. Memoize Selectors

```typescript
// selectors.ts
import { createSelector } from 'reselect';

export const selectActiveAgents = createSelector(
  [(state: StoreState) => state.agents],
  (agents) => Array.from(agents.values()).filter(a => a.status === 'active')
);
```

## Three.js Scene Patterns

### 1. Resource Management

Always implement proper disposal:

```typescript
private disposeMaterial(material: THREE.Material): void {
  if (material instanceof THREE.MeshStandardMaterial) {
    material.map?.dispose();
    material.normalMap?.dispose();
    material.roughnessMap?.dispose();
  }
  material.dispose();
}

private disposeGroup(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach(mat => this.disposeMaterial(mat));
      } else {
        this.disposeMaterial(child.material);
      }
    }
  });
}
```

### 2. Factory Functions for 3D Objects

Extract object creation into factory functions:

```typescript
// celestial.ts
export function createSun(): THREE.Sprite {
  const canvas = document.createElement('canvas');
  // ... setup canvas
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture });
  const sun = new THREE.Sprite(material);
  sun.name = 'sun';
  return sun;
}
```

### 3. Animation State Objects

For complex animations, use state objects:

```typescript
export interface GalacticState {
  group: THREE.Group;
  stars: THREE.Points | null;
  nebulas: THREE.Mesh[];
  time: number;
}

export function updateGalacticAnimation(state: GalacticState, deltaTime: number): void {
  state.time += deltaTime;
  // Update animations based on state.time
}
```

## React Component Patterns

### 1. Extract Custom Hooks

Move complex logic into hooks:

```typescript
// hooks/useAgentSelection.ts
export function useAgentSelection() {
  const selectedId = useStore(state => state.selectedAgentId);
  const agents = useStore(selectActiveAgents);

  const selectNext = useCallback(() => {
    // ...
  }, [agents, selectedId]);

  return { selectedId, selectNext };
}
```

### 2. Split Large Components

```
components/ClaudeOutputPanel/
├── index.tsx              # Main component
├── types.ts               # Component-specific types
├── OutputBlock.tsx        # Individual output block
├── StreamingContent.tsx   # Streaming text display
├── ToolCallDisplay.tsx    # Tool call rendering
├── hooks/
│   ├── useAutoScroll.ts
│   └── useOutputFiltering.ts
└── utils/
    └── formatting.ts
```

### 3. Memoize Expensive Renders

```typescript
const MemoizedOutputBlock = React.memo(OutputBlock, (prev, next) => {
  return prev.block.id === next.block.id &&
         prev.block.content === next.block.content;
});
```

## Naming Conventions

### Files
- **Components**: PascalCase (`UnitPanel.tsx`)
- **Utilities**: camelCase (`formatting.ts`)
- **Types**: camelCase with descriptive name (`types.ts`)
- **Hooks**: camelCase with `use` prefix (`useAgentSelection.ts`)

### Exports
- **Classes**: PascalCase (`class Battlefield`)
- **Functions**: camelCase (`createSun()`)
- **Types/Interfaces**: PascalCase (`interface TimeConfig`)
- **Constants**: SCREAMING_SNAKE_CASE (`const MAX_AGENTS = 100`)

## Import Organization

```typescript
// 1. External libraries
import * as THREE from 'three';
import React, { useState, useCallback } from 'react';

// 2. Internal absolute imports
import { useStore } from '@/store';

// 3. Relative imports - types first
import type { FloorStyle, TimeConfig } from './types';

// 4. Relative imports - implementations
import { generateFloorTexture } from './floorTextures';
import { createSun, createMoon } from './celestial';
```

## Performance Considerations

### 1. Avoid Creating Objects in Render Loops

```typescript
// ❌ Bad - creates new Vector3 every frame
function update() {
  mesh.position.copy(new THREE.Vector3(x, y, z));
}

// ✅ Good - reuse objects
const tempVector = new THREE.Vector3();
function update() {
  tempVector.set(x, y, z);
  mesh.position.copy(tempVector);
}
```

### 2. Use Object Pooling for Frequent Operations

```typescript
class VectorPool {
  private pool: THREE.Vector3[] = [];

  acquire(): THREE.Vector3 {
    return this.pool.pop() || new THREE.Vector3();
  }

  release(v: THREE.Vector3): void {
    v.set(0, 0, 0);
    this.pool.push(v);
  }
}
```

### 3. Batch State Updates

```typescript
// ❌ Bad - multiple re-renders
setAgents(newAgents);
setSelectedId(id);
setIsLoading(false);

// ✅ Good - single update
set((state) => ({
  agents: newAgents,
  selectedId: id,
  isLoading: false
}));
```

## Testing Considerations

When refactoring, ensure modules can be tested independently:

```typescript
// timeConfig.test.ts
import { getTimeConfig, interpolateConfig } from './timeConfig';

describe('getTimeConfig', () => {
  it('returns night config at midnight', () => {
    const config = getTimeConfig(0);
    expect(config.phase).toBe('night');
  });

  it('returns day config at noon', () => {
    const config = getTimeConfig(12);
    expect(config.phase).toBe('day');
  });
});
```

## Summary

| Principle | Description |
|-----------|-------------|
| **Single Responsibility** | Each module does one thing well |
| **Explicit Dependencies** | Import what you need, export what others need |
| **Backwards Compatibility** | Use barrel exports to maintain existing imports |
| **Resource Management** | Always dispose Three.js objects properly |
| **State Isolation** | Split store by domain, use selectors |
| **Performance First** | Avoid allocations in hot paths, memoize renders |
