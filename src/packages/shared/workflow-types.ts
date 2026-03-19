/**
 * Workflow Types
 * Type definitions for the workflow engine (Phase 6).
 *
 * A workflow definition is a state machine template with states, transitions,
 * conditions, and variable schemas. Instances are running executions of a definition.
 */

// ─── Variable Schema ───

export type WorkflowVariableType = 'string' | 'number' | 'boolean' | 'date' | 'email' | 'json';

export interface WorkflowVariableSchema {
  name: string;
  type: WorkflowVariableType;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
}

// ─── Conditions ───

export type ConditionOperator = 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'is_true';

export type WorkflowCondition =
  | { type: 'agent_complete' }
  | { type: 'trigger_fired'; triggerId?: string }
  | { type: 'variable_check'; variable: string; operator: ConditionOperator; value?: unknown }
  | { type: 'timeout'; afterMs: number }
  | { type: 'manual' }
  | { type: 'cron'; expression: string; timezone?: string };

// ─── Actions ───

export type WorkflowAction =
  | {
      type: 'agent_task';
      agentId: string;
      promptTemplate: string;
      skills?: string[];
    }
  | {
      type: 'trigger_setup';
      triggerConfig: Record<string, unknown>;
      triggerVariableMapping?: Record<string, string>;
    }
  | {
      type: 'wait_for_trigger';
      triggerId?: string;
      timeoutMs?: number;
    }
  | {
      type: 'set_variables';
      assignments: Record<string, string>;
    };

// ─── Transitions ───

export interface WorkflowTransition {
  id: string;
  name: string;
  targetStateId: string;
  condition: WorkflowCondition;
}

// ─── States ───

export type WorkflowStateType = 'action' | 'wait' | 'decision' | 'end';

export interface WorkflowState {
  id: string;
  name: string;
  description?: string;
  type: WorkflowStateType;
  action?: WorkflowAction;
  transitions: WorkflowTransition[];
  /** Position on the editor canvas (pixels) */
  position?: { x: number; y: number };
}

// ─── Visual Styling ───

export type WorkflowStyle = 'flowchart' | 'circuit-board' | 'constellation' | 'helix' | 'clockwork';

// ─── Workflow Definition (Template) ───

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  version: number;
  variables: WorkflowVariableSchema[];
  states: WorkflowState[];
  initialStateId: string;

  // Visual (3D work area)
  position?: { x: number; z: number };
  style?: WorkflowStyle;
  color?: string;
  scale?: number;

  createdAt: number;
  updatedAt: number;
}

// ─── Workflow Instance ───

export type WorkflowInstanceStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type WorkflowModelStatus = 'idle' | 'running' | 'completed' | 'error';

export interface WorkflowHistoryEntry {
  timestamp: number;
  fromStateId?: string;
  toStateId: string;
  transitionName?: string;
  details?: string;
  variables?: Record<string, unknown>;
}

// ─── Workflow Chat ───

export type WorkflowChatScope =
  | { level: 'workflow' }
  | { level: 'instance'; instanceId: string }
  | { level: 'step'; instanceId: string; stepId: string };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  sources?: SourceRef[];
}

export interface SourceRef {
  type: 'step' | 'variable' | 'trigger' | 'slack' | 'email' | 'approval' | 'document' | 'jira' | 'calendar' | 'audit';
  id: string | number;
  label: string;
}

// ─── Event Listener ───

export interface WorkflowEventPayload {
  instanceId: string;
  eventType: 'state_changed' | 'step_update' | 'variable_changed' | 'completed' | 'error';
  data?: unknown;
}

export type WorkflowListener = (event: WorkflowEventPayload) => void;

// ─── Create/Update Payloads ───

export type CreateWorkflowPayload = Omit<WorkflowDefinition, 'id' | 'version' | 'createdAt' | 'updatedAt'>;
export type UpdateWorkflowPayload = Partial<Omit<WorkflowDefinition, 'id' | 'createdAt'>>;

// ─── CC Workflow Reference ───

/** The 12-state CC (Control de Cambios) reference workflow definition. */
export const CC_WORKFLOW_STATES: WorkflowState[] = [
  {
    id: 'intake',
    name: 'Intake',
    type: 'action',
    description: 'Gather CC details from the developer via Slack',
    action: {
      type: 'agent_task',
      agentId: '',
      promptTemplate: 'A developer has requested a new CC (Control de Cambios). Here is their message:\n{{trigger.slack.message}}\nFrom: {{trigger.slack.user}} (Slack ID: {{trigger.slack.userId}})\n\nYou need to ask them the following questions via Slack (in channel {{trigger.slack.channel}}, thread {{trigger.slack.threadTs}}):\n1. Release name/version\n2. Brief description of what is being released\n3. Which systems are affected\n4. Desired release date and time\n5. Is this an urgent release? (less than 2 working days)\n6. Who else should be invited to the release event? (email addresses)\n\nUse the slack wait-for-reply endpoint to get their answers.\nOnce you have all answers, update the workflow variables.',
      skills: ['slack-messaging'],
    },
    transitions: [{ id: 't-intake', name: 'Intake Complete', targetStateId: 'create-jira', condition: { type: 'agent_complete' } }],
    position: { x: 100, y: 60 },
  },
  {
    id: 'create-jira',
    name: 'Create Jira Ticket',
    type: 'action',
    description: 'Create a Jira Service Desk ticket for the CC',
    action: {
      type: 'agent_task',
      agentId: '',
      promptTemplate: 'Create a Jira Service Desk ticket for this CC:\n- Project: SD\n- Issue Type: Change Request\n- Summary: "CC - {{release_name}} - {{release_date}}"\n- Description: Include all CC details.\n- Labels: ["cc", "release"]\n\nSave the returned ticket key to workflow variable jira_ticket_key.',
      skills: ['jira-service-desk'],
    },
    transitions: [{ id: 't-jira', name: 'Ticket Created', targetStateId: 'generate-doc', condition: { type: 'agent_complete' } }],
    position: { x: 100, y: 160 },
  },
  {
    id: 'generate-doc',
    name: 'Generate Document',
    type: 'action',
    description: 'Generate the CC document from template',
    action: {
      type: 'agent_task',
      agentId: '',
      promptTemplate: 'Generate the CC document using template "CC Template" with the workflow variables.\nSave the returned file path to workflow variable cc_file_path.',
      skills: ['document-generator'],
    },
    transitions: [{ id: 't-doc', name: 'Document Generated', targetStateId: 'validate-date', condition: { type: 'agent_complete' } }],
    position: { x: 100, y: 260 },
  },
  {
    id: 'validate-date',
    name: 'Validate Date',
    type: 'decision',
    description: 'Validate release date and classify as normal or urgent',
    action: {
      type: 'agent_task',
      agentId: '',
      promptTemplate: 'Validate the release date {{release_date}} {{release_time}}.\nA normal release requires at least 2 working days from now.\nIf the date is less than 2 working days away and is_urgent is not set, warn the requester.',
      skills: ['google-calendar'],
    },
    transitions: [{ id: 't-validate', name: 'Date Validated', targetStateId: 'calendar-event', condition: { type: 'agent_complete' } }],
    position: { x: 100, y: 360 },
  },
  {
    id: 'calendar-event',
    name: 'Calendar Event',
    type: 'action',
    description: 'Create a Google Calendar event for the release',
    action: {
      type: 'agent_task',
      agentId: '',
      promptTemplate: 'Create a Google Calendar event:\n- Title: "Release {{release_name}} ({{jira_ticket_key}})"\n- Date/Time: {{release_date}} {{release_time}} (1 hour duration)\n- Attendees: {{requester_email}}, {{additional_attendees}}\n\nSave the event ID to workflow variable calendar_event_id.',
      skills: ['google-calendar'],
    },
    transitions: [{ id: 't-cal', name: 'Event Created', targetStateId: 'send-approval', condition: { type: 'agent_complete' } }],
    position: { x: 100, y: 460 },
  },
  {
    id: 'send-approval',
    name: 'Send for Approval',
    type: 'action',
    description: 'Email the CC document to approvers',
    action: {
      type: 'agent_task',
      agentId: '',
      promptTemplate: 'Send the CC email for approval:\n- To: [configured approver emails]\n- Subject: "Control de Cambios - {{jira_ticket_key}} - {{release_name}} - {{release_date}}"\n- Attachment: {{cc_file_path}}\n\nSave the returned threadId to workflow variable email_thread_id.',
      skills: ['email-gmail'],
    },
    transitions: [{ id: 't-email', name: 'Email Sent', targetStateId: 'await-approvals', condition: { type: 'agent_complete' } }],
    position: { x: 100, y: 560 },
  },
  {
    id: 'await-approvals',
    name: 'Awaiting Approvals',
    type: 'wait',
    description: 'Wait for 3+ email approvals from client approvers',
    action: {
      type: 'wait_for_trigger',
      timeoutMs: 48 * 60 * 60 * 1000,
    },
    transitions: [
      { id: 't-approved', name: 'Approvals Received', targetStateId: 'notify-approved', condition: { type: 'trigger_fired' } },
      { id: 't-timeout', name: 'Timeout (48h)', targetStateId: 'end', condition: { type: 'timeout', afterMs: 48 * 60 * 60 * 1000 } },
    ],
    position: { x: 100, y: 660 },
  },
  {
    id: 'notify-approved',
    name: 'Approved - Notify',
    type: 'action',
    description: 'Notify team of approval via Slack and update Jira',
    action: {
      type: 'agent_task',
      agentId: '',
      promptTemplate: 'The CC for {{release_name}} ({{jira_ticket_key}}) has been approved.\n1. Send Slack message announcing green light for release on {{release_date}} at {{release_time}}.\n2. Add comment to Jira ticket: "CC approved."\n3. Transition Jira ticket to "Approved" status.',
      skills: ['slack-messaging', 'jira-service-desk'],
    },
    transitions: [{ id: 't-notified', name: 'Team Notified', targetStateId: 'release-reminder', condition: { type: 'agent_complete' } }],
    position: { x: 100, y: 760 },
  },
  {
    id: 'release-reminder',
    name: 'Release Reminder (T-10min)',
    type: 'wait',
    description: 'Wait until 10 minutes before release time',
    action: {
      type: 'wait_for_trigger',
      timeoutMs: 7 * 24 * 60 * 60 * 1000,
    },
    transitions: [{ id: 't-reminder', name: 'Reminder Time', targetStateId: 'dev-confirm', condition: { type: 'trigger_fired' } }],
    position: { x: 100, y: 860 },
  },
  {
    id: 'dev-confirm',
    name: 'Dev Ready Confirmation',
    type: 'action',
    description: 'Send reminder and wait for developer confirmation',
    action: {
      type: 'agent_task',
      agentId: '',
      promptTemplate: 'It is 10 minutes before the release of {{release_name}} ({{jira_ticket_key}}).\nSend a Slack reminder and ask {{requester_name}} to confirm they are ready.\nWait for their confirmation reply.',
      skills: ['slack-messaging'],
    },
    transitions: [{ id: 't-confirmed', name: 'Dev Confirmed', targetStateId: 'release-started', condition: { type: 'agent_complete' } }],
    position: { x: 100, y: 960 },
  },
  {
    id: 'release-started',
    name: 'Release Started',
    type: 'action',
    description: 'Announce release start via email, Slack, and Jira',
    action: {
      type: 'agent_task',
      agentId: '',
      promptTemplate: 'The developer has confirmed ready.\n1. Reply in approval email thread: release is starting now.\n2. Send Slack message confirming release started.\n3. Update Jira ticket status to "In Progress" or "Done".',
      skills: ['email-gmail', 'slack-messaging', 'jira-service-desk'],
    },
    transitions: [{ id: 't-done', name: 'Release Complete', targetStateId: 'end', condition: { type: 'agent_complete' } }],
    position: { x: 100, y: 1060 },
  },
  {
    id: 'end',
    name: 'End',
    type: 'end',
    description: 'CC process complete',
    transitions: [],
    position: { x: 100, y: 1160 },
  },
];

export const CC_WORKFLOW_VARIABLES: WorkflowVariableSchema[] = [
  { name: 'requester_name', type: 'string', description: 'Developer requesting the release', required: true },
  { name: 'requester_email', type: 'email', description: 'Requester email', required: true },
  { name: 'requester_slack_id', type: 'string', description: 'Requester Slack user ID' },
  { name: 'release_name', type: 'string', description: 'Release version/name', required: true },
  { name: 'release_description', type: 'string', description: 'What is being released' },
  { name: 'affected_systems', type: 'string', description: 'Systems impacted' },
  { name: 'release_date', type: 'date', description: 'Scheduled release date', required: true },
  { name: 'release_time', type: 'string', description: 'Scheduled release time', required: true },
  { name: 'is_urgent', type: 'boolean', description: 'Whether this is an urgent release' },
  { name: 'additional_attendees', type: 'string', description: 'Other people to invite (comma-separated emails)' },
  { name: 'jira_ticket_key', type: 'string', description: 'Jira ticket key (e.g. SD-1234)' },
  { name: 'jira_ticket_url', type: 'string', description: 'Full Jira ticket URL' },
  { name: 'cc_file_path', type: 'string', description: 'Path to generated CC document' },
  { name: 'email_thread_id', type: 'string', description: 'Gmail thread ID for approval chain' },
  { name: 'calendar_event_id', type: 'string', description: 'Google Calendar event ID' },
  { name: 'approval_status', type: 'json', description: 'Current approval status' },
];
