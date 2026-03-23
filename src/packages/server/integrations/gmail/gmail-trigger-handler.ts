/**
 * Gmail Trigger Handler
 * Implements TriggerHandler for 'email' type triggers.
 * Delegates event listening to gmail-client's polling and onNewMessage callback.
 */

import type { TriggerHandler, TriggerDefinition, ExternalEvent } from '../../../shared/integration-types.js';
import * as gmailClient from './gmail-client.js';
import type { EmailMessage } from './gmail-config.js';

interface EmailTriggerConfig {
  fromFilter?: string[];
  subjectPattern?: string;
  threadId?: string;
  requiredApprovals?: {
    count: number;
    approvers: string[];
    approvalKeywords: string[];
  };
}

let unsubscribe: (() => void) | null = null;

export const gmailTriggerHandler: TriggerHandler = {
  triggerType: 'email',

  async startListening(onEvent) {
    unsubscribe = gmailClient.onNewMessage((message: EmailMessage) => {
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

    if (config.fromFilter?.length) {
      const fromLower = msg.from.toLowerCase();
      if (!config.fromFilter.some(f => fromLower.includes(f.toLowerCase()))) return false;
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
    };
  },

  formatEventForLLM(event: ExternalEvent): string {
    const msg = event.data as EmailMessage;
    return `Email from ${msg.from}\nSubject: ${msg.subject}\nDate: ${new Date(msg.date).toISOString()}\n\n${msg.body}`;
  },
};
