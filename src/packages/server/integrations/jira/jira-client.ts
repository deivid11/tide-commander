/**
 * Jira Client
 * REST API v3 wrapper using raw fetch (no extra dependencies).
 * Authentication: Basic (email:apiToken) for Atlassian Cloud.
 */

import type { IntegrationContext } from '../../../shared/integration-types.js';
import { parseCustomFieldMappings } from './jira-config.js';

// ─── Types ───

export interface JiraIssueParams {
  projectKey: string;
  issueType: string;
  summary: string;
  description: string;
  priority?: string;
  labels?: string[];
  customFields?: Record<string, unknown>;
  assignee?: string;
  reporter?: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    status: { name: string };
    priority?: { name: string };
    assignee?: { displayName: string; emailAddress: string };
    issuetype?: { name: string };
    project?: { key: string; name: string };
    created: string;
    updated: string;
    description?: unknown;
    [key: string]: unknown;
  };
}

export interface JiraTransition {
  id: string;
  name: string;
}

export interface JiraComment {
  id: string;
  author: string;
  body: string;
  created: string;
}

export interface JiraSearchResult {
  issues: JiraIssue[];
  total: number;
  startAt: number;
  maxResults: number;
}

// ─── Client ───

export class JiraClient {
  private baseUrl: string = '';
  private auth: string = '';
  private ctx: IntegrationContext;

  constructor(ctx: IntegrationContext) {
    this.ctx = ctx;
  }

  /** Configure the client with credentials. Call after secrets are available. */
  configure(baseUrl: string, email: string, apiToken: string): void {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
  }

  get isConfigured(): boolean {
    return this.baseUrl.length > 0 && this.auth.length > 0;
  }

  // ─── Issues ───

  async createIssue(params: JiraIssueParams): Promise<JiraIssue> {
    const fields: Record<string, unknown> = {
      project: { key: params.projectKey },
      issuetype: { name: params.issueType },
      summary: params.summary,
      description: this.toADF(params.description),
    };

    if (params.priority) fields.priority = { name: params.priority };
    if (params.labels) fields.labels = params.labels;
    if (params.assignee) fields.assignee = { id: params.assignee };
    if (params.reporter) fields.reporter = { id: params.reporter };

    // Apply custom field mappings from config
    const mappings = parseCustomFieldMappings(
      this.ctx.secrets.get('jira_custom_field_mappings')
    );
    if (params.customFields) {
      for (const [key, value] of Object.entries(params.customFields)) {
        const mapping = mappings.find((m) => m.workflowVariable === key);
        if (mapping) {
          fields[mapping.jiraField] = value;
        } else {
          fields[key] = value;
        }
      }
    }

    const resp = await this.request('POST', '/rest/api/3/issue', { fields });
    const created = resp as { id: string; key: string; self: string };

    // Fetch full issue to return complete data
    return this.getIssue(created.key);
  }

  async getIssue(issueKey: string): Promise<JiraIssue> {
    return (await this.request('GET', `/rest/api/3/issue/${encodeURIComponent(issueKey)}`)) as JiraIssue;
  }

  async updateIssue(issueKey: string, updates: Partial<JiraIssueParams>): Promise<void> {
    const fields: Record<string, unknown> = {};

    if (updates.summary) fields.summary = updates.summary;
    if (updates.description) fields.description = this.toADF(updates.description);
    if (updates.priority) fields.priority = { name: updates.priority };
    if (updates.labels) fields.labels = updates.labels;
    if (updates.assignee) fields.assignee = { id: updates.assignee };
    if (updates.reporter) fields.reporter = { id: updates.reporter };

    // Apply custom field mappings
    const mappings = parseCustomFieldMappings(
      this.ctx.secrets.get('jira_custom_field_mappings')
    );
    if (updates.customFields) {
      for (const [key, value] of Object.entries(updates.customFields)) {
        const mapping = mappings.find((m) => m.workflowVariable === key);
        if (mapping) {
          fields[mapping.jiraField] = value;
        } else {
          fields[key] = value;
        }
      }
    }

    await this.request('PUT', `/rest/api/3/issue/${encodeURIComponent(issueKey)}`, { fields });
  }

  // ─── Comments ───

  async addComment(issueKey: string, body: string): Promise<{ id: string }> {
    const resp = await this.request(
      'POST',
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
      { body: this.toADF(body) }
    );
    return { id: (resp as { id: string }).id };
  }

  async getComments(issueKey: string): Promise<JiraComment[]> {
    const resp = (await this.request(
      'GET',
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`
    )) as { comments: Array<{ id: string; author: { displayName: string }; body: unknown; created: string }> };

    return resp.comments.map((c) => ({
      id: c.id,
      author: c.author.displayName,
      body: this.fromADF(c.body),
      created: c.created,
    }));
  }

  // ─── Transitions ───

  async getTransitions(issueKey: string): Promise<JiraTransition[]> {
    const resp = (await this.request(
      'GET',
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`
    )) as { transitions: Array<{ id: string; name: string }> };

    return resp.transitions.map((t) => ({ id: t.id, name: t.name }));
  }

  async transitionIssue(issueKey: string, transitionId: string, comment?: string): Promise<void> {
    const body: Record<string, unknown> = {
      transition: { id: transitionId },
    };

    if (comment) {
      body.update = {
        comment: [{ add: { body: this.toADF(comment) } }],
      };
    }

    await this.request('POST', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, body);
  }

  // ─── Search ───

  async searchIssues(
    jql: string,
    opts?: { maxResults?: number; startAt?: number; fields?: string[] }
  ): Promise<JiraSearchResult> {
    const body: Record<string, unknown> = {
      jql,
      maxResults: opts?.maxResults ?? 25,
      fields: opts?.fields ?? [
        'summary', 'status', 'priority', 'assignee', 'issuetype',
        'project', 'created', 'updated', 'labels',
      ],
    };

    return (await this.request('POST', '/rest/api/3/search/jql', body)) as JiraSearchResult;
  }

  // ─── Service Desk (optional) ───

  async createServiceRequest(
    serviceDeskId: string,
    requestTypeId: string,
    params: { summary: string; description: string; [key: string]: unknown }
  ): Promise<JiraIssue> {
    const body = {
      serviceDeskId,
      requestTypeId,
      requestFieldValues: {
        summary: params.summary,
        description: params.description,
      },
    };

    const resp = (await this.request(
      'POST',
      '/rest/servicedeskapi/request',
      body
    )) as { issueKey: string; issueId: string };

    return this.getIssue(resp.issueKey);
  }

  // ─── Helpers ───

  /** Convert plain text to Atlassian Document Format (ADF). */
  private toADF(text: string): unknown {
    return {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text }],
        },
      ],
    };
  }

  /** Extract plain text from ADF. */
  private fromADF(adf: unknown): string {
    if (typeof adf === 'string') return adf;
    if (!adf || typeof adf !== 'object') return '';

    const doc = adf as { content?: Array<{ content?: Array<{ text?: string }> }> };
    if (!doc.content) return '';

    return doc.content
      .flatMap((block) => block.content?.map((inline) => inline.text ?? '') ?? [])
      .join('');
  }

  /** Make an authenticated request to the Jira API. */
  private async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<unknown> {
    if (!this.isConfigured) {
      throw new Error('Jira client is not configured. Set base URL, email, and API token.');
    }

    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Basic ${this.auth}`,
      Accept: 'application/json',
    };

    const init: RequestInit = { method, headers };

    if (body) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);

    if (!response.ok) {
      let errorDetail = '';
      try {
        const errorBody = await response.json();
        errorDetail = JSON.stringify(
          (errorBody as { errorMessages?: string[] }).errorMessages ?? errorBody
        );
      } catch {
        errorDetail = await response.text().catch(() => '');
      }
      throw new Error(
        `Jira API ${method} ${path} failed (${response.status}): ${errorDetail}`
      );
    }

    // 204 No Content
    if (response.status === 204) return undefined;

    return response.json();
  }
}
