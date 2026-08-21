import * as path from 'node:path';
import type {
  PluginActionContext,
  PluginCommandContext,
  TideServerPluginActivation,
} from '../../../shared/plugin-types.js';
import type { JiraAttachment, JiraComment, JiraIssue } from '../../integrations/jira/jira-client.js';
import { getJiraBaseUrl, requireJiraClient } from '../../integrations/jira/index.js';
import { getDataDir } from '../../data/index.js';
import type { BuiltinPluginDefinition } from '../manager.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_SEARCH_LENGTH = 200;
const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/i;
const PENDING_JQL = 'statusCategory in ("To Do", "In Progress") ORDER BY updated DESC';

type JiraViewMode = 'pending' | 'search' | 'issue';

type JiraTicketItem = {
  id: string;
  key: string;
  summary: string;
  description?: string;
  status: string;
  priority?: string;
  assignee?: string;
  issueType?: string;
  project?: string;
  created?: string;
  updated?: string;
  labels: string[];
  reporter?: string;
  dueDate?: string;
  resolution?: string;
  components: string[];
  fixVersions: string[];
  url: string;
};

type JiraTicketDetailsData = Record<string, unknown> & {
  kind: 'jira-ticket-details';
  ticket: JiraTicketItem;
  comments: JiraComment[];
  attachments: Array<{
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    author?: string;
    created?: string;
  }>;
};

export type JiraTicketListData = Record<string, unknown> & {
  kind: 'jira-ticket-list';
  title: string;
  mode: JiraViewMode;
  query?: string;
  jql?: string;
  count: number;
  total: number;
  limit: number;
  items: JiraTicketItem[];
  actions: {
    refresh: string;
    search: string;
    details: string;
    previewAttachment: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIMIT;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    throw new Error(`Jira ticket limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return parsed;
}

function cleanSearch(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Jira search requires a ticket key or text');
  const clean = value.trim();
  if (!clean) throw new Error('Jira search requires a ticket key or text');
  if (clean.length > MAX_SEARCH_LENGTH) throw new Error(`Jira search is limited to ${MAX_SEARCH_LENGTH} characters`);
  return clean;
}

function jqlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function adfToText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  const lines: string[] = [];
  const walk = (node: unknown): void => {
    if (!isRecord(node)) return;
    if (typeof node.text === 'string') lines.push(node.text);
    if (node.type === 'hardBreak') lines.push('\n');
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
      if (['paragraph', 'heading', 'listItem'].includes(String(node.type))) lines.push('\n');
    }
  };
  walk(value);
  const text = lines.join('').replace(/\n{3,}/g, '\n\n').trim();
  return text || undefined;
}

function ticketUrl(key: string): string {
  const baseUrl = getJiraBaseUrl()?.replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Jira base URL is not configured');
  return `${baseUrl}/browse/${encodeURIComponent(key)}`;
}

function nameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => isRecord(entry) && typeof entry.name === 'string' ? [entry.name] : []);
}

function displayName(value: unknown): string | undefined {
  return isRecord(value) && typeof value.displayName === 'string' ? value.displayName : undefined;
}

function namedValue(value: unknown): string | undefined {
  return isRecord(value) && typeof value.name === 'string' ? value.name : undefined;
}

function toTicketItem(issue: JiraIssue): JiraTicketItem {
  const labels = Array.isArray(issue.fields.labels)
    ? issue.fields.labels.filter((label): label is string => typeof label === 'string')
    : [];
  return {
    id: issue.id,
    key: issue.key,
    summary: issue.fields.summary || '(sin resumen)',
    description: adfToText(issue.fields.description),
    status: issue.fields.status?.name || 'Unknown',
    priority: issue.fields.priority?.name,
    assignee: issue.fields.assignee?.displayName,
    issueType: issue.fields.issuetype?.name,
    project: issue.fields.project?.key,
    created: issue.fields.created,
    updated: issue.fields.updated,
    labels,
    reporter: displayName(issue.fields.reporter),
    dueDate: typeof issue.fields.duedate === 'string' ? issue.fields.duedate : undefined,
    resolution: namedValue(issue.fields.resolution),
    components: nameList(issue.fields.components),
    fixVersions: nameList(issue.fields.fixVersions),
    url: ticketUrl(issue.key),
  };
}

function response(
  title: string,
  mode: JiraViewMode,
  items: JiraTicketItem[],
  options: { limit: number; total?: number; query?: string; jql?: string },
): JiraTicketListData {
  return {
    kind: 'jira-ticket-list',
    title,
    mode,
    query: options.query,
    jql: options.jql,
    count: items.length,
    total: options.total ?? items.length,
    limit: options.limit,
    items,
    actions: {
      refresh: 'refresh',
      search: 'search',
      details: 'details',
      previewAttachment: 'preview-attachment',
    },
  };
}

export async function fetchPendingTickets(limit = DEFAULT_LIMIT): Promise<JiraTicketListData> {
  const result = await requireJiraClient().searchIssues(PENDING_JQL, { maxResults: limit });
  return response('Todos los tickets pendientes', 'pending', result.issues.map(toTicketItem), {
    limit,
    total: result.total,
    jql: PENDING_JQL,
  });
}

export async function fetchTicket(issueKey: string, limit = DEFAULT_LIMIT): Promise<JiraTicketListData> {
  const key = cleanSearch(issueKey).toUpperCase();
  if (!ISSUE_KEY_RE.test(key)) throw new Error('Invalid Jira issue key; expected a value such as PROJ-123');
  const issue = await requireJiraClient().getIssue(key);
  return response(`Ticket ${issue.key}`, 'issue', [toTicketItem(issue)], {
    limit,
    query: key,
  });
}

export async function searchTickets(query: string, limit = DEFAULT_LIMIT): Promise<JiraTicketListData> {
  const clean = cleanSearch(query);
  if (ISSUE_KEY_RE.test(clean)) return fetchTicket(clean, limit);
  const jql = `updated >= -365d AND text ~ ${jqlString(clean)} ORDER BY updated DESC`;
  const result = await requireJiraClient().searchIssues(jql, { maxResults: limit });
  return response(`Resultados para “${clean}”`, 'search', result.issues.map(toTicketItem), {
    limit,
    total: result.total,
    query: clean,
    jql,
  });
}

function commandResult(context: PluginCommandContext): Promise<JiraTicketListData> {
  if (context.args.length === 0) return fetchPendingTickets();
  const [first, ...rest] = context.args;
  const normalized = first.toLowerCase();
  if (/^\d+$/.test(first) && rest.length === 0) return fetchPendingTickets(parseLimit(first));
  if (['pending', 'pendientes', 'todos'].includes(normalized)) {
    if (rest.length > 1) throw new Error('Usage: /jira pending [limit]');
    return fetchPendingTickets(parseLimit(rest[0]));
  }
  if (['search', 'buscar', 'busca'].includes(normalized)) {
    return searchTickets(cleanSearch(rest.join(' ')));
  }
  return searchTickets(context.argsText);
}

function actionState(context: PluginActionContext): { mode: JiraViewMode; query?: string; limit: number } {
  if (!isRecord(context.data)) return { mode: 'pending', limit: DEFAULT_LIMIT };
  const mode = context.data.mode === 'issue' || context.data.mode === 'search'
    ? context.data.mode
    : 'pending';
  return {
    mode,
    query: typeof context.data.query === 'string' ? context.data.query : undefined,
    limit: parseLimit(context.data.limit),
  };
}

async function refresh(context: PluginActionContext): Promise<JiraTicketListData> {
  const state = actionState(context);
  if (state.mode === 'pending') return fetchPendingTickets(state.limit);
  if (state.mode === 'issue' && state.query) return fetchTicket(state.query, state.limit);
  if (state.query) return searchTickets(state.query, state.limit);
  return fetchPendingTickets(state.limit);
}

async function search(context: PluginActionContext): Promise<JiraTicketListData> {
  return searchTickets(cleanSearch(context.body.query), actionState(context).limit);
}

function issueKeyFromAction(context: PluginActionContext): string {
  const nestedKey = isRecord(context.item) && typeof context.item.key === 'string'
    ? context.item.key
    : undefined;
  const candidate = typeof context.itemId === 'string' ? context.itemId : nestedKey;
  const key = candidate?.trim().toUpperCase() ?? '';
  if (!ISSUE_KEY_RE.test(key)) throw new Error('Jira details action requires a valid issue key');
  return key;
}

function cleanAttachments(attachments: JiraAttachment[]): JiraTicketDetailsData['attachments'] {
  return attachments.map((attachment) => ({
    id: attachment.id,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.size,
    author: attachment.authorDisplayName,
    created: attachment.created,
  }));
}

async function details(context: PluginActionContext): Promise<JiraTicketDetailsData> {
  const key = issueKeyFromAction(context);
  const jira = requireJiraClient();
  const [issue, comments, attachments] = await Promise.all([
    jira.getIssue(key),
    jira.getComments(key),
    jira.listAttachments(key),
  ]);
  return {
    kind: 'jira-ticket-details',
    ticket: toTicketItem(issue),
    comments,
    attachments: cleanAttachments(attachments),
  };
}

function attachmentFromAction(context: PluginActionContext): { id: string; filename: string; issueKey: string } {
  if (!isRecord(context.item)) throw new Error('Jira attachment preview requires attachment metadata');
  const id = typeof context.item.id === 'string' ? context.item.id.trim() : '';
  const rawFilename = typeof context.item.filename === 'string' ? context.item.filename.trim() : '';
  const issueKey = typeof context.body.issueKey === 'string' ? context.body.issueKey.trim().toUpperCase() : '';
  if (!id || id.length > 256 || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid Jira attachment id');
  if (!ISSUE_KEY_RE.test(issueKey)) throw new Error('Invalid Jira issue key for attachment preview');
  const filename = path.basename(rawFilename)
    .replace(/[\\/\x00-\x1f\x7f]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 200);
  if (!filename) throw new Error('Invalid Jira attachment filename');
  return { id, filename, issueKey };
}

async function previewAttachment(context: PluginActionContext): Promise<Record<string, unknown>> {
  const attachment = attachmentFromAction(context);
  const targetPath = path.join(
    getDataDir(),
    'cache',
    'jira-attachments',
    attachment.issueKey,
    attachment.id,
    attachment.filename,
  );
  const downloaded = await requireJiraClient().downloadAttachment(attachment.id, targetPath);
  return {
    kind: 'jira-attachment-preview',
    path: downloaded.path,
    filename: attachment.filename,
    bytes: downloaded.bytes,
  };
}

function activateJiraTickets(): TideServerPluginActivation {
  return {
    commands: { 'show-jira-tickets': commandResult },
    actions: {
      refresh,
      search,
      details,
      'preview-attachment': previewAttachment,
    },
  };
}

export const jiraTicketsPlugin: BuiltinPluginDefinition = {
  manifest: {
    id: 'jira-tickets',
    name: 'Jira Tickets',
    version: '1.3.0',
    description: 'Show all pending Jira tickets and search by issue key or text.',
    contributes: {
      slashCommands: [{
        name: '/jira',
        aliases: ['/tickets', '/ticket', '/jira-tickets'],
        summary: 'Mostrar pendientes o buscar: /jira [PROJ-123|buscar texto|pending 20]',
        handler: 'show-jira-tickets',
        renderer: 'jira-ticket-list',
      }],
      outputRenderers: [{ id: 'jira-ticket-list' }],
      settings: [{
        id: 'jira-connection',
        type: 'integration',
        integrationId: 'jira',
        title: 'Conexión con Jira Cloud',
        description: 'Configura la instancia y la cuenta que usa el plugin para consultar tickets.',
        instructions: [
          'Copia la URL de tu sitio de Atlassian Cloud, por ejemplo https://empresa.atlassian.net.',
          'Genera un API token desde la seguridad de tu cuenta de Atlassian.',
          'Guarda el correo de la cuenta, el API token y, opcionalmente, un proyecto predeterminado.',
          'La cuenta debe tener permiso para ver los proyectos y tickets que quieras consultar.',
        ],
        secrets: ['jira_base_url', 'jira_email', 'jira_api_token'],
      }],
    },
  },
  activate: activateJiraTickets,
};
