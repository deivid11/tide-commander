/**
 * Slack Trigger Handler
 * Implements TriggerHandler for 'slack' type triggers.
 * Delegates event listening to slack-client's Socket Mode connection.
 */

import type { TriggerHandler, TriggerDefinition, ExternalEvent } from '../../../shared/integration-types.js';
import * as slackClient from './slack-client.js';
import type { SlackMessage } from './slack-client.js';

interface SlackTriggerConfig {
  channelId?: string;
  userFilter?: string[];
  messagePattern?: string;
  threadTs?: string;
}

let unsubscribe: (() => void) | null = null;

/** Env toggle: set SLACK_REACT_ON_TRIGGER=false (or 0/no/off) to disable the auto-:eyes: ack. */
function reactOnTriggerEnabled(): boolean {
  const raw = (process.env.SLACK_REACT_ON_TRIGGER ?? '').toLowerCase().trim();
  if (!raw) return true;
  return !['false', '0', 'no', 'off'].includes(raw);
}

export const slackTriggerHandler: TriggerHandler = {
  triggerType: 'slack',

  async startListening(onEvent) {
    const autoReact = reactOnTriggerEnabled();

    unsubscribe = slackClient.onMessage((message: SlackMessage) => {
      // Fire-and-forget :eyes: reaction to ack that the bot saw it. Failure MUST NOT block triggers.
      if (autoReact) {
        slackClient
          .addReaction({ channel: message.channel, ts: message.ts, name: 'eyes' })
          .catch(() => { /* swallow — already logged upstream if it matters */ });
      }

      onEvent({
        source: 'slack',
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
    const msg = event.data as SlackMessage;
    const config = trigger.config as SlackTriggerConfig;

    if (config.channelId && msg.channel !== config.channelId) return false;
    if (config.userFilter?.length && !config.userFilter.includes(msg.userId)) return false;
    if (config.messagePattern) {
      try {
        if (!new RegExp(config.messagePattern).test(msg.text)) return false;
      } catch {
        return false; // Invalid regex
      }
    }
    if (config.threadTs && msg.threadTs !== config.threadTs) return false;

    return true;
  },

  extractVariables(trigger: TriggerDefinition, event: ExternalEvent): Record<string, string> {
    const msg = event.data as SlackMessage;
    void trigger; // trigger config not needed for basic extraction
    const files = msg.files ?? [];
    return {
      'slack.user': msg.userName,
      'slack.userId': msg.userId,
      'slack.message': msg.text,
      'slack.channel': msg.channel,
      'slack.threadTs': msg.threadTs || msg.ts,
      'slack.fileCount': String(files.length),
      'slack.fileIds': files.map((f) => f.id).join(','),
      'slack.fileNames': files.map((f) => f.name ?? '').filter(Boolean).join(','),
    };
  },

  formatEventForLLM(event: ExternalEvent): string {
    const msg = event.data as SlackMessage;
    const files = msg.files ?? [];
    const filesLine = files.length
      ? `\nAttachments (${files.length}): ${files.map((f) => `${f.name ?? f.id} [${f.mimetype ?? 'unknown'}]`).join(', ')}`
      : '';
    return `Slack message from @${msg.userName} (${msg.userId}) in #${msg.channel}:\n"${msg.text}"${filesLine}`;
  },
};
