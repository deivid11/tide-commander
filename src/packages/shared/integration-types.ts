// ============================================================================
// Integration Plugin Architecture Types
// ============================================================================
// Shared types for the integration plugin system. Server-only interfaces
// (IntegrationPlugin, IntegrationContext) live here so both server and client
// can reference the data-shape types (ConfigField, ExternalEvent, etc.).

// ─── Integration Status ───

export interface IntegrationStatus {
  connected: boolean;
  lastChecked: number;
  error?: string;
}

// ─── External Events ───

export interface ExternalEvent {
  source: string;              // e.g. 'slack', 'email', 'jira'
  type: string;                // e.g. 'message', 'new_email', 'approval', 'issue_created'
  data: unknown;               // Raw event data (Slack event, email message, etc.)
  timestamp: number;
}

// ─── Config Field Schema (Generic Settings UI) ───

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

// ─── Trigger Handler ───

/** Minimal trigger definition for integration trigger handlers.
 *  The full Trigger union types are defined in the trigger system. */
export interface TriggerDefinition {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  matchMode: string;
  extractionMode?: string;
  enabled: boolean;
}

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
  structuralMatch(trigger: TriggerDefinition, event: ExternalEvent): boolean;

  /** Extract interpolation variables from an event using field-based logic.
   *  Only called when extractionMode is 'structural' (the default). */
  extractVariables(trigger: TriggerDefinition, event: ExternalEvent): Record<string, string>;

  /** Serialize the event payload into a human-readable string for the LLM.
   *  Called when matchMode is 'llm' or 'hybrid', and when extractionMode is 'llm'.
   *  Each integration knows how to format its events best. */
  formatEventForLLM(event: ExternalEvent): string;
}

// ─── Integration Context (Dependency Injection) ───

export interface IntegrationContext {
  /** Log events to SQLite */
  eventDb: {
    logTriggerFire: (...args: unknown[]) => unknown;
    logSlackMessage: (...args: unknown[]) => unknown;
    logEmailMessage: (...args: unknown[]) => unknown;
    logApprovalEvent: (...args: unknown[]) => unknown;
    logDocumentGeneration: (...args: unknown[]) => unknown;
    logCalendarAction: (...args: unknown[]) => unknown;
    logJiraTicketAction: (...args: unknown[]) => unknown;
    logAudit: (...args: unknown[]) => unknown;
  };

  /** Send a command/message to an agent */
  sendAgentMessage: (agentId: string, message: string) => Promise<void>;

  /** Broadcast a WS message to all connected clients */
  broadcast: (message: unknown) => void;

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

// ─── Integration Plugin ───

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
   *  Mounted at /api/{routePrefix}/ by the registry.
   *  Returns an Express Router (typed as unknown to avoid Express dep in shared). */
  getRoutes(): unknown;

  /** Built-in skills this integration provides to agents.
   *  Registered in the skill service automatically.
   *  Returns BuiltinSkillDefinition[] (typed as unknown[] to avoid server dep in shared). */
  getSkills(): unknown[];

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

// ─── API Response Types (for client consumption) ───

export interface IntegrationInfo {
  id: string;
  name: string;
  description: string;
  schema: ConfigField[];
  values: Record<string, unknown>;
  status: IntegrationStatus;
  customComponent?: string;
}
