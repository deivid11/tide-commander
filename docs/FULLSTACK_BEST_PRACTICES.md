# Full-Stack Developer Best Practices - Tide Commander

This document consolidates coding standards and best practices for full-stack development in Tide Commander, combining frontend (React/Three.js/TypeScript) and backend (Node.js/WebSocket) patterns.

---

## Table of Contents

1. [Universal Principles](#universal-principles)
2. [File Size Guidelines](#file-size-guidelines)
3. [Project Structure](#project-structure)
4. [Module Decomposition](#module-decomposition)
5. [Type System](#type-system)
6. [State Management](#state-management)
7. [API & Communication Patterns](#api--communication-patterns)
8. [Performance Optimization](#performance-optimization)
9. [Error Handling](#error-handling)
10. [Testing Strategies](#testing-strategies)
11. [Naming Conventions](#naming-conventions)
12. [Import Organization](#import-organization)
13. [Code Review Checklist](#code-review-checklist)

---

## Universal Principles

These principles apply across the entire stack:

| Principle | Description |
|-----------|-------------|
| **Single Responsibility** | Each module/service does one thing well |
| **Explicit Dependencies** | Import what you need, export what others need |
| **Unidirectional Flow** | Data and dependencies flow in one direction |
| **Backwards Compatibility** | Use barrel exports to maintain existing imports |
| **Resource Management** | Always clean up resources (subscriptions, connections, 3D objects) |
| **Performance First** | Avoid allocations in hot paths, batch updates |

---

## File Size Guidelines

### Frontend (React/Three.js)

| Size | Status | Action |
|------|--------|--------|
| < 500 lines | ✅ Good | Maintainable |
| 500-800 lines | ⚠️ Warning | Consider splitting |
| > 800 lines | ❌ Too large | Refactor required |

### Backend (Node.js/Services)

| Category | Target | Action if Exceeded |
|----------|--------|-------------------|
| Services | < 400 lines | Split responsibilities |
| WebSocket Handlers | < 700 lines | Extract to handlers/ |
| Utilities | < 150 lines | Keep focused, split if needed |
| Prompts/Templates | Any size | Separate file per category |

---

## Project Structure

### Full-Stack Overview

```
src/packages/
├── client/                    # Frontend application
│   ├── components/            # React components
│   ├── hooks/                 # Custom React hooks
│   ├── store/                 # Zustand state management
│   ├── scene/                 # Three.js scene management
│   │   └── environment/       # Environment/battlefield
│   └── utils/                 # Frontend utilities
│
├── server/                    # Backend application
│   ├── claude/                # Claude API integration
│   ├── data/                  # Data persistence layer
│   ├── services/              # Business logic (core)
│   ├── utils/                 # Backend utilities
│   └── websocket/
│       ├── handler.ts         # WebSocket message routing
│       └── handlers/          # Individual message handlers
│
└── shared/                    # Shared between client & server
    └── types.ts               # Shared type definitions
```

### Frontend Module Example

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

### Backend Module Example

```
services/
├── agent-service.ts            # Agent lifecycle management
├── boss-service.ts             # Boss agent logic
├── boss-message-service.ts     # Message composition
├── subordinate-context-service.ts  # Context gathering
├── supervisor-service.ts       # Supervisor logic
├── supervisor-prompts.ts       # LLM prompt templates
└── supervisor-claude.ts        # Claude API calls
```

---

## Module Decomposition

### 1. Extract Types First (Both Stacks)

**Frontend:**
```typescript
// types.ts
export type FloorStyle = 'none' | 'concrete' | 'galactic' | 'metal';

export interface TimeConfig {
  phase: TimePhase;
  sunPosition: THREE.Vector3;
}
```

**Backend:**
```typescript
// shared/types.ts
export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
}

export interface SupervisorReport {
  agentId: string;
  analysis: string;
  timestamp: number;
}
```

### 2. Group by Responsibility

**Bad: God Service/Component**
```typescript
// ❌ One file doing 5+ things
class EverythingManager {
  handleUI() { ... }
  fetchData() { ... }
  transformData() { ... }
  saveToDatabase() { ... }
  sendNotifications() { ... }
}
```

**Good: Focused Modules**
```typescript
// ✅ Each module has one job
// ui-manager.ts - UI orchestration only
// data-fetcher.ts - Data fetching only
// data-transformer.ts - Transformations only
// persistence.ts - Database operations only
// notifications.ts - Notification handling only
```

### 3. Barrel Exports for Backwards Compatibility

Always provide an `index.ts` that re-exports everything:

```typescript
// index.ts
export { Battlefield } from './Battlefield';
export type { FloorStyle, TimeConfig } from './types';
export { createSun, createMoon } from './celestial';

// utils/index.ts (backend)
export * from './logger.js';
export * from './string.js';
export * from './tool-formatting.js';
```

This allows both import styles:
```typescript
import { Battlefield } from './scene/environment';
import { Battlefield } from './scene/environment/Battlefield';
```

### 4. Dependency Direction

Dependencies should flow in ONE direction. Avoid bidirectional imports.

```
✓ Good:
  boss-service → supervisor-service
  subordinate-context-service → boss-service
  Component → Hook → Store → Service

✗ Bad:
  boss-service ↔ supervisor-service (circular)
  Store ↔ Component (bidirectional)
```

**Solutions for circular dependencies:**
1. Move shared logic to a utility
2. Create an intermediary module
3. Pass callbacks/data instead of importing

---

## Type System

### Shared Types

Define types in `shared/types.ts` for cross-stack use:

```typescript
// shared/types.ts
export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  bossId?: string;
}

export type ServerMessage =
  | { type: 'agent_update'; payload: Agent }
  | { type: 'sync_complete'; payload: { count: number } };
```

### Type-Only Imports

Use `import type` for types to improve build performance:

```typescript
import type { Agent, ServerMessage } from '../../shared/types.js';
import type { FloorStyle, TimeConfig } from './types';
```

### Generics for Reusable Patterns

```typescript
// Backend: Generic handler
function handleSyncMessage<T>(
  ws: WebSocket,
  payload: T[],
  entityName: string,
  saveFn: (data: T[]) => void,
  updateType: string
): void {
  saveFn(payload);
  broadcast({ type: updateType, payload });
}

// Frontend: Generic selector
function createEntitySelector<T>(
  entityType: string
): (state: StoreState) => Map<string, T> {
  return (state) => state[entityType] as Map<string, T>;
}
```

---

## State Management

### Frontend: Zustand Store Pattern

**Split Store by Domain:**
```
store/
├── index.ts           # Main store combining slices
├── types.ts           # Shared store types
├── selectors.ts       # Memoized selectors
├── agents.ts          # Agent state slice
├── buildings.ts       # Building state slice
└── permissions.ts     # Permission state slice
```

**Slice Pattern:**
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
});
```

**Memoized Selectors:**
```typescript
import { createSelector } from 'reselect';

export const selectActiveAgents = createSelector(
  [(state: StoreState) => state.agents],
  (agents) => Array.from(agents.values()).filter(a => a.status === 'active')
);
```

**Batch State Updates:**
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

### Backend: Service State

Keep services stateless when possible. For stateful services:

```typescript
// agent-service.ts
class AgentService {
  private agents: Map<string, Agent> = new Map();

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  updateAgent(id: string, updates: Partial<Agent>): Agent | null {
    const agent = this.agents.get(id);
    if (!agent) return null;

    const updated = { ...agent, ...updates };
    this.agents.set(id, updated);
    return updated;
  }
}

export const agentService = new AgentService();
```

---

## API & Communication Patterns

### WebSocket Handler Extraction

When handlers grow large, extract to dedicated files:

```typescript
// handlers/boss-response-handler.ts
import type { WebSocket } from 'ws';
import type { ServerMessage } from '../../../shared/types.js';

export type BroadcastFn = (message: ServerMessage) => void;

export interface HandlerContext {
  ws: WebSocket;
  broadcast: BroadcastFn;
}

export async function handleBossResponse(
  ctx: HandlerContext,
  agentId: string,
  response: string
): Promise<void> {
  // Handler logic
}
```

### Async/Await Over Promises

```typescript
// ✅ Good
export async function buildBossContext(bossId: string): Promise<string | null> {
  const subordinates = bossService.getSubordinates(bossId);
  if (subordinates.length === 0) return null;

  const sections = await Promise.all(
    subordinates.map(sub => buildSubordinateSection(sub))
  );
  return sections.join('\n\n');
}

// ❌ Avoid
export function buildBossContext(bossId: string): Promise<string | null> {
  return new Promise((resolve) => {
    const subordinates = bossService.getSubordinates(bossId);
    // ...
  });
}
```

### Large Prompts in Separate Files

```typescript
// supervisor-prompts.ts
export const SINGLE_AGENT_PROMPT = `
You are analyzing a single agent's behavior...
`;

export const DEFAULT_SUPERVISOR_PROMPT = `
You are a supervisor overseeing multiple agents...
`;

// supervisor-service.ts
import { SINGLE_AGENT_PROMPT, DEFAULT_SUPERVISOR_PROMPT } from './supervisor-prompts.js';
```

---

## Performance Optimization

### Frontend: Three.js Patterns

**Avoid Creating Objects in Render Loops:**
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

**Object Pooling:**
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

**Resource Disposal:**
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

### Frontend: React Patterns

**Memoize Expensive Renders:**
```typescript
const MemoizedOutputBlock = React.memo(OutputBlock, (prev, next) => {
  return prev.block.id === next.block.id &&
         prev.block.content === next.block.content;
});
```

**Extract Custom Hooks:**
```typescript
export function useAgentSelection() {
  const selectedId = useStore(state => state.selectedAgentId);
  const agents = useStore(selectActiveAgents);

  const selectNext = useCallback(() => {
    // ...
  }, [agents, selectedId]);

  return { selectedId, selectNext };
}
```

### Backend: Efficient Processing

**Use Promise.all for Parallel Operations:**
```typescript
const [agents, buildings, areas] = await Promise.all([
  loadAgents(),
  loadBuildings(),
  loadAreas(),
]);
```

**Stream Large Responses:**
```typescript
// For large data sets, stream instead of loading all into memory
async function* streamAgentLogs(agentId: string) {
  for await (const chunk of readLogFile(agentId)) {
    yield processChunk(chunk);
  }
}
```

---

## Error Handling

### Early Returns for Null Checks

```typescript
export async function buildBossMessage(bossId: string, command: string) {
  const agent = agentService.getAgent(bossId);
  if (!agent) {
    return { error: 'Agent not found' };
  }

  const context = await buildBossContext(bossId);
  if (!context) {
    return { message: `${instructions}\n\n${command}`, systemPrompt };
  }

  return { message: `${instructions}\n\n${context}\n\n${command}`, systemPrompt };
}
```

### Structured Error Types

```typescript
// shared/types.ts
export interface AppError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: AppError };
```

---

## Testing Strategies

### Unit Test Modules Independently

```typescript
// Frontend: timeConfig.test.ts
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

```typescript
// Backend: boss-message-service.test.ts
import { buildBossSystemPrompt, buildBossMessage } from './boss-message-service';

describe('buildBossSystemPrompt', () => {
  it('includes agent name in prompt', () => {
    const prompt = buildBossSystemPrompt('TestBoss');
    expect(prompt).toContain('TestBoss');
  });
});
```

### Integration Test API Contracts

```typescript
// websocket.test.ts
describe('WebSocket API', () => {
  it('handles sync_agents message', async () => {
    const ws = await connectWebSocket();
    ws.send(JSON.stringify({ type: 'sync_agents', payload: testAgents }));

    const response = await waitForMessage(ws, 'agents_update');
    expect(response.payload).toEqual(testAgents);
  });
});
```

---

## Naming Conventions

### Files

| Type | Convention | Example |
|------|------------|---------|
| React Components | PascalCase | `UnitPanel.tsx` |
| Hooks | camelCase with `use` prefix | `useAgentSelection.ts` |
| Services | kebab-case | `boss-message-service.ts` |
| Utilities | camelCase | `formatting.ts` |
| Types | camelCase | `types.ts` |
| Prompts | kebab-case with `-prompts` | `supervisor-prompts.ts` |

### Exports

| Type | Convention | Example |
|------|------------|---------|
| Classes | PascalCase | `class Battlefield` |
| React Components | PascalCase | `function UnitPanel()` |
| Functions | camelCase | `createSun()` |
| Types/Interfaces | PascalCase | `interface TimeConfig` |
| Constants | SCREAMING_SNAKE_CASE | `const MAX_AGENTS = 100` |

---

## Import Organization

### Frontend

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

### Backend

```typescript
// 1. Node.js built-ins
import { readFile, writeFile } from 'fs/promises';

// 2. External libraries
import { WebSocket } from 'ws';
import Anthropic from '@anthropic-ai/sdk';

// 3. Shared types
import type { Agent, ServerMessage } from '../../shared/types.js';

// 4. Internal utilities
import { logger, sanitizeUnicode } from '../utils/index.js';

// 5. Internal services
import { agentService } from './agent-service.js';
```

---

## Code Review Checklist

### Universal Checks

- [ ] Module has single, clear responsibility
- [ ] No bidirectional/circular dependencies
- [ ] Duplicated logic extracted to utilities
- [ ] File under size guidelines (or has justification)
- [ ] Types imported from shared/types.ts
- [ ] Proper error handling with early returns

### Frontend Specific

- [ ] Three.js resources properly disposed
- [ ] No object allocations in render loops
- [ ] React components memoized where appropriate
- [ ] State updates batched
- [ ] Selectors memoized for expensive computations
- [ ] Custom hooks extracted for complex logic

### Backend Specific

- [ ] Services are stateless where possible
- [ ] Handlers follow consistent pattern
- [ ] Logging uses structured logger
- [ ] Large prompts in separate files
- [ ] Async/await used instead of raw promises
- [ ] WebSocket broadcasts to correct clients

---

## Logging

### Backend Structured Logger

```typescript
import { logger } from '../utils/index.js';

const log = logger.supervisor; // or logger.claude, logger.websocket

log.log('Processing agent:', agentId);
log.error('Failed to parse response:', error);
```

### Frontend Console Groups (Development Only)

```typescript
if (process.env.NODE_ENV === 'development') {
  console.group('Agent Update');
  console.log('Agent:', agent);
  console.log('Changes:', changes);
  console.groupEnd();
}
```

---

## Summary

This guide provides a unified approach to full-stack development in Tide Commander. The key takeaways:

1. **Keep files small** - Frontend < 500 lines, Backend services < 400 lines
2. **Single responsibility** - Each module does one thing well
3. **Types first** - Extract and share types across the stack
4. **Barrel exports** - Maintain backwards compatibility
5. **Unidirectional flow** - Dependencies and data flow one way
6. **Resource management** - Clean up connections, subscriptions, and 3D objects
7. **Performance conscious** - Batch updates, memoize, avoid allocations in hot paths
8. **Test independently** - Modules should be testable in isolation
