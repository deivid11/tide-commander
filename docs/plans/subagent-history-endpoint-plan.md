# Subagent History Endpoint Integration Plan

## Scope

This plan is specifically for **Claude Code agents** and their session/subagent storage model under `~/.claude/projects/...`.

## Problem Statement

Subagent activity is visible in realtime, but it is not recoverable when the UI reloads or when a user revisits an agent and relies on `GET /api/agents/:id/history`.

## Current Behavior (Deep-Dive Findings)

1. History endpoint only returns parsed session messages.
   - `src/packages/server/services/agent-service.ts:355` calls `loadSession(...)` and returns only `messages`, `totalCount`, `hasMore`.
2. Session loader parses only the main session JSONL conversation stream.
   - `src/packages/server/claude/session-loader.ts:433` parses `user`/`assistant`/`tool_use`/`tool_result`.
   - It does not read `subagents/*.jsonl` files.
3. Realtime subagent output is sourced from a dedicated watcher.
   - `src/packages/server/websocket/listeners/runtime-listeners.ts:71` starts `subagent-jsonl-watcher`.
   - It broadcasts `subagent_stream` payloads (`runtime-listeners.ts:76`).
4. Subagent stream entries are parsed and broadcast only in realtime.
   - `src/packages/server/services/subagent-jsonl-watcher.ts:397` parses JSONL lines into `SubagentStreamEntry`.
5. Client stores subagent stream state in memory only.
   - `src/packages/client/websocket/handlers.ts:814` handles `subagent_stream`.
   - `src/packages/client/store/subagents.ts:151` appends stream entries into store state.
   - `src/packages/client/store/subagents.ts:14` auto-removes completed subagents after delay.
6. UI subagent panel rendering depends on in-memory subagent map.
   - `src/packages/client/components/ClaudeOutputPanel/OutputLine.tsx:540` matches Task/Agent tool line to live subagent by `toolUseId`.
   - `src/packages/client/components/ClaudeOutputPanel/OutputLine.tsx:792` renders `streamEntries` panel if present.

## Subagent Output Location and Identification

### Location on disk (Claude Code)

For a parent session:

- Main session file: `~/.claude/projects/<encoded-project-path>/<sessionId>.jsonl`
- Subagent files directory: `~/.claude/projects/<encoded-project-path>/<sessionId>/subagents/`
- Subagent file pattern: `agent-<subagentAgentId>.jsonl`

In this repository flow, `<encoded-project-path>` is generated using the same encoding used by `encodeProjectPath(...)` in `src/packages/server/claude/session-loader.ts`.

### How to identify which subagent file belongs to which Task/Agent tool_use

Use this correlation order:

1. Primary:
   - Read parent session `tool_result` for Task/Agent and extract `agentId: <subagentAgentId>` from returned content.
   - Match to file `subagents/agent-<subagentAgentId>.jsonl`.
2. Secondary:
   - Use `parentToolUseID` when present in subagent entries/events to directly map back to parent `toolUseId`.
3. Tertiary fallback:
   - Time-based and name-based matching (subagent start time near parent Task/Agent tool_use timestamp, plus Task name/description hints).

### Practical identifiers to persist in API payload

To keep matching stable across reloads, payload should include:

- `toolUseId` (parent Task/Agent tool_use id)
- `subagentAgentId` (from `agent-<id>.jsonl` filename or extracted metadata)
- `subagentFile` (optional relative path under `subagents/`)
- `name`/`description`/`subagentType`/`model`

## Goals

1. Make subagent output recoverable via `/api/agents/:id/history`.
2. Preserve existing realtime websocket behavior.
3. Keep history payload deterministic and paginatable.
4. Avoid breaking current `HistoryMessage` rendering.

## Non-Goals

1. Replacing websocket realtime streaming.
2. Changing Claude/Codex raw session file formats.
3. Building full long-term analytics for subagents.

## Proposed Design

### 1) Extend history response with subagent history payload

Add a new field in history response:

- `subagents: Array<{ toolUseId, subagentId?, name?, description?, subagentType?, model?, startedAt?, completedAt?, stats?, streamEntries: SubagentStreamEntry[] }>`

Notes:

1. Keep `messages` unchanged for backward compatibility.
2. Add optional query flags:
   - `includeSubagents=true|false` (default `true`)
   - `subagentEntriesLimit` (default `200`)

### 2) Add server-side loader for persisted subagent output

Implement a subagent history loader in `src/packages/server/claude/session-loader.ts` (or a new helper module adjacent to it):

1. Resolve subagents directory with existing `encodeProjectPath(...)` + session path convention.
2. Read `subagents/*.jsonl` files.
3. Parse entries similarly to current realtime parser (`subagent-jsonl-watcher`), but with optional non-truncated text for history.
4. Derive correlation metadata:
   - Prefer explicit `parentToolUseID` if present in lines.
   - Fallback map from parent session Task/Agent tool results (`toolUseId -> subagent agentId`) by extracting `agentId: <id>` tokens found in tool result content.
5. Return normalized subagent list keyed by `toolUseId`.

### 3) Scope subagent payload to requested history window

Because history is paginated:

1. From `limitedMessages`, collect Task/Agent `tool_use` `toolUseId`s in current page.
2. Return only subagents linked to those tool IDs.
3. This prevents oversized payloads and keeps page coherence.

### 4) Wire endpoint/service

1. Update `src/packages/server/services/agent-service.ts:getAgentHistory(...)` to request subagent history data in the same call path.
2. Update `src/packages/server/routes/agents.ts` history route response shape to include `subagents`.

### 5) Client hydration on history load

After `useHistoryLoader` fetch:

1. If response includes `subagents`, hydrate store map for the selected agent.
2. Add store action in `src/packages/client/store/subagents.ts`, e.g.:
   - `hydrateSubagentsFromHistory(parentAgentId, subagents)`
3. Hydrated entries should be marked `completed` (or inferred status), and should not be auto-removed immediately on load.
4. Keep websocket handlers unchanged so live updates still append naturally.

### 6) Rendering behavior

No major UI rewrite needed:

1. `OutputLine` already matches Task/Agent by `toolUseId` and renders `streamEntries`.
2. With hydrated store data present, historic Task lines will show subagent panel on revisit.

## Implementation Steps

1. Add shared response types for history with subagents (server + client typing).
2. Implement server subagent history extraction utility.
3. Integrate utility into `getAgentHistory`.
4. Add route query params for inclusion and entry limits.
5. Add client store hydration action.
6. Update `useHistoryLoader` to call hydration after successful fetch.
7. Validate interaction with reconnect dedup logic.
8. Add tests.

## Testing Plan

### Server Tests

1. `src/packages/server/claude/session-loader.test.ts`
   - parses subagent jsonl files into `subagents` payload.
   - correlates `toolUseId` correctly.
   - respects `subagentEntriesLimit`.
2. `src/packages/server/services/agent-service` tests
   - `getAgentHistory` returns both `messages` and `subagents`.
3. Route test for `GET /api/agents/:id/history`
   - includes `subagents` by default.
   - excludes when `includeSubagents=false`.

### Client Tests

1. `useHistoryLoader` test
   - hydrates subagents from response payload.
2. Subagent store test
   - history hydration merges/replaces correctly per parent agent.
3. UI behavior test (or integration smoke)
   - revisiting agent still shows subagent stream panel on historical Task lines.

## Risks and Mitigations

1. Correlation ambiguity between subagent file and parent `toolUseId`.
   - Mitigation: layered matching (`parentToolUseID` first, `agentId` fallback), log unresolved files.
2. Large payloads for agents with heavy subagent activity.
   - Mitigation: page-scoped tool IDs + entry limit + truncation for long text fields.
3. Type drift between old clients and new response shape.
   - Mitigation: additive response field only; keep `messages` unchanged.

## Rollout Strategy

1. Ship server support first (additive field).
2. Ship client hydration.
3. Enable by default and monitor response size + render performance.
4. If needed, tune default `subagentEntriesLimit`.

## Acceptance Criteria

1. Run Task/Agent subagents and observe stream panel in realtime.
2. Reload page or switch away/back.
3. Fetch history via `/api/agents/:id/history`.
4. Historical Task lines still show corresponding subagent stream entries and completion stats.
