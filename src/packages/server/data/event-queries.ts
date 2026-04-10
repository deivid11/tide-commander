/**
 * Event Query Functions
 * Pre-built query functions organized by domain.
 * Each integration calls these instead of writing raw SQL.
 */

import { insertOne, queryMany, queryOne, execute } from './event-db.js';
import type {
  TriggerFireEvent,
  SlackMessageEvent,
  EmailMessageEvent,
  ApprovalEvent,
  DocumentGenerationEvent,
  CalendarActionEvent,
  JiraTicketLogEvent,
  WorkflowInstanceRow,
  WorkflowStepLogRow,
  VariableChangeRow,
  AuditLogEntry,
  TimelineEntry,
} from '../../shared/event-types.js';

// ─── JSON serialization helpers ───

function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

function fromJson<T>(value: string | null | undefined): T | undefined {
  if (value === null || value === undefined) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

// ═══════════════════════════════════════════════════════════════
// TRIGGER EVENTS
// ═══════════════════════════════════════════════════════════════

interface TriggerEventRow {
  id: number;
  trigger_id: string;
  trigger_name: string;
  trigger_type: string;
  agent_id: string | null;
  workflow_instance_id: string | null;
  fired_at: number;
  variables: string | null;
  payload: string | null;
  match_mode: string;
  llm_match_result: string | null;
  llm_extract_result: string | null;
  status: string;
  error: string | null;
  duration_ms: number | null;
}

function triggerRowToEvent(row: TriggerEventRow): TriggerFireEvent {
  return {
    id: row.id,
    triggerId: row.trigger_id,
    triggerName: row.trigger_name,
    triggerType: row.trigger_type as TriggerFireEvent['triggerType'],
    agentId: row.agent_id ?? undefined,
    workflowInstanceId: row.workflow_instance_id ?? undefined,
    firedAt: row.fired_at,
    variables: fromJson(row.variables),
    payload: fromJson(row.payload),
    matchMode: row.match_mode as TriggerFireEvent['matchMode'],
    llmMatchResult: fromJson(row.llm_match_result),
    llmExtractResult: fromJson(row.llm_extract_result),
    status: row.status as TriggerFireEvent['status'],
    error: row.error ?? undefined,
    durationMs: row.duration_ms ?? undefined,
  };
}

export function logTriggerFire(event: TriggerFireEvent): number {
  return insertOne('trigger_events', {
    trigger_id: event.triggerId,
    trigger_name: event.triggerName,
    trigger_type: event.triggerType,
    agent_id: event.agentId ?? null,
    workflow_instance_id: event.workflowInstanceId ?? null,
    fired_at: event.firedAt,
    variables: toJson(event.variables),
    payload: toJson(event.payload),
    match_mode: event.matchMode,
    llm_match_result: toJson(event.llmMatchResult),
    llm_extract_result: toJson(event.llmExtractResult),
    status: event.status,
    error: event.error ?? null,
    duration_ms: event.durationMs ?? null,
  });
}

export function updateTriggerEventStatus(eventId: number, status: string, error?: string, durationMs?: number): void {
  execute(
    'UPDATE trigger_events SET status = ?, error = ?, duration_ms = ? WHERE id = ?',
    [status, error ?? null, durationMs ?? null, eventId]
  );
}

// ═══════════════════════════════════════════════════════════════
// SLACK MESSAGES
// ═══════════════════════════════════════════════════════════════

interface SlackMessageRow {
  id: number;
  ts: string;
  thread_ts: string | null;
  channel_id: string;
  channel_name: string | null;
  user_id: string;
  user_name: string;
  text: string;
  direction: string;
  agent_id: string | null;
  workflow_instance_id: string | null;
  raw_event: string | null;
  received_at: number;
}

function slackRowToEvent(row: SlackMessageRow): SlackMessageEvent {
  return {
    id: row.id,
    ts: row.ts,
    threadTs: row.thread_ts ?? undefined,
    channelId: row.channel_id,
    channelName: row.channel_name ?? undefined,
    userId: row.user_id,
    userName: row.user_name,
    text: row.text,
    direction: row.direction as SlackMessageEvent['direction'],
    agentId: row.agent_id ?? undefined,
    workflowInstanceId: row.workflow_instance_id ?? undefined,
    rawEvent: fromJson(row.raw_event),
    receivedAt: row.received_at,
  };
}

export function logSlackMessage(msg: SlackMessageEvent): number {
  return insertOne('slack_messages', {
    ts: msg.ts,
    thread_ts: msg.threadTs ?? null,
    channel_id: msg.channelId,
    channel_name: msg.channelName ?? null,
    user_id: msg.userId,
    user_name: msg.userName,
    text: msg.text,
    direction: msg.direction,
    agent_id: msg.agentId ?? null,
    workflow_instance_id: msg.workflowInstanceId ?? null,
    raw_event: toJson(msg.rawEvent),
    received_at: msg.receivedAt,
  });
}

// ═══════════════════════════════════════════════════════════════
// EMAIL MESSAGES
// ═══════════════════════════════════════════════════════════════

interface EmailMessageRow {
  id: number;
  message_id: string;
  thread_id: string;
  from_address: string;
  to_addresses: string;
  cc_addresses: string | null;
  subject: string;
  body_text: string | null;
  body_html: string | null;
  direction: string;
  has_attachments: number;
  attachment_names: string | null;
  agent_id: string | null;
  workflow_instance_id: string | null;
  gmail_labels: string | null;
  raw_headers: string | null;
  received_at: number;
}

function emailRowToEvent(row: EmailMessageRow): EmailMessageEvent {
  return {
    id: row.id,
    messageId: row.message_id,
    threadId: row.thread_id,
    fromAddress: row.from_address,
    toAddresses: fromJson<string[]>(row.to_addresses) ?? [],
    ccAddresses: fromJson<string[]>(row.cc_addresses),
    subject: row.subject,
    bodyText: row.body_text ?? undefined,
    bodyHtml: row.body_html ?? undefined,
    direction: row.direction as EmailMessageEvent['direction'],
    hasAttachments: row.has_attachments === 1,
    attachmentNames: fromJson<string[]>(row.attachment_names),
    agentId: row.agent_id ?? undefined,
    workflowInstanceId: row.workflow_instance_id ?? undefined,
    gmailLabels: fromJson<string[]>(row.gmail_labels),
    rawHeaders: fromJson<Record<string, string>>(row.raw_headers),
    receivedAt: row.received_at,
  };
}

export function logEmailMessage(msg: EmailMessageEvent): number {
  return insertOne('email_messages', {
    message_id: msg.messageId,
    thread_id: msg.threadId,
    from_address: msg.fromAddress,
    to_addresses: JSON.stringify(msg.toAddresses),
    cc_addresses: toJson(msg.ccAddresses),
    subject: msg.subject,
    body_text: msg.bodyText ?? null,
    body_html: msg.bodyHtml ?? null,
    direction: msg.direction,
    has_attachments: msg.hasAttachments ? 1 : 0,
    attachment_names: toJson(msg.attachmentNames),
    agent_id: msg.agentId ?? null,
    workflow_instance_id: msg.workflowInstanceId ?? null,
    gmail_labels: toJson(msg.gmailLabels),
    raw_headers: toJson(msg.rawHeaders),
    received_at: msg.receivedAt,
  });
}

// ═══════════════════════════════════════════════════════════════
// APPROVAL EVENTS
// ═══════════════════════════════════════════════════════════════

interface ApprovalEventRow {
  id: number;
  thread_id: string;
  approver_email: string;
  approved: number;
  reply_message_id: string | null;
  reply_snippet: string | null;
  keyword_matched: string | null;
  workflow_instance_id: string | null;
  recorded_at: number;
}

function approvalRowToEvent(row: ApprovalEventRow): ApprovalEvent {
  return {
    id: row.id,
    threadId: row.thread_id,
    approverEmail: row.approver_email,
    approved: row.approved === 1,
    replyMessageId: row.reply_message_id ?? undefined,
    replySnippet: row.reply_snippet ?? undefined,
    keywordMatched: row.keyword_matched ?? undefined,
    workflowInstanceId: row.workflow_instance_id ?? undefined,
    recordedAt: row.recorded_at,
  };
}

export function logApprovalEvent(event: ApprovalEvent): number {
  return insertOne('email_approval_events', {
    thread_id: event.threadId,
    approver_email: event.approverEmail,
    approved: event.approved ? 1 : 0,
    reply_message_id: event.replyMessageId ?? null,
    reply_snippet: event.replySnippet ?? null,
    keyword_matched: event.keywordMatched ?? null,
    workflow_instance_id: event.workflowInstanceId ?? null,
    recorded_at: event.recordedAt,
  });
}

// ═══════════════════════════════════════════════════════════════
// DOCUMENT GENERATIONS
// ═══════════════════════════════════════════════════════════════

interface DocGenRow {
  id: number;
  template_id: string;
  template_name: string;
  output_filename: string;
  output_path: string;
  variables: string;
  file_size_bytes: number | null;
  agent_id: string | null;
  workflow_instance_id: string | null;
  generated_at: number;
}

function docGenRowToEvent(row: DocGenRow): DocumentGenerationEvent {
  return {
    id: row.id,
    templateId: row.template_id,
    templateName: row.template_name,
    outputFilename: row.output_filename,
    outputPath: row.output_path,
    variables: fromJson<Record<string, unknown>>(row.variables) ?? {},
    fileSizeBytes: row.file_size_bytes ?? undefined,
    agentId: row.agent_id ?? undefined,
    workflowInstanceId: row.workflow_instance_id ?? undefined,
    generatedAt: row.generated_at,
  };
}

export function logDocumentGeneration(gen: DocumentGenerationEvent): number {
  return insertOne('document_generations', {
    template_id: gen.templateId,
    template_name: gen.templateName,
    output_filename: gen.outputFilename,
    output_path: gen.outputPath,
    variables: JSON.stringify(gen.variables),
    file_size_bytes: gen.fileSizeBytes ?? null,
    agent_id: gen.agentId ?? null,
    workflow_instance_id: gen.workflowInstanceId ?? null,
    generated_at: gen.generatedAt,
  });
}

// ═══════════════════════════════════════════════════════════════
// CALENDAR EVENT LOGS
// ═══════════════════════════════════════════════════════════════

interface CalendarLogRow {
  id: number;
  event_id: string;
  action: string;
  summary: string;
  start_datetime: string;
  end_datetime: string;
  attendees: string | null;
  html_link: string | null;
  agent_id: string | null;
  workflow_instance_id: string | null;
  recorded_at: number;
}

function calendarRowToEvent(row: CalendarLogRow): CalendarActionEvent {
  return {
    id: row.id,
    eventId: row.event_id,
    action: row.action as CalendarActionEvent['action'],
    summary: row.summary,
    startDatetime: row.start_datetime,
    endDatetime: row.end_datetime,
    attendees: fromJson<string[]>(row.attendees),
    htmlLink: row.html_link ?? undefined,
    agentId: row.agent_id ?? undefined,
    workflowInstanceId: row.workflow_instance_id ?? undefined,
    recordedAt: row.recorded_at,
  };
}

export function logCalendarAction(log: CalendarActionEvent): number {
  return insertOne('calendar_event_logs', {
    event_id: log.eventId,
    action: log.action,
    summary: log.summary,
    start_datetime: log.startDatetime,
    end_datetime: log.endDatetime,
    attendees: toJson(log.attendees),
    html_link: log.htmlLink ?? null,
    agent_id: log.agentId ?? null,
    workflow_instance_id: log.workflowInstanceId ?? null,
    recorded_at: log.recordedAt,
  });
}

// ═══════════════════════════════════════════════════════════════
// JIRA TICKET LOGS
// ═══════════════════════════════════════════════════════════════

interface JiraLogRow {
  id: number;
  ticket_key: string;
  ticket_id: string;
  project_key: string;
  action: string;
  summary: string;
  issue_type: string | null;
  status: string | null;
  priority: string | null;
  assignee: string | null;
  description: string | null;
  fields_changed: string | null;
  comment_body: string | null;
  self_url: string | null;
  agent_id: string | null;
  workflow_instance_id: string | null;
  recorded_at: number;
}

function jiraRowToEvent(row: JiraLogRow): JiraTicketLogEvent {
  return {
    id: row.id,
    ticketKey: row.ticket_key,
    ticketId: row.ticket_id,
    projectKey: row.project_key,
    action: row.action as JiraTicketLogEvent['action'],
    summary: row.summary,
    issueType: row.issue_type ?? undefined,
    status: row.status ?? undefined,
    priority: row.priority ?? undefined,
    assignee: row.assignee ?? undefined,
    description: row.description ?? undefined,
    fieldsChanged: fromJson(row.fields_changed),
    commentBody: row.comment_body ?? undefined,
    selfUrl: row.self_url ?? undefined,
    agentId: row.agent_id ?? undefined,
    workflowInstanceId: row.workflow_instance_id ?? undefined,
    recordedAt: row.recorded_at,
  };
}

export function logJiraTicketAction(log: JiraTicketLogEvent): number {
  return insertOne('jira_ticket_logs', {
    ticket_key: log.ticketKey,
    ticket_id: log.ticketId,
    project_key: log.projectKey,
    action: log.action,
    summary: log.summary,
    issue_type: log.issueType ?? null,
    status: log.status ?? null,
    priority: log.priority ?? null,
    assignee: log.assignee ?? null,
    description: log.description ?? null,
    fields_changed: toJson(log.fieldsChanged),
    comment_body: log.commentBody ?? null,
    self_url: log.selfUrl ?? null,
    agent_id: log.agentId ?? null,
    workflow_instance_id: log.workflowInstanceId ?? null,
    recorded_at: log.recordedAt,
  });
}

// ═══════════════════════════════════════════════════════════════
// WORKFLOW INSTANCES
// ═══════════════════════════════════════════════════════════════

interface WorkflowInstanceDbRow {
  id: string;
  workflow_def_id: string;
  workflow_name: string;
  status: string;
  current_state_id: string;
  variables: string;
  active_trigger_ids: string;
  active_timers: string;
  error: string | null;
  agent_id: string | null;
  trigger_id: string | null;
  trigger_data_json: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

function workflowRowToInstance(row: WorkflowInstanceDbRow): WorkflowInstanceRow {
  return {
    id: row.id,
    workflowDefId: row.workflow_def_id,
    workflowName: row.workflow_name,
    status: row.status as WorkflowInstanceRow['status'],
    currentStateId: row.current_state_id,
    variables: fromJson<Record<string, unknown>>(row.variables) ?? {},
    activeTriggerIds: fromJson<string[]>(row.active_trigger_ids) ?? [],
    activeTimers: fromJson<string[]>(row.active_timers) ?? [],
    error: row.error ?? undefined,
    agentId: row.agent_id ?? undefined,
    triggerId: row.trigger_id ?? undefined,
    triggerData: fromJson<Record<string, unknown>>(row.trigger_data_json) ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
}

export function insertWorkflowInstance(instance: WorkflowInstanceRow): void {
  insertOne('workflow_instances', {
    id: instance.id,
    workflow_def_id: instance.workflowDefId,
    workflow_name: instance.workflowName,
    status: instance.status,
    current_state_id: instance.currentStateId,
    variables: JSON.stringify(instance.variables),
    active_trigger_ids: JSON.stringify(instance.activeTriggerIds),
    active_timers: JSON.stringify(instance.activeTimers),
    error: instance.error ?? null,
    agent_id: instance.agentId ?? null,
    trigger_id: instance.triggerId ?? null,
    trigger_data_json: instance.triggerData ? JSON.stringify(instance.triggerData) : null,
    created_at: instance.createdAt,
    updated_at: instance.updatedAt,
    completed_at: instance.completedAt ?? null,
  });
}

export function updateWorkflowInstance(id: string, updates: Partial<WorkflowInstanceRow>): void {
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (updates.status !== undefined) { setClauses.push('status = ?'); params.push(updates.status); }
  if (updates.currentStateId !== undefined) { setClauses.push('current_state_id = ?'); params.push(updates.currentStateId); }
  if (updates.variables !== undefined) { setClauses.push('variables = ?'); params.push(JSON.stringify(updates.variables)); }
  if (updates.activeTriggerIds !== undefined) { setClauses.push('active_trigger_ids = ?'); params.push(JSON.stringify(updates.activeTriggerIds)); }
  if (updates.activeTimers !== undefined) { setClauses.push('active_timers = ?'); params.push(JSON.stringify(updates.activeTimers)); }
  if (updates.error !== undefined) { setClauses.push('error = ?'); params.push(updates.error); }
  if (updates.agentId !== undefined) { setClauses.push('agent_id = ?'); params.push(updates.agentId); }
  if (updates.triggerId !== undefined) { setClauses.push('trigger_id = ?'); params.push(updates.triggerId); }
  if (updates.triggerData !== undefined) { setClauses.push('trigger_data_json = ?'); params.push(JSON.stringify(updates.triggerData)); }
  if (updates.updatedAt !== undefined) { setClauses.push('updated_at = ?'); params.push(updates.updatedAt); }
  if (updates.completedAt !== undefined) { setClauses.push('completed_at = ?'); params.push(updates.completedAt); }

  if (setClauses.length === 0) return;

  params.push(id);
  execute(`UPDATE workflow_instances SET ${setClauses.join(', ')} WHERE id = ?`, params);
}

export function getWorkflowInstance(id: string): WorkflowInstanceRow | undefined {
  const row = queryOne<WorkflowInstanceDbRow>(
    'SELECT * FROM workflow_instances WHERE id = ?',
    [id]
  );
  return row ? workflowRowToInstance(row) : undefined;
}

export function listWorkflowInstances(opts?: { status?: string; workflowDefId?: string; limit?: number; offset?: number }): WorkflowInstanceRow[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.status) { conditions.push('status = ?'); params.push(opts.status); }
  if (opts?.workflowDefId) { conditions.push('workflow_def_id = ?'); params.push(opts.workflowDefId); }

  let sql = 'SELECT * FROM workflow_instances';
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(opts?.limit ?? 50, opts?.offset ?? 0);

  return queryMany<WorkflowInstanceDbRow>(sql, params).map(workflowRowToInstance);
}

export function countWorkflowInstances(opts?: { status?: string; workflowDefId?: string }): number {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.status) { conditions.push('status = ?'); params.push(opts.status); }
  if (opts?.workflowDefId) { conditions.push('workflow_def_id = ?'); params.push(opts.workflowDefId); }

  let sql = 'SELECT COUNT(*) as count FROM workflow_instances';
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  const row = queryOne<{ count: number }>(sql, params);
  return row?.count ?? 0;
}

// ═══════════════════════════════════════════════════════════════
// WORKFLOW STEP LOG
// ═══════════════════════════════════════════════════════════════

interface StepLogDbRow {
  id: number;
  workflow_instance_id: string;
  from_state_id: string | null;
  to_state_id: string;
  to_state_name: string;
  transition_name: string | null;
  transition_condition: string | null;
  action_type: string | null;
  agent_id: string | null;
  prompt_sent: string | null;
  agent_response: string | null;
  agent_reasoning: string | null;
  trigger_id: string | null;
  trigger_payload: string | null;
  variables_before: string | null;
  variables_after: string | null;
  entered_at: number;
  exited_at: number | null;
  duration_ms: number | null;
  status: string;
  error: string | null;
  agent_summary: string | null;
}

function stepLogRowToModel(row: StepLogDbRow): WorkflowStepLogRow {
  return {
    id: row.id,
    workflowInstanceId: row.workflow_instance_id,
    fromStateId: row.from_state_id ?? undefined,
    toStateId: row.to_state_id,
    toStateName: row.to_state_name,
    transitionName: row.transition_name ?? undefined,
    transitionCondition: fromJson(row.transition_condition),
    actionType: row.action_type ?? undefined,
    agentId: row.agent_id ?? undefined,
    promptSent: row.prompt_sent ?? undefined,
    agentResponse: row.agent_response ?? undefined,
    agentReasoning: row.agent_reasoning ?? undefined,
    agentSummary: row.agent_summary ?? undefined,
    triggerId: row.trigger_id ?? undefined,
    triggerPayload: fromJson(row.trigger_payload),
    variablesBefore: fromJson(row.variables_before),
    variablesAfter: fromJson(row.variables_after),
    enteredAt: row.entered_at,
    exitedAt: row.exited_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    status: row.status as WorkflowStepLogRow['status'],
    error: row.error ?? undefined,
  };
}

export function insertStepLog(step: WorkflowStepLogRow): number {
  return insertOne('workflow_step_log', {
    workflow_instance_id: step.workflowInstanceId,
    from_state_id: step.fromStateId ?? null,
    to_state_id: step.toStateId,
    to_state_name: step.toStateName,
    transition_name: step.transitionName ?? null,
    transition_condition: toJson(step.transitionCondition),
    action_type: step.actionType ?? null,
    agent_id: step.agentId ?? null,
    prompt_sent: step.promptSent ?? null,
    agent_response: step.agentResponse ?? null,
    agent_reasoning: step.agentReasoning ?? null,
    agent_summary: step.agentSummary ?? null,
    trigger_id: step.triggerId ?? null,
    trigger_payload: toJson(step.triggerPayload),
    variables_before: toJson(step.variablesBefore),
    variables_after: toJson(step.variablesAfter),
    entered_at: step.enteredAt,
    exited_at: step.exitedAt ?? null,
    duration_ms: step.durationMs ?? null,
    status: step.status,
    error: step.error ?? null,
  });
}

export function updateStepLog(id: number, updates: Partial<WorkflowStepLogRow>): void {
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (updates.agentResponse !== undefined) { setClauses.push('agent_response = ?'); params.push(updates.agentResponse); }
  if (updates.agentReasoning !== undefined) { setClauses.push('agent_reasoning = ?'); params.push(updates.agentReasoning); }
  if (updates.agentSummary !== undefined) { setClauses.push('agent_summary = ?'); params.push(updates.agentSummary); }
  if (updates.variablesAfter !== undefined) { setClauses.push('variables_after = ?'); params.push(toJson(updates.variablesAfter)); }
  if (updates.exitedAt !== undefined) { setClauses.push('exited_at = ?'); params.push(updates.exitedAt); }
  if (updates.durationMs !== undefined) { setClauses.push('duration_ms = ?'); params.push(updates.durationMs); }
  if (updates.status !== undefined) { setClauses.push('status = ?'); params.push(updates.status); }
  if (updates.error !== undefined) { setClauses.push('error = ?'); params.push(updates.error); }

  if (setClauses.length === 0) return;

  params.push(id);
  execute(`UPDATE workflow_step_log SET ${setClauses.join(', ')} WHERE id = ?`, params);
}

export function getStepsByInstance(workflowInstanceId: string): WorkflowStepLogRow[] {
  const rows = queryMany<StepLogDbRow>(
    'SELECT * FROM workflow_step_log WHERE workflow_instance_id = ? ORDER BY entered_at ASC',
    [workflowInstanceId]
  );
  return rows.map(stepLogRowToModel);
}

export function getCurrentStep(workflowInstanceId: string): WorkflowStepLogRow | undefined {
  const row = queryOne<StepLogDbRow>(
    'SELECT * FROM workflow_step_log WHERE workflow_instance_id = ? AND exited_at IS NULL ORDER BY entered_at DESC LIMIT 1',
    [workflowInstanceId]
  );
  return row ? stepLogRowToModel(row) : undefined;
}

export function getStepsByAgent(agentId: string, opts?: { limit?: number }): WorkflowStepLogRow[] {
  const limit = opts?.limit ?? 50;
  const rows = queryMany<StepLogDbRow>(
    'SELECT * FROM workflow_step_log WHERE agent_id = ? ORDER BY entered_at DESC LIMIT ?',
    [agentId, limit]
  );
  return rows.map(stepLogRowToModel);
}

// ═══════════════════════════════════════════════════════════════
// WORKFLOW VARIABLE CHANGES
// ═══════════════════════════════════════════════════════════════

interface VarChangeDbRow {
  id: number;
  workflow_instance_id: string;
  step_log_id: number | null;
  variable_name: string;
  old_value: string | null;
  new_value: string;
  changed_by: string;
  changed_at: number;
}

function varChangeRowToModel(row: VarChangeDbRow): VariableChangeRow {
  return {
    id: row.id,
    workflowInstanceId: row.workflow_instance_id,
    stepLogId: row.step_log_id ?? undefined,
    variableName: row.variable_name,
    oldValue: fromJson(row.old_value),
    newValue: fromJson(row.new_value)!,
    changedBy: row.changed_by,
    changedAt: row.changed_at,
  };
}

export function logVariableChange(change: VariableChangeRow): number {
  return insertOne('workflow_variable_changes', {
    workflow_instance_id: change.workflowInstanceId,
    step_log_id: change.stepLogId ?? null,
    variable_name: change.variableName,
    old_value: toJson(change.oldValue),
    new_value: JSON.stringify(change.newValue),
    changed_by: change.changedBy,
    changed_at: change.changedAt,
  });
}

export function getVariableHistory(workflowInstanceId: string, variableName?: string): VariableChangeRow[] {
  if (variableName) {
    const rows = queryMany<VarChangeDbRow>(
      'SELECT * FROM workflow_variable_changes WHERE workflow_instance_id = ? AND variable_name = ? ORDER BY changed_at ASC',
      [workflowInstanceId, variableName]
    );
    return rows.map(varChangeRowToModel);
  }
  const rows = queryMany<VarChangeDbRow>(
    'SELECT * FROM workflow_variable_changes WHERE workflow_instance_id = ? ORDER BY changed_at ASC',
    [workflowInstanceId]
  );
  return rows.map(varChangeRowToModel);
}

// ═══════════════════════════════════════════════════════════════
// AUDIT LOG
// ═══════════════════════════════════════════════════════════════

interface AuditLogDbRow {
  id: number;
  category: string;
  action: string;
  agent_id: string | null;
  workflow_instance_id: string | null;
  details: string | null;
  level: string;
  created_at: number;
}

function auditRowToEntry(row: AuditLogDbRow): AuditLogEntry {
  return {
    id: row.id,
    category: row.category as AuditLogEntry['category'],
    action: row.action,
    agentId: row.agent_id ?? undefined,
    workflowInstanceId: row.workflow_instance_id ?? undefined,
    details: fromJson(row.details),
    level: row.level as AuditLogEntry['level'],
    createdAt: row.created_at,
  };
}

export function logAudit(entry: AuditLogEntry): number {
  return insertOne('audit_log', {
    category: entry.category,
    action: entry.action,
    agent_id: entry.agentId ?? null,
    workflow_instance_id: entry.workflowInstanceId ?? null,
    details: toJson(entry.details),
    level: entry.level,
    created_at: entry.createdAt,
  });
}

export function queryAuditLog(opts?: {
  category?: string;
  level?: string;
  workflowInstanceId?: string;
  agentId?: string;
  since?: number;
  limit?: number;
  offset?: number;
}): AuditLogEntry[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.category) { conditions.push('category = ?'); params.push(opts.category); }
  if (opts?.level) { conditions.push('level = ?'); params.push(opts.level); }
  if (opts?.workflowInstanceId) { conditions.push('workflow_instance_id = ?'); params.push(opts.workflowInstanceId); }
  if (opts?.agentId) { conditions.push('agent_id = ?'); params.push(opts.agentId); }
  if (opts?.since) { conditions.push('created_at >= ?'); params.push(opts.since); }

  let sql = 'SELECT * FROM audit_log';
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(opts?.limit ?? 100, opts?.offset ?? 0);

  return queryMany<AuditLogDbRow>(sql, params).map(auditRowToEntry);
}

export function countAuditEntries(opts?: { category?: string; level?: string; since?: number }): number {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.category) { conditions.push('category = ?'); params.push(opts.category); }
  if (opts?.level) { conditions.push('level = ?'); params.push(opts.level); }
  if (opts?.since) { conditions.push('created_at >= ?'); params.push(opts.since); }

  let sql = 'SELECT COUNT(*) as count FROM audit_log';
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  const row = queryOne<{ count: number }>(sql, params);
  return row?.count ?? 0;
}

// ═══════════════════════════════════════════════════════════════
// QUERY HELPERS (for event-routes.ts)
// ═══════════════════════════════════════════════════════════════

export function queryTriggerEvents(opts: {
  triggerId?: string;
  workflowInstanceId?: string;
  status?: string;
  since?: number;
  limit?: number;
  offset?: number;
}): { events: TriggerFireEvent[]; total: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.triggerId) { conditions.push('trigger_id = ?'); params.push(opts.triggerId); }
  if (opts.workflowInstanceId) { conditions.push('workflow_instance_id = ?'); params.push(opts.workflowInstanceId); }
  if (opts.status) { conditions.push('status = ?'); params.push(opts.status); }
  if (opts.since) { conditions.push('fired_at >= ?'); params.push(opts.since); }

  const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

  const countRow = queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM trigger_events${where}`, params);
  const total = countRow?.count ?? 0;

  const dataParams = [...params, opts.limit ?? 50, opts.offset ?? 0];
  const rows = queryMany<TriggerEventRow>(
    `SELECT * FROM trigger_events${where} ORDER BY fired_at DESC LIMIT ? OFFSET ?`,
    dataParams
  );

  return { events: rows.map(triggerRowToEvent), total };
}

export function querySlackMessages(opts: {
  channelId?: string;
  threadTs?: string;
  workflowInstanceId?: string;
  agentId?: string;
  since?: number;
  limit?: number;
}): { messages: SlackMessageEvent[]; total: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.channelId) { conditions.push('channel_id = ?'); params.push(opts.channelId); }
  if (opts.threadTs) { conditions.push('(thread_ts = ? OR ts = ?)'); params.push(opts.threadTs, opts.threadTs); }
  if (opts.workflowInstanceId) { conditions.push('workflow_instance_id = ?'); params.push(opts.workflowInstanceId); }
  if (opts.agentId) { conditions.push('agent_id = ?'); params.push(opts.agentId); }
  if (opts.since) { conditions.push('received_at >= ?'); params.push(opts.since); }

  const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

  const countRow = queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM slack_messages${where}`, params);
  const total = countRow?.count ?? 0;

  const dataParams = [...params, opts.limit ?? 50];
  const rows = queryMany<SlackMessageRow>(
    `SELECT * FROM slack_messages${where} ORDER BY received_at DESC LIMIT ?`,
    dataParams
  );

  return { messages: rows.map(slackRowToEvent), total };
}

export function queryEmailMessages(opts: {
  threadId?: string;
  workflowInstanceId?: string;
  direction?: string;
  since?: number;
  limit?: number;
}): { messages: EmailMessageEvent[]; total: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.threadId) { conditions.push('thread_id = ?'); params.push(opts.threadId); }
  if (opts.workflowInstanceId) { conditions.push('workflow_instance_id = ?'); params.push(opts.workflowInstanceId); }
  if (opts.direction) { conditions.push('direction = ?'); params.push(opts.direction); }
  if (opts.since) { conditions.push('received_at >= ?'); params.push(opts.since); }

  const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

  const countRow = queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM email_messages${where}`, params);
  const total = countRow?.count ?? 0;

  const dataParams = [...params, opts.limit ?? 50];
  const rows = queryMany<EmailMessageRow>(
    `SELECT * FROM email_messages${where} ORDER BY received_at DESC LIMIT ?`,
    dataParams
  );

  return { messages: rows.map(emailRowToEvent), total };
}

export function queryApprovalEvents(opts: {
  threadId?: string;
  workflowInstanceId?: string;
  limit?: number;
}): { events: ApprovalEvent[]; total: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.threadId) { conditions.push('thread_id = ?'); params.push(opts.threadId); }
  if (opts.workflowInstanceId) { conditions.push('workflow_instance_id = ?'); params.push(opts.workflowInstanceId); }

  const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

  const countRow = queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM email_approval_events${where}`, params);
  const total = countRow?.count ?? 0;

  const dataParams = [...params, opts.limit ?? 50];
  const rows = queryMany<ApprovalEventRow>(
    `SELECT * FROM email_approval_events${where} ORDER BY recorded_at DESC LIMIT ?`,
    dataParams
  );

  return { events: rows.map(approvalRowToEvent), total };
}

export function queryDocumentGenerations(opts: {
  templateId?: string;
  workflowInstanceId?: string;
  since?: number;
  limit?: number;
}): { events: DocumentGenerationEvent[]; total: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.templateId) { conditions.push('template_id = ?'); params.push(opts.templateId); }
  if (opts.workflowInstanceId) { conditions.push('workflow_instance_id = ?'); params.push(opts.workflowInstanceId); }
  if (opts.since) { conditions.push('generated_at >= ?'); params.push(opts.since); }

  const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

  const countRow = queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM document_generations${where}`, params);
  const total = countRow?.count ?? 0;

  const dataParams = [...params, opts.limit ?? 50];
  const rows = queryMany<DocGenRow>(
    `SELECT * FROM document_generations${where} ORDER BY generated_at DESC LIMIT ?`,
    dataParams
  );

  return { events: rows.map(docGenRowToEvent), total };
}

export function queryCalendarLogs(opts: {
  eventId?: string;
  workflowInstanceId?: string;
  since?: number;
  limit?: number;
}): { events: CalendarActionEvent[]; total: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.eventId) { conditions.push('event_id = ?'); params.push(opts.eventId); }
  if (opts.workflowInstanceId) { conditions.push('workflow_instance_id = ?'); params.push(opts.workflowInstanceId); }
  if (opts.since) { conditions.push('recorded_at >= ?'); params.push(opts.since); }

  const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

  const countRow = queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM calendar_event_logs${where}`, params);
  const total = countRow?.count ?? 0;

  const dataParams = [...params, opts.limit ?? 50];
  const rows = queryMany<CalendarLogRow>(
    `SELECT * FROM calendar_event_logs${where} ORDER BY recorded_at DESC LIMIT ?`,
    dataParams
  );

  return { events: rows.map(calendarRowToEvent), total };
}

export function queryJiraLogs(opts: {
  ticketKey?: string;
  projectKey?: string;
  workflowInstanceId?: string;
  action?: string;
  since?: number;
  limit?: number;
}): { events: JiraTicketLogEvent[]; total: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.ticketKey) { conditions.push('ticket_key = ?'); params.push(opts.ticketKey); }
  if (opts.projectKey) { conditions.push('project_key = ?'); params.push(opts.projectKey); }
  if (opts.workflowInstanceId) { conditions.push('workflow_instance_id = ?'); params.push(opts.workflowInstanceId); }
  if (opts.action) { conditions.push('action = ?'); params.push(opts.action); }
  if (opts.since) { conditions.push('recorded_at >= ?'); params.push(opts.since); }

  const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

  const countRow = queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM jira_ticket_logs${where}`, params);
  const total = countRow?.count ?? 0;

  const dataParams = [...params, opts.limit ?? 50];
  const rows = queryMany<JiraLogRow>(
    `SELECT * FROM jira_ticket_logs${where} ORDER BY recorded_at DESC LIMIT ?`,
    dataParams
  );

  return { events: rows.map(jiraRowToEvent), total };
}

// ═══════════════════════════════════════════════════════════════
// WORKFLOW TIMELINE (merged chronological view)
// ═══════════════════════════════════════════════════════════════

export function getWorkflowTimeline(workflowInstanceId: string): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  // Step logs
  const steps = getStepsByInstance(workflowInstanceId);
  for (const step of steps) {
    entries.push({ type: 'step', timestamp: step.enteredAt, data: step });
  }

  // Variable changes
  const varChanges = getVariableHistory(workflowInstanceId);
  for (const vc of varChanges) {
    entries.push({ type: 'variable_change', timestamp: vc.changedAt, data: vc });
  }

  // Trigger events
  const triggers = queryTriggerEvents({ workflowInstanceId, limit: 200 });
  for (const t of triggers.events) {
    entries.push({ type: 'trigger', timestamp: t.firedAt, data: t });
  }

  // Slack messages
  const slackMsgs = querySlackMessages({ workflowInstanceId, limit: 200 });
  for (const m of slackMsgs.messages) {
    entries.push({ type: 'slack', timestamp: m.receivedAt, data: m });
  }

  // Email messages
  const emails = queryEmailMessages({ workflowInstanceId, limit: 200 });
  for (const e of emails.messages) {
    entries.push({ type: 'email', timestamp: e.receivedAt, data: e });
  }

  // Approvals
  const approvals = queryApprovalEvents({ workflowInstanceId, limit: 200 });
  for (const a of approvals.events) {
    entries.push({ type: 'approval', timestamp: a.recordedAt, data: a });
  }

  // Document generations
  const docs = queryDocumentGenerations({ workflowInstanceId, limit: 200 });
  for (const d of docs.events) {
    entries.push({ type: 'document', timestamp: d.generatedAt, data: d });
  }

  // Calendar actions
  const calEvents = queryCalendarLogs({ workflowInstanceId, limit: 200 });
  for (const c of calEvents.events) {
    entries.push({ type: 'calendar', timestamp: c.recordedAt, data: c });
  }

  // Jira actions
  const jiraActions = queryJiraLogs({ workflowInstanceId, limit: 200 });
  for (const j of jiraActions.events) {
    entries.push({ type: 'jira', timestamp: j.recordedAt, data: j });
  }

  // Audit logs
  const audits = queryAuditLog({ workflowInstanceId, limit: 200 });
  for (const a of audits) {
    entries.push({ type: 'audit', timestamp: a.createdAt, data: a });
  }

  // Sort chronologically
  entries.sort((a, b) => a.timestamp - b.timestamp);
  return entries;
}
