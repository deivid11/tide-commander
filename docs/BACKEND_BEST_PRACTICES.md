# Backend Best Practices for Tide Commander

This document outlines coding standards and architectural patterns for backend development in this project.

## Project Structure

```
src/packages/server/
├── claude/           # Claude API integration
├── data/             # Data persistence layer
├── services/         # Business logic (core of the app)
├── utils/            # Shared utilities
└── websocket/
    ├── handler.ts    # WebSocket message routing
    └── handlers/     # Individual message handlers
```

## Service Architecture

### Single Responsibility Principle

Each service should have ONE clear responsibility. When a service grows beyond ~300-400 lines, evaluate if it's doing too much.

**Bad: God Service**
```typescript
// boss-message-service.ts doing 5 things:
// - Building system prompts
// - Gathering subordinate context
// - Formatting time strings
// - Building conversation sections
// - Composing final messages
```

**Good: Focused Services**
```typescript
// boss-message-service.ts - Message composition only
export function buildBossSystemPrompt() { ... }
export function buildBossMessage() { ... }

// subordinate-context-service.ts - Context gathering only
export function buildBossContext() { ... }
export function formatTimeSince() { ... }
```

### Service Dependencies

Dependencies should flow in ONE direction. Avoid bidirectional imports between services.

```
✓ Good:
  boss-service → supervisor-service
  subordinate-context-service → boss-service
  subordinate-context-service → supervisor-service

✗ Bad:
  boss-service ↔ supervisor-service (circular)
```

If you need functionality from a "lower" service, consider:
1. Moving the shared logic to a utility
2. Creating an intermediary service
3. Passing callbacks/data instead of importing

## Utilities

### When to Create a Utility

Extract to `utils/` when:
- The same logic appears in 2+ services
- The function is pure (no service dependencies)
- It's a general-purpose transformation

**Example: Tool Formatting**
```typescript
// utils/tool-formatting.ts
export function getFileName(path: string | undefined): string { ... }
export function getShortPath(filePath: string | undefined): string | null { ... }
export function formatToolNarrative(toolName?: string, toolInput?: Record<string, unknown>): string { ... }
```

### Utility Organization

```
utils/
├── index.ts              # Re-exports everything
├── logger.ts             # Logging utilities
├── string.ts             # String manipulation
├── unicode.ts            # Unicode handling
└── tool-formatting.ts    # Tool display formatting
```

Always export from `index.ts`:
```typescript
// utils/index.ts
export * from './logger.js';
export * from './string.js';
export * from './unicode.js';
export * from './tool-formatting.js';
```

Import from the barrel:
```typescript
// Good
import { logger, sanitizeUnicode, formatToolNarrative } from '../utils/index.js';

// Avoid (unless needed for circular dependency reasons)
import { logger } from '../utils/logger.js';
```

## WebSocket Handlers

### Handler Extraction

When `handler.ts` grows large, extract message handlers to `handlers/` directory.

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

### Generic Handlers for Similar Operations

When multiple message types follow the same pattern, use generics:

```typescript
function handleSyncMessage<T>(
  ws: WebSocket,
  payload: T[],
  entityName: string,
  saveFn: (data: T[]) => void,
  updateType: string
): void {
  saveFn(payload);
  log.log(`Saved ${payload.length} ${entityName}`);
  for (const client of clients) {
    if (client !== ws && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: updateType, payload }));
    }
  }
}

// Usage
case 'sync_areas':
  handleSyncMessage(ws, message.payload, 'areas', saveAreas, 'areas_update');
  break;
case 'sync_buildings':
  handleSyncMessage(ws, message.payload, 'buildings', saveBuildings, 'buildings_update');
  break;
```

## Code Organization Patterns

### Prompts and Templates

Large string templates (LLM prompts, instructions) should live in dedicated files:

```typescript
// supervisor-prompts.ts
export const SINGLE_AGENT_PROMPT = `...`;
export const DEFAULT_SUPERVISOR_PROMPT = `...`;

// supervisor-service.ts
import { SINGLE_AGENT_PROMPT, DEFAULT_SUPERVISOR_PROMPT } from './supervisor-prompts.js';
```

### Claude API Logic

Complex Claude API interactions should be extracted:

```typescript
// supervisor-claude.ts
export async function callClaudeForAnalysis(
  sessionPath: string,
  agentName: string,
  promptTemplate: string,
  eventsSummary: string
): Promise<AgentAnalysis | null> { ... }

export function stripCodeFences(text: string): string { ... }
```

## File Size Guidelines

| Category | Target | Action if Exceeded |
|----------|--------|-------------------|
| Services | < 400 lines | Split responsibilities |
| Handlers | < 700 lines | Extract to handlers/ |
| Utils | < 150 lines | Keep focused, split if needed |
| Prompts | Any size | Separate file per prompt category |

## TypeScript Patterns

### Type Exports

Define types in `shared/types.ts` and import where needed:

```typescript
import type {
  Agent,
  AgentStatusSummary,
  SupervisorReport,
} from '../../shared/types.js';
```

### Async/Await

Prefer async/await over raw promises:

```typescript
// Good
export async function buildBossContext(bossId: string): Promise<string | null> {
  const subordinates = bossService.getSubordinates(bossId);
  if (subordinates.length === 0) return null;

  const sections = await Promise.all(
    subordinates.map(sub => buildSubordinateSection(sub))
  );
  return sections.join('\n\n');
}

// Avoid
export function buildBossContext(bossId: string): Promise<string | null> {
  return new Promise((resolve) => {
    const subordinates = bossService.getSubordinates(bossId);
    // ...
  });
}
```

### Null Handling

Use early returns for null checks:

```typescript
export async function buildBossMessage(bossId: string, command: string) {
  const agent = agentService.getAgent(bossId);
  const bossName = agent?.name || 'Boss';

  const context = await buildBossContext(bossId);
  if (!context) {
    // Handle no-subordinates case early
    return { message: `${instructions}\n\n${command}`, systemPrompt };
  }

  // Main logic with context
  return { message: `${instructions}\n\n${context}\n\n${command}`, systemPrompt };
}
```

## Logging

Use the structured logger from utils:

```typescript
import { logger } from '../utils/index.js';

const log = logger.supervisor; // or logger.claude, logger.websocket, etc.

log.log('Processing agent:', agentId);
log.error('Failed to parse response:', error);
```

## Summary Checklist

Before submitting code:

- [ ] Service has single, clear responsibility
- [ ] No bidirectional service dependencies
- [ ] Duplicated logic extracted to utilities
- [ ] File under size guidelines (or has justification)
- [ ] Handlers follow consistent pattern
- [ ] Types imported from shared/types.ts
- [ ] Logging uses structured logger
- [ ] Large prompts in separate files
