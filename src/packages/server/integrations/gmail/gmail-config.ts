/**
 * Gmail Integration - Configuration Schema
 * ConfigField[] for OAuth credentials, polling interval, and approval defaults.
 */

import type { ConfigField } from '../../../shared/integration-types.js';

export const gmailConfigSchema: ConfigField[] = [
  {
    key: 'clientId',
    label: 'Google OAuth Client ID',
    type: 'text',
    description: 'OAuth2 client ID from Google Cloud Console',
    required: true,
    secret: true,
    group: 'Authentication',
  },
  {
    key: 'clientSecret',
    label: 'Google OAuth Client Secret',
    type: 'password',
    description: 'OAuth2 client secret from Google Cloud Console',
    required: true,
    secret: true,
    group: 'Authentication',
  },
  {
    key: 'pollingIntervalMs',
    label: 'Polling Interval (ms)',
    type: 'number',
    description: 'How often to check for new emails (milliseconds). Default: 30000 (30s).',
    required: false,
    defaultValue: 30000,
    group: 'Polling',
  },
  {
    key: 'defaultApprovalKeywords',
    label: 'Default Approval Keywords',
    type: 'textarea',
    description: 'Comma-separated keywords that indicate approval (e.g. "approved, aprobado, autorizado, yes, ok")',
    required: false,
    defaultValue: 'approved,aprobado,autorizado,yes,ok',
    group: 'Approvals',
  },
];

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  pollingIntervalMs: number;
  defaultApprovalKeywords: string[];
}

export interface GmailStatus {
  configured: boolean;
  authenticated: boolean;
  emailAddress?: string;
  pollingActive: boolean;
  lastPollAt?: number;
  lastError?: string;
}

export interface EmailAttachment {
  filename: string;
  content?: Buffer;
  path?: string;
  mimeType: string;
}

export interface EmailMessage {
  messageId: string;
  threadId: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  bodyHtml?: string;
  date: number;
  inReplyTo?: string;
  labels?: string[];
  hasAttachments: boolean;
  attachmentNames?: string[];
}

export interface EmailThread {
  threadId: string;
  subject: string;
  messages: EmailMessage[];
  participantCount: number;
}

export interface ApprovalDetail {
  email: string;
  approved: boolean;
  message?: string;
  timestamp?: number;
  keywordMatched?: string;
}

export interface ApprovalStatus {
  approved: boolean;
  approvalCount: number;
  totalRequired: number;
  approvedBy: string[];
  pendingFrom: string[];
  details: ApprovalDetail[];
}
