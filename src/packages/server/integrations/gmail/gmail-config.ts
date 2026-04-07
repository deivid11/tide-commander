/**
 * Gmail Integration - Configuration Schema
 * ConfigField[] for OAuth credentials, polling interval, and approval defaults.
 */

import type { ConfigField, IntegrationStatus } from '../../../shared/integration-types.js';

export const gmailConfigSchema: ConfigField[] = [
  {
    key: 'authMethod',
    label: 'Authentication Method',
    type: 'select',
    description: 'Choose OAuth2 (browser login) or Service Account (domain-wide delegation)',
    required: false,
    defaultValue: 'oauth2',
    options: [
      { label: 'OAuth2', value: 'oauth2' },
      { label: 'Service Account', value: 'service_account' },
    ],
    group: 'Authentication',
  },
  {
    key: 'clientId',
    label: 'Google OAuth Client ID',
    type: 'text',
    description: 'OAuth2 client ID from Google Cloud Console',
    required: false,
    secret: true,
    group: 'Authentication',
  },
  {
    key: 'clientSecret',
    label: 'Google OAuth Client Secret',
    type: 'password',
    description: 'OAuth2 client secret from Google Cloud Console',
    required: false,
    secret: true,
    group: 'Authentication',
  },
  {
    key: 'serviceAccountJson',
    label: 'Service Account JSON',
    type: 'textarea',
    description: 'Full JSON content of the Google service account key file',
    required: false,
    secret: true,
    group: 'Authentication',
  },
  {
    key: 'impersonateEmail',
    label: 'Impersonate Email',
    type: 'email',
    description: 'Email address to impersonate via domain-wide delegation (required for service account)',
    required: false,
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
  authMethod: 'oauth2' | 'service_account';
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  serviceAccountJson?: string;
  impersonateEmail?: string;
  pollingIntervalMs: number;
  defaultApprovalKeywords: string[];
}

export interface GmailStatus extends IntegrationStatus {
  configured: boolean;
  authenticated: boolean;
  emailAddress?: string;
  pollingActive: boolean;
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
  rfc822MessageId?: string;
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
