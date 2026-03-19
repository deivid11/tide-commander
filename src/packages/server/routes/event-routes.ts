/**
 * Event Routes
 * GET endpoints for querying the event store.
 */

import { Router, Request, Response } from 'express';
import {
  queryTriggerEvents,
  querySlackMessages,
  queryEmailMessages,
  queryApprovalEvents,
  queryDocumentGenerations,
  queryCalendarLogs,
  queryJiraLogs,
  queryAuditLog,
  countAuditEntries,
  getWorkflowInstance,
  getStepsByInstance,
  getVariableHistory,
  countWorkflowInstances,
} from '../data/event-queries.js';
import { queryOne } from '../data/event-db.js';
import type { TimelineEntry } from '../../shared/event-types.js';

const router = Router();

/** Safely extract a single string query param (Express query values can be string | string[] | ...) */
function qs(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
  return undefined;
}

function qn(val: unknown): number | undefined {
  const s = qs(val);
  return s !== undefined ? Number(s) : undefined;
}

// ─── Trigger Events ───

router.get('/triggers', (req: Request, res: Response) => {
  const result = queryTriggerEvents({
    triggerId: qs(req.query.triggerId),
    workflowInstanceId: qs(req.query.workflowInstanceId),
    status: qs(req.query.status),
    since: qn(req.query.since),
    limit: qn(req.query.limit) ?? 50,
    offset: qn(req.query.offset) ?? 0,
  });
  res.json(result);
});

// ─── Slack Messages ───

router.get('/slack', (req: Request, res: Response) => {
  const result = querySlackMessages({
    channelId: qs(req.query.channelId),
    threadTs: qs(req.query.threadTs),
    workflowInstanceId: qs(req.query.workflowInstanceId),
    agentId: qs(req.query.agentId),
    since: qn(req.query.since),
    limit: qn(req.query.limit) ?? 50,
  });
  res.json(result);
});

// ─── Email Messages ───

router.get('/email', (req: Request, res: Response) => {
  const result = queryEmailMessages({
    threadId: qs(req.query.threadId),
    workflowInstanceId: qs(req.query.workflowInstanceId),
    direction: qs(req.query.direction),
    since: qn(req.query.since),
    limit: qn(req.query.limit) ?? 50,
  });
  res.json(result);
});

// ─── Approval Events ───

router.get('/approvals', (req: Request, res: Response) => {
  const result = queryApprovalEvents({
    threadId: qs(req.query.threadId),
    workflowInstanceId: qs(req.query.workflowInstanceId),
    limit: qn(req.query.limit) ?? 50,
  });
  res.json(result);
});

// ─── Document Generations ───

router.get('/documents', (req: Request, res: Response) => {
  const result = queryDocumentGenerations({
    templateId: qs(req.query.templateId),
    workflowInstanceId: qs(req.query.workflowInstanceId),
    since: qn(req.query.since),
    limit: qn(req.query.limit) ?? 50,
  });
  res.json(result);
});

// ─── Calendar Event Logs ───

router.get('/calendar', (req: Request, res: Response) => {
  const result = queryCalendarLogs({
    eventId: qs(req.query.eventId),
    workflowInstanceId: qs(req.query.workflowInstanceId),
    since: qn(req.query.since),
    limit: qn(req.query.limit) ?? 50,
  });
  res.json(result);
});

// ─── Jira Ticket Logs ───

router.get('/jira', (req: Request, res: Response) => {
  const result = queryJiraLogs({
    ticketKey: qs(req.query.ticketKey),
    projectKey: qs(req.query.projectKey),
    workflowInstanceId: qs(req.query.workflowInstanceId),
    action: qs(req.query.action),
    since: qn(req.query.since),
    limit: qn(req.query.limit) ?? 50,
  });
  res.json(result);
});

// ─── Audit Log ───

router.get('/audit', (req: Request, res: Response) => {
  const entries = queryAuditLog({
    category: qs(req.query.category),
    level: qs(req.query.level),
    workflowInstanceId: qs(req.query.workflowInstanceId),
    agentId: qs(req.query.agentId),
    since: qn(req.query.since),
    limit: qn(req.query.limit) ?? 100,
    offset: qn(req.query.offset) ?? 0,
  });
  const total = countAuditEntries({
    category: qs(req.query.category),
    level: qs(req.query.level),
    since: qn(req.query.since),
  });
  res.json({ entries, total });
});

// ─── Workflow-centric endpoints ───

router.get('/workflow/:instanceId/timeline', (req: Request, res: Response) => {
  const instanceId = req.params.instanceId as string;

  const instance = getWorkflowInstance(instanceId);
  if (!instance) {
    res.status(404).json({ error: 'Workflow instance not found' });
    return;
  }

  const timeline: TimelineEntry[] = [];

  // Gather all events for this workflow instance
  const triggers = queryTriggerEvents({ workflowInstanceId: instanceId, limit: 1000 });
  for (const e of triggers.events) {
    timeline.push({ type: 'trigger', timestamp: e.firedAt, data: e });
  }

  const slackMsgs = querySlackMessages({ workflowInstanceId: instanceId, limit: 1000 });
  for (const m of slackMsgs.messages) {
    timeline.push({ type: 'slack', timestamp: m.receivedAt, data: m });
  }

  const emails = queryEmailMessages({ workflowInstanceId: instanceId, limit: 1000 });
  for (const m of emails.messages) {
    timeline.push({ type: 'email', timestamp: m.receivedAt, data: m });
  }

  const approvals = queryApprovalEvents({ workflowInstanceId: instanceId, limit: 1000 });
  for (const a of approvals.events) {
    timeline.push({ type: 'approval', timestamp: a.recordedAt, data: a });
  }

  const docs = queryDocumentGenerations({ workflowInstanceId: instanceId, limit: 1000 });
  for (const d of docs.events) {
    timeline.push({ type: 'document', timestamp: d.generatedAt, data: d });
  }

  const calendar = queryCalendarLogs({ workflowInstanceId: instanceId, limit: 1000 });
  for (const c of calendar.events) {
    timeline.push({ type: 'calendar', timestamp: c.recordedAt, data: c });
  }

  const jira = queryJiraLogs({ workflowInstanceId: instanceId, limit: 1000 });
  for (const j of jira.events) {
    timeline.push({ type: 'jira', timestamp: j.recordedAt, data: j });
  }

  const steps = getStepsByInstance(instanceId);
  for (const s of steps) {
    timeline.push({ type: 'step', timestamp: s.enteredAt, data: s });
  }

  const varChanges = getVariableHistory(instanceId);
  for (const v of varChanges) {
    timeline.push({ type: 'variable_change', timestamp: v.changedAt, data: v });
  }

  // Sort chronologically
  timeline.sort((a, b) => a.timestamp - b.timestamp);

  res.json({ timeline, instance });
});

router.get('/workflow/:instanceId/steps', (req: Request, res: Response) => {
  const steps = getStepsByInstance(req.params.instanceId as string);
  res.json({ steps });
});

router.get('/workflow/:instanceId/variables', (req: Request, res: Response) => {
  const changes = getVariableHistory(
    req.params.instanceId as string,
    qs(req.query.variableName)
  );
  res.json({ changes });
});

// ─── Stats ───

router.get('/stats', (_req: Request, res: Response) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayMs = startOfDay.getTime();

  const triggersFiredToday = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM trigger_events WHERE fired_at >= ?',
    [todayMs]
  )?.count ?? 0;

  const slackMessageCount = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM slack_messages'
  )?.count ?? 0;

  const emailCount = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM email_messages'
  )?.count ?? 0;

  const activeWorkflows = countWorkflowInstances({ status: 'running' });
  const completedWorkflows = countWorkflowInstances({ status: 'completed' });
  const failedWorkflows = countWorkflowInstances({ status: 'failed' });

  res.json({
    triggersFiredToday,
    slackMessageCount,
    emailCount,
    activeWorkflows,
    completedWorkflows,
    failedWorkflows,
  });
});

export default router;
