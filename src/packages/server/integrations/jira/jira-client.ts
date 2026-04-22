/**
 * Jira Client
 * REST API v3 wrapper using raw fetch (no extra dependencies).
 * Authentication: Basic (email:apiToken) for Atlassian Cloud.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
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

export interface JiraAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  /** Direct, authenticated download URL returned by Jira (includes signed query params or base path). */
  contentUrl: string;
  authorDisplayName?: string;
  created?: string;
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

  // ─── Attachments ───

  /**
   * List all attachments on a Jira issue.
   * @param issueKey Issue key or numeric id (e.g. "SD-1234").
   * @returns Array of attachment descriptors (id, filename, mimeType, size, contentUrl, author, created).
   */
  async listAttachments(issueKey: string): Promise<JiraAttachment[]> {
    const resp = (await this.request(
      'GET',
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=attachment`
    )) as {
      fields?: {
        attachment?: Array<{
          id: string;
          filename: string;
          mimeType: string;
          size: number;
          content: string;
          author?: { displayName?: string };
          created?: string;
        }>;
      };
    };

    const list = resp.fields?.attachment ?? [];
    return list.map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      contentUrl: a.content,
      authorDisplayName: a.author?.displayName,
      created: a.created,
    }));
  }

  /**
   * List attachments referenced by comments on an issue.
   * Comments reference media via ADF nodes of type "media"; those ids resolve to entries in the
   * issue's own attachment list.
   * @param issueKey Issue key or numeric id.
   * @param commentId Optional — restrict to a single comment.
   * @returns Attachments referenced by matching comment ADF bodies.
   */
  async listCommentAttachments(issueKey: string, commentId?: string): Promise<JiraAttachment[]> {
    const resp = (await this.request(
      'GET',
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`
    )) as { comments?: Array<{ id: string; body?: unknown }> };

    const comments = commentId
      ? (resp.comments ?? []).filter((c) => c.id === commentId)
      : resp.comments ?? [];

    const mediaIds = new Set<string>();
    for (const c of comments) {
      for (const id of extractMediaIdsFromADF(c.body)) mediaIds.add(id);
    }
    if (mediaIds.size === 0) return [];

    const all = await this.listAttachments(issueKey);
    return all.filter((a) => mediaIds.has(a.id));
  }

  /**
   * Download a single attachment to disk.
   * @param attachment Either the attachment id (string) or a full {@link JiraAttachment} object.
   * @param outputPath Absolute or relative destination file path. Parent directory is created.
   * @returns The destination path and bytes written.
   */
  async downloadAttachment(
    attachment: string | JiraAttachment,
    outputPath: string
  ): Promise<{ path: string; bytes: number }> {
    if (!this.isConfigured) {
      throw new Error('Jira client is not configured. Set base URL, email, and API token.');
    }

    const url =
      typeof attachment === 'string'
        ? `${this.baseUrl}/rest/api/3/attachment/content/${encodeURIComponent(attachment)}`
        : attachment.contentUrl;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${this.auth}`,
        Accept: '*/*',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const id = typeof attachment === 'string' ? attachment : attachment.id;
      throw new Error(
        `Jira attachment download failed for id ${id} (${response.status}): ${detail}`
      );
    }

    const buf = Buffer.from(await response.arrayBuffer());
    await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
    await fs.writeFile(outputPath, buf);
    return { path: outputPath, bytes: buf.byteLength };
  }

  /**
   * Fetch an attachment's raw bytes along with relevant response headers. Used by the HTTP
   * proxy route to stream content back to a caller without exposing credentials.
   * @param attachmentId Jira attachment id.
   */
  async fetchAttachmentBytes(
    attachmentId: string
  ): Promise<{
    buffer: Buffer;
    contentType: string | null;
    contentDisposition: string | null;
    contentLength: string | null;
  }> {
    if (!this.isConfigured) {
      throw new Error('Jira client is not configured. Set base URL, email, and API token.');
    }

    const response = await fetch(
      `${this.baseUrl}/rest/api/3/attachment/content/${encodeURIComponent(attachmentId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Basic ${this.auth}`,
          Accept: '*/*',
        },
        redirect: 'follow',
      }
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Jira attachment fetch failed for id ${attachmentId} (${response.status}): ${detail}`
      );
    }

    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type'),
      contentDisposition: response.headers.get('content-disposition'),
      contentLength: response.headers.get('content-length'),
    };
  }

  /**
   * Download every attachment on an issue (optionally also those referenced by comments) to a directory.
   * Filename collisions overwrite.
   * @param issueKey Issue key or numeric id.
   * @param outputDir Directory to write files into; created recursively if missing.
   * @param opts.includeComments When true, union in attachments referenced by the issue's comments.
   * @returns The list of attachments that were downloaded.
   */
  async downloadAllAttachments(
    issueKey: string,
    outputDir: string,
    opts?: { includeComments?: boolean }
  ): Promise<JiraAttachment[]> {
    await fs.mkdir(outputDir, { recursive: true });

    const issueAtts = await this.listAttachments(issueKey);
    const byId = new Map<string, JiraAttachment>();
    for (const a of issueAtts) byId.set(a.id, a);

    if (opts?.includeComments) {
      const commentAtts = await this.listCommentAttachments(issueKey);
      for (const a of commentAtts) if (!byId.has(a.id)) byId.set(a.id, a);
    }

    const downloaded: JiraAttachment[] = [];
    for (const att of byId.values()) {
      const safeName = sanitizeFilename(att.filename) || att.id;
      const outPath = path.join(outputDir, safeName);
      await this.downloadAttachment(att, outPath);
      downloaded.push(att);
    }
    return downloaded;
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

// ─── Module-level helpers ───

/** Walk an ADF document and return all media-node ids (`{type:"media",attrs:{id,...}}`). */
function extractMediaIdsFromADF(adf: unknown): string[] {
  const ids: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; attrs?: { id?: string }; content?: unknown[] };
    if (n.type === 'media' && typeof n.attrs?.id === 'string') {
      ids.push(n.attrs.id);
    }
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
    }
  };
  walk(adf);
  return ids;
}

/** Strip path separators and NUL so an attachment filename is safe to join with an outputDir. */
function sanitizeFilename(name: string): string {
  return name.replace(/[\\/\0]/g, '_').replace(/^\.+/, '_').trim();
}
