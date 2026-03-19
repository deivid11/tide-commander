/**
 * Jira Integration - Trigger Handler
 * Implements TriggerHandler for 'jira' trigger type.
 *
 * Jira webhooks arrive at /api/triggers/webhook/:triggerId (via core webhook route).
 * The handler provides structural matching by project, event type, and JQL-like fields,
 * extracts standard variables, and formats events for LLM matching.
 */

import type {
  TriggerHandler,
  TriggerDefinition,
  ExternalEvent,
} from '../../../shared/integration-types.js';

// ─── Jira Webhook Event Shape ───

interface JiraWebhookData {
  webhookEvent?: string;
  issue_event_type_name?: string;
  user?: { displayName?: string; emailAddress?: string; accountId?: string };
  issue?: {
    id?: string;
    key?: string;
    self?: string;
    fields?: {
      summary?: string;
      status?: { name?: string };
      priority?: { name?: string };
      project?: { key?: string; name?: string };
      issuetype?: { name?: string };
      assignee?: { displayName?: string; emailAddress?: string };
      reporter?: { displayName?: string; emailAddress?: string };
      description?: unknown;
      labels?: string[];
      created?: string;
      updated?: string;
      [key: string]: unknown;
    };
  };
  changelog?: {
    items?: Array<{
      field: string;
      fromString?: string;
      toString?: string;
    }>;
  };
  comment?: {
    id?: string;
    body?: unknown;
    author?: { displayName?: string };
    created?: string;
  };
}

// ─── Trigger Handler ───

export const jiraTriggerHandler: TriggerHandler = {
  triggerType: 'jira',

  async startListening(_onEvent) {
    // Jira webhooks are push-based and arrive via the core webhook route
    // (/api/triggers/webhook/:triggerId). No persistent connection needed.
    // The user configures the webhook URL in Jira Settings → System → Webhooks.
  },

  async stopListening() {
    // No persistent connection to tear down
  },

  structuralMatch(trigger: TriggerDefinition, event: ExternalEvent): boolean {
    const config = trigger.config;
    const data = event.data as JiraWebhookData;

    // Filter by project key
    if (config.projectKey) {
      const projectKey = data.issue?.fields?.project?.key;
      if (projectKey !== config.projectKey) return false;
    }

    // Filter by webhook event types
    if (config.events) {
      const events = config.events as string[];
      const webhookEvent = data.webhookEvent ?? data.issue_event_type_name;
      if (events.length > 0 && webhookEvent && !events.includes(webhookEvent)) {
        return false;
      }
    }

    // Filter by issue type
    if (config.issueType) {
      const issueType = data.issue?.fields?.issuetype?.name;
      if (issueType && issueType !== config.issueType) return false;
    }

    // Simple JQL-like filter on labels
    if (config.jqlFilter) {
      const jql = config.jqlFilter as string;
      // Support simple label matching: labels = "cc"
      const labelMatch = jql.match(/labels\s*=\s*["']?(\w+)["']?/i);
      if (labelMatch) {
        const labels = data.issue?.fields?.labels ?? [];
        if (!labels.includes(labelMatch[1])) return false;
      }
      // Support simple status matching: status = "Done"
      const statusMatch = jql.match(/status\s*=\s*["']([^"']+)["']/i);
      if (statusMatch) {
        const status = data.issue?.fields?.status?.name;
        if (status !== statusMatch[1]) return false;
      }
    }

    return true;
  },

  extractVariables(trigger: TriggerDefinition, event: ExternalEvent): Record<string, string> {
    const data = event.data as JiraWebhookData;
    const issue = data.issue;
    const fields = issue?.fields;

    const vars: Record<string, string> = {
      'trigger.name': trigger.name,
      'jira.eventType': data.webhookEvent ?? data.issue_event_type_name ?? 'unknown',
      'jira.issueKey': issue?.key ?? '',
      'jira.issueId': issue?.id ?? '',
      'jira.summary': fields?.summary ?? '',
      'jira.status': fields?.status?.name ?? '',
      'jira.project': fields?.project?.key ?? '',
      'jira.projectName': fields?.project?.name ?? '',
      'jira.issueType': fields?.issuetype?.name ?? '',
      'jira.priority': fields?.priority?.name ?? '',
      'jira.assignee': fields?.assignee?.displayName ?? '',
      'jira.reporter': fields?.reporter?.displayName ?? '',
      'jira.user': data.user?.displayName ?? '',
      timestamp: new Date().toISOString(),
    };

    // Include labels as comma-separated
    if (fields?.labels && fields.labels.length > 0) {
      vars['jira.labels'] = fields.labels.join(', ');
    }

    // Include changelog for update events
    if (data.changelog?.items) {
      const changes = data.changelog.items
        .map((item) => `${item.field}: "${item.fromString ?? ''}" → "${item.toString ?? ''}"`)
        .join('; ');
      vars['jira.changes'] = changes;
    }

    // Include comment body if present
    if (data.comment) {
      vars['jira.commentAuthor'] = data.comment.author?.displayName ?? '';
      // ADF body — flatten to text
      vars['jira.commentBody'] = flattenADF(data.comment.body);
    }

    return vars;
  },

  formatEventForLLM(event: ExternalEvent): string {
    const data = event.data as JiraWebhookData;
    const issue = data.issue;
    const fields = issue?.fields;

    const lines = [
      `Jira ${data.webhookEvent ?? 'event'} in project ${fields?.project?.key ?? 'unknown'}`,
      `Issue: ${issue?.key ?? 'N/A'} — ${fields?.summary ?? 'No summary'}`,
      `Type: ${fields?.issuetype?.name ?? 'N/A'}`,
      `Status: ${fields?.status?.name ?? 'N/A'}`,
      `Priority: ${fields?.priority?.name ?? 'None'}`,
      `Assignee: ${fields?.assignee?.displayName ?? 'Unassigned'}`,
      `Reporter: ${fields?.reporter?.displayName ?? 'Unknown'}`,
      `User who triggered: ${data.user?.displayName ?? 'Unknown'}`,
    ];

    if (fields?.labels && fields.labels.length > 0) {
      lines.push(`Labels: ${fields.labels.join(', ')}`);
    }

    if (data.changelog?.items && data.changelog.items.length > 0) {
      lines.push('Changes:');
      for (const item of data.changelog.items) {
        lines.push(`  ${item.field}: "${item.fromString ?? ''}" → "${item.toString ?? ''}"`);
      }
    }

    if (data.comment) {
      lines.push(`Comment by ${data.comment.author?.displayName ?? 'Unknown'}:`);
      lines.push(`  ${flattenADF(data.comment.body)}`);
    }

    return lines.join('\n');
  },
};

/** Flatten Atlassian Document Format to plain text. */
function flattenADF(adf: unknown): string {
  if (typeof adf === 'string') return adf;
  if (!adf || typeof adf !== 'object') return '';

  const doc = adf as { content?: Array<{ content?: Array<{ text?: string }> }> };
  if (!doc.content) return '';

  return doc.content
    .flatMap((block) => block.content?.map((inline) => inline.text ?? '') ?? [])
    .join('');
}
