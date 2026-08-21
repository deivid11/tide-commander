import type {
  PluginActionContext,
  PluginCommandContext,
  TideServerPluginActivation,
} from '../../../shared/plugin-types.js';
import * as gmailClient from '../../integrations/gmail/gmail-client.js';
import type { EmailMessage } from '../../integrations/gmail/gmail-config.js';
import type { BuiltinPluginDefinition } from '../manager.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const UNREAD_QUERY = 'in:inbox is:unread';
const ALL_INBOX_QUERY = 'in:inbox';

type GmailViewMode = 'unread' | 'all';

type GmailPendingItem = {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  date: number;
  labels: string[];
  isUnread: boolean;
  hasAttachments: boolean;
  attachmentNames: string[];
  gmailUrl: string;
};

export type GmailPendingListData = Record<string, unknown> & {
  kind: 'gmail-pending-list';
  title: string;
  account?: string;
  count: number;
  limit: number;
  mode: GmailViewMode;
  query: string;
  items: GmailPendingItem[];
  actions: {
    markRead: string;
    refresh: string;
    showAll: string;
    showUnread: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseLimit(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') return DEFAULT_LIMIT;
  const parsed = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    throw new Error(`Gmail pending limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return parsed;
}

function commandOptions(context: PluginCommandContext): { limit: number; mode: GmailViewMode } {
  if (context.args.length > 2) throw new Error('Usage: /gmail [all|unread] [limit]');
  let limit = DEFAULT_LIMIT;
  let hasLimit = false;
  let mode: GmailViewMode = context.invokedAs === '/gmail-all' || context.invokedAs === '/todos-correos'
    ? 'all'
    : 'unread';

  for (const argument of context.args) {
    const normalized = argument.trim().toLowerCase();
    if (['all', 'todos', 'todo'].includes(normalized)) {
      mode = 'all';
    } else if (['unread', 'pendientes', 'no-leidos', 'no-leídos'].includes(normalized)) {
      mode = 'unread';
    } else if (!hasLimit) {
      limit = parseLimit(argument);
      hasLimit = true;
    } else {
      throw new Error('Usage: /gmail [all|unread] [limit]');
    }
  }
  return { limit, mode };
}

function actionOptions(context: PluginActionContext): { limit: number; mode: GmailViewMode } {
  if (!isRecord(context.data)) return { limit: DEFAULT_LIMIT, mode: 'unread' };
  return {
    limit: parseLimit(context.data.limit ?? DEFAULT_LIMIT),
    mode: context.data.mode === 'all' ? 'all' : 'unread',
  };
}

function gmailUrl(message: EmailMessage): string {
  return `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(message.threadId || message.messageId)}`;
}

function toPendingItem(message: EmailMessage): GmailPendingItem {
  return {
    id: message.messageId,
    threadId: message.threadId,
    from: message.from,
    to: message.to,
    cc: message.cc,
    subject: message.subject,
    body: message.body,
    date: message.date,
    labels: message.labels ?? [],
    isUnread: message.labels?.includes('UNREAD') ?? false,
    hasAttachments: message.hasAttachments,
    attachmentNames: message.attachmentNames ?? [],
    gmailUrl: gmailUrl(message),
  };
}

export async function fetchEmails(
  limit = DEFAULT_LIMIT,
  mode: GmailViewMode = 'unread',
): Promise<GmailPendingListData> {
  const status = gmailClient.getStatus();
  if (!status.authenticated) {
    const detail = status.needsReauth
      ? 'Gmail authorization expired; reconnect Gmail in Settings → Integrations'
      : 'Gmail is not connected; configure it in Settings → Integrations';
    throw new Error(detail);
  }

  const query = mode === 'all' ? ALL_INBOX_QUERY : UNREAD_QUERY;
  const messages = await gmailClient.getRecentMessages({ query, maxResults: limit });
  const items = messages.map(toPendingItem);
  return {
    kind: 'gmail-pending-list',
    title: mode === 'all' ? 'Todos los correos' : 'Correos pendientes',
    account: status.emailAddress,
    count: items.length,
    limit,
    mode,
    query,
    items,
    actions: {
      markRead: 'mark-read',
      refresh: 'refresh',
      showAll: 'show-all',
      showUnread: 'show-unread',
    },
  };
}

function messageIdFromAction(context: PluginActionContext): string {
  const nestedId = isRecord(context.item) && typeof context.item.id === 'string'
    ? context.item.id
    : undefined;
  const candidate = typeof context.itemId === 'string' ? context.itemId : nestedId;
  const messageId = candidate?.trim() ?? '';
  if (!messageId || messageId.length > 256 || !/^[a-zA-Z0-9_-]+$/.test(messageId)) {
    throw new Error('Gmail mark-read action requires a valid message id');
  }
  return messageId;
}

async function markRead(context: PluginActionContext): Promise<GmailPendingListData> {
  await gmailClient.markMessageAsRead(messageIdFromAction(context));
  const { limit, mode } = actionOptions(context);
  return fetchEmails(limit, mode);
}

async function refresh(context: PluginActionContext): Promise<GmailPendingListData> {
  const { limit, mode } = actionOptions(context);
  return fetchEmails(limit, mode);
}

async function showMode(context: PluginActionContext, mode: GmailViewMode): Promise<GmailPendingListData> {
  return fetchEmails(actionOptions(context).limit, mode);
}

function activateGmailPending(): TideServerPluginActivation {
  return {
    commands: {
      'show-pending-emails': (context) => {
        const { limit, mode } = commandOptions(context);
        return fetchEmails(limit, mode);
      },
    },
    actions: {
      'mark-read': markRead,
      refresh,
      'show-all': (context) => showMode(context, 'all'),
      'show-unread': (context) => showMode(context, 'unread'),
    },
  };
}

export const gmailPendingPlugin: BuiltinPluginDefinition = {
  manifest: {
    id: 'gmail-pending',
    name: 'Gmail Inbox',
    version: '1.2.0',
    description: 'Review unread or all inbox messages, open them in Gmail, and mark them as read.',
    contributes: {
      slashCommands: [{
        name: '/gmail',
        aliases: ['/gmail-pending', '/correos', '/gmail-all', '/todos-correos'],
        summary: 'Mostrar correos no leídos o todos; uso: /gmail [all|unread] [1-50]',
        handler: 'show-pending-emails',
        renderer: 'gmail-pending-list',
      }],
      outputRenderers: [{ id: 'gmail-pending-list' }],
      settings: [{
        id: 'gmail-connection',
        type: 'integration',
        integrationId: 'gmail',
        title: 'Conexión con Gmail',
        description: 'Configura la cuenta y las credenciales seguras que usa este plugin.',
        instructions: [
          'Activa Gmail API en un proyecto de Google Cloud.',
          'Para OAuth 2.0, crea credenciales Web y registra exactamente la URL de callback que muestra Tide Commander.',
          'Guarda el Client ID y Client Secret, y después autoriza la cuenta en Google.',
          'Como alternativa para Google Workspace, usa una Service Account con domain-wide delegation.',
        ],
        secrets: [
          'GOOGLE_CLIENT_ID',
          'GOOGLE_CLIENT_SECRET',
          'GOOGLE_REFRESH_TOKEN',
          'GOOGLE_SERVICE_ACCOUNT_JSON (alternativa)',
        ],
      }],
    },
  },
  activate: activateGmailPending,
};
