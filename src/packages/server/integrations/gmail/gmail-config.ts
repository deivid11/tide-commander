/**
 * Gmail Integration - Configuration Schema
 * ConfigField[] for OAuth credentials, polling interval, and approval defaults.
 */

import type { ConfigField, IntegrationStatus } from '../../../shared/integration-types.js';
import type { GoogleTokenState } from '../google-auth/token-health.js';

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
    key: 'redirectBaseUrl',
    label: 'OAuth Redirect Base URL',
    type: 'text',
    description: 'Override the base URL used for the OAuth redirect (e.g. http://commander.local:10003). Leave empty to use http://localhost:<port>. Google does not accept raw IPs — use a domain (you can map one in /etc/hosts).',
    required: false,
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
  redirectBaseUrl?: string;
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
  /** Result of the last real refresh_token exchange against Google. OAuth path only —
   *  undefined in service-account mode, which doesn't use GOOGLE_REFRESH_TOKEN. */
  tokenState?: GoogleTokenState;
}

export interface EmailAttachment {
  filename: string;
  content?: Buffer;
  path?: string;
  mimeType: string;
}

/** Structured metadata for a single Gmail attachment. Filled in
 *  `parseGmailMessage` from the MIME parts and used by the trigger handler
 *  to download the bytes via Gmail's `users.messages.attachments.get` API. */
export interface EmailAttachmentMeta {
  /** Gmail-internal attachment id (passed to attachments.get). */
  attachmentId: string;
  /** Filename as set in the MIME `Content-Disposition`. */
  filename: string;
  /** MIME type from the part header. */
  mimeType: string;
  /** Reported size in bytes (Gmail decoded length). */
  size: number;
}

/** Result of persisting one inbound Gmail attachment to local /tmp. Stamped
 *  onto `EmailMessage.attachments` after the download completes. */
export interface DownloadedEmailAttachment extends EmailAttachmentMeta {
  /** Absolute path on disk under /tmp/tide-commander-uploads/triggers/gmail/<msgId>/<filename>. */
  path: string;
  /** Actual bytes written. */
  bytesOnDisk: number;
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
  /** Structured metadata for each attachment. Populated when parsing the
   *  Gmail payload. The trigger handler uses these to fetch the bytes and
   *  persist them locally. */
  attachmentsMeta?: EmailAttachmentMeta[];
  /** Local downloads (`attachmentsMeta` + on-disk path). Stamped by the
   *  trigger handler after `downloadAttachment` succeeds. */
  downloadedAttachments?: DownloadedEmailAttachment[];
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
