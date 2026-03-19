-- Migration 001: Initial Event Store Schema
-- Creates all 11 event tables with indexes

-- ═══════════════════════════════════════════════════════════════
-- TRIGGER EVENTS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE trigger_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_id      TEXT NOT NULL,
  trigger_name    TEXT NOT NULL,
  trigger_type    TEXT NOT NULL,
  agent_id        TEXT,
  workflow_instance_id TEXT,
  fired_at        INTEGER NOT NULL,
  variables       TEXT,
  payload         TEXT,
  match_mode      TEXT NOT NULL DEFAULT 'structural',
  llm_match_result TEXT,
  llm_extract_result TEXT,
  status          TEXT NOT NULL DEFAULT 'fired',
  error           TEXT,
  duration_ms     INTEGER
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
  ts              TEXT NOT NULL,
  thread_ts       TEXT,
  channel_id      TEXT NOT NULL,
  channel_name    TEXT,
  user_id         TEXT NOT NULL,
  user_name       TEXT NOT NULL,
  text            TEXT NOT NULL,
  direction       TEXT NOT NULL,
  agent_id        TEXT,
  workflow_instance_id TEXT,
  raw_event       TEXT,
  received_at     INTEGER NOT NULL
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
  message_id      TEXT NOT NULL,
  thread_id       TEXT NOT NULL,
  from_address    TEXT NOT NULL,
  to_addresses    TEXT NOT NULL,
  cc_addresses    TEXT,
  subject         TEXT NOT NULL,
  body_text       TEXT,
  body_html       TEXT,
  direction       TEXT NOT NULL,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  attachment_names TEXT,
  agent_id        TEXT,
  workflow_instance_id TEXT,
  gmail_labels    TEXT,
  raw_headers     TEXT,
  received_at     INTEGER NOT NULL
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
  thread_id       TEXT NOT NULL,
  approver_email  TEXT NOT NULL,
  approved        INTEGER NOT NULL,
  reply_message_id TEXT,
  reply_snippet   TEXT,
  keyword_matched TEXT,
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
  output_path     TEXT NOT NULL,
  variables       TEXT NOT NULL,
  file_size_bytes INTEGER,
  agent_id        TEXT,
  workflow_instance_id TEXT,
  generated_at    INTEGER NOT NULL
);

CREATE INDEX idx_doc_gen_template ON document_generations(template_id);
CREATE INDEX idx_doc_gen_workflow ON document_generations(workflow_instance_id);
CREATE INDEX idx_doc_gen_generated_at ON document_generations(generated_at);

-- ═══════════════════════════════════════════════════════════════
-- CALENDAR EVENT LOGS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE calendar_event_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id        TEXT NOT NULL,
  action          TEXT NOT NULL,
  summary         TEXT NOT NULL,
  start_datetime  TEXT NOT NULL,
  end_datetime    TEXT NOT NULL,
  attendees       TEXT,
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
  ticket_key      TEXT NOT NULL,
  ticket_id       TEXT NOT NULL,
  project_key     TEXT NOT NULL,
  action          TEXT NOT NULL,
  summary         TEXT NOT NULL,
  issue_type      TEXT,
  status          TEXT,
  priority        TEXT,
  assignee        TEXT,
  description     TEXT,
  fields_changed  TEXT,
  comment_body    TEXT,
  self_url        TEXT,
  agent_id        TEXT,
  workflow_instance_id TEXT,
  recorded_at     INTEGER NOT NULL
);

CREATE INDEX idx_jira_logs_ticket ON jira_ticket_logs(ticket_key);
CREATE INDEX idx_jira_logs_project ON jira_ticket_logs(project_key);
CREATE INDEX idx_jira_logs_workflow ON jira_ticket_logs(workflow_instance_id);
CREATE INDEX idx_jira_logs_recorded ON jira_ticket_logs(recorded_at);

-- ═══════════════════════════════════════════════════════════════
-- WORKFLOW INSTANCES
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE workflow_instances (
  id                  TEXT PRIMARY KEY,
  workflow_def_id     TEXT NOT NULL,
  workflow_name       TEXT NOT NULL,
  status              TEXT NOT NULL,
  current_state_id    TEXT NOT NULL,
  variables           TEXT NOT NULL DEFAULT '{}',
  active_trigger_ids  TEXT NOT NULL DEFAULT '[]',
  active_timers       TEXT NOT NULL DEFAULT '[]',
  error               TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  completed_at        INTEGER
);

CREATE INDEX idx_workflow_instances_status ON workflow_instances(status);
CREATE INDEX idx_workflow_instances_def ON workflow_instances(workflow_def_id);
CREATE INDEX idx_workflow_instances_created ON workflow_instances(created_at);

-- ═══════════════════════════════════════════════════════════════
-- WORKFLOW STEP LOG
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE workflow_step_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_instance_id TEXT NOT NULL,
  from_state_id       TEXT,
  to_state_id         TEXT NOT NULL,
  to_state_name       TEXT NOT NULL,
  transition_name     TEXT,
  transition_condition TEXT,
  action_type         TEXT,
  agent_id            TEXT,
  prompt_sent         TEXT,
  agent_response      TEXT,
  agent_reasoning     TEXT,
  trigger_id          TEXT,
  trigger_payload     TEXT,
  variables_before    TEXT,
  variables_after     TEXT,
  entered_at          INTEGER NOT NULL,
  exited_at           INTEGER,
  duration_ms         INTEGER,
  status              TEXT NOT NULL DEFAULT 'entered',
  error               TEXT
);

CREATE INDEX idx_step_log_instance ON workflow_step_log(workflow_instance_id);
CREATE INDEX idx_step_log_entered ON workflow_step_log(entered_at);
CREATE INDEX idx_step_log_agent ON workflow_step_log(agent_id);
CREATE INDEX idx_step_log_status ON workflow_step_log(status);

-- ═══════════════════════════════════════════════════════════════
-- WORKFLOW VARIABLE CHANGES
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE workflow_variable_changes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_instance_id TEXT NOT NULL,
  step_log_id         INTEGER,
  variable_name       TEXT NOT NULL,
  old_value           TEXT,
  new_value           TEXT NOT NULL,
  changed_by          TEXT NOT NULL,
  changed_at          INTEGER NOT NULL
);

CREATE INDEX idx_var_changes_instance ON workflow_variable_changes(workflow_instance_id);
CREATE INDEX idx_var_changes_variable ON workflow_variable_changes(variable_name);
CREATE INDEX idx_var_changes_step ON workflow_variable_changes(step_log_id);

-- ═══════════════════════════════════════════════════════════════
-- GENERIC AUDIT LOG
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  category        TEXT NOT NULL,
  action          TEXT NOT NULL,
  agent_id        TEXT,
  workflow_instance_id TEXT,
  details         TEXT,
  level           TEXT NOT NULL DEFAULT 'info',
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_audit_log_category ON audit_log(category);
CREATE INDEX idx_audit_log_workflow ON audit_log(workflow_instance_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);
CREATE INDEX idx_audit_log_level ON audit_log(level);
