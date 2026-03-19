/**
 * Gmail Integration - API Client
 * Wraps the Google Gmail API with OAuth2, polling, sending, reading, and approval checking.
 */

import { google, gmail_v1 } from 'googleapis';
import * as fs from 'fs';
import type { IntegrationContext } from '../../../shared/integration-types.js';
import type {
  GmailConfig,
  GmailStatus,
  EmailMessage,
  EmailThread,
  ApprovalStatus,
  EmailAttachment,
} from './gmail-config.js';

// Gmail API scopes
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
];

const REDIRECT_PATH = '/api/email/auth/callback';

// ─── State ───

let ctx: IntegrationContext | null = null;
let config: GmailConfig = {
  clientId: '',
  clientSecret: '',
  pollingIntervalMs: 30000,
  defaultApprovalKeywords: ['approved', 'aprobado', 'autorizado', 'yes', 'ok'],
};

let oauth2Client: InstanceType<typeof google.auth.OAuth2> | null = null;
let gmail: gmail_v1.Gmail | null = null;
let authenticatedEmail: string | undefined;
let pollingTimer: ReturnType<typeof setInterval> | null = null;
let lastPollAt: number | undefined;
let lastError: string | undefined;
let messageCallbacks: Array<(msg: EmailMessage) => void> = [];
let lastHistoryId: string | undefined;

// ─── Lifecycle ───

export async function init(context: IntegrationContext): Promise<void> {
  ctx = context;
  loadConfig();

  if (!config.clientId || !config.clientSecret) {
    ctx.log.info('Gmail not configured (missing OAuth credentials)');
    return;
  }

  oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    `${ctx.serverConfig.baseUrl}${REDIRECT_PATH}`
  );

  // Load refresh token from secrets
  const refreshToken = ctx.secrets.get('GOOGLE_REFRESH_TOKEN') || config.refreshToken;
  if (refreshToken) {
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    try {
      const profile = await gmail.users.getProfile({ userId: 'me' });
      authenticatedEmail = profile.data.emailAddress ?? undefined;
      lastHistoryId = profile.data.historyId ?? undefined;
      ctx.log.info(`Gmail authenticated as ${authenticatedEmail}`);
    } catch (err) {
      lastError = `Authentication failed: ${err}`;
      ctx.log.error('Gmail authentication failed', err);
    }
  }
}

function loadConfig(): void {
  if (!ctx) return;
  const clientId = ctx.secrets.get('GOOGLE_CLIENT_ID') || '';
  const clientSecret = ctx.secrets.get('GOOGLE_CLIENT_SECRET') || '';
  const refreshToken = ctx.secrets.get('GOOGLE_REFRESH_TOKEN');

  config = {
    ...config,
    clientId,
    clientSecret,
    refreshToken: refreshToken || undefined,
  };
}

export function updateConfig(updates: Partial<GmailConfig>): void {
  if (updates.clientId !== undefined) {
    config.clientId = updates.clientId;
    ctx?.secrets.set('GOOGLE_CLIENT_ID', updates.clientId);
  }
  if (updates.clientSecret !== undefined) {
    config.clientSecret = updates.clientSecret;
    ctx?.secrets.set('GOOGLE_CLIENT_SECRET', updates.clientSecret);
  }
  if (updates.pollingIntervalMs !== undefined) {
    config.pollingIntervalMs = updates.pollingIntervalMs;
  }
  if (updates.defaultApprovalKeywords !== undefined) {
    config.defaultApprovalKeywords = updates.defaultApprovalKeywords;
  }
}

export function getConfig(): GmailConfig {
  return { ...config };
}

export function shutdown(): void {
  stopPolling();
  messageCallbacks = [];
}

// ─── Status ───

export function getStatus(): GmailStatus {
  return {
    configured: Boolean(config.clientId && config.clientSecret),
    authenticated: Boolean(gmail && authenticatedEmail),
    emailAddress: authenticatedEmail,
    pollingActive: pollingTimer !== null,
    lastPollAt,
    lastError,
  };
}

export function isConfigured(): boolean {
  return Boolean(config.clientId && config.clientSecret);
}

// ─── OAuth2 ───

export function getAuthUrl(): string {
  if (!oauth2Client) {
    if (!config.clientId || !config.clientSecret || !ctx) {
      throw new Error('Gmail OAuth not configured');
    }
    oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      `${ctx.serverConfig.baseUrl}${REDIRECT_PATH}`
    );
  }
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

export async function handleAuthCallback(code: string): Promise<void> {
  if (!oauth2Client || !ctx) throw new Error('Gmail OAuth not initialized');

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  if (tokens.refresh_token) {
    ctx.secrets.set('GOOGLE_REFRESH_TOKEN', tokens.refresh_token);
    config.refreshToken = tokens.refresh_token;
  }

  gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const profile = await gmail.users.getProfile({ userId: 'me' });
  authenticatedEmail = profile.data.emailAddress ?? undefined;
  lastHistoryId = profile.data.historyId ?? undefined;
  lastError = undefined;

  ctx.log.info(`Gmail OAuth complete. Authenticated as ${authenticatedEmail}`);
}

// ─── Sending ───

const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024; // 25MB Gmail API limit
const WARN_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB warning

export async function sendEmail(params: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  bodyText?: string;
  attachments?: Array<{ filename: string; path?: string; content?: Buffer; mimeType?: string }>;
  threadId?: string;
  inReplyTo?: string;
  agentId?: string;
  workflowInstanceId?: string;
}): Promise<{ messageId: string; threadId: string }> {
  if (!gmail) throw new Error('Gmail not authenticated');

  // Build MIME message
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const hasAttachments = params.attachments && params.attachments.length > 0;

  const headers = [
    `To: ${params.to.join(', ')}`,
    ...(params.cc?.length ? [`Cc: ${params.cc.join(', ')}`] : []),
    ...(params.bcc?.length ? [`Bcc: ${params.bcc.join(', ')}`] : []),
    `From: ${authenticatedEmail}`,
    `Subject: ${params.subject}`,
    ...(params.inReplyTo ? [`In-Reply-To: ${params.inReplyTo}`, `References: ${params.inReplyTo}`] : []),
    `MIME-Version: 1.0`,
  ];

  let rawEmail: string;

  if (hasAttachments) {
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

    const parts: string[] = [];

    // Text/HTML body part
    const bodyBoundary = `body_${Date.now()}`;
    let bodyPart = `--${boundary}\r\nContent-Type: multipart/alternative; boundary="${bodyBoundary}"\r\n\r\n`;
    if (params.bodyText) {
      bodyPart += `--${bodyBoundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${params.bodyText}\r\n`;
    }
    bodyPart += `--${bodyBoundary}\r\nContent-Type: text/html; charset="UTF-8"\r\n\r\n${params.body}\r\n`;
    bodyPart += `--${bodyBoundary}--`;
    parts.push(bodyPart);

    // Attachment parts
    for (const att of params.attachments!) {
      let content: Buffer;
      if (att.path) {
        if (!fs.existsSync(att.path)) {
          throw new Error(`Attachment file not found: ${att.path}`);
        }
        content = fs.readFileSync(att.path);
      } else if (att.content) {
        content = att.content;
      } else {
        throw new Error(`Attachment ${att.filename} has no content or path`);
      }

      if (content.length > MAX_ATTACHMENT_SIZE) {
        throw new Error(`Attachment ${att.filename} exceeds 25MB Gmail limit (${(content.length / 1024 / 1024).toFixed(1)}MB)`);
      }
      if (content.length > WARN_ATTACHMENT_SIZE) {
        ctx?.log.warn(`Large attachment: ${att.filename} is ${(content.length / 1024 / 1024).toFixed(1)}MB`);
      }

      const mimeType = att.mimeType || 'application/octet-stream';
      parts.push(
        `--${boundary}\r\nContent-Type: ${mimeType}; name="${att.filename}"\r\nContent-Disposition: attachment; filename="${att.filename}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${content.toString('base64')}`
      );
    }

    rawEmail = headers.join('\r\n') + '\r\n\r\n' + parts.join('\r\n') + `\r\n--${boundary}--`;
  } else {
    // Simple HTML email
    const bodyBoundary = `body_${Date.now()}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${bodyBoundary}"`);
    let bodyContent = '';
    if (params.bodyText) {
      bodyContent += `--${bodyBoundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${params.bodyText}\r\n`;
    }
    bodyContent += `--${bodyBoundary}\r\nContent-Type: text/html; charset="UTF-8"\r\n\r\n${params.body}\r\n`;
    bodyContent += `--${bodyBoundary}--`;

    rawEmail = headers.join('\r\n') + '\r\n\r\n' + bodyContent;
  }

  const encodedMessage = Buffer.from(rawEmail).toString('base64url');

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage,
      threadId: params.threadId,
    },
  });

  const messageId = result.data.id!;
  const threadId = result.data.threadId!;

  // Log to SQLite
  try {
    ctx?.eventDb.logEmailMessage({
      messageId,
      threadId,
      fromAddress: authenticatedEmail || '',
      toAddresses: params.to,
      ccAddresses: params.cc,
      subject: params.subject,
      bodyText: params.bodyText,
      bodyHtml: params.body,
      direction: 'outbound',
      hasAttachments: hasAttachments || false,
      attachmentNames: params.attachments?.map(a => a.filename),
      agentId: params.agentId,
      workflowInstanceId: params.workflowInstanceId,
      receivedAt: Date.now(),
    });
  } catch (err) {
    ctx?.log.error('Failed to log outbound email', err);
  }

  ctx?.log.info(`Email sent to ${params.to.join(', ')}: ${params.subject}`);
  return { messageId, threadId };
}

// ─── Reading ───

function parseGmailMessage(msg: gmail_v1.Schema$Message): EmailMessage {
  const headers = msg.payload?.headers || [];
  const getHeader = (name: string) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

  const from = getHeader('From');
  const to = getHeader('To').split(',').map(s => s.trim()).filter(Boolean);
  const cc = getHeader('Cc') ? getHeader('Cc').split(',').map(s => s.trim()).filter(Boolean) : undefined;
  const subject = getHeader('Subject');
  const date = msg.internalDate ? parseInt(msg.internalDate, 10) : Date.now();
  const inReplyTo = getHeader('In-Reply-To') || undefined;

  // Extract body
  let body = '';
  let bodyHtml = '';

  function extractParts(payload: gmail_v1.Schema$MessagePart | undefined): void {
    if (!payload) return;
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      body = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
    }
    if (payload.mimeType === 'text/html' && payload.body?.data) {
      bodyHtml = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
    }
    if (payload.parts) {
      for (const part of payload.parts) {
        extractParts(part);
      }
    }
  }
  extractParts(msg.payload);

  // Check attachments
  const attachmentNames: string[] = [];
  function findAttachments(payload: gmail_v1.Schema$MessagePart | undefined): void {
    if (!payload) return;
    if (payload.filename && payload.filename.length > 0) {
      attachmentNames.push(payload.filename);
    }
    if (payload.parts) {
      for (const part of payload.parts) {
        findAttachments(part);
      }
    }
  }
  findAttachments(msg.payload);

  return {
    messageId: msg.id || '',
    threadId: msg.threadId || '',
    from,
    to,
    cc,
    subject,
    body: body || (bodyHtml ? bodyHtml.replace(/<[^>]+>/g, '') : ''),
    bodyHtml: bodyHtml || undefined,
    date,
    inReplyTo,
    labels: msg.labelIds || undefined,
    hasAttachments: attachmentNames.length > 0,
    attachmentNames: attachmentNames.length > 0 ? attachmentNames : undefined,
  };
}

export async function getThread(threadId: string): Promise<EmailThread> {
  if (!gmail) throw new Error('Gmail not authenticated');

  const response = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  });

  const messages = (response.data.messages || []).map(parseGmailMessage);
  const participants = new Set<string>();
  for (const msg of messages) {
    participants.add(msg.from);
    for (const to of msg.to) participants.add(to);
  }

  return {
    threadId,
    subject: messages[0]?.subject || '',
    messages,
    participantCount: participants.size,
  };
}

export async function getRecentMessages(params: {
  query?: string;
  maxResults?: number;
  after?: number;
}): Promise<EmailMessage[]> {
  if (!gmail) throw new Error('Gmail not authenticated');

  let q = params.query || '';
  if (params.after) {
    const afterDate = new Date(params.after);
    const dateStr = `${afterDate.getFullYear()}/${afterDate.getMonth() + 1}/${afterDate.getDate()}`;
    q += ` after:${dateStr}`;
  }

  const response = await gmail.users.messages.list({
    userId: 'me',
    q: q.trim() || undefined,
    maxResults: params.maxResults || 10,
  });

  const messages: EmailMessage[] = [];
  for (const item of response.data.messages || []) {
    if (!item.id) continue;
    const full = await gmail.users.messages.get({
      userId: 'me',
      id: item.id,
      format: 'full',
    });
    messages.push(parseGmailMessage(full.data));
  }

  return messages;
}

// ─── Approval Checking ───

export async function checkApprovals(params: {
  threadId: string;
  requiredApprovers: string[];
  approvalKeywords?: string[];
  minApprovals: number;
  workflowInstanceId?: string;
}): Promise<ApprovalStatus> {
  const thread = await getThread(params.threadId);
  const keywords = params.approvalKeywords || config.defaultApprovalKeywords;

  const details: ApprovalStatus['details'] = [];
  const approvedBy: string[] = [];

  for (const approver of params.requiredApprovers) {
    const approverLower = approver.toLowerCase();
    // Find replies from this approver
    const replies = thread.messages.filter(m => {
      const fromEmail = extractEmail(m.from).toLowerCase();
      return fromEmail === approverLower;
    });

    let found = false;
    for (const reply of replies) {
      const bodyLower = reply.body.toLowerCase();
      for (const keyword of keywords) {
        if (bodyLower.includes(keyword.toLowerCase())) {
          found = true;
          approvedBy.push(approver);
          details.push({
            email: approver,
            approved: true,
            message: reply.body.substring(0, 200),
            timestamp: reply.date,
            keywordMatched: keyword,
          });

          // Log approval event
          try {
            ctx?.eventDb.logApprovalEvent({
              threadId: params.threadId,
              approverEmail: approver,
              approved: true,
              replyMessageId: reply.messageId,
              replySnippet: reply.body.substring(0, 200),
              keywordMatched: keyword,
              workflowInstanceId: params.workflowInstanceId,
              recordedAt: Date.now(),
            });
          } catch (err) {
            ctx?.log.error('Failed to log approval event', err);
          }
          break;
        }
      }
      if (found) break;
    }

    if (!found) {
      details.push({ email: approver, approved: false });
    }
  }

  const pendingFrom = params.requiredApprovers.filter(a => !approvedBy.includes(a));

  return {
    approved: approvedBy.length >= params.minApprovals,
    approvalCount: approvedBy.length,
    totalRequired: params.minApprovals,
    approvedBy,
    pendingFrom,
    details,
  };
}

/** Synchronous-style wrapper (still async internally, used by trigger handler) */
export function checkApprovalsSync(
  threadId: string,
  requiredApprovers: string[],
  keywords?: string[],
  minApprovals?: number
): Promise<ApprovalStatus> {
  return checkApprovals({
    threadId,
    requiredApprovers,
    approvalKeywords: keywords,
    minApprovals: minApprovals || requiredApprovers.length,
  });
}

function extractEmail(fromHeader: string): string {
  const match = fromHeader.match(/<([^>]+)>/);
  return match ? match[1] : fromHeader.trim();
}

// ─── Polling ───

export function startPolling(intervalMs?: number): void {
  if (pollingTimer) return;
  if (!gmail) {
    ctx?.log.warn('Cannot start polling: Gmail not authenticated');
    return;
  }

  const interval = intervalMs || config.pollingIntervalMs;
  ctx?.log.info(`Gmail polling started (every ${interval / 1000}s)`);

  pollingTimer = setInterval(async () => {
    try {
      await pollForNewMessages();
    } catch (err) {
      lastError = `Polling error: ${err}`;
      ctx?.log.error('Gmail polling error', err);
    }
  }, interval);

  // Don't keep process alive just for polling
  if (pollingTimer.unref) pollingTimer.unref();
}

export function stopPolling(): void {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    ctx?.log.info('Gmail polling stopped');
  }
}

async function pollForNewMessages(): Promise<void> {
  if (!gmail) return;

  lastPollAt = Date.now();

  // Use history API if we have a historyId, otherwise list recent
  if (lastHistoryId) {
    try {
      const response = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: lastHistoryId,
        historyTypes: ['messageAdded'],
      });

      if (response.data.historyId) {
        lastHistoryId = response.data.historyId;
      }

      const newMessageIds = new Set<string>();
      for (const history of response.data.history || []) {
        for (const added of history.messagesAdded || []) {
          if (added.message?.id) {
            newMessageIds.add(added.message.id);
          }
        }
      }

      for (const msgId of newMessageIds) {
        try {
          const full = await gmail.users.messages.get({
            userId: 'me',
            id: msgId,
            format: 'full',
          });
          const parsed = parseGmailMessage(full.data);

          // Log inbound message
          try {
            ctx?.eventDb.logEmailMessage({
              messageId: parsed.messageId,
              threadId: parsed.threadId,
              fromAddress: extractEmail(parsed.from),
              toAddresses: parsed.to,
              ccAddresses: parsed.cc,
              subject: parsed.subject,
              bodyText: parsed.body,
              bodyHtml: parsed.bodyHtml,
              direction: 'inbound',
              hasAttachments: parsed.hasAttachments,
              attachmentNames: parsed.attachmentNames,
              gmailLabels: parsed.labels,
              rawHeaders: parsed.inReplyTo ? { 'In-Reply-To': parsed.inReplyTo } : undefined,
              receivedAt: parsed.date,
            });
          } catch (err) {
            ctx?.log.error('Failed to log inbound email', err);
          }

          // Notify callbacks
          for (const cb of messageCallbacks) {
            try { cb(parsed); } catch { /* ignore callback errors */ }
          }
        } catch (err) {
          ctx?.log.error(`Failed to fetch message ${msgId}`, err);
        }
      }
    } catch (err: unknown) {
      // History may have expired, fall back to list
      if ((err as { code?: number })?.code === 404) {
        ctx?.log.warn('Gmail history expired, resetting');
        const profile = await gmail.users.getProfile({ userId: 'me' });
        lastHistoryId = profile.data.historyId ?? undefined;
      } else {
        throw err;
      }
    }
  }
  lastError = undefined;
}

export function onNewMessage(callback: (message: EmailMessage) => void): () => void {
  messageCallbacks.push(callback);
  return () => {
    messageCallbacks = messageCallbacks.filter(cb => cb !== callback);
  };
}

export function getAuthenticatedEmail(): string | undefined {
  return authenticatedEmail;
}
