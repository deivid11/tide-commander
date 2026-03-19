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

export const slackTriggerHandler: TriggerHandler = {
  triggerType: 'slack',

  async startListening(onEvent) {
    unsubscribe = slackClient.onMessage((message: SlackMessage) => {
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
    return {
      'slack.user': msg.userName,
      'slack.userId': msg.userId,
      'slack.message': msg.text,
      'slack.channel': msg.channel,
      'slack.threadTs': msg.threadTs || msg.ts,
    };
  },

  formatEventForLLM(event: ExternalEvent): string {
    const msg = event.data as SlackMessage;
    return `Slack message from @${msg.userName} (${msg.userId}) in #${msg.channel}:\n"${msg.text}"`;
  },
};
