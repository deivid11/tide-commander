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

export type TriggerType = 'webhook' | 'email' | 'slack' | 'jira' | 'cron';
export type TriggerStatus = 'enabled' | 'disabled' | 'error';
export type MatchMode = 'structural' | 'llm' | 'hybrid';
export type ExtractionMode = 'structural' | 'llm';

// ─── Base Trigger ───

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
    messagePattern?: string;          // Regex to match message content
    threadTs?: string;                // Watch replies in a specific thread
  };
}

export interface JiraTrigger extends BaseTrigger {
  type: 'jira';
  config: {
    projectKey?: string;              // Only trigger for issues in this project
    events?: string[];                // Jira webhook events to match
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

// ─── Trigger Fire Options ───

export interface TriggerFireOptions {
  rawPayload?: unknown;
  llmMatchResult?: LLMMatchResult;
  llmExtractResult?: LLMExtractResult;
  workflowInstanceId?: string;
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
}
