/**
 * Jira Integration - Express Routes
 * Mounted at /api/jira/ by the integration registry.
 *
 * Endpoints:
 *   POST   /issues                          - Create issue
 *   GET    /issues/:key                     - Get issue
 *   PATCH  /issues/:key                     - Update issue
 *   POST   /issues/:key/comments            - Add comment
 *   GET    /issues/:key/comments            - Get comments
 *   GET    /issues/:key/transitions         - List transitions
 *   POST   /issues/:key/transitions         - Transition issue
 *   GET    /search                          - Search via JQL
 *   POST   /service-desk/:deskId/requests   - Create SD request
 */

import { Router, Request, Response } from 'express';
import type { IntegrationContext } from '../../../shared/integration-types.js';
import type { JiraTicketLogEvent } from '../../../shared/event-types.js';
import type { JiraClient, JiraIssueParams } from './jira-client.js';

export function createJiraRoutes(client: JiraClient, ctx: IntegrationContext): Router {
  const router = Router();

  // ─── Issues ───

  // Create issue
  router.post('/issues', async (req: Request, res: Response) => {
    try {
      const params = req.body as JiraIssueParams;
      if (!params.summary) {
        res.status(400).json({ error: 'summary is required' });
        return;
      }

      // Apply default project/issueType from config if not provided
      if (!params.projectKey) {
        const defaultProject = ctx.secrets.get('jira_default_project');
        if (defaultProject) params.projectKey = defaultProject;
      }
      if (!params.issueType) {
        const defaultType = ctx.secrets.get('jira_default_issue_type');
        if (defaultType) params.issueType = defaultType;
      }

      if (!params.projectKey) {
        res.status(400).json({ error: 'projectKey is required (no default configured)' });
        return;
      }
      if (!params.issueType) {
        res.status(400).json({ error: 'issueType is required (no default configured)' });
        return;
      }

      const issue = await client.createIssue(params);

      // Log to SQLite
      ctx.eventDb.logJiraTicketAction({
        ticketKey: issue.key,
        ticketId: issue.id,
        projectKey: params.projectKey,
        action: 'created',
        summary: params.summary,
        issueType: params.issueType,
        status: issue.fields.status.name,
        priority: params.priority,
        assignee: issue.fields.assignee?.displayName,
        selfUrl: issue.self,
        agentId: req.headers['x-agent-id'] as string | undefined,
        workflowInstanceId: req.headers['x-workflow-id'] as string | undefined,
        recordedAt: Date.now(),
      } as JiraTicketLogEvent);

      res.status(201).json({ key: issue.key, id: issue.id, self: issue.self });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create issue';
      ctx.log.error(`Create issue failed: ${message}`);
      res.status(500).json({ error: message });
    }
  });

  // Get issue
  router.get('/issues/:key', async (req: Request<{ key: string }>, res: Response) => {
    try {
      const issue = await client.getIssue(req.params.key);
      res.json(issue);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get issue';
      res.status(500).json({ error: message });
    }
  });

  // Update issue
  router.patch('/issues/:key', async (req: Request<{ key: string }>, res: Response) => {
    try {
      const updates = req.body as Partial<JiraIssueParams>;
      await client.updateIssue(req.params.key, updates);

      // Fetch updated issue for logging
      const issue = await client.getIssue(req.params.key);

      ctx.eventDb.logJiraTicketAction({
        ticketKey: issue.key,
        ticketId: issue.id,
        projectKey: issue.fields.project?.key ?? '',
        action: 'updated',
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        priority: issue.fields.priority?.name,
        assignee: issue.fields.assignee?.displayName,
        selfUrl: issue.self,
        agentId: req.headers['x-agent-id'] as string | undefined,
        workflowInstanceId: req.headers['x-workflow-id'] as string | undefined,
        recordedAt: Date.now(),
      } as JiraTicketLogEvent);

      res.json({ updated: true, key: issue.key });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update issue';
      ctx.log.error(`Update issue ${req.params.key} failed: ${message}`);
      res.status(500).json({ error: message });
    }
  });

  // ─── Comments ───

  // Add comment
  router.post('/issues/:key/comments', async (req: Request<{ key: string }>, res: Response) => {
    try {
      const { body } = req.body as { body: string };
      if (!body) {
        res.status(400).json({ error: 'body is required' });
        return;
      }

      const result = await client.addComment(req.params.key, body);

      // Fetch issue for logging context
      const issue = await client.getIssue(req.params.key);

      ctx.eventDb.logJiraTicketAction({
        ticketKey: issue.key,
        ticketId: issue.id,
        projectKey: issue.fields.project?.key ?? '',
        action: 'commented',
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        commentBody: body,
        selfUrl: issue.self,
        agentId: req.headers['x-agent-id'] as string | undefined,
        workflowInstanceId: req.headers['x-workflow-id'] as string | undefined,
        recordedAt: Date.now(),
      } as JiraTicketLogEvent);

      res.json({ id: result.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add comment';
      res.status(500).json({ error: message });
    }
  });

  // Get comments
  router.get('/issues/:key/comments', async (req: Request<{ key: string }>, res: Response) => {
    try {
      const comments = await client.getComments(req.params.key);
      res.json({ comments });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get comments';
      res.status(500).json({ error: message });
    }
  });

  // ─── Transitions ───

  // List transitions
  router.get('/issues/:key/transitions', async (req: Request<{ key: string }>, res: Response) => {
    try {
      const transitions = await client.getTransitions(req.params.key);
      res.json({ transitions });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get transitions';
      res.status(500).json({ error: message });
    }
  });

  // Transition issue
  router.post('/issues/:key/transitions', async (req: Request<{ key: string }>, res: Response) => {
    try {
      const { transitionId, comment } = req.body as {
        transitionId: string;
        comment?: string;
      };

      if (!transitionId) {
        res.status(400).json({ error: 'transitionId is required' });
        return;
      }

      await client.transitionIssue(req.params.key, transitionId, comment);

      // Fetch updated issue to log new status
      const issue = await client.getIssue(req.params.key);

      ctx.eventDb.logJiraTicketAction({
        ticketKey: issue.key,
        ticketId: issue.id,
        projectKey: issue.fields.project?.key ?? '',
        action: 'transitioned',
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        priority: issue.fields.priority?.name,
        commentBody: comment,
        selfUrl: issue.self,
        agentId: req.headers['x-agent-id'] as string | undefined,
        workflowInstanceId: req.headers['x-workflow-id'] as string | undefined,
        recordedAt: Date.now(),
      } as JiraTicketLogEvent);

      res.json({ transitioned: true, key: issue.key, status: issue.fields.status.name });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to transition issue';
      ctx.log.error(`Transition ${req.params.key} failed: ${message}`);
      res.status(500).json({ error: message });
    }
  });

  // ─── Search ───

  router.get('/search', async (req: Request, res: Response) => {
    try {
      const jql = req.query.jql as string;
      if (!jql) {
        res.status(400).json({ error: 'jql query parameter is required' });
        return;
      }

      const maxResults = parseInt(req.query.maxResults as string) || 25;
      const startAt = parseInt(req.query.startAt as string) || 0;

      const result = await client.searchIssues(jql, { maxResults, startAt });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Search failed';
      res.status(500).json({ error: message });
    }
  });

  // ─── Service Desk ───

  router.post(
    '/service-desk/:deskId/requests',
    async (req: Request<{ deskId: string }>, res: Response) => {
      try {
        const { requestTypeId, summary, description, ...rest } = req.body as {
          requestTypeId: string;
          summary: string;
          description: string;
          [key: string]: unknown;
        };

        if (!requestTypeId || !summary) {
          res.status(400).json({ error: 'requestTypeId and summary are required' });
          return;
        }

        const issue = await client.createServiceRequest(req.params.deskId, requestTypeId, {
          summary,
          description: description || '',
          ...rest,
        });

        ctx.eventDb.logJiraTicketAction({
          ticketKey: issue.key,
          ticketId: issue.id,
          projectKey: issue.fields.project?.key ?? '',
          action: 'created',
          summary,
          issueType: 'Service Request',
          status: issue.fields.status.name,
          selfUrl: issue.self,
          agentId: req.headers['x-agent-id'] as string | undefined,
          workflowInstanceId: req.headers['x-workflow-id'] as string | undefined,
          recordedAt: Date.now(),
        } as JiraTicketLogEvent);

        res.status(201).json({ key: issue.key, id: issue.id, self: issue.self });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create service request';
        res.status(500).json({ error: message });
      }
    }
  );

  return router;
}
