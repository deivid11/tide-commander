/**
 * Trigger Types
 * All type definitions for the trigger system (Phase 1).
 *
 * Triggers fire a pre-configured agent with a pre-configured prompt
 * when an external event matches. Matching can be structural (field-based),
 * LLM-powered (semantic), or hybrid (structural pre-filter + LLM).
 */

import type { ExternalEvent, TriggerHandler, TriggerDefinition } from './integration-types.js';
export type { ExternalEvent, TriggerHandler, TriggerDefinition };

// ─── Trigger Enums ───

export type TriggerType = 'webhook' | 'email' | 'slack' | 'jira' | 'cron' | 'whatsapp' | 'bitbucket';
export type TriggerStatus = 'enabled' | 'disabled' | 'error';
export type MatchMode = 'structural' | 'llm' | 'hybrid';
export type ExtractionMode = 'structural' | 'llm';

// ─── Base Trigger ───

export interface BaseTrigger {
  id: string;
  name: string;
  description?: string;
  type: TriggerType;
  agentId: string;                    // Primary agent to fire (kept for back-compat)
  /**
   * Fan-out: additional agents that should ALSO receive this trigger's
   * message. The effective delivery set is the de-duplicated union of
   * `agentId` + `agentIds`, so every "subscribed" agent gets the event. When
   * omitted/empty, only `agentId` fires (legacy single-agent behavior).
   *
   * Per-agent dedup (see fireTrigger) guarantees the same physical source
   * message never hits the same agent twice — e.g. when two Slack instances
   * (personal + bot) both see a shared-channel message, or two overlapping
   * triggers target the same agent.
   */
  agentIds?: string[];
  promptTemplate: string;             // Message sent to agent, supports {{variable}} interpolation
  enabled: boolean;
  status: TriggerStatus;
  lastFiredAt?: number;
  lastError?: string;
  fireCount: number;
  createdAt: number;
  updatedAt: number;

  /**
   * Optional per-trigger override of the global rate limit (default 10/min).
   * Set to a high value (e.g. 120) for high-volume local sources like the
   * personal WhatsApp / Slack bridges where the global cap is too restrictive
   * for normal traffic. Set to 0 (or any value <= 0) to disable rate-limiting
   * entirely for this trigger. Omit / undefined → use the global default.
   */
  rateLimitPerMinute?: number;

  // ─── Matching Strategy ───

  matchMode: MatchMode;               // How to evaluate if an event matches this trigger

  llmMatch?: {                        // Required when matchMode is 'llm' or 'hybrid'
    prompt: string;                   // Natural language condition
    model?: string;                   // Model to use (default: 'haiku')
    temperature?: number;             // LLM temperature (default: 0)
    maxTokens?: number;               // Max response tokens (default: 150)
    minConfidence?: number;           // Minimum confidence to accept match (default: 0.0)
  };

  // ─── Variable Extraction Strategy ───

  extractionMode?: ExtractionMode;    // How to extract variables from matched events

  llmExtract?: {                      // Required when extractionMode is 'llm'
    prompt: string;                   // What to extract
    variables: string[];              // Expected variable names in output
    model?: string;                   // Model to use (default: same as llmMatch.model)
  };
}

// ─── Type-Specific Triggers ───

export interface WebhookTrigger extends BaseTrigger {
  type: 'webhook';
  config: {
    secret?: string;                  // Optional HMAC secret for payload validation
    method: 'POST' | 'PUT';          // Accepted HTTP method
    extractFields?: string[];         // JSON paths to extract from payload
  };
}

export interface EmailTrigger extends BaseTrigger {
  type: 'email';
  config: {
    fromFilter?: string[];            // Only trigger for emails from these addresses
    subjectPattern?: string;          // Regex to match subject line
    threadId?: string;                // Only watch a specific thread
    requiredApprovals?: {
      count: number;
      approvers: string[];
      approvalKeywords: string[];
    };
  };
}

export interface SlackTrigger extends BaseTrigger {
  type: 'slack';
  config: {
    channelId?: string;               // Watch specific channel (null = DMs to bot)
    userFilter?: string[];            // Only trigger for messages from these Slack user IDs
    excludeUserIds?: string[];        // Skip messages from these Slack user IDs (e.g., to ignore your own personal account on a shared workspace)
    messagePattern?: string;          // Regex to match message content
    threadTs?: string;                // Watch replies in a specific thread
    dmOnly?: boolean;                 // Only fire on 1:1 DMs (channel ID starts with 'D')
    excludeDms?: boolean;             // Skip 1:1 DMs (channel ID starts with 'D')
    includeOwnMessages?: boolean;     // Include outbound messages (sent by this instance's bot/user). Default: false.
  };
}

export interface JiraTrigger extends BaseTrigger {
  type: 'jira';
  config: {
    projectKey?: string;              // Only trigger for issues in this project
    events?: string[];                // Jira webhook events to match
    issueType?: string;               // Restrict to a single issue type (e.g. "Service Request")
    jqlFilter?: string;               // Optional JQL expression for fine-grained filtering
    secret?: string;                  // HMAC secret (Server/DC signed webhooks) or shared secret (Cloud ?secret= fallback). Required — unsigned deliveries are rejected.
  };
}

export interface CronTrigger extends BaseTrigger {
  type: 'cron';
  config: {
    expression: string;               // Cron expression (e.g. "0 9 * * MON-FRI"). Required when runOnce is false/undefined.
    timezone: string;                 // IANA timezone (e.g. "America/Mexico_City")
    payload?: Record<string, string>; // Static variables injected into promptTemplate
    runOnce?: boolean;                // If true, fire exactly once at runAt then auto-disable
    runAt?: string;                   // ISO 8601 absolute datetime (UTC). Required when runOnce is true.
    completedAt?: number;             // Epoch ms when the one-shot fired successfully
    missedAt?: number;                // Epoch ms when a one-shot was detected as missed on restart
  };
}

export interface WhatsAppTrigger extends BaseTrigger {
  type: 'whatsapp';
  config: {
    fromFilter?: string[];            // Substring match against sender JID (e.g. "5215512345678" or "@g.us")
    bodyPattern?: string;             // Case-insensitive regex against message body
    direction?: 'inbound' | 'outbound' | 'any'; // Default: 'any'
    groupOnly?: boolean;              // Only fire on group messages
    dmOnly?: boolean;                 // Only fire on 1:1 DMs
    sessionId?: string;               // Restrict to a specific Baileys session id
    includeStatuses?: boolean;        // If true, also fire for WhatsApp status (Story) updates and broadcast lists. Default false.
  };
}

export interface BitbucketTrigger extends BaseTrigger {
  type: 'bitbucket';
  config: {
    workspace: string;                // Bitbucket workspace slug (e.g. "tide")
    repoSlug: string;                 // Repository slug within the workspace (e.g. "wind")
    events: string[];                 // Bitbucket event keys (e.g. "pullrequest:created", "pullrequest:updated")
    secret?: string;                  // Optional HMAC secret used to validate webhook signature
  };
}

export type Trigger = WebhookTrigger | EmailTrigger | SlackTrigger | JiraTrigger | CronTrigger | WhatsAppTrigger | BitbucketTrigger;

// ─── LLM Match Results ───

export interface LLMMatchResult {
  match: boolean;
  reason: string;
  confidence: number;
  durationMs: number;
  model: string;
  tokensUsed: number;
}

export interface LLMExtractResult {
  variables: Record<string, string>;
  reason: string;
  durationMs: number;
  model: string;
  tokensUsed: number;
}

// ─── Matcher Execution (debugging) ───

export interface MatcherExecution {
  matcherType: 'structural' | 'llm' | 'extraction';
  matcherName: string;
  executedAt: number;
  matched: boolean;
  confidence?: number;
  reason?: string;
  resultJson?: unknown;
  sourceType?: string;
  sourceId?: string;
  sourceTimestamp?: number;
}

// ─── Trigger Fire Options ───

export interface TriggerFireOptions {
  rawPayload?: unknown;
  llmMatchResult?: LLMMatchResult;
  llmExtractResult?: LLMExtractResult;
  workflowInstanceId?: string;
  matcherExecutions?: MatcherExecution[];
  /**
   * Stable identity of the source event (e.g. Slack message ts, email id).
   * Used for per-agent delivery dedup so the same physical message — seen by
   * multiple integration instances or matched by overlapping triggers — never
   * reaches the same agent twice. Omit for sources without a stable id (cron,
   * manual fires): those skip dedup.
   */
  dedupeSourceType?: string;
  dedupeSourceId?: string;
}

// ─── Trigger Listener (pub-sub) ───

export type TriggerListenerEvent =
  | 'trigger_created'
  | 'trigger_updated'
  | 'trigger_deleted'
  | 'trigger_fired'
  | 'trigger_error';

export type TriggerListener = (event: TriggerListenerEvent, data: unknown) => void;

// ─── Trigger Event (SQLite row shape) ───

export interface TriggerFireRow {
  id?: number;
  trigger_id: string;
  trigger_name: string;
  trigger_type: string;
  agent_id: string | null;
  workflow_instance_id: string | null;
  fired_at: number;
  variables: string | null;        // JSON string
  payload: string | null;          // JSON string
  match_mode: string;
  llm_match_result: string | null; // JSON string
  llm_extract_result: string | null; // JSON string
  status: string;
  error: string | null;
  duration_ms: number | null;
}

// ─── Create/Update Payloads ───

export type CreateTriggerPayload = Omit<Trigger, 'id' | 'createdAt' | 'updatedAt' | 'fireCount' | 'status' | 'lastFiredAt' | 'lastError'>;
export type UpdateTriggerPayload = { id: string; updates: Partial<Trigger> };

// ─── Test Match Result ───

export interface TestMatchResult {
  structuralMatch?: boolean;
  llmMatch?: LLMMatchResult;
  extractedVariables: Record<string, string>;
  wouldFire: boolean;
  matcherExecutions?: MatcherExecution[];
}
