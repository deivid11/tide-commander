import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { JiraIssue, JiraSearchResult } from '../../integrations/jira/jira-client.js';

const searchIssues = vi.fn();
const getIssue = vi.fn();
const getComments = vi.fn();
const listAttachments = vi.fn();
const downloadAttachment = vi.fn();

vi.mock('../../integrations/jira/index.js', () => ({
  getJiraBaseUrl: vi.fn(() => 'https://example.atlassian.net'),
  requireJiraClient: vi.fn(() => ({
    searchIssues,
    getIssue,
    getComments,
    listAttachments,
    downloadAttachment,
  })),
}));

import { PluginManager } from '../manager.js';
import { jiraTicketsPlugin } from './jira-tickets.js';

let testRoot: string;

function issue(overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    id: '10042',
    key: 'OPS-42',
    self: 'https://example.atlassian.net/rest/api/3/issue/10042',
    fields: {
      summary: 'Investigate production alert',
      status: { name: 'In Progress' },
      priority: { name: 'High' },
      assignee: { displayName: 'Ada Lovelace', emailAddress: 'ada@example.com' },
      issuetype: { name: 'Task' },
      project: { key: 'OPS', name: 'Operations' },
      created: '2026-08-20T10:00:00.000Z',
      updated: '2026-08-21T15:00:00.000Z',
      labels: ['production'],
      description: {
        version: 1,
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Full ticket details.' }] }],
      },
    },
    ...overrides,
  };
}

function searchResult(issues = [issue()]): JiraSearchResult {
  return { issues, total: issues.length, startAt: 0, maxResults: 20 };
}

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-jira-plugin-'));
  searchIssues.mockResolvedValue(searchResult());
  getIssue.mockResolvedValue(issue());
  getComments.mockResolvedValue([{
    id: 'comment-1',
    author: 'Grace Hopper',
    body: 'Please attach the diagnostic report.',
    created: '2026-08-21T16:00:00.000Z',
  }]);
  listAttachments.mockResolvedValue([{
    id: 'attachment-1',
    filename: 'diagnostic.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    contentUrl: 'https://example.atlassian.net/attachment/1',
    authorDisplayName: 'Grace Hopper',
    created: '2026-08-21T16:05:00.000Z',
  }]);
  downloadAttachment.mockImplementation(async (_id: string, outputPath: string) => ({
    path: outputPath,
    bytes: 2048,
  }));
});

afterEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
  vi.clearAllMocks();
});

function makeManager(): PluginManager {
  return new PluginManager({
    dataDir: path.join(testRoot, 'state'),
    builtins: [jiraTicketsPlugin],
  });
}

describe('builtin Jira Tickets plugin', () => {
  it('shows all pending tickets visible to the configured Jira account', async () => {
    const manager = makeManager();
    await manager.initialize();

    const output = await manager.executeSlashCommand('agent-1', '/jira');

    expect(searchIssues).toHaveBeenCalledWith(
      'statusCategory in ("To Do", "In Progress") ORDER BY updated DESC',
      { maxResults: 20 },
    );
    expect(output).toMatchObject({
      pluginId: 'jira-tickets',
      rendererId: 'jira-ticket-list',
      data: {
        kind: 'jira-ticket-list',
        title: 'Todos los tickets pendientes',
        mode: 'pending',
        count: 1,
        items: [{
          key: 'OPS-42',
          summary: 'Investigate production alert',
          status: 'In Progress',
          priority: 'High',
          assignee: 'Ada Lovelace',
          url: 'https://example.atlassian.net/browse/OPS-42',
        }],
      },
    });
    expect(manager.get('jira-tickets')?.contributes?.settings?.[0]).toMatchObject({
      type: 'integration',
      integrationId: 'jira',
      secrets: ['jira_base_url', 'jira_email', 'jira_api_token'],
    });
    await manager.shutdown();
  });

  it('gets a specific ticket by issue key and includes its description', async () => {
    const manager = makeManager();
    await manager.initialize();

    const output = await manager.executeSlashCommand('agent-1', '/jira ops-42');

    expect(getIssue).toHaveBeenCalledWith('OPS-42');
    expect(searchIssues).not.toHaveBeenCalled();
    expect(output.data).toMatchObject({
      mode: 'issue',
      query: 'OPS-42',
      items: [{ key: 'OPS-42', description: 'Full ticket details.' }],
    });
    await manager.shutdown();
  });

  it('searches ticket text with a bounded JQL query', async () => {
    const manager = makeManager();
    await manager.initialize();

    const output = await manager.executeSlashCommand('agent-1', '/jira buscar production alert');

    expect(searchIssues).toHaveBeenCalledWith(
      'updated >= -365d AND text ~ "production alert" ORDER BY updated DESC',
      { maxResults: 20 },
    );
    expect(output.data).toMatchObject({ mode: 'search', query: 'production alert' });
    await manager.shutdown();
  });

  it('searches from the interactive card and preserves the output instance', async () => {
    const manager = makeManager();
    await manager.initialize();

    const output = await manager.executeAction('jira-tickets', 'search', {
      instanceId: 'jira-card-1',
      rendererId: 'jira-ticket-list',
      query: 'OPS-42',
      data: { mode: 'pending', limit: 15 },
    });

    expect(getIssue).toHaveBeenCalledWith('OPS-42');
    expect(output.instanceId).toBe('jira-card-1');
    expect(output.data).toMatchObject({ mode: 'issue', limit: 15 });
    await manager.shutdown();
  });

  it('loads full ticket details, comments, and attachments on row expansion', async () => {
    const manager = makeManager();
    await manager.initialize();

    const output = await manager.executeAction('jira-tickets', 'details', {
      itemId: 'OPS-42',
      instanceId: 'jira-card-1',
      rendererId: 'jira-ticket-list',
    });

    expect(getIssue).toHaveBeenCalledWith('OPS-42');
    expect(getComments).toHaveBeenCalledWith('OPS-42');
    expect(listAttachments).toHaveBeenCalledWith('OPS-42');
    expect(output.data).toMatchObject({
      kind: 'jira-ticket-details',
      ticket: { key: 'OPS-42', description: 'Full ticket details.' },
      comments: [{ author: 'Grace Hopper', body: 'Please attach the diagnostic report.' }],
      attachments: [{
        id: 'attachment-1',
        filename: 'diagnostic.pdf',
        mimeType: 'application/pdf',
        size: 2048,
      }],
    });
    expect(JSON.stringify(output.data)).not.toContain('contentUrl');
    await manager.shutdown();
  });

  it('caches an attachment for Tide Commander file-viewer preview', async () => {
    const manager = makeManager();
    await manager.initialize();

    const output = await manager.executeAction('jira-tickets', 'preview-attachment', {
      issueKey: 'OPS-42',
      item: {
        id: 'attachment-1',
        filename: 'diagnostic.pdf',
        mimeType: 'application/pdf',
        size: 2048,
      },
    });

    expect(downloadAttachment).toHaveBeenCalledWith(
      'attachment-1',
      expect.stringMatching(/jira-attachments[\\/]OPS-42[\\/]attachment-1[\\/]diagnostic\.pdf$/),
    );
    expect(output.data).toMatchObject({
      kind: 'jira-attachment-preview',
      filename: 'diagnostic.pdf',
      bytes: 2048,
    });
    await manager.shutdown();
  });

  it('validates pending limits and empty searches', async () => {
    const manager = makeManager();
    await manager.initialize();

    await expect(manager.executeSlashCommand('agent-1', '/jira pending 100'))
      .rejects.toThrow('between 1 and 50');
    await expect(manager.executeSlashCommand('agent-1', '/jira buscar'))
      .rejects.toThrow('requires a ticket key or text');
    await manager.shutdown();
  });
});
