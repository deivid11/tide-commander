# CC (Control de Cambios) Process Automation — Full Spec

## Overview

This document specifies the set of **generic, reusable features** needed to automate the CC (Control de Cambios) process end-to-end. Nothing here is hardcoded to the CC workflow — we are building configurable infrastructure that the CC process is the first consumer of.

The features are organized in 8 phases (Phase 0 through Phase 6, plus Phase 5b), each independent enough to be developed and tested on its own, but together they form the complete automation pipeline. External integrations (Slack, Gmail, Calendar, DOCX, Jira) follow a self-contained **plugin architecture** — each lives in its own folder and implements a common `IntegrationPlugin` interface.

### Current Manual Process (Reference)

1. Developer sends Slack message requesting a release
2. CC operator asks a set of questions back via Slack
3. Operator creates a Jira Service Desk ticket for the CC, gets the ticket number
4. With the answers + ticket number, operator fills a DOCX template to create the CC file
5. Operator validates release date/time (normal = 2+ working days, otherwise = urgent)
6. Operator creates a Google Calendar event, invites the devs
7. Operator emails the CC file to client approvers with a templated body
8. Operator waits for 3+ email approvals from specific people
9. Once approved, operator sends Slack message: "green light"
10. At T-10min before release, operator sends Slack reminder
11. Developer confirms readiness via Slack
12. Operator sends "release starting" email in the approval thread

### Architecture Principle

Every integration is a **self-contained plugin** that provides skills (markdown instructions + REST endpoints agents call via `curl`), trigger handlers, and configuration — all behind a common `IntegrationPlugin` interface. The core app discovers and wires plugins at startup without importing integration-specific code. See the "Integration Plugin Architecture" section below for the full interface spec.

```
External World          Integration Plugin              Core                    Agent
──────────────          ──────────────────              ────                    ─────
Slack message  ──► [slack/] TriggerHandler ──► Trigger Service ──► Agent wakes up
Email reply    ──► [gmail/] TriggerHandler ──► Trigger Service ──► Agent wakes up
Jira webhook   ──► [jira/]  TriggerHandler ──► Trigger Service ──► Agent wakes up
Cron fires     ──► (core cron service)     ──► Trigger Service ──► Agent wakes up

                   [slack/] Router  /api/slack/send     ◄────────  Agent calls via curl
                   [gmail/] Router  /api/email/send     ◄────────  Agent calls via curl
                   [jira/]  Router  /api/jira/issues    ◄────────  Agent calls via curl
                   [docx/]  Router  /api/documents/gen  ◄────────  Agent calls via curl
                   [gcal/]  Router  /api/calendar/event ◄────────  Agent calls via curl
```

### Storage Principle: JSON for Config, SQLite for Events

All existing Tide Commander state uses JSON files on disk. We keep that for **configuration data** (agent definitions, trigger definitions, workflow definitions, skill definitions, secrets, etc.). These are low-volume, human-readable, and benefit from the atomic-write pattern already in place.

However, the new automation features generate **operational/event data** at a much higher volume and with different access patterns: trigger fire logs, Slack messages, email threads, workflow execution history, agent reasoning traces, approval events, document generation records, etc. This data is:

- **Append-heavy** — mostly inserts, rarely updated
- **Query-heavy** — needs filtering by date, workflow instance, trigger, channel, thread, etc.
- **High-volume** — a single workflow instance can generate hundreds of events
- **Auditable** — must be retained for compliance and debugging

For this data, we use **SQLite** via `better-sqlite3` (synchronous, fast, zero-config, single-file). The database lives at:

```
~/.local/share/tide-commander/events.db
```

**The boundary is clear:**

| Data Type | Storage | Examples |
|---|---|---|
| Configuration | JSON files (existing) | Agent definitions, trigger configs, workflow definitions, skills, secrets, buildings |
| Operational events | SQLite | Trigger fires, Slack messages, emails sent/received, workflow instance state, agent task logs, approval events, document generations |

### Integration Plugin Architecture

External integrations (Slack, Gmail, Google Calendar, DOCX generation, Jira) are **self-contained plugins**, not scattered across the codebase. Each integration lives in its own folder and implements a common interface. The core app discovers, loads, and wires them — but never imports integration-specific code directly.

**Why:** Without this, adding a new integration means touching 6+ files across the app (service, routes, data store, skill, trigger callback, WS messages, index.ts init). With the plugin pattern, adding a new integration is "create a folder, implement the interface, register it."

**What is NOT a plugin:** Triggers, workflows, the SQLite event store, and the agent system are core infrastructure. Integrations plug *into* them. The trigger system doesn't know about Slack — it asks the Slack plugin's trigger handler to evaluate events. The workflow engine doesn't know about Gmail — it sends prompts to agents who call the Gmail plugin's API.

#### The `IntegrationPlugin` Interface

```typescript
// src/packages/server/integrations/integration-types.ts

export interface IntegrationPlugin {
  /** Unique identifier, e.g. 'slack', 'gmail', 'google-calendar', 'docx' */
  id: string;

  /** Human-readable name shown in UI */
  name: string;

  /** Brief description of what this integration does */
  description: string;

  /** Route prefix for this integration's API endpoints (e.g. '/slack', '/email') */
  routePrefix: string;

  // ─── Lifecycle ───

  /** Initialize the integration. Called once at server startup.
   *  Receives the context object with references to core services. */
  init(ctx: IntegrationContext): Promise<void>;

  /** Clean shutdown. Close connections, flush state. */
  shutdown(): Promise<void>;

  // ─── Capabilities ───

  /** Express router with this integration's API endpoints.
   *  Mounted at /api/{routePrefix}/ by the registry. */
  getRoutes(): Router;

  /** Built-in skills this integration provides to agents.
   *  Registered in the skill service automatically. */
  getSkills(): BuiltinSkillDefinition[];

  /** Trigger handler for this integration's trigger type.
   *  If present, the trigger service delegates matching/subscribing to it.
   *  Return null if this integration doesn't provide triggers. */
  getTriggerHandler(): TriggerHandler | null;

  /** Current connection/health status. */
  getStatus(): IntegrationStatus;

  // ─── Configuration ───

  /** Declarative schema for this integration's settings.
   *  Drives the generic settings UI — no custom React component needed for basic config. */
  getConfigSchema(): ConfigField[];

  /** Get current configuration values. */
  getConfig(): Record<string, unknown>;

  /** Update configuration. The integration validates and applies internally. */
  setConfig(config: Record<string, unknown>): Promise<void>;

  // ─── Optional: Custom UI ───

  /** If the generic config form isn't enough, the integration can declare
   *  a custom React component name. The client-side registry maps this to
   *  a lazy-loaded component. Most integrations won't need this. */
  getCustomSettingsComponent?(): string | null;
}
```

#### The `IntegrationContext` (Dependency Injection)

Integrations don't import core services directly. Instead, they receive an `IntegrationContext` at init time that provides everything they need:

```typescript
export interface IntegrationContext {
  /** Log events to SQLite */
  eventDb: {
    logTriggerFire: typeof eventQueries.logTriggerFire;
    logSlackMessage: typeof eventQueries.logSlackMessage;
    logEmailMessage: typeof eventQueries.logEmailMessage;
    logApprovalEvent: typeof eventQueries.logApprovalEvent;
    logDocumentGeneration: typeof eventQueries.logDocumentGeneration;
    logCalendarAction: typeof eventQueries.logCalendarAction;
    logJiraTicketAction: typeof eventQueries.logJiraTicketAction;
    logAudit: typeof eventQueries.logAudit;
    // Each integration only uses the log functions it needs
  };

  /** Send a command/message to an agent */
  sendAgentMessage: (agentId: string, message: string) => Promise<void>;

  /** Broadcast a WS message to all connected clients */
  broadcast: (message: ServerMessage) => void;

  /** Read/write secrets (encrypted at rest) */
  secrets: {
    get: (key: string) => string | undefined;
    set: (key: string, value: string) => void;
  };

  /** Server config (port, host, auth token — for generating curl commands in skills) */
  serverConfig: {
    port: number;
    host: string;
    authToken?: string;
    baseUrl: string;        // e.g. "http://localhost:5174"
  };

  /** Logger scoped to this integration */
  log: {
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
}
```

#### The `TriggerHandler` Interface

Each integration that provides triggers implements this:

```typescript
export interface TriggerHandler {
  /** The trigger type this handler manages (e.g. 'slack', 'email') */
  triggerType: string;

  /** Start listening for events from the external source.
   *  Called once during trigger-service init.
   *  The handler calls `onEvent` whenever something happens. */
  startListening(onEvent: (event: ExternalEvent) => void): Promise<void>;

  /** Stop listening. Called on shutdown. */
  stopListening(): Promise<void>;

  /** Structural matching: check if an external event matches a trigger's config fields.
   *  Only called when matchMode is 'structural' or 'hybrid'.
   *  For 'hybrid' mode, this runs first as a cheap pre-filter before the LLM. */
  structuralMatch(trigger: Trigger, event: ExternalEvent): boolean;

  /** Extract interpolation variables from an event using field-based logic.
   *  Only called when extractionMode is 'structural' (the default). */
  extractVariables(trigger: Trigger, event: ExternalEvent): Record<string, string>;

  /** Serialize the event payload into a human-readable string for the LLM.
   *  Called when matchMode is 'llm' or 'hybrid', and when extractionMode is 'llm'.
   *  Each integration knows how to format its events best.
   *  E.g. Slack: "From: @john in #releases: 'We need to deploy v2.1 urgently'"
   *  E.g. Email: "From: john@co.com | Subject: Re: Release approval | Body: Approved." */
  formatEventForLLM(event: ExternalEvent): string;
}

export interface ExternalEvent {
  source: string;              // e.g. 'slack', 'email', 'jira'
  type: string;                // e.g. 'message', 'new_email', 'approval', 'issue_created'
  data: unknown;               // Raw event data (Slack event, email message, etc.)
  timestamp: number;
}
```

#### The `ConfigField` Schema (Generic Settings UI)

```typescript
export type ConfigFieldType = 'text' | 'password' | 'number' | 'boolean' | 'select' | 'textarea' | 'email' | 'url';

export interface ConfigField {
  key: string;                           // Config key (e.g. 'defaultChannelId')
  label: string;                         // Display label (e.g. 'Default Slack Channel')
  type: ConfigFieldType;
  description?: string;                  // Help text
  required?: boolean;
  defaultValue?: unknown;
  placeholder?: string;
  options?: { label: string; value: string }[];  // For 'select' type
  secret?: boolean;                      // If true, value is stored in secrets (encrypted)
  group?: string;                        // Group fields visually (e.g. 'Authentication', 'Defaults')
  validate?: (value: unknown) => string | null;  // Return error message or null
}
```

This drives a generic `<IntegrationSettingsForm>` React component that renders fields based on the schema. No custom React code per integration unless truly needed.

#### The Integration Registry

```typescript
// src/packages/server/integrations/integration-registry.ts

import { slackPlugin } from './slack/index.js';
import { gmailPlugin } from './gmail/index.js';
import { googleCalendarPlugin } from './google-calendar/index.js';
import { docxPlugin } from './docx/index.js';
import { jiraPlugin } from './jira/index.js';

// Explicit registration — no dynamic scanning
const ALL_PLUGINS: IntegrationPlugin[] = [
  slackPlugin,
  gmailPlugin,
  googleCalendarPlugin,
  docxPlugin,
  jiraPlugin,
];

const plugins = new Map<string, IntegrationPlugin>();

/** Initialize all integrations. Called once at server startup. */
export async function initIntegrations(ctx: IntegrationContext): Promise<void> {
  for (const plugin of ALL_PLUGINS) {
    try {
      await plugin.init(ctx);
      plugins.set(plugin.id, plugin);
      ctx.log.info(`Integration loaded: ${plugin.name}`);
    } catch (err) {
      ctx.log.error(`Failed to load integration ${plugin.name}: ${err}`);
      // Integration failure is non-fatal — other integrations still work
    }
  }
}

/** Shut down all integrations gracefully. */
export async function shutdownIntegrations(): Promise<void> {
  for (const [id, plugin] of plugins) {
    try { await plugin.shutdown(); }
    catch (err) { /* log but don't throw */ }
  }
}

/** Get all loaded plugins. */
export function getPlugins(): IntegrationPlugin[] {
  return Array.from(plugins.values());
}

/** Get a specific plugin by ID. */
export function getPlugin(id: string): IntegrationPlugin | undefined {
  return plugins.get(id);
}

/** Mount all integration routes on the Express app. */
export function mountIntegrationRoutes(app: Express): void {
  for (const plugin of plugins.values()) {
    app.use(`/api${plugin.routePrefix}`, plugin.getRoutes());
  }
}

/** Collect all integration skills for the skill service. */
export function getIntegrationSkills(): BuiltinSkillDefinition[] {
  return Array.from(plugins.values()).flatMap(p => p.getSkills());
}

/** Collect all trigger handlers for the trigger service. */
export function getIntegrationTriggerHandlers(): TriggerHandler[] {
  return Array.from(plugins.values())
    .map(p => p.getTriggerHandler())
    .filter((h): h is TriggerHandler => h !== null);
}

/** Get all integration statuses (for the UI). */
export function getIntegrationStatuses(): { id: string; name: string; status: IntegrationStatus }[] {
  return Array.from(plugins.values()).map(p => ({
    id: p.id,
    name: p.name,
    status: p.getStatus(),
  }));
}

/** Get all config schemas (for the generic settings UI). */
export function getIntegrationConfigs(): { id: string; name: string; description: string; schema: ConfigField[]; values: Record<string, unknown>; status: IntegrationStatus; customComponent?: string }[] {
  return Array.from(plugins.values()).map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    schema: p.getConfigSchema(),
    values: p.getConfig(),
    status: p.getStatus(),
    customComponent: p.getCustomSettingsComponent?.() ?? undefined,
  }));
}
```

#### How Integrations Wire Into Core

**Server startup** (`src/packages/server/index.ts`):
```typescript
import { initIntegrations, shutdownIntegrations, mountIntegrationRoutes } from './integrations/integration-registry.js';

async function main() {
  initEventDb();
  agentService.initAgents();
  triggerService.initTriggers();

  // Build the context and init all integrations
  const integrationCtx = buildIntegrationContext();
  await initIntegrations(integrationCtx);

  const app = createApp();

  // Mount integration routes (each plugin's router at its prefix)
  mountIntegrationRoutes(app);

  // Register integration skills in the skill service
  skillService.registerExternalSkills(getIntegrationSkills());

  // Register trigger handlers
  triggerService.registerHandlers(getIntegrationTriggerHandlers());

  // ... rest of init
}

// Shutdown:
await shutdownIntegrations();  // Before closing event DB
closeEventDb();
```

**Trigger service** — instead of importing slack/email services directly:
```typescript
// src/packages/server/services/trigger-service.ts

const triggerHandlers = new Map<string, TriggerHandler>();

export function registerHandlers(handlers: TriggerHandler[]): void {
  for (const handler of handlers) {
    triggerHandlers.set(handler.triggerType, handler);
    handler.startListening((event) => {
      // Find all enabled triggers of this type and check matches
      for (const trigger of getTriggersOfType(handler.triggerType)) {
        if (!trigger.enabled) continue;
        if (handler.matches(trigger, event)) {
          const variables = handler.extractVariables(trigger, event);
          fireTrigger(trigger.id, variables);
        }
      }
    });
  }
}
```

**REST API for integration management**:
```typescript
// src/packages/server/routes/integration-routes.ts

GET    /api/integrations                         // List all integrations with status
// Returns: [{ id, name, description, status, configSchema, configValues }]

GET    /api/integrations/:id                     // Get single integration details
GET    /api/integrations/:id/status              // Get integration status
PATCH  /api/integrations/:id/config              // Update integration config
// Body: { key: value, ... }
```

#### Folder Structure Per Integration

Each integration is a self-contained folder:

```
src/packages/server/integrations/
  integration-types.ts          ← Interfaces: IntegrationPlugin, IntegrationContext, TriggerHandler, ConfigField
  integration-registry.ts       ← Load, init, and wire all plugins
  slack/
    index.ts                    ← Exports slackPlugin implementing IntegrationPlugin
    slack-client.ts             ← Slack Web API + Socket Mode wrapper (connection management)
    slack-routes.ts             ← Express Router for /api/slack/* endpoints
    slack-trigger-handler.ts    ← Implements TriggerHandler for 'slack' type triggers
    slack-skill.ts              ← BuiltinSkillDefinition with curl instructions
    slack-events.ts             ← Helper functions that call eventQueries for Slack-specific logging
    slack-config.ts             ← ConfigField[] schema + defaults + config type
  gmail/
    index.ts
    gmail-client.ts             ← Gmail API wrapper (OAuth2, send, read, poll)
    gmail-routes.ts
    gmail-trigger-handler.ts
    gmail-skill.ts
    gmail-events.ts
    gmail-config.ts
  google-calendar/
    index.ts
    calendar-client.ts          ← Google Calendar API wrapper
    calendar-routes.ts
    calendar-skill.ts
    calendar-events.ts
    calendar-config.ts
    (no trigger handler — calendar doesn't provide triggers)
  docx/
    index.ts
    docx-engine.ts              ← docxtemplater wrapper
    docx-routes.ts
    docx-skill.ts
    docx-events.ts
    docx-config.ts
    (no trigger handler — docx doesn't provide triggers)
  jira/
    index.ts                    ← Exports jiraPlugin implementing IntegrationPlugin
    jira-client.ts              ← Jira REST API v3 / Service Desk API wrapper
    jira-routes.ts              ← Express Router for /api/jira/* endpoints
    jira-trigger-handler.ts     ← TriggerHandler for 'jira' type (webhook-based)
    jira-skill.ts               ← BuiltinSkillDefinition with curl instructions
    jira-events.ts              ← SQLite event logging helpers
    jira-config.ts              ← ConfigField[] schema + defaults
```

#### Client-Side Integration UI

The client doesn't need per-integration React components for basic config. Instead:

```typescript
// src/packages/client/components/IntegrationsPanel/IntegrationsPanel.tsx

// 1. Fetches GET /api/integrations to get all plugins with their schemas
// 2. Renders a list of integration cards with status badges
// 3. Clicking a card opens IntegrationSettingsForm
// 4. IntegrationSettingsForm renders fields from configSchema generically
// 5. Saves via PATCH /api/integrations/:id/config

// For integrations that need custom UI beyond the generic form:
const customComponents: Record<string, React.LazyExoticComponent<any>> = {
  'gmail-oauth': lazy(() => import('./GmailOAuthSetup')),
  // Add more only when the generic form isn't enough
};
```

The generic form handles `text`, `password`, `select`, `boolean`, `textarea` fields. This covers Slack (bot token, app token, default channel), DOCX (template directory), and most Gmail config. Only the Gmail OAuth consent flow needs a custom component (it's a redirect-based flow, not a simple form).

#### WebSocket Messages for Integrations

```typescript
// Server -> Client
| { type: 'integrations_update'; payload: IntegrationInfo[] }                  // Full state on connect
| { type: 'integration_status_changed'; payload: { id: string; status: IntegrationStatus } }

// IntegrationInfo is what getIntegrationConfigs() returns
```

These are broadcast on connect (like agents, skills, etc.) and whenever an integration's status changes (e.g. Slack connects/disconnects).

---

## Phase 0: SQLite Event Store

### Purpose

A centralized, queryable event store for all operational data generated by automations. Every integration logs its events here. The workflow engine uses it as its primary persistence for instance execution state and history.

### Why SQLite

- **Zero-config** — single file, no server process, no ports, no auth
- **Fast** — `better-sqlite3` is synchronous and uses native bindings; typical inserts < 0.1ms
- **Queryable** — full SQL for filtering, aggregation, and joins (JSON files can't do this)
- **Transactional** — ACID guarantees for multi-table writes (e.g., advancing workflow state + logging the event atomically)
- **Concurrent-read safe** — WAL mode allows concurrent reads while writing
- **Portable** — single file backup, easy to export/import

### Database Location

```
~/.local/share/tide-commander/events.db
```

### Schema

```sql
-- ═══════════════════════════════════════════════════════════════
-- TRIGGER EVENTS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE trigger_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_id      TEXT NOT NULL,                  -- FK to trigger config (JSON)
  trigger_name    TEXT NOT NULL,                  -- Denormalized for query convenience
  trigger_type    TEXT NOT NULL,                  -- 'webhook' | 'email' | 'slack' | 'jira' | 'cron'
  agent_id        TEXT,                           -- Agent that was fired (null if fire failed)
  workflow_instance_id TEXT,                      -- If this fire is part of a workflow
  fired_at        INTEGER NOT NULL,               -- Unix epoch ms
  variables       TEXT,                           -- JSON: interpolated variables sent to agent
  payload         TEXT,                           -- JSON: raw incoming payload (webhook body, email data, slack msg)
  match_mode      TEXT NOT NULL DEFAULT 'structural',  -- 'structural' | 'llm' | 'hybrid'
  llm_match_result TEXT,                          -- JSON: { match, reason, confidence, model, tokensUsed } (null if structural)
  llm_extract_result TEXT,                        -- JSON: { variables, reason, model, tokensUsed } (null if structural extraction)
  status          TEXT NOT NULL DEFAULT 'fired',  -- 'fired' | 'delivered' | 'failed'
  error           TEXT,                           -- Error message if status = 'failed'
  duration_ms     INTEGER                         -- Time from fire to agent acknowledgment
);

CREATE INDEX idx_trigger_events_trigger_id ON trigger_events(trigger_id);
CREATE INDEX idx_trigger_events_fired_at ON trigger_events(fired_at);
CREATE INDEX idx_trigger_events_workflow ON trigger_events(workflow_instance_id);
CREATE INDEX idx_trigger_events_status ON trigger_events(status);

-- ═══════════════════════════════════════════════════════════════
-- SLACK MESSAGES
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE slack_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT NOT NULL,                   -- Slack message timestamp (unique ID in Slack)
  thread_ts       TEXT,                            -- Parent thread timestamp
  channel_id      TEXT NOT NULL,
  channel_name    TEXT,
  user_id         TEXT NOT NULL,
  user_name       TEXT NOT NULL,
  text            TEXT NOT NULL,
  direction       TEXT NOT NULL,                   -- 'inbound' | 'outbound'
  agent_id        TEXT,                            -- Which agent sent/received this
  workflow_instance_id TEXT,                       -- If part of a workflow
  raw_event       TEXT,                            -- JSON: full Slack event payload
  received_at     INTEGER NOT NULL                 -- Unix epoch ms
);

CREATE INDEX idx_slack_messages_channel ON slack_messages(channel_id);
CREATE INDEX idx_slack_messages_thread ON slack_messages(channel_id, thread_ts);
CREATE INDEX idx_slack_messages_received_at ON slack_messages(received_at);
CREATE INDEX idx_slack_messages_workflow ON slack_messages(workflow_instance_id);
CREATE INDEX idx_slack_messages_agent ON slack_messages(agent_id);

-- ═══════════════════════════════════════════════════════════════
-- EMAIL MESSAGES
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE email_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id      TEXT NOT NULL,                   -- Gmail message ID
  thread_id       TEXT NOT NULL,                   -- Gmail thread ID
  from_address    TEXT NOT NULL,
  to_addresses    TEXT NOT NULL,                   -- JSON array of strings
  cc_addresses    TEXT,                            -- JSON array of strings
  subject         TEXT NOT NULL,
  body_text       TEXT,                            -- Plain text body
  body_html       TEXT,                            -- HTML body
  direction       TEXT NOT NULL,                   -- 'inbound' | 'outbound'
  has_attachments INTEGER NOT NULL DEFAULT 0,      -- Boolean (0/1)
  attachment_names TEXT,                           -- JSON array of filenames
  agent_id        TEXT,                            -- Which agent sent/processed this
  workflow_instance_id TEXT,                       -- If part of a workflow
  gmail_labels    TEXT,                            -- JSON array of label strings
  raw_headers     TEXT,                            -- JSON: selected headers (In-Reply-To, References, etc.)
  received_at     INTEGER NOT NULL                 -- Unix epoch ms (email Date header)
);

CREATE INDEX idx_email_messages_thread ON email_messages(thread_id);
CREATE INDEX idx_email_messages_from ON email_messages(from_address);
CREATE INDEX idx_email_messages_received_at ON email_messages(received_at);
CREATE INDEX idx_email_messages_workflow ON email_messages(workflow_instance_id);
CREATE INDEX idx_email_messages_direction ON email_messages(direction);

-- ═══════════════════════════════════════════════════════════════
-- EMAIL APPROVAL EVENTS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE email_approval_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id       TEXT NOT NULL,                   -- Gmail thread ID being monitored
  approver_email  TEXT NOT NULL,                   -- Who approved/rejected
  approved        INTEGER NOT NULL,                -- Boolean (0/1)
  reply_message_id TEXT,                           -- The Gmail message ID of the reply
  reply_snippet   TEXT,                            -- First 200 chars of the reply
  keyword_matched TEXT,                            -- Which approval keyword was found
  workflow_instance_id TEXT,
  recorded_at     INTEGER NOT NULL
);

CREATE INDEX idx_approval_events_thread ON email_approval_events(thread_id);
CREATE INDEX idx_approval_events_workflow ON email_approval_events(workflow_instance_id);

-- ═══════════════════════════════════════════════════════════════
-- DOCUMENT GENERATIONS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE document_generations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id     TEXT NOT NULL,
  template_name   TEXT NOT NULL,
  output_filename TEXT NOT NULL,
  output_path     TEXT NOT NULL,                   -- Absolute path on disk
  variables       TEXT NOT NULL,                   -- JSON: variables used
  file_size_bytes INTEGER,
  agent_id        TEXT,                            -- Which agent requested generation
  workflow_instance_id TEXT,
  generated_at    INTEGER NOT NULL
);

CREATE INDEX idx_doc_gen_template ON document_generations(template_id);
CREATE INDEX idx_doc_gen_workflow ON document_generations(workflow_instance_id);
CREATE INDEX idx_doc_gen_generated_at ON document_generations(generated_at);

-- ═══════════════════════════════════════════════════════════════
-- CALENDAR EVENTS LOG
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE calendar_event_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id        TEXT NOT NULL,                   -- Google Calendar event ID
  action          TEXT NOT NULL,                   -- 'created' | 'updated' | 'deleted'
  summary         TEXT NOT NULL,
  start_datetime  TEXT NOT NULL,                   -- ISO 8601
  end_datetime    TEXT NOT NULL,
  attendees       TEXT,                            -- JSON array of email strings
  html_link       TEXT,
  agent_id        TEXT,
  workflow_instance_id TEXT,
  recorded_at     INTEGER NOT NULL
);

CREATE INDEX idx_calendar_logs_event ON calendar_event_logs(event_id);
CREATE INDEX idx_calendar_logs_workflow ON calendar_event_logs(workflow_instance_id);

-- ═══════════════════════════════════════════════════════════════
-- JIRA TICKET LOGS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE jira_ticket_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_key      TEXT NOT NULL,                   -- Jira issue key (e.g. "SD-1234")
  ticket_id       TEXT NOT NULL,                   -- Jira issue ID (numeric)
  project_key     TEXT NOT NULL,                   -- Jira project key (e.g. "SD")
  action          TEXT NOT NULL,                   -- 'created' | 'updated' | 'transitioned' | 'commented'
  summary         TEXT NOT NULL,                   -- Issue summary/title
  issue_type      TEXT,                            -- e.g. 'Service Request', 'Task', 'Bug'
  status          TEXT,                            -- Jira status after action (e.g. 'Open', 'In Progress')
  priority        TEXT,                            -- Jira priority (e.g. 'High', 'Medium')
  assignee        TEXT,                            -- Assignee email or username
  description     TEXT,                            -- Issue description (truncated if large)
  fields_changed  TEXT,                            -- JSON: { field: { old, new } } for updates
  comment_body    TEXT,                            -- Comment text (for 'commented' action)
  self_url        TEXT,                            -- Jira issue URL
  agent_id        TEXT,
  workflow_instance_id TEXT,
  recorded_at     INTEGER NOT NULL
);

CREATE INDEX idx_jira_logs_ticket ON jira_ticket_logs(ticket_key);
CREATE INDEX idx_jira_logs_project ON jira_ticket_logs(project_key);
CREATE INDEX idx_jira_logs_workflow ON jira_ticket_logs(workflow_instance_id);
CREATE INDEX idx_jira_logs_recorded ON jira_ticket_logs(recorded_at);

-- ═══════════════════════════════════════════════════════════════
-- WORKFLOW INSTANCES (runtime state — replaces workflow-instances.json)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE workflow_instances (
  id                  TEXT PRIMARY KEY,            -- Instance ID
  workflow_def_id     TEXT NOT NULL,               -- FK to workflow definition (JSON)
  workflow_name       TEXT NOT NULL,               -- Denormalized
  status              TEXT NOT NULL,               -- 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  current_state_id    TEXT NOT NULL,
  variables           TEXT NOT NULL DEFAULT '{}',  -- JSON: current variable values
  active_trigger_ids  TEXT NOT NULL DEFAULT '[]',  -- JSON array of trigger IDs owned by this instance
  active_timers       TEXT NOT NULL DEFAULT '[]',  -- JSON array of timer IDs
  error               TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  completed_at        INTEGER
);

CREATE INDEX idx_workflow_instances_status ON workflow_instances(status);
CREATE INDEX idx_workflow_instances_def ON workflow_instances(workflow_def_id);
CREATE INDEX idx_workflow_instances_created ON workflow_instances(created_at);

-- ═══════════════════════════════════════════════════════════════
-- WORKFLOW STEP LOG (every state transition — the full audit trail)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE workflow_step_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_instance_id TEXT NOT NULL,
  from_state_id       TEXT,                        -- null for initial entry
  to_state_id         TEXT NOT NULL,
  to_state_name       TEXT NOT NULL,               -- Denormalized for readability
  transition_name     TEXT,                        -- Which transition was taken
  transition_condition TEXT,                       -- JSON: the condition that triggered it

  -- What happened in this step
  action_type         TEXT,                        -- 'agent_task' | 'trigger_setup' | 'wait_for_trigger' | 'set_variables' | null (for 'end' states)
  agent_id            TEXT,                        -- Agent that executed (if action_type = 'agent_task')
  prompt_sent         TEXT,                        -- The interpolated prompt sent to the agent
  agent_response      TEXT,                        -- Summary/key output from the agent
  agent_reasoning     TEXT,                        -- Agent's reasoning/thought process (if extractable)
  trigger_id          TEXT,                        -- Trigger involved (if trigger-based)
  trigger_payload     TEXT,                        -- JSON: data received from trigger

  -- Variable snapshot
  variables_before    TEXT,                        -- JSON: variables at state entry
  variables_after     TEXT,                        -- JSON: variables at state exit

  -- Timing
  entered_at          INTEGER NOT NULL,            -- When we entered this state
  exited_at           INTEGER,                     -- When we left (null if current state)
  duration_ms         INTEGER,                     -- Time spent in this state

  -- Status
  status              TEXT NOT NULL DEFAULT 'entered', -- 'entered' | 'executing' | 'completed' | 'failed' | 'skipped'
  error               TEXT
);

CREATE INDEX idx_step_log_instance ON workflow_step_log(workflow_instance_id);
CREATE INDEX idx_step_log_entered ON workflow_step_log(entered_at);
CREATE INDEX idx_step_log_agent ON workflow_step_log(agent_id);
CREATE INDEX idx_step_log_status ON workflow_step_log(status);

-- ═══════════════════════════════════════════════════════════════
-- WORKFLOW VARIABLE CHANGES (granular audit of every variable mutation)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE workflow_variable_changes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_instance_id TEXT NOT NULL,
  step_log_id         INTEGER,                     -- FK to workflow_step_log
  variable_name       TEXT NOT NULL,
  old_value           TEXT,                        -- JSON-encoded previous value (null if first set)
  new_value           TEXT NOT NULL,               -- JSON-encoded new value
  changed_by          TEXT NOT NULL,               -- 'agent:<agentId>' | 'trigger:<triggerId>' | 'system' | 'manual'
  changed_at          INTEGER NOT NULL
);

CREATE INDEX idx_var_changes_instance ON workflow_variable_changes(workflow_instance_id);
CREATE INDEX idx_var_changes_variable ON workflow_variable_changes(variable_name);
CREATE INDEX idx_var_changes_step ON workflow_variable_changes(step_log_id);

-- ═══════════════════════════════════════════════════════════════
-- GENERIC AUDIT LOG (catch-all for events not covered above)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  category        TEXT NOT NULL,                   -- 'trigger' | 'slack' | 'email' | 'calendar' | 'document' | 'jira' | 'workflow' | 'system'
  action          TEXT NOT NULL,                   -- Free-form action name (e.g. 'approval_check', 'connection_lost', 'polling_error')
  agent_id        TEXT,
  workflow_instance_id TEXT,
  details         TEXT,                            -- JSON: arbitrary event data
  level           TEXT NOT NULL DEFAULT 'info',    -- 'debug' | 'info' | 'warn' | 'error'
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_audit_log_category ON audit_log(category);
CREATE INDEX idx_audit_log_workflow ON audit_log(workflow_instance_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);
CREATE INDEX idx_audit_log_level ON audit_log(level);
```

### Server-Side Files

#### `src/packages/server/data/event-db.ts`

The central database module. Manages connection, schema migrations, and provides typed helpers.

```typescript
import Database from 'better-sqlite3';

let db: Database.Database;

// Lifecycle
export function initEventDb(): void
// Opens/creates events.db, enables WAL mode, runs migrations
// WAL mode: db.pragma('journal_mode = WAL')
// Busy timeout: db.pragma('busy_timeout = 5000')

export function closeEventDb(): void
// Graceful close on shutdown

export function getDb(): Database.Database
// Returns the database instance for direct use by services

// Schema migration
export function runMigrations(): void
// Checks a `schema_version` pragma or internal table,
// applies incremental migrations (v1, v2, ...) as needed.
// Initial migration creates all tables above.

// Helpers
export function insertOne<T>(table: string, row: T): number         // Returns lastInsertRowid
export function queryMany<T>(sql: string, params?: unknown[]): T[]  // SELECT helper
export function queryOne<T>(sql: string, params?: unknown[]): T | undefined
export function execute(sql: string, params?: unknown[]): Database.RunResult
export function transaction<T>(fn: () => T): T                      // Wraps in transaction
```

#### `src/packages/server/data/event-queries.ts`

Pre-built query functions organized by domain. Each integration calls these instead of writing raw SQL.

```typescript
// ─── Trigger Events ───
export function logTriggerFire(event: TriggerFireEvent): number
export function getTriggerHistory(triggerId: string, opts?: { limit?: number; offset?: number }): TriggerFireEvent[]
export function getTriggerHistoryByWorkflow(workflowInstanceId: string): TriggerFireEvent[]
export function countTriggerFires(triggerId: string, since?: number): number
export function updateTriggerEventStatus(eventId: number, status: string, error?: string, durationMs?: number): void

// ─── Slack Messages ───
export function logSlackMessage(msg: SlackMessageEvent): number
export function getSlackMessagesByChannel(channelId: string, opts?: { limit?: number; since?: number }): SlackMessageEvent[]
export function getSlackMessagesByThread(channelId: string, threadTs: string): SlackMessageEvent[]
export function getSlackMessagesByWorkflow(workflowInstanceId: string): SlackMessageEvent[]
export function getSlackMessagesByAgent(agentId: string, opts?: { limit?: number }): SlackMessageEvent[]

// ─── Email Messages ───
export function logEmailMessage(msg: EmailMessageEvent): number
export function getEmailsByThread(threadId: string): EmailMessageEvent[]
export function getEmailsByWorkflow(workflowInstanceId: string): EmailMessageEvent[]
export function getRecentEmails(opts?: { limit?: number; direction?: string; since?: number }): EmailMessageEvent[]

// ─── Approval Events ───
export function logApprovalEvent(event: ApprovalEvent): number
export function getApprovalsByThread(threadId: string): ApprovalEvent[]
export function getApprovalsByWorkflow(workflowInstanceId: string): ApprovalEvent[]

// ─── Document Generations ───
export function logDocumentGeneration(gen: DocumentGenerationEvent): number
export function getDocGenByWorkflow(workflowInstanceId: string): DocumentGenerationEvent[]
export function getDocGenByTemplate(templateId: string, opts?: { limit?: number }): DocumentGenerationEvent[]
export function getRecentDocGenerations(opts?: { limit?: number }): DocumentGenerationEvent[]

// ─── Calendar Event Logs ───
export function logCalendarAction(log: CalendarActionEvent): number
export function getCalendarLogsByEvent(eventId: string): CalendarActionEvent[]
export function getCalendarLogsByWorkflow(workflowInstanceId: string): CalendarActionEvent[]

// ─── Jira Ticket Logs ───
export function logJiraTicketAction(log: JiraTicketLogEvent): number
export function getJiraLogsByTicket(ticketKey: string): JiraTicketLogEvent[]
export function getJiraLogsByProject(projectKey: string, opts?: { limit?: number }): JiraTicketLogEvent[]
export function getJiraLogsByWorkflow(workflowInstanceId: string): JiraTicketLogEvent[]
export function getRecentJiraActions(opts?: { limit?: number; action?: string }): JiraTicketLogEvent[]

// ─── Workflow Instances ───
export function insertWorkflowInstance(instance: WorkflowInstanceRow): void
export function updateWorkflowInstance(id: string, updates: Partial<WorkflowInstanceRow>): void
export function getWorkflowInstance(id: string): WorkflowInstanceRow | undefined
export function listWorkflowInstances(opts?: { status?: string; workflowDefId?: string; limit?: number; offset?: number }): WorkflowInstanceRow[]
export function countWorkflowInstances(opts?: { status?: string; workflowDefId?: string }): number

// ─── Workflow Step Log ───
export function insertStepLog(step: WorkflowStepLogRow): number
export function updateStepLog(id: number, updates: Partial<WorkflowStepLogRow>): void
export function getStepsByInstance(workflowInstanceId: string): WorkflowStepLogRow[]
export function getCurrentStep(workflowInstanceId: string): WorkflowStepLogRow | undefined
export function getStepsByAgent(agentId: string, opts?: { limit?: number }): WorkflowStepLogRow[]

// ─── Workflow Variable Changes ───
export function logVariableChange(change: VariableChangeRow): number
export function getVariableHistory(workflowInstanceId: string, variableName?: string): VariableChangeRow[]

// ─── Audit Log ───
export function logAudit(entry: AuditLogEntry): number
export function queryAuditLog(opts?: {
  category?: string;
  level?: string;
  workflowInstanceId?: string;
  agentId?: string;
  since?: number;
  limit?: number;
  offset?: number;
}): AuditLogEntry[]
export function countAuditEntries(opts?: { category?: string; level?: string; since?: number }): number
```

#### `src/packages/shared/event-types.ts`

TypeScript interfaces for all event row types, shared between server and client:

```typescript
export interface TriggerFireEvent {
  id?: number;
  triggerId: string;
  triggerName: string;
  triggerType: TriggerType;
  agentId?: string;
  workflowInstanceId?: string;
  firedAt: number;
  variables?: Record<string, string>;
  payload?: unknown;
  matchMode: MatchMode;
  llmMatchResult?: {                  // Present when matchMode is 'llm' or 'hybrid'
    match: boolean;
    reason: string;
    confidence: number;
    model: string;
    tokensUsed: number;
    durationMs: number;
  };
  llmExtractResult?: {                // Present when extractionMode is 'llm'
    variables: Record<string, string>;
    reason: string;
    model: string;
    tokensUsed: number;
    durationMs: number;
  };
  status: 'fired' | 'delivered' | 'failed';
  error?: string;
  durationMs?: number;
}

export interface SlackMessageEvent {
  id?: number;
  ts: string;
  threadTs?: string;
  channelId: string;
  channelName?: string;
  userId: string;
  userName: string;
  text: string;
  direction: 'inbound' | 'outbound';
  agentId?: string;
  workflowInstanceId?: string;
  rawEvent?: unknown;
  receivedAt: number;
}

export interface EmailMessageEvent {
  id?: number;
  messageId: string;
  threadId: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses?: string[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  direction: 'inbound' | 'outbound';
  hasAttachments: boolean;
  attachmentNames?: string[];
  agentId?: string;
  workflowInstanceId?: string;
  gmailLabels?: string[];
  rawHeaders?: Record<string, string>;
  receivedAt: number;
}

export interface ApprovalEvent {
  id?: number;
  threadId: string;
  approverEmail: string;
  approved: boolean;
  replyMessageId?: string;
  replySnippet?: string;
  keywordMatched?: string;
  workflowInstanceId?: string;
  recordedAt: number;
}

export interface DocumentGenerationEvent {
  id?: number;
  templateId: string;
  templateName: string;
  outputFilename: string;
  outputPath: string;
  variables: Record<string, unknown>;
  fileSizeBytes?: number;
  agentId?: string;
  workflowInstanceId?: string;
  generatedAt: number;
}

export interface CalendarActionEvent {
  id?: number;
  eventId: string;
  action: 'created' | 'updated' | 'deleted';
  summary: string;
  startDatetime: string;
  endDatetime: string;
  attendees?: string[];
  htmlLink?: string;
  agentId?: string;
  workflowInstanceId?: string;
  recordedAt: number;
}

export interface JiraTicketLogEvent {
  id?: number;
  ticketKey: string;                             // e.g. "SD-1234"
  ticketId: string;                              // Jira numeric ID
  projectKey: string;                            // e.g. "SD"
  action: 'created' | 'updated' | 'transitioned' | 'commented';
  summary: string;
  issueType?: string;                            // e.g. 'Service Request'
  status?: string;                               // Jira status after action
  priority?: string;
  assignee?: string;
  description?: string;
  fieldsChanged?: Record<string, { old?: string; new: string }>;
  commentBody?: string;
  selfUrl?: string;                              // Full Jira issue URL
  agentId?: string;
  workflowInstanceId?: string;
  recordedAt: number;
}

export interface WorkflowInstanceRow {
  id: string;
  workflowDefId: string;
  workflowName: string;
  status: WorkflowInstanceStatus;
  currentStateId: string;
  variables: Record<string, unknown>;        // Stored as JSON TEXT in DB
  activeTriggerIds: string[];                // Stored as JSON TEXT in DB
  activeTimers: string[];                    // Stored as JSON TEXT in DB
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface WorkflowStepLogRow {
  id?: number;
  workflowInstanceId: string;
  fromStateId?: string;
  toStateId: string;
  toStateName: string;
  transitionName?: string;
  transitionCondition?: unknown;
  actionType?: string;
  agentId?: string;
  promptSent?: string;
  agentResponse?: string;
  agentReasoning?: string;
  triggerId?: string;
  triggerPayload?: unknown;
  variablesBefore?: Record<string, unknown>;
  variablesAfter?: Record<string, unknown>;
  enteredAt: number;
  exitedAt?: number;
  durationMs?: number;
  status: 'entered' | 'executing' | 'completed' | 'failed' | 'skipped';
  error?: string;
}

export interface VariableChangeRow {
  id?: number;
  workflowInstanceId: string;
  stepLogId?: number;
  variableName: string;
  oldValue?: unknown;
  newValue: unknown;
  changedBy: string;                         // 'agent:<id>' | 'trigger:<id>' | 'system' | 'manual'
  changedAt: number;
}

export interface AuditLogEntry {
  id?: number;
  category: 'trigger' | 'slack' | 'email' | 'calendar' | 'document' | 'workflow' | 'system';
  action: string;
  agentId?: string;
  workflowInstanceId?: string;
  details?: unknown;
  level: 'debug' | 'info' | 'warn' | 'error';
  createdAt: number;
}
```

### REST API Endpoints

```typescript
// src/packages/server/routes/event-routes.ts

// ─── Query endpoints (read-only, for UI and debugging) ───

GET    /api/events/triggers
// Query: ?triggerId=...&workflowInstanceId=...&status=...&since=...&limit=50&offset=0
// Returns: { events: TriggerFireEvent[], total: number }

GET    /api/events/slack
// Query: ?channelId=...&threadTs=...&workflowInstanceId=...&agentId=...&since=...&limit=50
// Returns: { messages: SlackMessageEvent[], total: number }

GET    /api/events/email
// Query: ?threadId=...&workflowInstanceId=...&direction=...&since=...&limit=50
// Returns: { messages: EmailMessageEvent[], total: number }

GET    /api/events/approvals
// Query: ?threadId=...&workflowInstanceId=...&limit=50
// Returns: { events: ApprovalEvent[], total: number }

GET    /api/events/documents
// Query: ?templateId=...&workflowInstanceId=...&since=...&limit=50
// Returns: { events: DocumentGenerationEvent[], total: number }

GET    /api/events/calendar
// Query: ?eventId=...&workflowInstanceId=...&since=...&limit=50
// Returns: { events: CalendarActionEvent[], total: number }

GET    /api/events/jira
// Query: ?ticketKey=...&projectKey=...&workflowInstanceId=...&action=...&since=...&limit=50
// Returns: { events: JiraTicketLogEvent[], total: number }

GET    /api/events/audit
// Query: ?category=...&level=...&workflowInstanceId=...&agentId=...&since=...&limit=100&offset=0
// Returns: { entries: AuditLogEntry[], total: number }

// ─── Workflow-centric history (primary UI endpoint) ───

GET    /api/events/workflow/:instanceId/timeline
// Returns a merged, chronological timeline of ALL events for a workflow instance:
// trigger fires, slack messages, emails, approvals, doc generations, calendar actions, step transitions
// Each entry has a `type` discriminator and unified `timestamp` field
// Returns: { timeline: TimelineEntry[], instance: WorkflowInstanceRow }

GET    /api/events/workflow/:instanceId/steps
// Returns: { steps: WorkflowStepLogRow[] }

GET    /api/events/workflow/:instanceId/variables
// Query: ?variableName=... (optional filter)
// Returns: { changes: VariableChangeRow[] }

// ─── Stats ───

GET    /api/events/stats
// Returns aggregate stats for dashboard:
// { triggersFiredToday, slackMessageCount, emailCount, activeWorkflows, completedWorkflows, failedWorkflows }
```

### Server Initialization

In `src/packages/server/index.ts`:

```typescript
import { initEventDb, closeEventDb } from './data/event-db.js';

async function main() {
  // FIRST — before any service that logs events
  initEventDb();

  agentService.initAgents();
  triggerService.initTriggers();
  // ... rest of init
}

// In shutdown:
closeEventDb();  // LAST — after all services have flushed
```

### Schema Migrations

Migrations are numbered SQL files applied in order. The database tracks the current version in a `_migrations` table:

```sql
CREATE TABLE IF NOT EXISTS _migrations (
  version   INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
```

```
src/packages/server/data/migrations/
  001_initial_schema.sql       -- All tables from the schema above
  002_add_xxx.sql              -- Future additions
```

Each migration is idempotent — it checks current version and only applies if needed. This keeps upgrades safe for users who update Tide Commander.

### Data Retention

To prevent unbounded growth:

```typescript
// src/packages/server/services/event-retention-service.ts

export function init(): void
// Starts a daily cleanup job (runs once per day via setTimeout, not cron)

export function cleanupOldEvents(retentionDays: number): void
// Default: 90 days for all event tables
// Deletes rows where timestamp < now - retentionDays
// Runs in a transaction to avoid partial deletes

export function getDbSize(): { sizeBytes: number; rowCounts: Record<string, number> }
// For monitoring in the UI
```

Retention period is configurable via a setting in `~/.local/share/tide-commander/event-retention.json`:

```json
{
  "retentionDays": 90,
  "cleanupEnabled": true
}
```

### Client UI Integration

The event store powers several UI views:

1. **Trigger fire log** — in the Trigger Manager, show history of fires with status, timing, and linked workflow
2. **Workflow timeline** — the primary view for a workflow instance, showing every step, every message, every email, every approval in chronological order
3. **Slack message log** — searchable history of all Slack interactions
4. **Email log** — searchable history of all emails sent/received
5. **Audit log viewer** — filterable log for debugging and compliance
6. **Stats dashboard** — aggregate counts and trends

### Dependencies

```
better-sqlite3        — Synchronous SQLite3 bindings for Node.js
@types/better-sqlite3 — TypeScript types
```

### Decisions

- **Full-text search**: Not for v1. The workflow chat feature covers most search needs conversationally. FTS5 indexes can be added as a later migration if raw text search is needed.
- **Export format**: Deferred to a future sprint. The workflow chat can summarize executions on demand for now.
- **Single database**: Yes — one `events.db` file. Cross-workflow queries ("how many CCs this month?") are valuable. No per-workflow databases.

---

## Phase 1: Trigger System

### Purpose

A generic mechanism where external events fire a pre-configured agent with a pre-configured prompt. Triggers are the foundation — every other phase plugs into them.

### Data Model

```typescript
// src/packages/shared/trigger-types.ts

export type TriggerType = 'webhook' | 'email' | 'slack' | 'jira' | 'cron';
export type TriggerStatus = 'enabled' | 'disabled' | 'error';

export type MatchMode = 'structural' | 'llm' | 'hybrid';
export type ExtractionMode = 'structural' | 'llm';

export interface BaseTrigger {
  id: string;
  name: string;
  description?: string;
  type: TriggerType;
  agentId: string;                    // Which agent to fire
  promptTemplate: string;             // Message sent to agent, supports {{variable}} interpolation
  enabled: boolean;
  status: TriggerStatus;
  lastFiredAt?: number;
  lastError?: string;
  fireCount: number;
  createdAt: number;
  updatedAt: number;

  // ─── Matching Strategy ───

  matchMode: MatchMode;               // How to evaluate if an event matches this trigger
                                      //   'structural' — classic field-based matching (default, fast, free)
                                      //   'llm'        — LLM-only semantic matching (flexible, costs tokens)
                                      //   'hybrid'     — structural pre-filter + LLM final decision (best of both)

  llmMatch?: {                        // Required when matchMode is 'llm' or 'hybrid'
    prompt: string;                   // Natural language condition, e.g. "Does this message request a CC?"
    model?: string;                   // Model to use (default: 'haiku' — fast/cheap classification)
    temperature?: number;             // LLM temperature (default: 0 — deterministic)
    maxTokens?: number;               // Max response tokens (default: 150 — enough for reason + boolean)
    minConfidence?: number;           // Minimum confidence to accept match (default: 0.0 — any positive match fires)
  };

  // ─── Variable Extraction Strategy ───

  extractionMode?: ExtractionMode;    // How to extract variables from matched events
                                      //   'structural' — use TriggerHandler.extractVariables() (default)
                                      //   'llm'        — LLM extracts variables from event payload

  llmExtract?: {                      // Required when extractionMode is 'llm'
    prompt: string;                   // What to extract, e.g. "Extract: release name, affected systems, urgency"
    variables: string[];              // Expected variable names in output, e.g. ['release_name', 'affected_systems']
    model?: string;                   // Model to use (default: same as llmMatch.model)
  };
}

export interface WebhookTrigger extends BaseTrigger {
  type: 'webhook';
  config: {
    secret?: string;                  // Optional HMAC secret for payload validation
    method: 'POST' | 'PUT';          // Accepted HTTP method
    extractFields?: string[];         // JSON paths to extract from payload (e.g. "body.release_name")
  };
}

export interface EmailTrigger extends BaseTrigger {
  type: 'email';
  config: {
    fromFilter?: string[];            // Only trigger for emails from these addresses
    subjectPattern?: string;          // Regex to match subject line
    threadId?: string;                // Only watch a specific thread (for approval monitoring)
    requiredApprovals?: {             // Approval mode config
      count: number;                  // Min number of approvals needed
      approvers: string[];            // Email addresses of valid approvers
      approvalKeywords: string[];     // Words that count as approval (e.g. "approved", "aprobado")
    };
  };
}

export interface SlackTrigger extends BaseTrigger {
  type: 'slack';
  config: {
    channelId?: string;               // Watch specific channel (null = DMs to bot)
    userFilter?: string[];            // Only trigger for messages from these Slack user IDs
    messagePattern?: string;          // Regex to match message content
    threadTs?: string;                // Watch replies in a specific thread
  };
}

export interface JiraTrigger extends BaseTrigger {
  type: 'jira';
  config: {
    projectKey?: string;              // Only trigger for issues in this project (e.g. "SD")
    events?: string[];                // Jira webhook events to match (e.g. ["issue_created", "issue_transitioned"])
    jqlFilter?: string;               // Optional JQL expression for fine-grained filtering
  };
}

export interface CronTrigger extends BaseTrigger {
  type: 'cron';
  config: {
    expression: string;               // Cron expression (e.g. "0 9 * * MON-FRI")
    timezone: string;                 // IANA timezone (e.g. "America/Mexico_City")
    payload?: Record<string, string>; // Static variables injected into promptTemplate
  };
}

export type Trigger = WebhookTrigger | EmailTrigger | SlackTrigger | JiraTrigger | CronTrigger;
```

### Prompt Template Interpolation

When a trigger fires, the `promptTemplate` is interpolated with context variables before being sent to the agent:

```
// Webhook trigger variables:
{{payload}}         — Full JSON payload as string
{{payload.field}}   — Extracted field from payload (via extractFields config)
{{trigger.name}}    — Trigger name
{{timestamp}}       — ISO timestamp of when trigger fired

// Email trigger variables:
{{email.from}}      — Sender address
{{email.subject}}   — Email subject
{{email.body}}      — Email body (plain text)
{{email.threadId}}  — Gmail thread ID
{{email.approvals}} — JSON array of who has approved (for approval triggers)

// Slack trigger variables:
{{slack.user}}      — Slack user display name
{{slack.userId}}    — Slack user ID
{{slack.message}}   — Message text
{{slack.channel}}   — Channel name
{{slack.threadTs}}  — Thread timestamp (for threaded replies)

// Cron trigger variables:
{{cron.expression}} — The cron expression that fired
{{cron.scheduledAt}} — Scheduled fire time
+ any keys from config.payload
```

### Intelligent Matching: LLM-Powered Trigger Evaluation

In addition to classic structural matching (field comparisons, regex patterns), triggers support **LLM-powered semantic matching**. This lets you define match conditions in natural language — for example, "Does this message have to do with angry clients?" — and the system uses an LLM to evaluate the condition against the incoming event.

#### Match Modes

| Mode | Behavior | Cost | Latency | Use When |
|---|---|---|---|---|
| `structural` | Field-based matching only (regex, exact, filters) | Free | ~0ms | You know the exact patterns to match |
| `llm` | Every event goes to the LLM for evaluation | Tokens per event | 500ms-2s | You need semantic understanding, low event volume |
| `hybrid` | Structural pre-filter first, then LLM on survivors | Tokens per matched event | 500ms-2s for LLM portion | High event volume, need semantic precision |

**`hybrid` is the recommended mode for most real-world use.** The structural config acts as a cheap, instant gate (e.g. "only messages in #releases channel") and the LLM handles the nuance (e.g. "is this actually a release request, not just a question about one?").

#### `src/packages/server/services/llm-matcher-service.ts`

```typescript
// src/packages/server/services/llm-matcher-service.ts

export interface LLMMatchResult {
  match: boolean;                     // Does the event match the condition?
  reason: string;                     // Why the LLM decided yes/no (logged to SQLite)
  confidence: number;                 // 0.0 to 1.0 — how confident the LLM is
  durationMs: number;                 // Time taken for the LLM call
  model: string;                      // Which model was used
  tokensUsed: number;                 // Total tokens consumed
}

export interface LLMExtractResult {
  variables: Record<string, string>;  // Extracted key-value pairs
  reason: string;                     // Extraction reasoning
  durationMs: number;
  model: string;
  tokensUsed: number;
}

/** Evaluate whether an event matches a trigger's LLM condition. */
export async function llmMatch(
  formattedEvent: string,             // Human-readable event (from TriggerHandler.formatEventForLLM)
  config: { prompt: string; model?: string; temperature?: number; maxTokens?: number }
): Promise<LLMMatchResult>

/** Extract variables from an event using LLM. */
export async function llmExtractVariables(
  formattedEvent: string,
  config: { prompt: string; variables: string[]; model?: string }
): Promise<LLMExtractResult>
```

#### System Prompt for Matching

The `llmMatch` function wraps the user's natural language condition in a structured system prompt:

```
You are an event classifier. Your job is to decide whether an incoming event
matches a given condition.

EVENT:
---
{formattedEvent}
---

CONDITION TO EVALUATE:
---
{trigger.llmMatch.prompt}
---

Analyze the event and determine if it matches the condition.
Respond ONLY with valid JSON (no markdown, no explanation outside JSON):
{
  "match": true or false,
  "reason": "Brief explanation of why the event does or does not match",
  "confidence": 0.0 to 1.0
}
```

**Key design decisions:**
- **Temperature 0** by default — we want deterministic classification, not creative answers.
- **Fast, cheap model** — Uses Haiku by default. This is a simple boolean classification; Opus/Sonnet would be overkill.
- **Structured JSON output** — Parsed with `JSON.parse()`. If parsing fails, the match is treated as `false` (fail-safe) and the error is logged.
- **The `reason` field is logged to SQLite** — This is critical for debugging and audit. You can see in the trigger event history *why* the LLM decided to fire or skip a trigger.
- **The `confidence` field** enables future thresholding — e.g. "only fire if confidence > 0.8".

#### System Prompt for Variable Extraction

The `llmExtractVariables` function extracts structured data from unstructured event content:

```
You are a data extractor. Extract specific variables from the event below.

EVENT:
---
{formattedEvent}
---

VARIABLES TO EXTRACT:
{variables.map(v => `- ${v}`).join('\n')}

EXTRACTION INSTRUCTIONS:
---
{trigger.llmExtract.prompt}
---

Respond ONLY with valid JSON (no markdown, no explanation outside JSON):
{
  "variables": {
    "variable_name_1": "extracted value or empty string if not found",
    "variable_name_2": "extracted value or empty string if not found"
  },
  "reason": "Brief explanation of how you extracted each value"
}
```

**Example:** A Slack trigger with LLM extraction configured as:

```json
{
  "extractionMode": "llm",
  "llmExtract": {
    "prompt": "Extract the release version, affected systems, and urgency from this message. If the user says 'ASAP' or 'urgent', set urgency to 'high'.",
    "variables": ["release_name", "affected_systems", "urgency"]
  }
}
```

For the message *"Hey, we need to push v2.3.1 to production ASAP, it fixes a critical bug in the payments API"*, the LLM would return:

```json
{
  "variables": {
    "release_name": "v2.3.1",
    "affected_systems": "payments API",
    "urgency": "high"
  },
  "reason": "Version 'v2.3.1' mentioned directly. 'Payments API' is the affected system. 'ASAP' + 'critical bug' indicates high urgency."
}
```

These variables are then available in the trigger's `promptTemplate` via `{{release_name}}`, `{{affected_systems}}`, `{{urgency}}`.

#### Matching Flow in `trigger-service.ts`

When an event arrives, the trigger service evaluates all enabled triggers of that type:

```typescript
// Inside trigger-service.ts — onEvent callback from TriggerHandler.startListening()

async function evaluateEvent(handler: TriggerHandler, event: ExternalEvent): Promise<void> {
  const triggersOfType = getAllTriggers().filter(t => t.type === handler.triggerType && t.enabled);

  for (const trigger of triggersOfType) {
    let matched = false;
    let llmResult: LLMMatchResult | undefined;

    // ─── Step 1: Structural matching ───
    if (trigger.matchMode === 'structural' || trigger.matchMode === 'hybrid') {
      const structuralMatch = handler.structuralMatch(trigger, event);
      if (trigger.matchMode === 'structural') {
        matched = structuralMatch;
      } else {
        // hybrid: structural must pass before LLM is called
        if (!structuralMatch) continue;  // Skip LLM — structural pre-filter rejected it
      }
    }

    // ─── Step 2: LLM matching ───
    if (trigger.matchMode === 'llm' || trigger.matchMode === 'hybrid') {
      const formatted = handler.formatEventForLLM(event);
      llmResult = await llmMatch(formatted, trigger.llmMatch!);
      matched = llmResult.match;
    }

    if (!matched) continue;

    // ─── Step 3: Variable extraction ───
    let variables: Record<string, string>;

    if (trigger.extractionMode === 'llm' && trigger.llmExtract) {
      const formatted = handler.formatEventForLLM(event);
      const extractResult = await llmExtractVariables(formatted, trigger.llmExtract);
      variables = extractResult.variables;
      // Merge with any structural variables as fallback
      const structuralVars = handler.extractVariables(trigger, event);
      variables = { ...structuralVars, ...variables };  // LLM values take precedence
    } else {
      variables = handler.extractVariables(trigger, event);
    }

    // ─── Step 4: Fire the trigger ───
    await fireTrigger(trigger.id, variables, {
      rawPayload: event.data,
      llmMatchResult: llmResult,    // Logged to SQLite for audit
    });
  }
}
```

#### Cost & Performance Considerations

- **Haiku is the default model.** At ~$0.25/M input tokens and ~$1.25/M output tokens, evaluating a typical Slack message (200 tokens in + 50 tokens out) costs ~$0.0001 per evaluation. Even at 1000 events/day, that's ~$0.10/day.
- **Hybrid mode cuts costs dramatically.** If a structural pre-filter rejects 90% of events, LLM costs drop to ~$0.01/day.
- **Events are evaluated in parallel** across triggers but **sequentially per trigger** (one LLM call at a time per trigger to avoid race conditions with fire-once semantics).
- **Timeout**: LLM calls have a 5-second timeout. If the LLM doesn't respond, the match is treated as `false` (fail-safe).

### Persistence

```
~/.local/share/tide-commander/triggers.json
```

Follows the existing pattern: `atomicWriteJson` / `safeReadJsonSync`, debounced writes on update.

### Server-Side Files

#### `src/packages/shared/trigger-types.ts`
Type definitions (above).

#### `src/packages/server/data/trigger-store.ts`
```typescript
export function loadTriggers(): Trigger[]
export function saveTriggers(triggers: Trigger[]): void
export async function saveTriggersAsync(triggers: Trigger[]): Promise<void>
```

#### `src/packages/server/services/trigger-service.ts`
```typescript
// In-memory store
const triggers = new Map<string, Trigger>();
const listeners = new Set<TriggerListener>();

// Lifecycle
export function initTriggers(): void
export function shutdown(): void                         // Stop all cron jobs, cleanup

// CRUD
export function getTrigger(id: string): Trigger | undefined
export function getAllTriggers(): Trigger[]
export function createTrigger(data: Omit<Trigger, 'id' | 'createdAt' | 'updatedAt' | 'fireCount'>): Trigger
export function updateTrigger(id: string, updates: Partial<Trigger>): Trigger | null
export function deleteTrigger(id: string): boolean

// Execution
export function fireTrigger(
  id: string,
  variables: Record<string, string>,
  opts?: { rawPayload?: unknown; llmMatchResult?: LLMMatchResult; llmExtractResult?: LLMExtractResult }
): Promise<void>
// Interpolates promptTemplate, calls agentService/runtimeService to send command
// ALSO: logs a TriggerFireEvent to SQLite via eventQueries.logTriggerFire()
//   — includes llmMatchResult and llmExtractResult when present
// Updates event status to 'delivered' on success, 'failed' on error

// Cron management (internal)
function startCronJob(trigger: CronTrigger): void
function stopCronJob(triggerId: string): void
function restartCronJobs(): void                         // Called on init, re-registers all enabled cron triggers

// Event system
export function subscribe(listener: TriggerListener): () => void
```

#### `src/packages/server/services/cron-service.ts`
```typescript
// Thin wrapper around node-cron or cron library
export function schedule(expression: string, timezone: string, callback: () => void): CronJob
export function stop(job: CronJob): void
export function validate(expression: string): boolean
```

#### `src/packages/server/routes/trigger-routes.ts`
```typescript
// CRUD endpoints
GET    /api/triggers                         // List all triggers
GET    /api/triggers/:id                     // Get single trigger
POST   /api/triggers                         // Create trigger
PATCH  /api/triggers/:id                     // Update trigger
DELETE /api/triggers/:id                     // Delete trigger

// Webhook ingestion endpoint (no auth — uses per-trigger secret)
POST   /api/triggers/webhook/:triggerId      // External systems call this

// Manual fire (for testing)
POST   /api/triggers/:id/fire                // Manually fire a trigger with test variables

// LLM match testing (dry-run — evaluates matching pipeline without firing)
POST   /api/triggers/:id/test-match          // Body: { event: ExternalEvent }
// Returns: { structuralMatch?: boolean, llmMatch?: LLMMatchResult, extractedVariables: Record<string, string>, wouldFire: boolean }
// Runs the full matching pipeline (structural + LLM) but does NOT fire the trigger or log to SQLite.
// Used by the UI "Test Match" button to tune LLM prompts.

// Validation
POST   /api/triggers/validate-cron           // Validate cron expression, return next 5 fire times
```

#### Webhook Endpoint Detail

```
POST /api/triggers/webhook/:triggerId
```

- No auth token required (this is called by external systems)
- If trigger has `config.secret`, validate HMAC-SHA256 signature from `X-Hub-Signature-256` header (GitHub-style) or `X-Webhook-Secret` header (direct comparison)
- Extract fields from JSON body per `config.extractFields`
- Call `triggerService.fireTrigger(triggerId, extractedVariables)`
- Return `200 OK` with `{ fired: true }` or appropriate error

#### WebSocket Integration

```typescript
// src/packages/server/websocket/handlers/trigger-handler.ts

export function handleCreateTrigger(ctx: HandlerContext, payload: CreateTriggerPayload): void
export function handleUpdateTrigger(ctx: HandlerContext, payload: UpdateTriggerPayload): void
export function handleDeleteTrigger(ctx: HandlerContext, payload: { id: string }): void
export function handleFireTrigger(ctx: HandlerContext, payload: { id: string, variables?: Record<string, string> }): void
```

New WS message types:

```typescript
// Client -> Server
| { type: 'create_trigger'; payload: CreateTriggerPayload }
| { type: 'update_trigger'; payload: UpdateTriggerPayload }
| { type: 'delete_trigger'; payload: { id: string } }
| { type: 'fire_trigger'; payload: { id: string; variables?: Record<string, string> } }

// Server -> Client
| { type: 'triggers_update'; payload: Trigger[] }                    // Full state on connect
| { type: 'trigger_created'; payload: Trigger }
| { type: 'trigger_updated'; payload: Trigger }
| { type: 'trigger_deleted'; payload: { id: string } }
| { type: 'trigger_fired'; payload: { triggerId: string; agentId: string; timestamp: number } }
| { type: 'trigger_error'; payload: { triggerId: string; error: string } }
```

#### Client UI

A `TriggerManagerPanel` component (similar to the skill editor modal):
- List all triggers with status indicators (enabled/disabled/error, last fired time, fire count)
- Create/edit form with type-specific config sections
- **Match mode selector** — toggle between `structural`, `llm`, and `hybrid` with conditional fields:
  - For `llm`/`hybrid`: text area for the natural language match prompt, model selector dropdown (Haiku/Sonnet/Opus), optional confidence threshold slider
  - For `hybrid`: structural config fields + LLM prompt (both visible)
- **Extraction mode selector** — toggle between `structural` and `llm`:
  - For `llm`: text area for extraction instructions, list editor for expected variable names
- "Test Fire" button that sends a manual fire with sample variables
- **"Test Match" button** — pastes a sample event payload, runs the matching pipeline (structural + LLM), and shows the result inline (match/no-match, reason, confidence, tokens used, latency). Crucial for tuning LLM prompts without waiting for real events.
- Log of recent trigger fires with success/failure status
  - For LLM-matched triggers: shows the reasoning, confidence, model, and token cost per fire

#### Server Initialization

In `src/packages/server/index.ts`, add:
```typescript
triggerService.initTriggers();   // After agentService.initAgents()
```

In shutdown handler:
```typescript
triggerService.shutdown();       // Stop cron jobs
```

### Dependencies

```
node-cron (or croner) — for cron expression parsing and scheduling
```

### SQLite Integration

Every call to `fireTrigger()` logs to the `trigger_events` table:

```typescript
// Inside fireTrigger():
const eventId = eventQueries.logTriggerFire({
  triggerId: trigger.id,
  triggerName: trigger.name,
  triggerType: trigger.type,
  agentId: trigger.agentId,
  workflowInstanceId: workflowCtx?.instanceId,  // if fired by a workflow
  firedAt: Date.now(),
  variables,
  payload: rawPayload,                           // original webhook body, slack event, email data
  matchMode: trigger.matchMode,
  llmMatchResult: opts?.llmMatchResult,          // { match, reason, confidence, model, tokensUsed, durationMs }
  llmExtractResult: opts?.llmExtractResult,      // { variables, reason, model, tokensUsed, durationMs }
  status: 'fired',
});

try {
  await sendCommandToAgent(trigger.agentId, interpolatedPrompt);
  eventQueries.updateTriggerEventStatus(eventId, 'delivered', undefined, Date.now() - startTime);
} catch (err) {
  eventQueries.updateTriggerEventStatus(eventId, 'failed', err.message);
}
```

The Trigger Manager UI reads from `GET /api/events/triggers?triggerId=X` to show fire history, replacing the in-memory-only `lastFiredAt` + `fireCount` approach. For triggers using LLM matching, the history includes the LLM's reasoning and confidence — making it easy to debug why a trigger did or didn't fire.

### Decisions

- **Rate limiting**: Yes. 10 req/min per trigger, simple in-memory rate limiter (`Map<triggerId, timestamp[]>`). Configurable limit in trigger config. Prevents accidental floods from misconfigured external systems.
- **Chained triggers**: Single `agentId` per trigger for v1. The workflow engine handles multi-agent orchestration. Can extend to `agentIds: string[]` later if needed — backwards compatible.
- **LLM match confidence threshold**: Add optional `llmMatch.minConfidence` field to trigger config, default `0.0` (any positive match fires). Users can tighten to 0.7+ after observing confidence values in the fire history.
- **LLM match caching**: Not for v1. Hybrid mode already cuts 90%+ of LLM calls via structural pre-filtering. Caching adds complexity (invalidation when prompt changes) with minimal benefit.
- **LLM provider**: Anthropic-only for v1, using the `model` field to select Haiku/Sonnet/Opus. Extend to other providers when the agent system does — the abstraction is already in place.

---

## Phase 2: Slack Integration

### Purpose

Bidirectional Slack communication. Agents can send messages, read channels, and wait for replies. The trigger system can watch Slack for incoming messages.

### Slack App Setup

We need a Slack App with these scopes:
- `chat:write` — Send messages
- `channels:history` — Read channel messages
- `channels:read` — List channels
- `groups:history` — Read private channel messages
- `im:history` — Read DMs
- `im:write` — Open DMs
- `users:read` — Resolve user names
- `reactions:read` — Read reactions (optional, for approval via emoji)

Connection method: **Socket Mode** (uses `@slack/socket-mode`). This avoids needing a public URL for Slack events — the server connects outbound to Slack's WebSocket. This is ideal since Tide Commander typically runs on a local machine or internal network.

### Configuration Storage

Slack credentials are stored in the existing secrets system:

```
SLACK_BOT_TOKEN    — xoxb-... Bot User OAuth Token
SLACK_APP_TOKEN    — xapp-... App-Level Token (for Socket Mode)
```

These go into `secrets.json` via the existing secrets UI, encrypted at rest with the existing AES-256-GCM mechanism.

Additional Slack settings stored in a new config file:

```
~/.local/share/tide-commander/slack-config.json
```

```typescript
interface SlackConfig {
  enabled: boolean;
  defaultChannelId?: string;          // Default channel for notifications
  botUserId?: string;                 // Populated automatically on connect
  botName?: string;                   // Populated automatically on connect
  connectedAt?: number;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  lastError?: string;
}
```

### Server-Side Files

All Slack files live under `src/packages/server/integrations/slack/`:

#### `src/packages/server/integrations/slack/index.ts`

Exports `slackPlugin: IntegrationPlugin` — wires together all Slack components:

```typescript
export const slackPlugin: IntegrationPlugin = {
  id: 'slack',
  name: 'Slack',
  description: 'Bidirectional Slack messaging for agents',
  routePrefix: '/slack',
  init: (ctx) => slackClient.init(ctx),
  shutdown: () => slackClient.shutdown(),
  getRoutes: () => slackRoutes,
  getSkills: () => [slackSkill],
  getTriggerHandler: () => slackTriggerHandler,
  getStatus: () => slackClient.getStatus(),
  getConfigSchema: () => slackConfig.schema,
  getConfig: () => slackConfig.getValues(),
  setConfig: (cfg) => slackConfig.setValues(cfg),
};
```

#### `src/packages/server/integrations/slack/slack-client.ts`

```typescript
// Connection lifecycle
export function init(ctx: IntegrationContext): Promise<void>  // Connect Socket Mode if tokens present
export function shutdown(): void               // Disconnect
export function getStatus(): SlackConfig
export function reconnect(): Promise<void>

// Sending
export function sendMessage(params: {
  channel: string;                             // Channel ID or name
  text: string;
  threadTs?: string;                           // Reply in thread
  blocks?: SlackBlock[];                       // Rich formatting (optional)
}): Promise<{ ts: string; channel: string }>   // Returns message timestamp + channel

// Reading
export function getChannelMessages(params: {
  channel: string;
  limit?: number;                              // Default 20
  oldest?: string;                             // Timestamp lower bound
  latest?: string;                             // Timestamp upper bound
}): Promise<SlackMessage[]>

export function getThreadReplies(params: {
  channel: string;
  threadTs: string;
  limit?: number;
}): Promise<SlackMessage[]>

// Waiting (long-poll for agent use)
export function waitForReply(params: {
  channel: string;
  threadTs: string;
  fromUsers?: string[];                        // Only wait for specific users
  timeoutMs?: number;                          // Default 300000 (5 min)
  messagePattern?: string;                     // Regex to match
}): Promise<SlackMessage | null>               // null on timeout

// Lookup
export function listChannels(): Promise<SlackChannel[]>
export function resolveUser(userId: string): Promise<SlackUser>
export function findUserByEmail(email: string): Promise<SlackUser | null>
export function findUserByName(displayName: string): Promise<SlackUser | null>

// Event handling (internal, for triggers)
export function onMessage(callback: (message: SlackMessage) => void): () => void
```

#### `SlackMessage` type

```typescript
interface SlackMessage {
  ts: string;                                  // Slack timestamp (unique ID)
  threadTs?: string;
  channel: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: number;                           // Unix epoch ms
}
```

#### `src/packages/server/integrations/slack/slack-routes.ts`

```typescript
// Agents call these via curl (mounted at /api/slack/ by the registry)

POST   /api/slack/send
// Body: { channel, text, threadTs? }
// Returns: { success: true, ts, channel }

GET    /api/slack/messages
// Query: ?channel=C123&limit=20&oldest=...&latest=...
// Returns: { messages: SlackMessage[] }

GET    /api/slack/thread
// Query: ?channel=C123&threadTs=1234567890.123456&limit=20
// Returns: { messages: SlackMessage[] }

POST   /api/slack/wait-for-reply
// Body: { channel, threadTs, fromUsers?, timeoutMs?, messagePattern? }
// Returns: { message: SlackMessage | null, timedOut: boolean }

GET    /api/slack/channels
// Returns: { channels: SlackChannel[] }

GET    /api/slack/users/:userId
// Returns: { user: SlackUser }

GET    /api/slack/status
// Returns: SlackConfig (connection status)

POST   /api/slack/connect
// Manually trigger connection (if tokens are set but not connected)

POST   /api/slack/disconnect
// Manually disconnect
```

#### Trigger Integration

Slack provides a `TriggerHandler` via the plugin interface. The trigger service never imports Slack code — it calls the handler generically:

```typescript
// src/packages/server/integrations/slack/slack-trigger-handler.ts

export const slackTriggerHandler: TriggerHandler = {
  triggerType: 'slack',

  async startListening(onEvent) {
    // Register a Socket Mode message callback
    slackClient.onMessage((message) => {
      onEvent({
        source: 'slack',
        type: 'message',
        data: message,
        timestamp: Date.now(),
      });
    });
  },

  async stopListening() {
    // Handled by slackClient.shutdown()
  },

  structuralMatch(trigger: SlackTrigger, event: ExternalEvent): boolean {
    const msg = event.data as SlackMessage;
    if (trigger.config.channelId && msg.channel !== trigger.config.channelId) return false;
    if (trigger.config.userFilter?.length && !trigger.config.userFilter.includes(msg.userId)) return false;
    if (trigger.config.messagePattern && !new RegExp(trigger.config.messagePattern).test(msg.text)) return false;
    if (trigger.config.threadTs && msg.threadTs !== trigger.config.threadTs) return false;
    return true;
  },

  extractVariables(trigger: SlackTrigger, event: ExternalEvent): Record<string, string> {
    const msg = event.data as SlackMessage;
    return {
      'slack.user': msg.userName,
      'slack.userId': msg.userId,
      'slack.message': msg.text,
      'slack.channel': msg.channel,
      'slack.threadTs': msg.threadTs || msg.ts,
    };
  },

  formatEventForLLM(event: ExternalEvent): string {
    const msg = event.data as SlackMessage;
    return `Slack message from @${msg.userName} (${msg.userId}) in #${msg.channel}:\n"${msg.text}"`;
  },
};
```

#### Built-in Skill: `slack-messaging`

```typescript
// src/packages/server/integrations/slack/slack-skill.ts
export const slackSkill: BuiltinSkillDefinition = {
  slug: 'slack-messaging',
  name: 'Slack Messaging',
  description: 'Send and receive messages via Slack',
  allowedTools: ['Bash(curl:*)'],
  content: `# Slack Messaging

Use these endpoints to communicate via Slack.

## Send a Message

\`\`\`bash
curl -s -X POST -H "X-Auth-Token: {{AUTH_TOKEN}}" http://localhost:{{PORT}}/api/slack/send \\
  -H "Content-Type: application/json" \\
  -d '{"channel":"CHANNEL_ID","text":"Your message here"}'
\`\`\`

To reply in a thread, add \`"threadTs":"THREAD_TIMESTAMP"\`.

## Read Channel Messages

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/slack/messages?channel=CHANNEL_ID&limit=10"
\`\`\`

## Read Thread Replies

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/slack/thread?channel=CHANNEL_ID&threadTs=THREAD_TS"
\`\`\`

## Wait for a Reply (Long-Poll)

\`\`\`bash
curl -s -X POST -H "X-Auth-Token: {{AUTH_TOKEN}}" http://localhost:{{PORT}}/api/slack/wait-for-reply \\
  -H "Content-Type: application/json" \\
  -d '{"channel":"CHANNEL_ID","threadTs":"THREAD_TS","timeoutMs":300000}'
\`\`\`

Returns the first matching reply or \`{"message":null,"timedOut":true}\` after timeout.

## List Channels

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/slack/channels"
\`\`\`

## Notes
- Channel IDs look like \`C0123456789\`. Use the list channels endpoint to find them.
- Thread timestamps look like \`1234567890.123456\`.
- The wait-for-reply endpoint blocks until a reply arrives or timeout. Use it when you need to wait for a human response.
`,
};
```

### SQLite Integration

**Every Slack message is logged** — both inbound (received from Slack) and outbound (sent by agents):

```typescript
// In slack-client.ts sendMessage():
const result = await slackClient.chat.postMessage({ channel, text, thread_ts });
eventQueries.logSlackMessage({
  ts: result.ts,
  threadTs: result.message.thread_ts,
  channelId: channel,
  channelName: channelNameCache.get(channel),
  userId: botUserId,
  userName: botName,
  text,
  direction: 'outbound',
  agentId: callingAgentId,         // passed through from the API route
  workflowInstanceId,              // passed through if in workflow context
  receivedAt: Date.now(),
});

// In Socket Mode message handler:
socketModeClient.on('message', (event) => {
  eventQueries.logSlackMessage({
    ts: event.ts,
    threadTs: event.thread_ts,
    channelId: event.channel,
    userId: event.user,
    userName: resolvedUserName,
    text: event.text,
    direction: 'inbound',
    rawEvent: event,               // full Slack event for debugging
    receivedAt: Date.now(),
  });
  // ... then fire trigger matching, etc.
});
```

The REST endpoints `GET /api/slack/messages` and `GET /api/slack/thread` can optionally read from SQLite as a cache/fallback, so agents get consistent history even if the Slack API rate limits. The primary query path is still the Slack API for real-time accuracy, but the DB provides:

- **Offline history** — messages from when the server was down or Slack was disconnected
- **Cross-workflow search** — find all Slack interactions related to a specific workflow
- **Audit trail** — who said what, when, in which context

UI-wise, the Slack message log is available at `GET /api/events/slack` and integrated into the workflow timeline view.

#### Client UI

- Slack connection status indicator in settings
- Connect/disconnect buttons
- Channel browser (for configuring triggers)
- Test send message form
- **Slack message history** — searchable log of all inbound/outbound messages (reads from SQLite via `GET /api/events/slack`)

#### WebSocket Messages

```typescript
// Server -> Client
| { type: 'slack_status_update'; payload: SlackConfig }
| { type: 'slack_message_received'; payload: { channel: string; userName: string; text: string; ts: string } }
```

### Dependencies

```
@slack/web-api    — Slack Web API client
@slack/socket-mode — Socket Mode client (no public URL needed)
```

### Decisions

- **Single workspace** for v1. The CC process runs in one Slack workspace. Multi-workspace adds significant complexity (multiple bot tokens, workspace routing).
- **Plain text + markdown** for messages. Block Kit adds a big API surface for limited benefit in the CC flow. Add it in a later sprint if richer formatting is requested.
- **No file uploads** in v1. The CC document is sent via email (the approval channel). Slack file uploads are a nice-to-have, not part of the CC flow.

---

## Phase 3: Gmail / Email Integration

### Purpose

Send emails with attachments from a configured Gmail account. Monitor incoming emails for replies and approvals. Integrates with the trigger system for approval-based automation.

### Google OAuth2 Setup

We use the Gmail API (not SMTP) for both sending and reading. This gives us:
- Thread tracking (crucial for approval chains)
- Label/filter support
- Push notifications via Google Cloud Pub/Sub (for real-time triggers)

OAuth2 credentials stored in secrets:

```
GOOGLE_CLIENT_ID       — OAuth2 client ID
GOOGLE_CLIENT_SECRET   — OAuth2 client secret
GOOGLE_REFRESH_TOKEN   — Long-lived refresh token (obtained via one-time auth flow)
```

#### One-Time OAuth Flow

A setup route handles the initial OAuth consent:

```
GET  /api/email/auth/url         — Returns the OAuth consent URL
GET  /api/email/auth/callback    — OAuth redirect handler, stores refresh token
```

The user visits the consent URL in their browser, grants Gmail access, and the callback stores the refresh token in secrets. This only needs to happen once.

Required Gmail API scopes:
- `https://www.googleapis.com/auth/gmail.send` — Send email
- `https://www.googleapis.com/auth/gmail.readonly` — Read email
- `https://www.googleapis.com/auth/gmail.modify` — Modify labels (for marking processed)

### Server-Side Files

All Gmail files live under `src/packages/server/integrations/gmail/`:

#### `src/packages/server/integrations/gmail/index.ts`

Exports `gmailPlugin: IntegrationPlugin` — same pattern as Slack. The Gmail plugin also needs a custom settings component for the OAuth consent flow (redirect-based, not a simple form):

```typescript
export const gmailPlugin: IntegrationPlugin = {
  id: 'gmail',
  name: 'Gmail',
  description: 'Send and read emails via Gmail, monitor approval chains',
  routePrefix: '/email',
  // ...standard wiring...
  getCustomSettingsComponent: () => 'gmail-oauth',  // Client loads a custom OAuth setup component
};
```

#### `src/packages/server/integrations/gmail/gmail-client.ts`

```typescript
// Connection
export function init(ctx: IntegrationContext): Promise<void>  // Initialize OAuth2 client from stored tokens
export function getStatus(): GmailStatus
export function isConfigured(): boolean

// Sending
export function sendEmail(params: {
  to: string[];                                 // Recipient addresses
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;                                 // HTML body
  bodyText?: string;                            // Plain text alternative
  attachments?: EmailAttachment[];
  threadId?: string;                            // Reply in thread (for approval chain replies)
  inReplyTo?: string;                           // Message-ID header for threading
}): Promise<{ messageId: string; threadId: string }>

// Reading
export function getThread(threadId: string): Promise<EmailThread>
export function getRecentMessages(params: {
  query?: string;                               // Gmail search query (e.g. "from:approver@client.com")
  maxResults?: number;
  after?: Date;
}): Promise<EmailMessage[]>

// Approval monitoring
export function checkApprovals(params: {
  threadId: string;
  requiredApprovers: string[];                  // Email addresses
  approvalKeywords: string[];                   // e.g. ["approved", "aprobado", "autorizado"]
  minApprovals: number;
}): Promise<ApprovalStatus>

// Polling (for email triggers, used internally)
export function startPolling(intervalMs?: number): void    // Default 30s
export function stopPolling(): void
export function onNewMessage(callback: (message: EmailMessage) => void): () => void
```

#### Types

```typescript
interface EmailAttachment {
  filename: string;
  content: Buffer;                              // File content
  mimeType: string;
}

interface EmailMessage {
  messageId: string;
  threadId: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;                                 // Plain text
  bodyHtml?: string;
  date: number;                                 // Unix epoch ms
  inReplyTo?: string;
  labels?: string[];
}

interface EmailThread {
  threadId: string;
  subject: string;
  messages: EmailMessage[];
  participantCount: number;
}

interface ApprovalStatus {
  approved: boolean;                            // true if minApprovals met
  approvalCount: number;
  totalRequired: number;
  approvedBy: string[];                         // Email addresses that approved
  pendingFrom: string[];                        // Approvers who haven't responded
  details: {
    email: string;
    approved: boolean;
    message?: string;                           // The reply text
    timestamp?: number;
  }[];
}

interface GmailStatus {
  configured: boolean;
  authenticated: boolean;
  emailAddress?: string;                        // The authenticated Gmail address
  pollingActive: boolean;
  lastPollAt?: number;
  lastError?: string;
}
```

#### `src/packages/server/integrations/gmail/gmail-routes.ts`

```typescript
// OAuth setup
GET    /api/email/auth/url                      // Get OAuth consent URL
GET    /api/email/auth/callback                 // OAuth redirect handler

// Status
GET    /api/email/status                        // GmailStatus

// Agents call these via curl:
POST   /api/email/send
// Body: { to, cc?, subject, body, attachments?: [{filename, path}], threadId?, inReplyTo? }
// Note: attachments use file paths on disk (agent generates the docx, passes the path)
// Returns: { messageId, threadId }

GET    /api/email/thread/:threadId
// Returns: { thread: EmailThread }

GET    /api/email/messages
// Query: ?query=...&maxResults=10&after=2024-01-01
// Returns: { messages: EmailMessage[] }

POST   /api/email/check-approvals
// Body: { threadId, requiredApprovers, approvalKeywords, minApprovals }
// Returns: ApprovalStatus

POST   /api/email/wait-for-approvals
// Body: { threadId, requiredApprovers, approvalKeywords, minApprovals, timeoutMs? }
// Long-polls until approvals are met or timeout
// Returns: ApprovalStatus
```

#### Trigger Integration

Gmail provides a `TriggerHandler` via the plugin interface, same pattern as Slack:

```typescript
// src/packages/server/integrations/gmail/gmail-trigger-handler.ts

export const gmailTriggerHandler: TriggerHandler = {
  triggerType: 'email',

  async startListening(onEvent) {
    gmailClient.onNewMessage((message) => {
      onEvent({
        source: 'email',
        type: 'new_email',
        data: message,
        timestamp: Date.now(),
      });
    });
  },

  async stopListening() {
    gmailClient.stopPolling();
  },

  structuralMatch(trigger: EmailTrigger, event: ExternalEvent): boolean {
    const msg = event.data as EmailMessage;
    if (trigger.config.fromFilter?.length && !trigger.config.fromFilter.includes(msg.from)) return false;
    if (trigger.config.subjectPattern && !new RegExp(trigger.config.subjectPattern).test(msg.subject)) return false;
    if (trigger.config.threadId && msg.threadId !== trigger.config.threadId) return false;
    // For approval triggers, check approval status
    if (trigger.config.requiredApprovals) {
      const status = gmailClient.checkApprovalsSync(msg.threadId, trigger.config.requiredApprovals);
      return status.approved;
    }
    return true;
  },

  extractVariables(trigger: EmailTrigger, event: ExternalEvent): Record<string, string> {
    const msg = event.data as EmailMessage;
    const vars: Record<string, string> = {
      'email.from': msg.from,
      'email.subject': msg.subject,
      'email.body': msg.body,
      'email.threadId': msg.threadId,
    };
    // For approval triggers, include who approved
    if (trigger.config.requiredApprovals) {
      const status = gmailClient.checkApprovalsSync(msg.threadId, trigger.config.requiredApprovals);
      vars['email.approvals'] = JSON.stringify(status.approvedBy);
    }
    return vars;
  },

  formatEventForLLM(event: ExternalEvent): string {
    const msg = event.data as EmailMessage;
    return `Email from: ${msg.from}\nSubject: ${msg.subject}\nBody:\n${msg.body}`;
  },
};
```

#### Built-in Skill: `email-gmail`

```typescript
// src/packages/server/integrations/gmail/gmail-skill.ts
export const gmailSkill: BuiltinSkillDefinition = {
  slug: 'email-gmail',
  name: 'Gmail Email',
  description: 'Send and read emails via Gmail, monitor approval chains',
  allowedTools: ['Bash(curl:*)'],
  content: `# Gmail Email

## Send an Email

\`\`\`bash
curl -s -X POST -H "X-Auth-Token: {{AUTH_TOKEN}}" http://localhost:{{PORT}}/api/email/send \\
  -H "Content-Type: application/json" \\
  -d '{"to":["recipient@example.com"],"subject":"Subject","body":"<p>HTML body</p>"}'
\`\`\`

### With Attachment (file path on disk)

\`\`\`bash
curl -s -X POST -H "X-Auth-Token: {{AUTH_TOKEN}}" http://localhost:{{PORT}}/api/email/send \\
  -H "Content-Type: application/json" \\
  -d '{"to":["recipient@example.com"],"subject":"Subject","body":"<p>Body</p>","attachments":[{"filename":"CC-Release.docx","path":"/tmp/generated/CC-Release.docx"}]}'
\`\`\`

### Reply in Thread

Add \`"threadId"\` and \`"inReplyTo"\` from the original message.

## Read a Thread

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/email/thread/THREAD_ID"
\`\`\`

## Check Approval Status

\`\`\`bash
curl -s -X POST -H "X-Auth-Token: {{AUTH_TOKEN}}" http://localhost:{{PORT}}/api/email/check-approvals \\
  -H "Content-Type: application/json" \\
  -d '{"threadId":"THREAD_ID","requiredApprovers":["approver1@client.com","approver2@client.com"],"approvalKeywords":["approved","aprobado"],"minApprovals":3}'
\`\`\`

## Wait for Approvals (Long-Poll)

\`\`\`bash
curl -s -X POST -H "X-Auth-Token: {{AUTH_TOKEN}}" http://localhost:{{PORT}}/api/email/wait-for-approvals \\
  -H "Content-Type: application/json" \\
  -d '{"threadId":"THREAD_ID","requiredApprovers":["a@x.com","b@x.com","c@x.com"],"approvalKeywords":["approved"],"minApprovals":3,"timeoutMs":3600000}'
\`\`\`

Returns approval status. If not all approvals arrived within timeout, \`approved\` will be \`false\`.
`,
};
```

### SQLite Integration

**Every email sent or received is logged**, plus every approval event:

```typescript
// In gmail-client.ts sendEmail():
const result = await gmail.users.messages.send({ ... });
eventQueries.logEmailMessage({
  messageId: result.data.id,
  threadId: result.data.threadId,
  fromAddress: authenticatedEmail,
  toAddresses: params.to,
  ccAddresses: params.cc,
  subject: params.subject,
  bodyText: params.bodyText,
  bodyHtml: params.body,
  direction: 'outbound',
  hasAttachments: (params.attachments?.length ?? 0) > 0,
  attachmentNames: params.attachments?.map(a => a.filename),
  agentId: callingAgentId,
  workflowInstanceId,
  receivedAt: Date.now(),
});

// In polling handler, for each new message:
eventQueries.logEmailMessage({
  messageId: msg.id,
  threadId: msg.threadId,
  fromAddress: msg.from,
  toAddresses: msg.to,
  subject: msg.subject,
  bodyText: msg.body,
  direction: 'inbound',
  hasAttachments: msg.attachments.length > 0,
  attachmentNames: msg.attachments.map(a => a.filename),
  gmailLabels: msg.labels,
  rawHeaders: { 'In-Reply-To': msg.inReplyTo, 'References': msg.references },
  receivedAt: msg.date,
});

// In checkApprovals(), for each approval detected:
eventQueries.logApprovalEvent({
  threadId,
  approverEmail: reply.from,
  approved: isApproval,
  replyMessageId: reply.messageId,
  replySnippet: reply.body.substring(0, 200),
  keywordMatched: matchedKeyword,
  workflowInstanceId,
  recordedAt: Date.now(),
});
```

This gives us:
- **Complete email audit trail** — every email in and out, with full metadata
- **Approval tracking** — who approved, when, with which keyword, in which reply
- **Workflow correlation** — all emails and approvals linked to their workflow instance
- **Offline resilience** — if Gmail API is temporarily unavailable, we still have local history

The `GET /api/events/email` and `GET /api/events/approvals` endpoints power the UI views.

### Dependencies

```
googleapis — Google APIs Node.js client (includes Gmail API)
```

### Decisions

- **Polling at 30s** for v1. Push via Pub/Sub requires a public URL or Cloud Function — unnecessary deployment complexity. 30-second polling is fine for approval monitoring. Add push later if latency matters.
- **Single Gmail account**. The CC operator uses one account. Multi-account adds OAuth token management complexity.
- **Attachment validation**: Warn if >10MB, reject at 25MB (Gmail API limit). DOCX files for CC are typically <1MB, so this is a safety net. Log a warning if an agent tries to send a large attachment.
- **Agent composes email body** directly. No template engine for email bodies. The agent's prompt tells it what to include — it can write HTML inline. If pixel-perfect branded emails are needed later, add a template service then.

---

## Phase 4: Document Generation

### Purpose

Generate DOCX files from templates with variable substitution. Templates are uploaded DOCX files with `{variable}` placeholders.

### How Templates Work

Users upload a `.docx` file where placeholders use the `{variableName}` syntax. When generating, the agent provides a JSON object mapping variable names to values.

Example template content:
```
Control de Cambios: {release_name}
Fecha: {release_date}
Tipo: {release_type}
Solicitante: {requester_name}
Descripción: {description}
Sistemas afectados: {affected_systems}
```

The `docxtemplater` library handles:
- Simple variable replacement: `{variableName}`
- Loops: `{#items}{name} - {value}{/items}`
- Conditionals: `{#isUrgent}URGENTE{/isUrgent}`
- Images (with image module, optional)

### Storage

```
~/.local/share/tide-commander/templates/          — Template DOCX files
~/.local/share/tide-commander/generated/           — Generated DOCX output files
~/.local/share/tide-commander/template-meta.json   — Template metadata
```

### Types

```typescript
interface DocumentTemplate {
  id: string;
  name: string;
  description?: string;
  filename: string;                             // Original upload filename
  storedPath: string;                           // Path in templates/ directory
  variables: string[];                          // Extracted variable names from template
  createdAt: number;
  updatedAt: number;
}

interface GeneratedDocument {
  id: string;
  templateId: string;
  filename: string;                             // Output filename
  storedPath: string;                           // Path in generated/ directory
  variables: Record<string, unknown>;           // Variables used to generate
  createdAt: number;
}
```

### Server-Side Files

All DOCX files live under `src/packages/server/integrations/docx/`.

#### `src/packages/server/integrations/docx/docx-engine.ts`

```typescript
export function init(ctx: IntegrationContext): void

// Templates
export function listTemplates(): DocumentTemplate[]
export function getTemplate(id: string): DocumentTemplate | undefined
export function uploadTemplate(file: Buffer, originalFilename: string, name: string, description?: string): DocumentTemplate
export function deleteTemplate(id: string): boolean
export function extractVariables(templatePath: string): string[]    // Parse DOCX for {var} placeholders

// Generation
export function generateDocument(params: {
  templateId: string;
  variables: Record<string, unknown>;
  outputFilename?: string;                      // Default: template name + timestamp
}): Promise<GeneratedDocument>

// Cleanup
export function listGenerated(): GeneratedDocument[]
export function deleteGenerated(id: string): boolean
```

#### `src/packages/server/integrations/docx/docx-routes.ts`

```typescript
// Template management
GET    /api/documents/templates                  // List templates
GET    /api/documents/templates/:id              // Get template metadata
POST   /api/documents/templates                  // Upload template (multipart/form-data)
DELETE /api/documents/templates/:id              // Delete template

// Generation (agents call this via curl)
POST   /api/documents/generate
// Body: { templateId, variables: { key: value, ... }, outputFilename? }
// Returns: { document: GeneratedDocument, path: string }
// The `path` is the absolute path to the generated file — agents pass this to email attachments

// Generated files
GET    /api/documents/generated                  // List generated docs
GET    /api/documents/generated/:id/download     // Download generated file
DELETE /api/documents/generated/:id              // Delete generated file

// PDF conversion (requires libreoffice installed on host)
POST   /api/documents/convert
// Body: { sourceFileId: string, outputFormat: 'pdf' }
// Returns: { fileId: string, fileName: string, filePath: string }
// Calls `libreoffice --headless --convert-to pdf` on the generated DOCX
```

#### Built-in Skill: `document-generator`

```typescript
// src/packages/server/integrations/docx/docx-skill.ts
export const docxSkill: BuiltinSkillDefinition = {
  slug: 'document-generator',
  name: 'Document Generator',
  description: 'Generate DOCX documents from templates',
  allowedTools: ['Bash(curl:*)'],
  content: `# Document Generator

## List Available Templates

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/documents/templates"
\`\`\`

## Generate a Document

\`\`\`bash
curl -s -X POST -H "X-Auth-Token: {{AUTH_TOKEN}}" http://localhost:{{PORT}}/api/documents/generate \\
  -H "Content-Type: application/json" \\
  -d '{"templateId":"TEMPLATE_ID","variables":{"release_name":"v2.1.0","release_date":"2024-03-15","release_type":"Normal","requester_name":"Juan Perez"},"outputFilename":"CC-v2.1.0.docx"}'
\`\`\`

Returns the generated document metadata including the file \`path\` on disk. Use this path when sending the file as an email attachment.

## Notes
- Variables in the template use \`{variableName}\` syntax.
- For lists, use \`{#items}{name}{/items}\` syntax.
- For conditionals, use \`{#isUrgent}URGENT{/isUrgent}\`.
- The generated file path can be passed directly to the email send endpoint's attachments parameter.
`,
};
```

### SQLite Integration

**Every document generation is logged**:

```typescript
// In docx-engine.ts generateDocument():
const doc = await renderTemplate(template, variables);
const outputPath = writeToGenerated(doc, outputFilename);
const stats = fs.statSync(outputPath);

eventQueries.logDocumentGeneration({
  templateId: template.id,
  templateName: template.name,
  outputFilename,
  outputPath,
  variables,
  fileSizeBytes: stats.size,
  agentId: callingAgentId,
  workflowInstanceId,
  generatedAt: Date.now(),
});
```

This gives us:
- **Generation history** — which templates were used, with what variables, by which agent
- **Workflow correlation** — the CC document for a specific release is linked to its workflow instance
- **Template usage stats** — how often each template is used (queryable via `GET /api/events/documents?templateId=X`)

#### Client UI

- Template management panel (upload, list, preview variables, delete)
- Generate test document form (select template, fill variables, preview/download)
- **Document generation history** — list of all generated documents with variables, agent, workflow link (reads from SQLite via `GET /api/events/documents`)

### Dependencies

```
docxtemplater    — DOCX template engine
pizzip           — ZIP handling for DOCX files (docxtemplater dependency)
multer           — Multipart file upload handling (already may be in use)
```

### Decisions

- **PDF generation**: Yes, include as a post-processing option. Add a `POST /api/documents/convert` endpoint that calls `libreoffice --convert-to pdf`. Low effort and the CC process may need PDFs for some approvers. `libreoffice` must be installed on the host (document this as a prerequisite).
- **No template versioning** for v1. Templates are uploaded manually and change rarely. Old files are overwritten. If versioning is needed later, simple rename-on-upload pattern (`template_v1.docx`, `template_v2.docx`).
- **90-day file retention**, configurable. A cron job (same schedule as the SQLite retention service) cleans up generated documents older than the threshold. The SQLite metadata record persists (the file path becomes a dangling reference, but the log entry stays for audit).

---

## Phase 5: Google Calendar Integration

### Purpose

Create calendar events and invite attendees. Used in the CC process to schedule the release window and invite developers.

### Authentication

Shares OAuth2 with Gmail (Phase 3). Additional scope needed:
- `https://www.googleapis.com/auth/calendar.events` — Create/modify/delete events

This scope is added to the same OAuth consent URL from Phase 3. If the user already completed Gmail OAuth, they may need to re-consent to add the calendar scope.

### Server-Side Files

All calendar files live under `src/packages/server/integrations/google-calendar/`.

#### `src/packages/server/integrations/google-calendar/calendar-client.ts`

```typescript
export function init(ctx: IntegrationContext): Promise<void>
export function isConfigured(): boolean

// Events
export function createEvent(params: {
  summary: string;                              // Event title
  description?: string;
  startDateTime: string;                        // ISO 8601 (e.g. "2024-03-15T22:00:00-06:00")
  endDateTime: string;                          // ISO 8601
  attendees: string[];                          // Email addresses to invite
  location?: string;
  reminders?: {
    useDefault: boolean;
    overrides?: { method: 'email' | 'popup'; minutes: number }[];
  };
  calendarId?: string;                          // Default: 'primary'
}): Promise<CalendarEvent>

export function updateEvent(eventId: string, updates: Partial<CreateEventParams>): Promise<CalendarEvent>
export function deleteEvent(eventId: string): Promise<void>
export function getEvent(eventId: string): Promise<CalendarEvent>
export function listEvents(params: {
  timeMin?: string;                             // ISO 8601
  timeMax?: string;
  maxResults?: number;
  calendarId?: string;
}): Promise<CalendarEvent[]>
```

#### Types

```typescript
interface CalendarEvent {
  eventId: string;
  summary: string;
  description?: string;
  startDateTime: string;
  endDateTime: string;
  attendees: EventAttendee[];
  location?: string;
  htmlLink: string;                             // Link to view in Google Calendar
  status: string;
  created: string;
  updated: string;
}

interface EventAttendee {
  email: string;
  displayName?: string;
  responseStatus: 'needsAction' | 'declined' | 'tentative' | 'accepted';
}
```

#### `src/packages/server/integrations/google-calendar/calendar-routes.ts`

```typescript
POST   /api/calendar/events                      // Create event
// Body: { summary, description?, startDateTime, endDateTime, attendees, location? }
// Returns: { event: CalendarEvent }

GET    /api/calendar/events                      // List events
// Query: ?timeMin=...&timeMax=...&maxResults=10
// Returns: { events: CalendarEvent[] }

GET    /api/calendar/events/:eventId             // Get event
PATCH  /api/calendar/events/:eventId             // Update event
DELETE /api/calendar/events/:eventId             // Delete event

// Working days utility
POST   /api/calendar/working-days
// Body: { targetDate: string (ISO date) }
// Returns: { workingDays: number, isUrgent: boolean, holidays: string[] }
// Calculates working days from now to targetDate, excluding weekends and configured holidays
// isUrgent is true if workingDays < 2 (configurable threshold)
```

#### Built-in Skill: `google-calendar`

```typescript
// src/packages/server/integrations/google-calendar/calendar-skill.ts
export const calendarSkill: BuiltinSkillDefinition = {
  slug: 'google-calendar',
  name: 'Google Calendar',
  description: 'Create and manage Google Calendar events',
  allowedTools: ['Bash(curl:*)'],
  content: `# Google Calendar

## Create an Event

\`\`\`bash
curl -s -X POST -H "X-Auth-Token: {{AUTH_TOKEN}}" http://localhost:{{PORT}}/api/calendar/events \\
  -H "Content-Type: application/json" \\
  -d '{"summary":"Release v2.1.0","description":"CC approved release","startDateTime":"2024-03-15T22:00:00-06:00","endDateTime":"2024-03-15T23:00:00-06:00","attendees":["dev@company.com","lead@company.com"]}'
\`\`\`

## List Upcoming Events

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/calendar/events?timeMin=$(date -u +%Y-%m-%dT%H:%M:%SZ)&maxResults=10"
\`\`\`

## Update an Event

\`\`\`bash
curl -s -X PATCH -H "X-Auth-Token: {{AUTH_TOKEN}}" http://localhost:{{PORT}}/api/calendar/events/EVENT_ID \\
  -H "Content-Type: application/json" \\
  -d '{"summary":"Updated title","attendees":["dev@company.com","newdev@company.com"]}'
\`\`\`

## Delete an Event

\`\`\`bash
curl -s -X DELETE -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/calendar/events/EVENT_ID"
\`\`\`

## Notes
- All datetimes must be ISO 8601 format with timezone offset.
- Attendees receive Google Calendar invitations automatically.
- The event link (\`htmlLink\`) can be shared in Slack or email.
`,
};
```

### SQLite Integration

**Every calendar action is logged**:

```typescript
// In calendar-client.ts createEvent():
const result = await calendar.events.insert({ ... });
eventQueries.logCalendarAction({
  eventId: result.data.id,
  action: 'created',
  summary: params.summary,
  startDatetime: params.startDateTime,
  endDatetime: params.endDateTime,
  attendees: params.attendees,
  htmlLink: result.data.htmlLink,
  agentId: callingAgentId,
  workflowInstanceId,
  recordedAt: Date.now(),
});

// Similarly for updateEvent() with action: 'updated'
// and deleteEvent() with action: 'deleted'
```

Queryable via `GET /api/events/calendar`, and included in the workflow timeline view.

### Dependencies

```
googleapis — Already needed for Gmail (Phase 3). Calendar API is included.
```

### Decisions

- **Working days calculation**: Add a utility endpoint `POST /api/calendar/working-days` in the calendar plugin. Takes a target date, returns the number of working days from now. Configurable holidays list stored in the calendar plugin config (JSON array of dates). The agent calls this during the "Validate Date" workflow state to determine if the release is urgent.
- **Configurable calendar, default to primary**. Add a `calendar_id` field to the Google Calendar plugin config schema, defaulting to `'primary'`. Users who want a shared "Releases" calendar can set it there.

---

## Phase 5b: Jira Service Desk Integration

### Purpose

Connect to Jira Service Desk to create, update, and track tickets as part of automated processes. In the CC workflow, a Jira ticket is created immediately after intake — its key (e.g. `SD-1234`) is embedded into the CC document and referenced throughout the process for traceability.

### Plugin Structure

```
src/packages/server/integrations/jira/
  index.ts                    ← Exports jiraPlugin implementing IntegrationPlugin
  jira-client.ts              ← Jira REST API v3 / Service Desk API wrapper
  jira-routes.ts              ← Express Router for /api/jira/* endpoints
  jira-trigger-handler.ts     ← TriggerHandler for 'jira' type (webhook-based)
  jira-skill.ts               ← BuiltinSkillDefinition with curl instructions
  jira-events.ts              ← SQLite event logging helpers
  jira-config.ts              ← ConfigField[] schema + defaults
```

### `jira-client.ts` — Service Signatures

```typescript
// src/packages/server/integrations/jira/jira-client.ts

import { IntegrationContext } from '../integration-types.js';

export interface JiraIssueParams {
  projectKey: string;          // e.g. "SD"
  issueType: string;           // e.g. "Service Request", "Change Request"
  summary: string;             // Issue title
  description: string;         // Issue body (Atlassian Document Format or plain text)
  priority?: string;           // e.g. "High", "Medium", "Low"
  labels?: string[];           // e.g. ["cc", "release"]
  customFields?: Record<string, unknown>;  // Project-specific custom fields
  assignee?: string;           // Account ID or email
  reporter?: string;           // Account ID or email
}

export interface JiraIssue {
  id: string;                  // Numeric issue ID
  key: string;                 // e.g. "SD-1234"
  self: string;                // API URL
  fields: {
    summary: string;
    status: { name: string };
    priority?: { name: string };
    assignee?: { displayName: string; emailAddress: string };
    created: string;
    updated: string;
    [key: string]: unknown;
  };
}

export interface JiraTransition {
  id: string;
  name: string;                // e.g. "In Progress", "Done", "Closed"
}

export class JiraClient {
  private ctx: IntegrationContext;
  private baseUrl: string;     // e.g. "https://yourcompany.atlassian.net"
  private auth: string;        // Base64(email:apiToken)

  constructor(ctx: IntegrationContext) { /* reads config from ctx.secrets */ }

  // ─── Issues ───

  /** Create a new Jira issue. Returns the created issue with key. */
  async createIssue(params: JiraIssueParams): Promise<JiraIssue>

  /** Get issue by key (e.g. "SD-1234"). */
  async getIssue(issueKey: string): Promise<JiraIssue>

  /** Update issue fields (partial update). */
  async updateIssue(issueKey: string, fields: Partial<JiraIssueParams>): Promise<void>

  // ─── Comments ───

  /** Add a comment to an issue. */
  async addComment(issueKey: string, body: string): Promise<{ id: string }>

  /** Get all comments on an issue. */
  async getComments(issueKey: string): Promise<Array<{ id: string; author: string; body: string; created: string }>>

  // ─── Transitions ───

  /** List available transitions for an issue. */
  async getTransitions(issueKey: string): Promise<JiraTransition[]>

  /** Transition an issue to a new status. */
  async transitionIssue(issueKey: string, transitionId: string, comment?: string): Promise<void>

  // ─── Search ───

  /** Search issues via JQL. */
  async searchIssues(jql: string, opts?: { maxResults?: number; startAt?: number }): Promise<{ issues: JiraIssue[]; total: number }>

  // ─── Service Desk (optional, for SD-specific features) ───

  /** Create a Service Desk request (uses the Service Desk API v1). */
  async createServiceRequest(serviceDeskId: string, requestTypeId: string, params: { summary: string; description: string; [key: string]: unknown }): Promise<JiraIssue>
}
```

**Authentication:** Uses Jira API tokens (Atlassian account email + API token). Stored in the secrets store via `ctx.secrets.set('jira_email', ...)` and `ctx.secrets.set('jira_api_token', ...)`. Base64-encoded as `email:token` for the `Authorization: Basic` header.

### `jira-routes.ts` — REST Endpoints

```typescript
// src/packages/server/integrations/jira/jira-routes.ts
// Mounted at /api/jira/ by the integration registry

// ─── Issues ───
POST   /api/jira/issues
// Body: JiraIssueParams
// Returns: { key: "SD-1234", id: "10042", self: "https://..." }

GET    /api/jira/issues/:key
// Returns: JiraIssue (full issue details)

PATCH  /api/jira/issues/:key
// Body: Partial<JiraIssueParams>
// Updates the issue fields

// ─── Comments ───
POST   /api/jira/issues/:key/comments
// Body: { body: "Comment text" }
// Returns: { id: "10123" }

GET    /api/jira/issues/:key/comments
// Returns: { comments: [...] }

// ─── Transitions ───
GET    /api/jira/issues/:key/transitions
// Returns: { transitions: [{ id, name }] }

POST   /api/jira/issues/:key/transitions
// Body: { transitionId: "31", comment?: "Transitioning to Done" }

// ─── Search ───
GET    /api/jira/search?jql=...&maxResults=25&startAt=0
// Returns: { issues: JiraIssue[], total: number }

// ─── Service Desk ───
POST   /api/jira/service-desk/:deskId/requests
// Body: { requestTypeId: "10", summary: "...", description: "...", ... }
// Returns: JiraIssue
```

### `jira-trigger-handler.ts` — Webhook-Based Triggers

Jira can send webhooks on issue events (created, updated, transitioned, commented). The trigger handler listens for these via the existing webhook ingestion endpoint.

```typescript
// src/packages/server/integrations/jira/jira-trigger-handler.ts

export const jiraTriggerHandler: TriggerHandler = {
  triggerType: 'jira',

  async startListening(onEvent) {
    // Jira webhooks arrive at /api/webhooks/jira (via core webhook route)
    // The handler registers itself to receive these events
    // No persistent connection needed — webhooks are push-based
  },

  async stopListening() {
    // Unregister from webhook dispatcher
  },

  structuralMatch(trigger, event) {
    // Match by project, issue type, event type, JQL filter
    // Example trigger config:
    // { type: 'jira', projectKey: 'SD', events: ['issue_created', 'issue_transitioned'] }
    const config = trigger.config;
    if (config.projectKey && event.data.project?.key !== config.projectKey) return false;
    if (config.events && !config.events.includes(event.data.webhookEvent)) return false;
    if (config.jqlFilter) { /* JQL matching is complex — simplified to key fields */ }
    return true;
  },

  extractVariables(trigger, event) {
    return {
      'jira.issueKey': event.data.issue?.key,
      'jira.issueId': event.data.issue?.id,
      'jira.summary': event.data.issue?.fields?.summary,
      'jira.status': event.data.issue?.fields?.status?.name,
      'jira.project': event.data.issue?.fields?.project?.key,
      'jira.eventType': event.data.webhookEvent,
      'jira.user': event.data.user?.displayName,
    };
  },

  formatEventForLLM(event: ExternalEvent): string {
    const d = event.data as any;
    const issue = d.issue;
    return [
      `Jira ${d.webhookEvent} event`,
      `Project: ${issue?.fields?.project?.key}`,
      `Issue: ${issue?.key} — ${issue?.fields?.summary}`,
      `Status: ${issue?.fields?.status?.name}`,
      `Priority: ${issue?.fields?.priority?.name || 'None'}`,
      `User: ${d.user?.displayName}`,
      issue?.fields?.description ? `Description: ${issue.fields.description}` : '',
    ].filter(Boolean).join('\n');
  },
};
```

### `jira-skill.ts` — Built-in Skill

```typescript
// src/packages/server/integrations/jira/jira-skill.ts

export const jiraSkill: BuiltinSkillDefinition = {
  id: 'jira-service-desk',
  name: 'Jira Service Desk',
  description: 'Create, update, and manage Jira Service Desk tickets',
  content: `
# Jira Service Desk

You have access to the Jira Service Desk integration. Use these endpoints via curl.

## Create a ticket

\`\`\`bash
curl -s -X POST "{{BASE_URL}}/api/jira/issues" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{
    "projectKey": "SD",
    "issueType": "Change Request",
    "summary": "CC - Release v2.1.0 - 2026-03-20",
    "description": "Control de Cambios for release v2.1.0. Requested by: John Doe. Systems affected: API, Frontend.",
    "priority": "Medium",
    "labels": ["cc", "release"]
  }'
\`\`\`
Returns: \`{ "key": "SD-1234", "id": "10042", "self": "https://..." }\`

## Get a ticket

\`\`\`bash
curl -s "{{BASE_URL}}/api/jira/issues/SD-1234" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}"
\`\`\`

## Update a ticket

\`\`\`bash
curl -s -X PATCH "{{BASE_URL}}/api/jira/issues/SD-1234" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "summary": "Updated summary", "priority": "High" }'
\`\`\`

## Add a comment

\`\`\`bash
curl -s -X POST "{{BASE_URL}}/api/jira/issues/SD-1234/comments" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "body": "CC document generated and sent for approval." }'
\`\`\`

## Transition a ticket (change status)

First, list available transitions:
\`\`\`bash
curl -s "{{BASE_URL}}/api/jira/issues/SD-1234/transitions" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}"
\`\`\`

Then transition:
\`\`\`bash
curl -s -X POST "{{BASE_URL}}/api/jira/issues/SD-1234/transitions" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "transitionId": "31", "comment": "Approved and release completed" }'
\`\`\`

## Search tickets (JQL)

\`\`\`bash
curl -s "{{BASE_URL}}/api/jira/search?jql=project%3DSD%20AND%20labels%3Dcc&maxResults=10" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}"
\`\`\`
`,
};
```

### `jira-config.ts` — ConfigField Schema

```typescript
// src/packages/server/integrations/jira/jira-config.ts

export const jiraConfigSchema: ConfigField[] = [
  {
    key: 'jira_base_url',
    label: 'Jira Base URL',
    type: 'text',
    placeholder: 'https://yourcompany.atlassian.net',
    description: 'Your Atlassian Cloud instance URL',
    required: true,
  },
  {
    key: 'jira_email',
    label: 'Jira Account Email',
    type: 'text',
    placeholder: 'user@company.com',
    description: 'Email address of the Jira account used for API access',
    required: true,
  },
  {
    key: 'jira_api_token',
    label: 'Jira API Token',
    type: 'password',
    description: 'API token generated at https://id.atlassian.com/manage-profile/security/api-tokens',
    required: true,
  },
  {
    key: 'jira_default_project',
    label: 'Default Project Key',
    type: 'text',
    placeholder: 'SD',
    description: 'Default Jira project key for new issues (can be overridden per request)',
    required: false,
  },
  {
    key: 'jira_default_issue_type',
    label: 'Default Issue Type',
    type: 'select',
    options: ['Change Request', 'Service Request', 'Task', 'Bug', 'Story'],
    description: 'Default issue type when creating tickets',
    required: false,
  },
  {
    key: 'jira_webhook_secret',
    label: 'Webhook Secret',
    type: 'password',
    description: 'Secret for validating incoming Jira webhooks (optional, for trigger handler)',
    required: false,
  },
  {
    key: 'jira_custom_field_mappings',
    label: 'Custom Field Mappings',
    type: 'textarea',
    description: 'JSON array mapping workflow variables to Jira custom fields. Example: [{"workflowVariable":"release_name","jiraField":"customfield_10042"}]',
    required: false,
    placeholder: '[{"workflowVariable": "...", "jiraField": "customfield_..."}]',
  },
];
```

### `jira/index.ts` — Plugin Export

```typescript
// src/packages/server/integrations/jira/index.ts

import { Router } from 'express';
import type { IntegrationPlugin, IntegrationContext, IntegrationStatus } from '../integration-types.js';
import { JiraClient } from './jira-client.js';
import { createJiraRoutes } from './jira-routes.js';
import { jiraSkill } from './jira-skill.js';
import { jiraTriggerHandler } from './jira-trigger-handler.js';
import { jiraConfigSchema } from './jira-config.js';

export const jiraPlugin: IntegrationPlugin = {
  id: 'jira',
  name: 'Jira Service Desk',
  description: 'Create, update, and track Jira Service Desk tickets for change control processes',
  routePrefix: '/jira',

  async init(ctx: IntegrationContext) {
    // Read config from secrets, instantiate JiraClient
    // Validate connectivity with a test API call
  },

  async shutdown() {
    // No persistent connections to close (REST-only)
  },

  getRoutes(): Router {
    return createJiraRoutes(this.client, this.ctx);
  },

  getSkills() {
    return [jiraSkill];
  },

  getTriggerHandler() {
    return jiraTriggerHandler;
  },

  getStatus(): IntegrationStatus {
    return { connected: this.isConfigured, lastChecked: Date.now() };
  },

  getConfigSchema() {
    return jiraConfigSchema;
  },

  getConfig() { /* return current config minus secrets */ },
  async setConfig(config) { /* validate, save to secrets, re-init client */ },
};
```

### SQLite Integration

Every Jira API call logs to the `jira_ticket_logs` table (defined in Phase 0 schema). The integration uses `ctx.eventDb.logJiraTicketAction()`:

```typescript
// Inside jira-routes.ts — POST /api/jira/issues handler
const issue = await jiraClient.createIssue(params);
ctx.eventDb.logJiraTicketAction({
  ticketKey: issue.key,
  ticketId: issue.id,
  projectKey: params.projectKey,
  action: 'created',
  summary: params.summary,
  issueType: params.issueType,
  status: issue.fields.status.name,
  priority: params.priority,
  agentId: callingAgentId,
  workflowInstanceId,
  selfUrl: issue.self,
  recordedAt: Date.now(),
});

// Inside jira-routes.ts — POST /api/jira/issues/:key/transitions handler
await jiraClient.transitionIssue(issueKey, transitionId, comment);
ctx.eventDb.logJiraTicketAction({
  ticketKey: issueKey,
  ticketId: issue.id,
  projectKey: issue.fields.project.key,
  action: 'transitioned',
  summary: issue.fields.summary,
  status: newStatus,
  agentId: callingAgentId,
  workflowInstanceId,
  selfUrl: issue.self,
  recordedAt: Date.now(),
});

// Similarly for updateIssue (action: 'updated'), addComment (action: 'commented')
```

Queryable via `GET /api/events/jira`, and included in the workflow timeline view.

### Dependencies

```
jira.js — (Optional) Community Jira API client for Node.js, or use raw fetch with Jira REST API v3
          (Recommend raw fetch to minimize deps — Jira REST API v3 is simple and well-documented)
```

### Decisions

- **Jira Cloud only** for v1. The `JiraClient` abstraction already isolates API calls — swapping auth and base URLs for on-premise Jira Server is straightforward when needed.
- **Standard Issues API** (`/rest/api/3/issue`) as default. It works for all Jira project types, not just Service Desk. The SD-specific API (`/rest/servicedeskapi/`) adds queue/SLA features that aren't needed for CC. The optional `createServiceRequest()` method is kept in the client for teams that need it.
- **Instructions in the config UI** for webhook setup. Auto-registration via Jira API requires admin-level tokens and is fragile. The config UI shows a clear guide ("Go to Jira Settings → System → Webhooks → Add URL: `{baseUrl}/api/webhooks/jira`") with a "Copy webhook URL" button.
- **Custom field mapping**: Yes. Add a `customFieldMappings` array to `jira-config.ts`: `[{ workflowVariable: 'release_name', jiraField: 'customfield_10042' }]`. The `jira-client.ts` applies these mappings when creating/updating issues, merging them into the `customFields` parameter.

---

## Phase 6: Workflow Engine (Process Orchestration)

### Purpose

A configurable state machine that ties triggers, tools, and agent actions together into repeatable, automated processes. The CC process is configured as a workflow — not hardcoded.

### Key Design Decisions

1. **Agent-driven, not engine-driven** — The workflow engine doesn't execute logic itself. It tells agents what to do at each state, and transitions are triggered by events (triggers, manual, or agent completion).
2. **State machine model** — Each workflow is a directed graph of states with named transitions.
3. **Workflow instances** — A workflow definition is a template. Each execution creates an instance with its own state and variables.
4. **Variables persist across states** — Data collected in early states (e.g., developer answers) is available in later states (e.g., document generation).

### Data Model

```typescript
// src/packages/shared/workflow-types.ts

// ─── Workflow Definition (the template) ───

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  version: number;

  // Variables schema — what data this workflow collects/uses
  variables: WorkflowVariableSchema[];

  // States
  states: WorkflowState[];
  initialStateId: string;

  createdAt: number;
  updatedAt: number;
}

export interface WorkflowVariableSchema {
  name: string;                                 // Variable key
  type: 'string' | 'number' | 'boolean' | 'date' | 'email' | 'json';
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
}

export interface WorkflowState {
  id: string;
  name: string;
  description?: string;
  type: 'action' | 'wait' | 'decision' | 'end';

  // What happens when we enter this state
  action?: WorkflowAction;

  // How we leave this state
  transitions: WorkflowTransition[];
}

export type WorkflowAction = {
  type: 'agent_task';
  agentId: string;                              // Which agent executes
  promptTemplate: string;                       // Supports {{variable}} interpolation
  skills?: string[];                            // Skill slugs to ensure are available
} | {
  type: 'trigger_setup';                        // Dynamically create/enable a trigger
  triggerConfig: Partial<Trigger>;
  triggerVariableMapping?: Record<string, string>; // Map trigger output vars to workflow vars
} | {
  type: 'wait_for_trigger';                     // Wait for an existing trigger to fire
  triggerId: string;
  timeoutMs?: number;
} | {
  type: 'set_variables';                        // Set workflow variables
  assignments: Record<string, string>;          // Key: variable name, Value: expression/template
};

export interface WorkflowTransition {
  id: string;
  name: string;                                 // Human-readable (e.g. "Approved", "Timeout", "Dev Ready")
  targetStateId: string;

  condition: WorkflowCondition;
}

export type WorkflowCondition = {
  type: 'agent_complete';                       // Agent finished its task
} | {
  type: 'trigger_fired';                        // A specific trigger fired
  triggerId?: string;                           // If null, uses the trigger from action.trigger_setup
} | {
  type: 'variable_check';                       // Check a workflow variable
  variable: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'is_true';
  value?: unknown;
} | {
  type: 'timeout';                              // Time-based transition
  afterMs: number;
} | {
  type: 'manual';                               // User clicks a button in the UI
} | {
  type: 'cron';                                 // Fire at a specific time
  expression: string;
  timezone: string;
};

// ─── Workflow Instance (a running execution) ───

export type WorkflowInstanceStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowInstance {
  id: string;
  workflowDefId: string;
  workflowName: string;
  status: WorkflowInstanceStatus;
  currentStateId: string;
  variables: Record<string, unknown>;           // Runtime variable values

  history: WorkflowHistoryEntry[];              // Audit trail

  createdAt: number;
  updatedAt: number;
  completedAt?: number;

  // Active trigger IDs created by this instance (for cleanup on cancel/complete)
  activeTriggerIds: string[];

  // Active cron jobs for this instance
  activeTimers: string[];

  error?: string;
}

export interface WorkflowHistoryEntry {
  timestamp: number;
  fromStateId?: string;
  toStateId: string;
  transitionName?: string;
  details?: string;                             // What happened (agent output, trigger payload, etc.)
  variables?: Record<string, unknown>;          // Variable snapshot at this point
}
```

### Persistence

**Definitions** (configuration) stay in JSON — they're user-edited templates:
```
~/.local/share/tide-commander/workflow-definitions.json
```

**Instances** (runtime state) live in SQLite — they're high-volume operational data:
```
Table: workflow_instances     — current state, variables, status
Table: workflow_step_log      — every state transition with full context
Table: workflow_variable_changes — every variable mutation
```

This split follows the storage principle: JSON for config, SQLite for events. Workflow definitions are created/edited infrequently by users. Workflow instances are created, updated, and queried constantly during execution.

### Server-Side Files

#### `src/packages/server/services/workflow-service.ts`

```typescript
// Definitions
export function initWorkflows(): void
export function shutdown(): void

export function listDefinitions(): WorkflowDefinition[]
export function getDefinition(id: string): WorkflowDefinition | undefined
export function createDefinition(data: Omit<WorkflowDefinition, 'id' | 'version' | 'createdAt' | 'updatedAt'>): WorkflowDefinition
export function updateDefinition(id: string, updates: Partial<WorkflowDefinition>): WorkflowDefinition | null
export function deleteDefinition(id: string): boolean

// Instances (backed by SQLite — reads/writes go through eventQueries)
export function listInstances(opts?: { workflowDefId?: string; status?: string; limit?: number; offset?: number }): WorkflowInstanceRow[]
export function getInstance(id: string): WorkflowInstanceRow | undefined

export function startWorkflow(params: {
  workflowDefId: string;
  initialVariables?: Record<string, unknown>;
}): Promise<WorkflowInstanceRow>

export function pauseWorkflow(instanceId: string): WorkflowInstanceRow | null
export function resumeWorkflow(instanceId: string): Promise<WorkflowInstanceRow | null>
export function cancelWorkflow(instanceId: string): WorkflowInstanceRow | null

// State machine execution (internal — all transitions logged to SQLite)
function enterState(instance: WorkflowInstanceRow, stateId: string): Promise<void>
// 1. Creates a workflow_step_log entry with status='entered', variables_before snapshot
// 2. Updates workflow_instances.current_state_id
// 3. Executes the state's action (if any)
// 4. Updates step_log status to 'executing'

function evaluateTransitions(instance: WorkflowInstanceRow): Promise<void>
// Checks all transitions from current state, fires the first matching one

function executeAction(instance: WorkflowInstanceRow, action: WorkflowAction): Promise<void>
// For agent_task: logs prompt_sent to step_log, sends to agent
// For trigger_setup: creates trigger, logs trigger_id to step_log
// For set_variables: logs each variable change to workflow_variable_changes

function completeStep(instance: WorkflowInstanceRow, stepLogId: number, agentResponse?: string, agentReasoning?: string): void
// 1. Updates step_log: status='completed', exited_at, duration_ms, variables_after snapshot, agent_response, agent_reasoning
// 2. Evaluates transitions

function handleTransition(instance: WorkflowInstanceRow, transition: WorkflowTransition): Promise<void>
// 1. Logs the transition in the current step_log entry
// 2. Calls enterState for the target state

// External event injection (called by trigger service, agent completion, etc.)
export function notifyEvent(params: {
  instanceId: string;
  eventType: 'trigger_fired' | 'agent_complete' | 'manual_transition';
  triggerId?: string;
  transitionId?: string;
  data?: Record<string, unknown>;              // Additional variables from the event
}): Promise<void>
// Logs the event to audit_log, then evaluates transitions

// Variable updates (called by agents via API)
export function updateVariables(instanceId: string, updates: Record<string, unknown>, changedBy: string): void
// 1. For each changed variable, inserts a workflow_variable_changes row
// 2. Updates workflow_instances.variables
// 3. Broadcasts variable change via WS

// History queries (delegates to eventQueries)
export function getInstanceTimeline(instanceId: string): TimelineEntry[]
export function getInstanceSteps(instanceId: string): WorkflowStepLogRow[]
export function getInstanceVariableHistory(instanceId: string, variableName?: string): VariableChangeRow[]

// Event system
export function subscribe(listener: WorkflowListener): () => void
```

#### `src/packages/server/routes/workflow-routes.ts`

```typescript
// Definitions (CRUD — stored in JSON)
GET    /api/workflows/definitions
GET    /api/workflows/definitions/:id
POST   /api/workflows/definitions
PATCH  /api/workflows/definitions/:id
DELETE /api/workflows/definitions/:id

// Instances (runtime — stored in SQLite)
GET    /api/workflows/instances
// Query: ?status=running&workflowDefId=...&limit=50&offset=0
GET    /api/workflows/instances/:id
POST   /api/workflows/instances                  // Start a workflow
// Body: { workflowDefId, initialVariables? }

PATCH  /api/workflows/instances/:id/pause
PATCH  /api/workflows/instances/:id/resume
PATCH  /api/workflows/instances/:id/cancel

// Manual transition (user clicks in UI)
POST   /api/workflows/instances/:id/transition
// Body: { transitionId }

// Variable updates (agents call this via curl)
PATCH  /api/workflows/instances/:id/variables
// Body: { variables: { key: value, ... } }
// Each change is logged to workflow_variable_changes

// Event injection (for triggers to notify workflows)
POST   /api/workflows/instances/:id/event
// Body: { eventType, triggerId?, data? }

// ─── History & Audit (reads from SQLite) ───

GET    /api/workflows/instances/:id/timeline
// Merged chronological timeline of ALL events: state transitions, slack messages,
// emails, approvals, doc generations, calendar actions, trigger fires
// Returns: { timeline: TimelineEntry[], instance: WorkflowInstanceRow }

GET    /api/workflows/instances/:id/steps
// Returns: { steps: WorkflowStepLogRow[] }
// Each step includes: prompt sent, agent response, agent reasoning, timing, variable snapshots

GET    /api/workflows/instances/:id/variables
// Query: ?variableName=... (optional)
// Returns: { changes: VariableChangeRow[] }
// Full audit trail of every variable mutation with who changed it and when

GET    /api/workflows/instances/:id/reasoning
// Returns: { steps: { stateId, stateName, agentId, promptSent, agentResponse, agentReasoning, durationMs }[] }
// Agent reasoning trace — shows the prompt the agent received and how it responded at each step
// Primary endpoint for understanding WHY a workflow made specific decisions

// ─── Workflow Chat (conversational audit) ───

POST   /api/workflows/:defId/chat
// Body: { message: string, scope: WorkflowChatScope, conversationHistory?: ChatMessage[] }
// Returns: { response: string, sources: SourceRef[] }
// Builds context from SQLite based on scope, sends to LLM with user question
// sources: references to specific events/steps the LLM cited (clickable in UI)

GET    /api/workflows/:defId/chat/history
// Returns: { messages: ChatMessage[] }
// Session chat history (optional persistence)
```

#### WebSocket Messages

```typescript
// Client -> Server
| { type: 'create_workflow_def'; payload: ... }
| { type: 'update_workflow_def'; payload: ... }
| { type: 'delete_workflow_def'; payload: { id: string } }
| { type: 'start_workflow'; payload: { workflowDefId: string; initialVariables?: Record<string, unknown> } }
| { type: 'pause_workflow'; payload: { instanceId: string } }
| { type: 'resume_workflow'; payload: { instanceId: string } }
| { type: 'cancel_workflow'; payload: { instanceId: string } }
| { type: 'manual_transition'; payload: { instanceId: string; transitionId: string } }

// Server -> Client
| { type: 'workflow_definitions_update'; payload: WorkflowDefinition[] }
| { type: 'workflow_definition_created'; payload: WorkflowDefinition }
| { type: 'workflow_definition_updated'; payload: WorkflowDefinition }
| { type: 'workflow_definition_deleted'; payload: { id: string } }
| { type: 'workflow_instances_update'; payload: WorkflowInstanceRow[] }
| { type: 'workflow_instance_created'; payload: WorkflowInstanceRow }
| { type: 'workflow_instance_updated'; payload: WorkflowInstanceRow }
| { type: 'workflow_state_changed'; payload: { instanceId: string; fromState: string; toState: string; transition: string; stepLogId: number } }
| { type: 'workflow_step_update'; payload: { instanceId: string; step: WorkflowStepLogRow } }    // Real-time step progress
| { type: 'workflow_variable_changed'; payload: { instanceId: string; change: VariableChangeRow } }
| { type: 'workflow_completed'; payload: { instanceId: string } }
| { type: 'workflow_error'; payload: { instanceId: string; error: string } }
```

#### 3D Workflow Models in the Work Area

Following the same pattern as Buildings, each workflow definition is represented as a **3D model in the work area** (the Three.js scene). This makes workflows first-class visual citizens alongside agents and buildings.

**How it works (mirroring the Building pattern):**

- Each `WorkflowDefinition` gets a 3D mesh in the scene, positioned on the battlefield grid
- The model visually reflects the workflow's status:
  - **Idle** (no active instances) — subtle ambient animation (glow, slow rotation)
  - **Running** (1+ active instances) — energetic animation, particle effects, instance count badge
  - **Error** (any instance in error state) — red pulsing glow, alert indicator
- Workflows have a `position: { x: number; z: number }` field (like buildings) and a `style` field for visual variety
- The workflow model is stored in the same `workflows.json` definition file — no separate persistence
- The 3D scene manager (`WorkflowModelManager`, analogous to `BuildingManager`) handles add/remove/update/animate
- Click a workflow model → selects it, shows quick info panel (name, status, active instance count, last run)
- Double-click / enter → opens the **Workflow Detail View**

**WorkflowDefinition additions for 3D representation:**

```typescript
// Added to WorkflowDefinition in src/packages/shared/workflow-types.ts

export interface WorkflowDefinition {
  // ... existing fields (id, name, states, transitions, variables, etc.)

  // ─── Visual (3D work area) ───
  position: { x: number; z: number };   // Position on the battlefield grid
  style?: WorkflowStyle;                // Visual style for 3D model
  color?: string;                       // Hex color override
  scale?: number;                       // Size multiplier (default 1.0)
}

export type WorkflowStyle =
  | 'flowchart'       // Connected nodes floating in a ring
  | 'circuit-board'   // PCB-style traces with glowing paths
  | 'constellation'   // Star map with connected points
  | 'helix'           // DNA-like double spiral
  | 'clockwork'       // Mechanical gears and cogs
  ;
```

**Workflow status computation (aggregated from instances):**

```typescript
export type WorkflowModelStatus = 'idle' | 'running' | 'completed' | 'error';

// Computed from active instances:
// - No instances or all completed → 'idle'
// - Any instance in 'running' or 'waiting' → 'running'
// - Any instance in 'error' → 'error'
// - All instances completed in last 5min → 'completed' (then fades to 'idle')
```

#### Workflow Detail View

When the user enters a workflow model (double-click / enter key), it opens the **Workflow Detail View** — a full-screen panel with three levels of depth:

**Level 1: Workflow Overview**
- Workflow name, description, status badge
- **Definition tab** — the workflow's state machine definition:
  - Visual state diagram (nodes and transitions)
  - State list with action types, assigned agents, skills
  - Variable schema table
  - Trigger bindings (which triggers start this workflow)
  - Edit button → opens workflow definition editor (state machine designer)
- **Executions tab** — list of all workflow instances (powered by SQLite):
  - Table: instance ID, started at, current state, status, duration, trigger source
  - Filters: status (running/completed/failed/all), date range
  - Sort: by date, status, duration
  - Click a row → drills down to Level 2

**Level 2: Execution Detail**
- Selected instance's state machine with current position highlighted
- Instance metadata: started by (trigger/manual), started at, current state, elapsed time
- **Timeline view** (`GET .../timeline`) — chronological feed of ALL events: state transitions, Slack messages sent/received, emails in/out, approvals, documents generated, calendar events created, Jira tickets created/transitioned. Each entry is color-coded by type and expandable for details.
- **Steps view** (`GET .../steps`) — list of every state the workflow visited, with:
  - The prompt sent to the agent
  - The agent's response
  - The agent's reasoning/thought process
  - Variable snapshots before and after
  - Duration in each state
  - Error details if a step failed
  - Click a step → drills down to Level 3
- **Variables view** (`GET .../variables`) — table showing every variable mutation: who changed it, when, old value, new value. Filterable by variable name.
- Controls: pause/resume/cancel (for running instances), manual transition buttons

**Level 3: Step Detail / Reasoning Trace**
- Full agent interaction for a single workflow step
- The complete prompt that was sent (with all interpolated variables)
- The agent's full response
- Reasoning trace (`GET .../reasoning`) — the agent's thought process
- All side effects triggered by this step (Slack messages sent, emails sent, Jira actions, documents generated — linked from SQLite events)
- Variable changes made during this step (before → after diff)
- Duration breakdown (waiting for agent, API calls, total)

**Navigation:** breadcrumb trail at the top: `Workflow Name → Execution #1234 → State: Generate Document`

#### Workflow Chat — Conversational Audit & Exploration

Every workflow has a **persistent chat panel** in its detail view. Instead of manually navigating the timeline, steps, variables, and traces to find information, the user can just ask questions in natural language:

- "What happened in the last execution?"
- "Why did it go to the urgent path?"
- "Who approved the CC and when?"
- "Show me the Slack conversation from the intake step"
- "What variables changed between state 3 and state 5?"
- "Did we get all 3 approvals? From whom?"
- "How long did the approval step take on average across all executions?"

**How it works:**

The chat is backed by an LLM that receives the user's question along with **workflow context retrieved on demand** from the SQLite event store. It does NOT hold the entire history in context at all times — instead, it uses a retrieval pattern:

1. User sends a message in the workflow chat
2. The server builds a **context payload** by querying SQLite based on the current scope:
   - If the user is at the workflow level → fetch recent instances summary
   - If the user is viewing a specific execution → fetch that instance's full timeline, steps, variables
   - If the user is on a specific step → fetch that step's detail, reasoning, side effects
3. The context payload + user question + conversation history are sent to an LLM
4. The LLM responds conversationally, referencing specific events, timestamps, variable values, agent reasoning

**System prompt structure:**

```
You are a workflow assistant for the "{{workflow.name}}" workflow.
You help users understand what happened during workflow executions, audit processes,
and explore workflow history through conversation.

WORKFLOW DEFINITION:
{{workflow.definition summary — states, transitions, variables}}

CURRENT CONTEXT ({{scope}}):
{{retrieved context from SQLite — varies by what the user is viewing}}

CONVERSATION HISTORY:
{{previous messages in this chat session}}

Answer the user's question based on the context above. Reference specific timestamps,
variable values, agent responses, and event details. If the information isn't in the
current context, say so and suggest what the user might look at.
```

**Context retrieval endpoints (server-side):**

```typescript
// src/packages/server/services/workflow-chat-service.ts

/** Build context for the workflow chat LLM based on current scope */
export async function buildChatContext(
  workflowId: string,
  scope: WorkflowChatScope
): Promise<string>

export type WorkflowChatScope =
  | { level: 'workflow' }                                    // Overview: recent instances
  | { level: 'instance'; instanceId: string }                // Full instance detail
  | { level: 'step'; instanceId: string; stepId: string }    // Single step deep dive

// Internally queries:
// - eventQueries.getWorkflowTimeline(instanceId)
// - eventQueries.getWorkflowSteps(instanceId)
// - eventQueries.getWorkflowVariableChanges(instanceId)
// - eventQueries.getSlackMessagesByWorkflow(instanceId)
// - eventQueries.getEmailMessagesByWorkflow(instanceId)
// - eventQueries.getJiraLogsByWorkflow(instanceId)
// - eventQueries.getWorkflowReasoning(instanceId)
// etc.
```

**REST API:**

```typescript
POST   /api/workflows/:id/chat
// Body: { message: string, scope: WorkflowChatScope, conversationHistory?: ChatMessage[] }
// Returns: { response: string, sources: string[] }
// `sources` lists which data was referenced (e.g. ["instance:abc123:step:intake", "slack:msg:1234"])
// so the UI can highlight/link to the referenced items in the detail views

GET    /api/workflows/:id/chat/history
// Returns: { messages: ChatMessage[] }
// Persisted chat history for this workflow (optional — can be session-only)
```

**Client-side:**

The chat panel lives as a **persistent sidebar or bottom panel** within the Workflow Detail View, accessible at all three levels. It follows the same input/output pattern as the agent chat (`TerminalInputArea` + `VirtualizedOutputList`), but scoped to the workflow context. Key differences from the agent chat:

- No command execution — purely conversational Q&A
- Scope-aware: the context automatically updates as the user navigates between workflow overview, execution detail, and step detail
- **Source linking**: when the LLM references a specific event (e.g. "the approval email from john@co.com at 14:32"), the referenced item is clickable to navigate directly to that event in the timeline/step view
- Conversation persists within the session (resets on page reload, optionally persisted to SQLite)

**Model selection:** Uses a fast model (Haiku) by default since the responses are straightforward data retrieval and summarization. The user can switch to a more capable model from the chat settings if needed for complex analysis.

#### Built-in Skill: `workflow-designer`

Just like the `create-building` skill lets agents create and configure buildings via natural language, the `workflow-designer` skill lets agents create complete workflow definitions and add them to the work area. A user can describe a process in plain language ("automate our CC approval flow") and the agent creates the full workflow configuration with all states, transitions, variables, prompts, and a 3D model.

```typescript
// src/packages/server/data/builtin-skills/workflow-designer.ts

export const workflowDesignerSkill: BuiltinSkillDefinition = {
  slug: 'workflow-designer',
  name: 'Workflow Designer',
  description: 'Create, edit, and manage workflow definitions and their 3D models in the work area',
  allowedTools: ['Bash(curl:*)'],
  content: `# Workflow Designer

You can create and manage workflow definitions. Workflows are state machines that automate
multi-step processes by coordinating agents, triggers, and integrations.

## Understanding Workflows

A workflow definition has:
- **States**: Named steps in the process (e.g. "Intake", "Generate Document", "Awaiting Approval")
- **Transitions**: Connections between states with conditions (e.g. "agent_complete" → next state)
- **Variables**: Data that persists across states (e.g. release_name, requester_email)
- **Actions**: What happens in each state (agent_task, wait, decision, trigger_setup, end)

## Explore Existing Workflows

\\\`\\\`\\\`bash
curl -s "{{BASE_URL}}/api/workflows" -H "X-Auth-Token: {{AUTH_TOKEN}}" | jq '.[] | {id, name, states: [.states[].name]}'
\\\`\\\`\\\`

## Create a Workflow Definition

\\\`\\\`\\\`bash
curl -s -X POST "{{BASE_URL}}/api/workflows" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d @- <<'EOF'
{
  "name": "Workflow Name",
  "description": "What this workflow automates",
  "position": { "x": 5, "z": -3 },
  "style": "flowchart",
  "color": "#4a9eff",
  "scale": 1.0,
  "variables": [
    { "name": "requester_name", "type": "string", "description": "Person who initiated the process" },
    { "name": "status", "type": "string", "description": "Current process status" }
  ],
  "states": [
    {
      "id": "intake",
      "name": "Intake",
      "type": "agent_task",
      "agentId": "AGENT_ID_HERE",
      "skills": ["slack-messaging"],
      "promptTemplate": "A new request has arrived: {{trigger.slack.message}}\\nFrom: {{trigger.slack.user}}\\n\\nAsk clarifying questions via Slack and collect all required information.\\nUpdate workflow variables when done.",
      "transitions": [
        { "event": "agent_complete", "target": "next_state_id" }
      ]
    },
    {
      "id": "end",
      "name": "End",
      "type": "end"
    }
  ]
}
EOF
\\\`\\\`\\\`

## State Types

| Type | Purpose | Key Fields |
|---|---|---|
| \\\`agent_task\\\` | Agent executes a task with a prompt | agentId, skills, promptTemplate |
| \\\`decision\\\` | Agent makes a routing decision | agentId, promptTemplate, multiple transitions |
| \\\`wait\\\` | Pause until a trigger fires or timeout | trigger_setup config, timeout |
| \\\`trigger_setup\\\` | Create a dynamic trigger at runtime | trigger config to create |
| \\\`end\\\` | Terminal state, workflow completes | (none) |

## Transition Events

| Event | When It Fires |
|---|---|
| \\\`agent_complete\\\` | Agent finishes its task |
| \\\`trigger_fired\\\` | A trigger associated with this state fires |
| \\\`timeout\\\` | Wait state exceeds its timeout duration |
| \\\`condition\\\` | A variable condition evaluates to true |

## Update a Workflow

\\\`\\\`\\\`bash
curl -s -X PATCH "{{BASE_URL}}/api/workflows/WORKFLOW_ID" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "name": "Updated Name", "states": [...] }'
\\\`\\\`\\\`

## Delete a Workflow

\\\`\\\`\\\`bash
curl -s -X DELETE "{{BASE_URL}}/api/workflows/WORKFLOW_ID" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}"
\\\`\\\`\\\`

## Move a Workflow Model

\\\`\\\`\\\`bash
curl -s -X PATCH "{{BASE_URL}}/api/workflows/WORKFLOW_ID" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "position": { "x": 10, "z": -5 } }'
\\\`\\\`\\\`

## Start a Workflow Manually

\\\`\\\`\\\`bash
curl -s -X POST "{{BASE_URL}}/api/workflows/WORKFLOW_ID/start" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "variables": { "requester_name": "John", "release_name": "v2.1.0" } }'
\\\`\\\`\\\`

## Check Workflow Instances

\\\`\\\`\\\`bash
curl -s "{{BASE_URL}}/api/workflows/WORKFLOW_ID/instances" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" | jq '.[] | {id, status, currentState, startedAt}'
\\\`\\\`\\\`

## Available Styles for 3D Models

| Style | Appearance |
|---|---|
| \\\`flowchart\\\` | Connected nodes floating in a ring |
| \\\`circuit-board\\\` | PCB-style traces with glowing paths |
| \\\`constellation\\\` | Star map with connected points |
| \\\`helix\\\` | DNA-like double spiral |
| \\\`clockwork\\\` | Mechanical gears and cogs |

## Design Guidelines

1. **State naming**: Use descriptive, action-oriented names ("Collect Requirements", "Generate Report", not "State 1")
2. **Prompts**: Be specific in promptTemplates — tell the agent exactly what information to collect, what APIs to call, and what variables to set
3. **Variables**: Define ALL variables upfront in the variables array. Agents reference them via {{variable_name}} in prompts
4. **Skills**: Assign only the skills each state needs. Common ones: slack-messaging, email-gmail, jira-service-desk, document-generator, google-calendar
5. **Error handling**: Add timeout transitions on wait states. Consider adding error/escalation states for critical processes
6. **Position**: Place workflow models near related buildings/agents in the work area for visual organization
`,
};
```

**Key parallel with `create-building` skill:**

| Aspect | Building Skill | Workflow Designer Skill |
|---|---|---|
| Persistence | `~/.local/share/tide-commander/buildings.json` (via jq) | `POST /api/workflows` REST endpoint |
| 3D model | `BuildingManager` adds mesh to scene | `WorkflowModelManager` adds mesh to scene |
| Detail view | `BuildingConfigModal` on double-click | Workflow Detail View on double-click |
| Agent creates | Agent uses jq to modify JSON, client auto-syncs | Agent calls REST API, server broadcasts WS update |
| Visual styles | 10 building styles | 5 workflow styles |
| Status | PM2/Docker runtime status | Aggregated from active instances |

**Why REST API instead of jq for workflows:** Buildings use direct JSON file manipulation because their config is simple and the pattern existed before the server had CRUD APIs for buildings. Workflows should use proper REST endpoints from the start — the definition includes states, transitions, and variable schemas that benefit from server-side validation. The server can also immediately broadcast the change to all clients and update the 3D scene.

### How It Connects to Triggers

The workflow engine hooks into the trigger system bidirectionally:

1. **Triggers can start workflows** — A trigger's `agentId` can point to a special "workflow starter" that calls `workflowService.startWorkflow()` instead of sending a command to an agent.

2. **Workflows can create triggers** — The `trigger_setup` action type creates dynamic triggers at runtime. For example, when the CC email is sent, the workflow creates an email trigger watching that specific thread for approvals.

3. **Triggers can advance workflows** — When a trigger fires and it belongs to an active workflow instance, the trigger service calls `workflowService.notifyEvent()` to advance the state machine.

### How Workflow Context Propagates (SQLite Correlation)

A critical architectural detail: every API call made within a workflow context must carry the `workflowInstanceId` so that the event gets logged with the correct correlation. This is how:

1. **Workflow engine sends task to agent** — the interpolated prompt includes `{{workflow.instanceId}}` so the agent knows which workflow it's serving.

2. **Agent calls integration APIs** — when the agent calls `POST /api/slack/send`, `POST /api/email/send`, etc., it passes `workflowInstanceId` in the request body (the skill instructions tell agents to do this).

3. **Each integration service logs the event** — with the `workflowInstanceId` from the request, creating the correlation in SQLite.

4. **The workflow timeline view** — queries all event tables filtering by `workflow_instance_id`, then merges and sorts chronologically.

The `workflowInstanceId` field is optional on all API endpoints — when agents are used outside workflows, events are still logged but without workflow correlation.

### How It Connects to Agents

When a workflow enters a state with `type: 'agent_task'`:

1. The workflow engine interpolates `promptTemplate` with current workflow variables
2. It sends the interpolated prompt to the configured agent via `POST /api/agents/:id/message`
3. The prompt includes context about the workflow (instance ID, current state, available variables)
4. When the agent completes (detected via agent status change to `idle`), the engine evaluates transitions with `type: 'agent_complete'`
5. The agent can update workflow variables by calling a new endpoint: `POST /api/workflows/instances/:id/variables`

---

## CC Workflow: Configuration Example

This is how the CC process would be configured as a workflow. This is NOT code — it's the configuration a user would create through the UI.

### Workflow: "Control de Cambios"

**Variables:**

| Name | Type | Description |
|---|---|---|
| `requester_name` | string | Developer requesting the release |
| `requester_email` | string | Requester's email |
| `requester_slack_id` | string | Requester's Slack user ID |
| `release_name` | string | Release version/name |
| `release_description` | string | What's being released |
| `affected_systems` | string | Systems impacted |
| `release_date` | date | Scheduled release date |
| `release_time` | string | Scheduled release time |
| `is_urgent` | boolean | Whether this is an urgent release |
| `additional_attendees` | string | Other people to invite |
| `jira_ticket_key` | string | Jira ticket key (e.g. "SD-1234") |
| `jira_ticket_url` | string | Full Jira ticket URL |
| `cc_file_path` | string | Path to generated CC document |
| `email_thread_id` | string | Gmail thread ID for approval chain |
| `calendar_event_id` | string | Google Calendar event ID |
| `approval_status` | json | Current approval status |

**States:**

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Intake     │────►│  Create Jira │────►│  Generate    │────►│  Validate Date  │
│  (Slack Q&A) │     │   Ticket     │     │  Document    │     │  & Classify     │
└─────────────┘     └──────────────┘     └──────────────┘     └─────────────────┘
                                                                         │
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐     ┌───────────────┐
│  Approved   │◄────│  Awaiting    │◄────│   Send for      │◄────│   Calendar    │
│  Notify     │     │  Approvals   │     │   Approval      │     │    Event      │
└─────────────┘     └──────────────┘     └─────────────────┘     └───────────────┘
      │
      ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐     ┌───────────────┐
│  Release    │────►│  Dev Ready   │────►│  Release        │────►│     End       │
│  Reminder   │     │  Confirm     │     │  Started        │     │               │
└─────────────┘     └──────────────┘     └─────────────────┘     └───────────────┘
```

**State 1: Intake**
- Type: `agent_task`
- Agent: CC Operator agent
- Skills: `slack-messaging`
- Prompt:
  ```
  A developer has requested a new CC (Control de Cambios). Here is their message:

  {{trigger.slack.message}}
  From: {{trigger.slack.user}} (Slack ID: {{trigger.slack.userId}})

  You need to ask them the following questions via Slack (in channel {{trigger.slack.channel}}, thread {{trigger.slack.threadTs}}):
  1. Release name/version
  2. Brief description of what is being released
  3. Which systems are affected
  4. Desired release date and time
  5. Is this an urgent release? (less than 2 working days)
  6. Who else should be invited to the release event? (email addresses)

  Use the slack wait-for-reply endpoint to get their answers.
  Once you have all answers, update the workflow variables by calling:
  POST /api/workflows/instances/{{workflow.instanceId}}/variables

  Set: requester_name, requester_email, requester_slack_id, release_name,
       release_description, affected_systems, release_date, release_time,
       is_urgent, additional_attendees
  ```
- Transition: `agent_complete` → State 2

**State 2: Create Jira Ticket**
- Type: `agent_task`
- Agent: CC Operator agent
- Skills: `jira-service-desk`
- Prompt:
  ```
  Create a Jira Service Desk ticket for this CC:
  - Project: {{config.jira_default_project}} (or "SD" if not set)
  - Issue Type: Change Request
  - Summary: "CC - {{release_name}} - {{release_date}}"
  - Description: Include all CC details:
    Requester: {{requester_name}} ({{requester_email}})
    Release: {{release_name}}
    Date/Time: {{release_date}} {{release_time}}
    Type: {{#is_urgent}}Urgent{{/is_urgent}}{{^is_urgent}}Normal{{/is_urgent}}
    Systems affected: {{affected_systems}}
    Description: {{release_description}}
  - Labels: ["cc", "release"]
  - Priority: {{#is_urgent}}High{{/is_urgent}}{{^is_urgent}}Medium{{/is_urgent}}

  Save the returned ticket key to workflow variable `jira_ticket_key`.
  Save the Jira issue URL to workflow variable `jira_ticket_url`.
  Notify the requester via Slack: "Jira ticket {{jira_ticket_key}} created for your CC request."
  ```
- Transition: `agent_complete` → State 3

**State 3: Generate Document**
- Type: `agent_task`
- Agent: CC Operator agent
- Skills: `document-generator`
- Prompt:
  ```
  Generate the CC document using template "CC Template" with these variables:
  - jira_ticket: {{jira_ticket_key}}
  - release_name: {{release_name}}
  - release_date: {{release_date}}
  - release_time: {{release_time}}
  - release_type: {{#is_urgent}}Urgente{{/is_urgent}}{{^is_urgent}}Normal{{/is_urgent}}
  - requester_name: {{requester_name}}
  - description: {{release_description}}
  - affected_systems: {{affected_systems}}

  Save the returned file path to workflow variable `cc_file_path`.
  ```
- Transition: `agent_complete` → State 4

**State 4: Validate Date & Classify**
- Type: `decision`
- Agent: CC Operator agent
- Prompt:
  ```
  Validate the release date {{release_date}} {{release_time}}.
  A normal release requires at least 2 working days from now.
  If the date is less than 2 working days away and is_urgent is not set, warn the requester via Slack
  and ask if they want to proceed as urgent.
  Update is_urgent variable if needed.
  ```
- Transitions:
  - `agent_complete` → State 5

**State 5: Calendar Event**
- Type: `agent_task`
- Agent: CC Operator agent
- Skills: `google-calendar`
- Prompt:
  ```
  Create a Google Calendar event:
  - Title: "Release {{release_name}} ({{jira_ticket_key}})"
  - Date/Time: {{release_date}} {{release_time}} (1 hour duration)
  - Attendees: {{requester_email}}, {{additional_attendees}}
  - Description: "CC Release - {{release_description}}\nJira: {{jira_ticket_url}}"

  Save the event ID to workflow variable `calendar_event_id`.
  ```
- Transition: `agent_complete` → State 6

**State 6: Send for Approval**
- Type: `agent_task`
- Agent: CC Operator agent
- Skills: `email-gmail`
- Prompt:
  ```
  Send the CC email for approval:
  - To: [list of client approver emails from config]
  - Subject: "Control de Cambios - {{jira_ticket_key}} - {{release_name}} - {{release_date}}"
  - Body: Use the standard CC email template with release details. Include the Jira ticket
    reference: {{jira_ticket_key}} ({{jira_ticket_url}})
  - Attachment: {{cc_file_path}}

  Save the returned threadId to workflow variable `email_thread_id`.
  ```
- Transition: `agent_complete` → State 7

**State 7: Awaiting Approvals**
- Type: `wait`
- Action: `trigger_setup` — creates an email trigger watching `{{email_thread_id}}` for 3 approvals from the approver list
- Transitions:
  - `trigger_fired` (approval trigger) → State 8
  - `timeout` (48h) → Error/escalation state

**State 8: Approved — Notify**
- Type: `agent_task`
- Agent: CC Operator agent
- Skills: `slack-messaging`, `jira-service-desk`
- Prompt:
  ```
  The CC for {{release_name}} ({{jira_ticket_key}}) has been approved.
  Approvals received from: {{approval_status}}.
  1. Send a message to the team Slack channel announcing green light for the release on {{release_date}} at {{release_time}}.
  2. Add a comment to Jira ticket {{jira_ticket_key}}: "CC approved. Approvals: {{approval_status}}"
  3. Transition the Jira ticket to "Approved" status (list transitions first to find the right one).
  ```
- Transition: `agent_complete` → State 9

**State 9: Release Reminder (T-10min)**
- Type: `wait`
- Action: `trigger_setup` — creates a cron trigger for 10 minutes before `{{release_date}} {{release_time}}`
- Transitions:
  - `trigger_fired` (cron trigger) → State 10

**State 10: Dev Ready Confirmation**
- Type: `agent_task`
- Agent: CC Operator agent
- Skills: `slack-messaging`
- Prompt:
  ```
  It is 10 minutes before the release of {{release_name}} ({{jira_ticket_key}}).
  Send a Slack reminder to the team channel and ask {{requester_name}} to confirm they are ready.
  Wait for their confirmation reply.
  ```
- Transitions:
  - `agent_complete` (dev confirmed ready) → State 11

**State 11: Release Started**
- Type: `agent_task`
- Agent: CC Operator agent
- Skills: `email-gmail`, `slack-messaging`, `jira-service-desk`
- Prompt:
  ```
  The developer has confirmed ready.
  1. Send an email replying in the approval thread ({{email_thread_id}})
     stating that the release of {{release_name}} is starting now.
  2. Send a Slack message confirming the release has started.
  3. Add a comment to Jira ticket {{jira_ticket_key}}: "Release started."
  4. Transition the Jira ticket to "In Progress" or "Done" status as appropriate.
  ```
- Transition: `agent_complete` → State 12

**State 12: End**
- Type: `end`

---

## Implementation Order & Dependencies

```
Phase 0: SQLite Event Store ───────────────────────────────────────────────────┐
   No dependencies. Must be built FIRST.                                        │
   All other phases depend on it for event logging.                             │
                                                                                │
Plugin Architecture ───────────────────────────────────────────────────┐       │
   Depends on Phase 0 (IntegrationContext includes eventDb).            │       │
   Must exist before any integration is built.                          │       │
                                                                         │       │
Phase 1: Triggers ─────────────────────────────────────────────┐        │       │
   Depends on Phase 0 (logs trigger fires to SQLite).           │        │       │
   Depends on Plugin Arch (TriggerHandler interface).           │        │       │
   Foundation for all integrations.                             │        │       │
                                                                 │        │       │
Phase 2: Slack Plugin ─────────────────────────────────┐        │        │       │
   Depends on Phase 0, Plugin Arch, Phase 1.            │        │        │       │
   Self-contained in integrations/slack/.               │        │        │       │
                                                        │        │        │       │
Phase 3: Gmail Plugin ────────────────────────────┐    │        │        │       │
   Depends on Phase 0, Plugin Arch, Phase 1.       │    │        │        │       │
   Self-contained in integrations/gmail/.          │    │        │        │       │
                                                    │    │        │        │       │
Phase 4: DOCX Plugin ───────────────────────┐     │    │        │        │       │
   Depends on Phase 0, Plugin Arch.          │     │    │        │        │       │
   No triggers. Self-contained in            │     │    │        │        │       │
   integrations/docx/.                       │     │    │        │        │       │
                                             │     │    │        │        │       │
Phase 5: Calendar Plugin ──────────────┐    │     │    │        │        │       │
   Depends on Phase 0, Plugin Arch.     │    │     │    │        │        │       │
   Shares OAuth with Phase 3.          │    │     │    │        │        │       │
   Self-contained in                   │    │     │    │        │        │       │
   integrations/google-calendar/.      │    │     │    │        │        │       │
                                       │    │     │    │        │        │       │
Phase 5b: Jira Plugin ───────────┐    │    │     │    │        │        │       │
   Depends on Phase 0, Plugin     │    │    │     │    │        │        │       │
   Arch, Phase 1 (webhooks).     │    │    │     │    │        │        │       │
   No OAuth, uses API tokens.    │    │    │     │    │        │        │       │
   Self-contained in              │    │    │     │    │        │        │       │
   integrations/jira/.           │    │    │     │    │        │        │       │
                                  │    │    │     │    │        │        │       │
Phase 6: Workflow Engine ◄────────┴────┴────┴─────┴────┴────────┴────────┴───────┘
   Depends on ALL phases.
   Instance state lives in SQLite (Phase 0).
   Orchestrates integrations via their plugin APIs.
   Step log, variable history, reasoning trace — all in SQLite.
```

### Suggested Sprint Plan

**Sprint 1** (Foundation):
- Phase 0: SQLite event store (schema, migrations, event-db.ts, event-queries.ts, event-routes.ts, retention service)
- Integration plugin architecture (IntegrationPlugin interface, IntegrationContext, TriggerHandler, ConfigField, integration-registry.ts)
- Phase 1: Trigger system (types, service, routes, WS, basic UI — with generic TriggerHandler dispatch and SQLite logging)

**Sprint 2** (First Integrations):
- Phase 4: DOCX integration plugin (quick win to validate the plugin architecture end-to-end)
- Phase 2: Slack integration plugin (client, routes, skill, trigger handler — all as self-contained plugin)
- Phase 5b: Jira integration plugin (simple REST-only plugin — no OAuth, good second validation of the plugin arch)
- Client: generic IntegrationsPanel with schema-driven config forms

**Sprint 3** (Google Integrations):
- Phase 3: Gmail integration plugin (OAuth, client, routes, skill, trigger handler)
- Phase 5: Google Calendar integration plugin (shares OAuth with Gmail)
- Client: Gmail OAuth custom settings component

**Sprint 4** (Workflow + Polish):
- Phase 6: Workflow engine (state machine logic — instances, steps, variables, reasoning all in SQLite)
- Phase 6 completion: Workflow UI (visual editor, instance dashboard with timeline/steps/reasoning views)
- Event/audit log viewer UI
- CC workflow configuration: Create the actual CC workflow using the UI
- End-to-end testing of the full CC process

---

## New Dependencies Summary

| Package | Phase | Purpose |
|---|---|---|
| `better-sqlite3` | 0 | Synchronous SQLite3 bindings |
| `@types/better-sqlite3` | 0 | TypeScript types for better-sqlite3 |
| `croner` or `node-cron` | 1 | Cron expression parsing & scheduling |
| `@slack/web-api` | 2 | Slack Web API client |
| `@slack/socket-mode` | 2 | Slack Socket Mode (no public URL needed) |
| `googleapis` | 3, 5 | Gmail API + Google Calendar API |
| `docxtemplater` | 4 | DOCX template processing |
| `pizzip` | 4 | ZIP handling for DOCX |
| _(none — raw fetch)_ | 5b | Jira REST API v3 (no extra client library needed) |

---

## File Index (All New Files)

### Shared Types
- `src/packages/shared/trigger-types.ts`
- `src/packages/shared/workflow-types.ts`
- `src/packages/shared/integration-types.ts` — IntegrationPlugin, IntegrationContext, TriggerHandler, ConfigField interfaces
- `src/packages/shared/event-types.ts` — All SQLite row types shared between server and client

### Server — Core Infrastructure

#### SQLite Event Store (Phase 0)
- `src/packages/server/data/event-db.ts` — SQLite connection, WAL mode, migration runner
- `src/packages/server/data/event-queries.ts` — All domain-specific query functions
- `src/packages/server/data/migrations/001_initial_schema.sql` — Initial SQLite schema

#### Trigger System (Phase 1)
- `src/packages/server/data/trigger-store.ts` — JSON store for trigger configs
- `src/packages/server/services/trigger-service.ts` — Trigger CRUD + generic handler dispatch + LLM match orchestration
- `src/packages/server/services/llm-matcher-service.ts` — LLM-powered semantic matching and variable extraction
- `src/packages/server/services/cron-service.ts` — Cron expression scheduling
- `src/packages/server/routes/trigger-routes.ts` — REST API for triggers + webhook ingestion + test-match endpoint
- `src/packages/server/websocket/handlers/trigger-handler.ts`

#### Workflow Engine (Phase 6)
- `src/packages/server/data/workflow-store.ts` — JSON store for workflow definitions (instances in SQLite)
- `src/packages/server/services/workflow-service.ts` — State machine orchestration
- `src/packages/server/routes/workflow-routes.ts` — REST API for definitions, instances, history
- `src/packages/server/websocket/handlers/workflow-handler.ts`
- `src/packages/server/data/builtin-skills/workflow-designer.ts` — Built-in skill for agent-driven workflow creation
- `src/packages/server/services/workflow-chat-service.ts` — Context retrieval and LLM chat for workflow exploration

#### Other Core
- `src/packages/server/services/event-retention-service.ts` — Daily cleanup of old events
- `src/packages/server/routes/event-routes.ts` — Read-only query endpoints for all event types
- `src/packages/server/routes/integration-routes.ts` — Integration management (list, status, config)

### Server — Integration Plugin System
- `src/packages/server/integrations/integration-types.ts` — Interfaces
- `src/packages/server/integrations/integration-registry.ts` — Load, init, wire all plugins

### Server — Slack Integration (`src/packages/server/integrations/slack/`)
- `slack/index.ts` — Exports `slackPlugin: IntegrationPlugin`
- `slack/slack-client.ts` — Slack Web API + Socket Mode wrapper
- `slack/slack-routes.ts` — Express Router mounted at `/api/slack/`
- `slack/slack-trigger-handler.ts` — TriggerHandler for `'slack'` type
- `slack/slack-skill.ts` — BuiltinSkillDefinition with curl instructions
- `slack/slack-events.ts` — SQLite event logging helpers
- `slack/slack-config.ts` — ConfigField[] schema + defaults

### Server — Gmail Integration (`src/packages/server/integrations/gmail/`)
- `gmail/index.ts` — Exports `gmailPlugin: IntegrationPlugin`
- `gmail/gmail-client.ts` — Gmail API wrapper (OAuth2, send, read, poll)
- `gmail/gmail-routes.ts` — Express Router mounted at `/api/email/`
- `gmail/gmail-trigger-handler.ts` — TriggerHandler for `'email'` type
- `gmail/gmail-skill.ts` — BuiltinSkillDefinition
- `gmail/gmail-events.ts` — SQLite event logging helpers
- `gmail/gmail-config.ts` — ConfigField[] schema + OAuth config

### Server — Google Calendar Integration (`src/packages/server/integrations/google-calendar/`)
- `google-calendar/index.ts` — Exports `googleCalendarPlugin: IntegrationPlugin`
- `google-calendar/calendar-client.ts` — Google Calendar API wrapper
- `google-calendar/calendar-routes.ts` — Express Router mounted at `/api/calendar/`
- `google-calendar/calendar-skill.ts` — BuiltinSkillDefinition
- `google-calendar/calendar-events.ts` — SQLite event logging helpers
- `google-calendar/calendar-config.ts` — ConfigField[] schema
- _(No trigger handler — calendar doesn't provide triggers)_

### Server — DOCX Integration (`src/packages/server/integrations/docx/`)
- `docx/index.ts` — Exports `docxPlugin: IntegrationPlugin`
- `docx/docx-engine.ts` — docxtemplater wrapper
- `docx/docx-routes.ts` — Express Router mounted at `/api/documents/`
- `docx/docx-skill.ts` — BuiltinSkillDefinition
- `docx/docx-events.ts` — SQLite event logging helpers
- `docx/docx-config.ts` — ConfigField[] schema (template directory, etc.)
- _(No trigger handler — docx doesn't provide triggers)_

### Server — Jira Integration (`src/packages/server/integrations/jira/`)
- `jira/index.ts` — Exports `jiraPlugin: IntegrationPlugin`
- `jira/jira-client.ts` — Jira REST API v3 / Service Desk API wrapper
- `jira/jira-routes.ts` — Express Router mounted at `/api/jira/`
- `jira/jira-trigger-handler.ts` — TriggerHandler for `'jira'` type (webhook-based)
- `jira/jira-skill.ts` — BuiltinSkillDefinition with curl instructions
- `jira/jira-events.ts` — SQLite event logging helpers
- `jira/jira-config.ts` — ConfigField[] schema (base URL, API token, project key, etc.)

### Client — Workflow 3D Scene
- `src/packages/client/scene/workflows/WorkflowModelManager.ts` — 3D mesh lifecycle for workflow models (analogous to `BuildingManager`)
- `src/packages/client/scene/workflows/WorkflowMeshFactory.ts` — Creates styled 3D meshes per `WorkflowStyle`
- `src/packages/client/store/workflows.ts` — Zustand store for workflow definitions, instances, and 3D scene state

### Client Components (high level — detailed in implementation)
- **Integrations panel** — generic list of all integrations with status, schema-driven config forms
- **Gmail OAuth setup** — custom component for OAuth redirect flow (only non-generic UI)
- Trigger manager panel (with fire history from SQLite, LLM match testing UI)
- **Workflow Detail View** — 3-level drill-down: definition + executions list → execution detail (timeline, steps, variables) → step trace (reasoning, side effects)
- Workflow definition editor (state machine designer, opened from Workflow Detail View)
- Event/audit log viewer (cross-cutting, reads from SQLite)
- Stats dashboard (aggregate counts from SQLite)

---

## Implementation Status & Improvements (v1.30.0)

### Skill-Oriented Architecture for Agent Usability

The core philosophy is: **agents should never need to read source code to use a feature**. Instead, we provide **markdown-based skills** that document exactly how to use integrations and tools.

Every agent receives skills in their system prompt at startup. Skills contain:
- **Clear instructions** — step-by-step markdown guide
- **Curl examples** — ready-to-use API calls with proper auth header injection
- **Design guidance** — best practices and patterns
- **Template variables** — what data is available in which context

#### Built-in Skills Catalog

**Core Skills** (shipped with Tide Commander):
- `boss-instructions` — How to delegate tasks and manage agent teams
- `workflow-designer` — Create, edit, and manage workflow state machines
- `trigger-designer` — Create and manage event-driven triggers ✅ NEW
- `git-captain` — Git workflow automation (commit, push, branching)
- `streaming-exec` — Execute long-running commands with real-time output
- Plus 8 more core skills (task-label, report-task-to-boss, server-logs, etc.)

**Integration Skills** (auto-loaded from plugins, now visible in UI):
- `slack-messaging` — Send/receive messages, list channels, resolve users
- `gmail-email` — Send emails, read messages, check approvals
- `google-calendar` — Create/update events, calculate working days
- `document-generator` — List templates, generate docs, convert to PDF
- `jira-service-desk` — Create/update/transition tickets, search issues

All skills are discoverable in the skills management panel and automatically injected into agents when they spawn.

### Phase 0: SQLite Event Store ✅ COMPLETE

**Status:** Fully implemented and stable

- Database: `~/.local/share/tide-commander/events.db` (better-sqlite3)
- Schema: 11 tables tracking trigger fires, Slack messages, emails, approvals, documents, workflows, audit logs
- Queries: `src/packages/server/data/event-queries.ts` — 1,285 lines of pre-built query functions
- API: Exposed via `/api/events/` endpoints for log viewers and audit trails

All 8 phases use the event store for logging and audit purposes.

### Phase 1: Trigger System ✅ COMPLETE

**Status:** Fully implemented with UI integration

- **Core:** `src/packages/server/services/trigger-service.ts` — 833 lines, full CRUD, state machine
- **Types:** Webhook, cron, slack, email, jira, manual
- **Matching:** Structural, LLM, hybrid modes with extraction templates
- **Rate Limiting:** 10 fires/min default, configurable per trigger
- **UI Integration:** `TriggerManagerPanel` now wired into Toolbox
  - Users can access "Trigger Manager" button from Toolbox > Triggers section
  - CRUD operations, test matching, fire history all available in UI
  - No code reading required—full feature access via UI

**Files:**
- `src/packages/client/components/TriggerManagerPanel.tsx` — 400+ lines of full-featured trigger UI
- `src/packages/client/components/AppModals.tsx` — TriggerManagerPanel imported and rendered
- `src/packages/client/components/toolbox/*` — Wiring (Toolbox.tsx, ConfigSection.tsx, types.ts)
- `src/packages/client/App.tsx` — Modal state management and registration

### Phases 2-5b: Integration Plugins ✅ COMPLETE

**Status:** All 5 integrations (Slack, Gmail, Google Calendar, DOCX, Jira) fully implemented with skill documentation

- Each integration is a self-contained plugin
- Each provides a **built-in skill** with comprehensive curl-based API documentation
- Integration skills are **now visible and discoverable** in the skill management UI
- No agent needs to read code—skills teach them how to use each integration

**Integration Skills Loading:**
- Modified `src/packages/server/services/skill-service.ts` to load integration skills from registry
- Integration skills now appear in `/api/skills` endpoint
- Skills are included in agent system prompts at startup

### Phase 6: Workflow Engine ✅ COMPLETE

**Status:** Fully implemented with 3D visualization

- State machine execution, persistence, variable management
- Workflow 3D models render in 3D scene
- WorkflowEditorPanel wired into UI for creation and editing
- Full event logging to SQLite

### New Feature: Trigger Designer Skill

**Added in v1.30.0:**

A new built-in skill (`trigger-designer`) that teaches agents how to create and manage triggers without reading code.

**File:** `src/packages/server/data/builtin-skills/trigger-designer.ts` — 350+ lines

**Includes:**
- Comprehensive guide to all trigger types (webhook, cron, slack, email, jira, manual)
- Curl examples for creating triggers with all matching modes
- Common cron expressions and their meanings
- Pattern matching and testing endpoints
- Template variable reference
- Rate limiting guidance
- Webhook security best practices

**Design Guidelines:**
- Names should be action-oriented ("Daily Report Generator", "P1 Incident Responder")
- Prompts should be specific and use available template variables
- Start with structural matching for simple patterns, use LLM for complex semantic matching
- Implement proper rate limiting to prevent loops
- Always test pattern matching before enabling triggers

### Implementation Approach: Skills Over Code Reading

**Philosophy:** Agents are knowledge workers, not code readers.

Every feature (triggers, integrations, workflows) comes with:
1. **A skill** — markdown instructions injected into agent system prompt
2. **A UI** — users can access and configure the feature without code
3. **REST API** — agents call endpoints via curl commands
4. **Auto-injected auth** — skill-service adds X-Auth-Token header automatically

This means:
- New agents immediately know how to use triggers, integrations, and workflows
- No documentation to maintain separately from the code
- Skills are version-controlled and tested alongside implementation
- Easy to add new integrations—just implement the plugin interface + write a skill

### Phase Completion Summary

| Phase | Status | Key Files | Skills |
|-------|--------|-----------|--------|
| Phase 0 | ✅ | event-db.ts, event-queries.ts | N/A (infrastructure) |
| Phase 1 | ✅ | trigger-service.ts, TriggerManagerPanel.tsx | `trigger-designer` |
| Phase 2 | ✅ | slack/ plugin, slack-routes.ts | `slack-messaging` |
| Phase 3 | ✅ | gmail/ plugin, gmail-routes.ts | `gmail-email` |
| Phase 4 | ✅ | docx/ plugin, docx-engine.ts | `document-generator` |
| Phase 5 | ✅ | google-calendar/ plugin, calendar-routes.ts | `google-calendar` |
| Phase 5b | ✅ | jira/ plugin, jira-routes.ts | `jira-service-desk` |
| Phase 6 | ✅ | workflow-service.ts, WorkflowEditorPanel.tsx | `workflow-designer` |

All phases are production-ready and integrated with the skill-oriented architecture.
