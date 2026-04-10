/**
 * Event Store Types
 * TypeScript interfaces for all event row types, shared between server and client.
 */

// ─── Enums / Unions ───

type TriggerType = 'webhook' | 'email' | 'slack' | 'jira' | 'cron';
type MatchMode = 'structural' | 'llm' | 'hybrid';
type TriggerEventStatus = 'fired' | 'delivered' | 'failed';
export type MessageDirection = 'inbound' | 'outbound';
export type CalendarAction = 'created' | 'updated' | 'deleted';
export type JiraAction = 'created' | 'updated' | 'transitioned' | 'commented';
type WorkflowInstanceStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
type WorkflowStepStatus = 'entered' | 'executing' | 'completed' | 'failed' | 'skipped';
export type AuditCategory = 'trigger' | 'slack' | 'email' | 'calendar' | 'document' | 'jira' | 'workflow' | 'system';
type AuditLevel = 'debug' | 'info' | 'warn' | 'error';

// ─── Trigger Events ───

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
  llmMatchResult?: {
    match: boolean;
    reason: string;
    confidence: number;
    model: string;
    tokensUsed: number;
    durationMs: number;
  };
  llmExtractResult?: {
    variables: Record<string, string>;
    reason: string;
    model: string;
    tokensUsed: number;
    durationMs: number;
  };
  status: TriggerEventStatus;
  error?: string;
  durationMs?: number;
}

// ─── Slack Messages ───

export interface SlackMessageEvent {
  id?: number;
  ts: string;
  threadTs?: string;
  channelId: string;
  channelName?: string;
  userId: string;
  userName: string;
  text: string;
  direction: MessageDirection;
  agentId?: string;
  workflowInstanceId?: string;
  rawEvent?: unknown;
  receivedAt: number;
}

// ─── Email Messages ───

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
  direction: MessageDirection;
  hasAttachments: boolean;
  attachmentNames?: string[];
  agentId?: string;
  workflowInstanceId?: string;
  gmailLabels?: string[];
  rawHeaders?: Record<string, string>;
  receivedAt: number;
}

// ─── Approval Events ───

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

// ─── Document Generations ───

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

// ─── Calendar Event Logs ───

export interface CalendarActionEvent {
  id?: number;
  eventId: string;
  action: CalendarAction;
  summary: string;
  startDatetime: string;
  endDatetime: string;
  attendees?: string[];
  htmlLink?: string;
  agentId?: string;
  workflowInstanceId?: string;
  recordedAt: number;
}

// ─── Jira Ticket Logs ───

export interface JiraTicketLogEvent {
  id?: number;
  ticketKey: string;
  ticketId: string;
  projectKey: string;
  action: JiraAction;
  summary: string;
  issueType?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  description?: string;
  fieldsChanged?: Record<string, { old?: string; new: string }>;
  commentBody?: string;
  selfUrl?: string;
  agentId?: string;
  workflowInstanceId?: string;
  recordedAt: number;
}

// ─── Workflow Instances ───

export interface WorkflowInstanceRow {
  id: string;
  workflowDefId: string;
  workflowName: string;
  status: WorkflowInstanceStatus;
  currentStateId: string;
  variables: Record<string, unknown>;
  activeTriggerIds: string[];
  activeTimers: string[];
  error?: string;
  agentId?: string;
  triggerId?: string;
  triggerData?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

// ─── Workflow Step Log ───

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
  agentSummary?: string;
  triggerId?: string;
  triggerPayload?: unknown;
  variablesBefore?: Record<string, unknown>;
  variablesAfter?: Record<string, unknown>;
  enteredAt: number;
  exitedAt?: number;
  durationMs?: number;
  status: WorkflowStepStatus;
  error?: string;
}

// ─── Workflow Variable Changes ───

export interface VariableChangeRow {
  id?: number;
  workflowInstanceId: string;
  stepLogId?: number;
  variableName: string;
  oldValue?: unknown;
  newValue: unknown;
  changedBy: string;
  changedAt: number;
}

// ─── Audit Log ───

export interface AuditLogEntry {
  id?: number;
  category: AuditCategory;
  action: string;
  agentId?: string;
  workflowInstanceId?: string;
  details?: unknown;
  level: AuditLevel;
  createdAt: number;
}

// ─── Timeline Entry (for workflow timeline endpoint) ───

export interface TimelineEntry {
  type: 'trigger' | 'slack' | 'email' | 'approval' | 'document' | 'calendar' | 'jira' | 'step' | 'variable_change' | 'audit';
  timestamp: number;
  data: TriggerFireEvent | SlackMessageEvent | EmailMessageEvent | ApprovalEvent |
        DocumentGenerationEvent | CalendarActionEvent | JiraTicketLogEvent |
        WorkflowStepLogRow | VariableChangeRow | AuditLogEntry;
}

// ─── Stats ───

export interface EventStats {
  triggersFiredToday: number;
  slackMessageCount: number;
  emailCount: number;
  activeWorkflows: number;
  completedWorkflows: number;
  failedWorkflows: number;
}
