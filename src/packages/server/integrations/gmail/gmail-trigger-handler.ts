/**
 * Gmail Trigger Handler
 * Implements TriggerHandler for 'email' type triggers.
 * Delegates event listening to gmail-client's polling and onNewMessage callback.
 */

import type { TriggerHandler, TriggerDefinition, ExternalEvent } from '../../../shared/integration-types.js';
import * as gmailClient from './gmail-client.js';
import type { EmailMessage, DownloadedEmailAttachment } from './gmail-config.js';
import { formatAttachmentLine } from '../../services/attachment-downloader.js';

interface EmailTriggerConfig {
  fromFilter?: string[];
  toFilter?: string[];
  subjectPattern?: string;
  threadId?: string;
  requiredApprovals?: {
    count: number;
    approvers: string[];
    approvalKeywords: string[];
  };
  /**
   * Additional Gmail labels whose messages should be dropped silently
   * (per-trigger override). `SPAM` and `TRASH` are ALWAYS dropped regardless
   * of this list — they're universally junk. Useful values:
   *   `CATEGORY_PROMOTIONS`, `CATEGORY_SOCIAL`, `CATEGORY_UPDATES`,
   *   `CATEGORY_FORUMS`.
   */
  excludeLabels?: string[];
  /**
   * Set to `true` to OPT IN to spam-tagged messages (default is to skip
   * them). Only flip this on for a dedicated spam-monitoring agent — for any
   * normal workflow you want spam filtered out.
   */
  includeSpam?: boolean;
}

/** Labels we always drop unless the trigger explicitly opts in. Gmail tags
 *  these on messages the user has already classified as junk. */
const ALWAYS_DROP_LABELS = new Set(['SPAM', 'TRASH']);

let unsubscribe: (() => void) | null = null;

export const gmailTriggerHandler: TriggerHandler = {
  triggerType: 'email',

  async startListening(onEvent) {
    unsubscribe = gmailClient.onNewMessage(async (message: EmailMessage) => {
      // Download any attachments BEFORE we hand the event to the trigger
      // service so `{{email.attachmentsBlock}}` is populated when the
      // template renders. Mirrors the WA/Slack pipelines — the agent gets
      // a local path it can open with the Read tool, not just a filename.
      if (message.attachmentsMeta && message.attachmentsMeta.length > 0) {
        const downloaded: DownloadedEmailAttachment[] = [];
        for (const meta of message.attachmentsMeta) {
          const result = await gmailClient.downloadGmailAttachment(
            message.messageId,
            meta,
          );
          if (result) {
            downloaded.push({
              ...meta,
              filename: result.filename,
              mimeType: result.mimeType,
              path: result.path,
              bytesOnDisk: result.bytesOnDisk,
            });
          }
        }
        if (downloaded.length > 0) {
          message.downloadedAttachments = downloaded;
        }
      }
      onEvent({
        source: 'email',
        type: 'message',
        data: message,
        timestamp: Date.now(),
      });
    });
  },

  async stopListening() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  },

  structuralMatch(trigger: TriggerDefinition, event: ExternalEvent): boolean {
    const msg = event.data as EmailMessage;
    const config = trigger.config as EmailTriggerConfig;
    const labels = msg.labels ?? [];

    // Always drop SPAM / TRASH unless this trigger explicitly opted in to
    // spam delivery. Saves the cost of LLM evaluation / agent prompts for
    // junk that the user has already classified.
    if (!config.includeSpam) {
      for (const lbl of labels) {
        if (ALWAYS_DROP_LABELS.has(lbl)) return false;
      }
    }

    // Per-trigger extra exclusions (e.g. CATEGORY_PROMOTIONS).
    if (config.excludeLabels?.length) {
      const exclude = new Set(config.excludeLabels);
      for (const lbl of labels) {
        if (exclude.has(lbl)) return false;
      }
    }

    if (config.fromFilter?.length) {
      const fromLower = msg.from.toLowerCase();
      if (!config.fromFilter.some(f => fromLower.includes(f.toLowerCase()))) return false;
    }

    if (config.toFilter?.length) {
      const toAddresses = msg.to.map(t => t.toLowerCase());
      if (!config.toFilter.some(f => toAddresses.some(t => t.includes(f.toLowerCase())))) return false;
    }

    if (config.subjectPattern) {
      try {
        if (!new RegExp(config.subjectPattern, 'i').test(msg.subject)) return false;
      } catch {
        return false;
      }
    }

    if (config.threadId && msg.threadId !== config.threadId) return false;

    return true;
  },

  extractVariables(trigger: TriggerDefinition, event: ExternalEvent): Record<string, string> {
    const msg = event.data as EmailMessage;
    void trigger;
    const labels = msg.labels ?? [];
    // Gmail tags sent messages with the SENT label. Anything else is treated
    // as inbound (covers INBOX, drafts, all-mail, etc.).
    const direction = labels.includes('SENT') ? 'outbound' : 'inbound';

    // Build the attachments block from the downloaded files. Each line is
    // shaped the same way as the WA / Slack pipelines so the existing
    // `AttachmentChip` parser on the frontend picks them up unchanged.
    const downloaded = msg.downloadedAttachments ?? [];
    const attachmentsBlock = downloaded
      .map((a) =>
        formatAttachmentLine({
          path: a.path,
          filename: a.filename,
          mimetype: a.mimeType,
          size: a.bytesOnDisk,
          sourceUrl: `gmail://attachment/${msg.messageId}/${a.attachmentId}`,
        }),
      )
      .join('\n');

    return {
      'email.from': msg.from,
      'email.to': msg.to.join(', '),
      'email.subject': msg.subject,
      'email.body': msg.body,
      'email.threadId': msg.threadId,
      'email.messageId': msg.messageId,
      'email.date': new Date(msg.date).toISOString(),
      'email.hasAttachments': String(msg.hasAttachments),
      'email.attachments': msg.attachmentNames?.join(', ') || '',
      // New: local downloaded paths + ready-to-render attachment chips block.
      'email.filePaths': downloaded.map((a) => a.path).join(','),
      'email.attachmentsBlock': attachmentsBlock,
      'email.direction': direction,
      'email.labels': labels.join(', '),
    };
  },

  formatEventForLLM(event: ExternalEvent): string {
    const msg = event.data as EmailMessage;
    const labels = msg.labels ?? [];
    const direction = labels.includes('SENT') ? 'outbound' : 'inbound';
    return `Email (${direction}) from ${msg.from}\nTo: ${msg.to.join(', ')}\nSubject: ${msg.subject}\nDate: ${new Date(msg.date).toISOString()}\n\n${msg.body}`;
  },
};
