/**
 * Slack Trigger Handler
 * Implements TriggerHandler for 'slack' type triggers.
 *
 * Multi-instance: subscribes to onMessage on EVERY known Slack instance and
 * propagates the source instanceId through the ExternalEvent payload so
 * triggers can scope themselves to a specific Slack connection (or accept
 * any).
 */

import type { TriggerHandler, TriggerDefinition, ExternalEvent } from '../../../shared/integration-types.js';
import * as slackClient from './slack-client.js';
import type { SlackMessage } from './slack-client.js';
import { listInstances } from './slack-instance.js';
import { listInstanceMetas } from './slack-instance-manifest.js';

/**
 * Trigger config recognised by `slack` triggers. `instanceId` is optional —
 * triggers without it match messages from ANY instance.
 */
interface SlackTriggerConfig {
  channelId?: string;
  userFilter?: string[];
  excludeUserIds?: string[];
  messagePattern?: string;
  threadTs?: string;
  /** Restrict to messages from this Slack instance. Falsy = match any. */
  instanceId?: string;
  /** Only fire on 1:1 DMs. Slack 1:1 DM channel IDs start with 'D'. */
  dmOnly?: boolean;
  /** Skip 1:1 DMs. Slack 1:1 DM channel IDs start with 'D'. */
  excludeDms?: boolean;
  /** Include outbound (own) messages. Default false — own messages are skipped. */
  includeOwnMessages?: boolean;
}

/** ExternalEvent.data shape for Slack — message + the instance it came from. */
export interface SlackTriggerEventData extends SlackMessage {
  /** Which Slack instance dispatched this event. */
  instanceId: string;
}

const unsubscribers: Array<() => void> = [];

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

    // Subscribe to every instance the manifest knows about. Unknown instances
    // (created later via the UI) are auto-created with `getInstance()` when
    // reconnect runs, but we re-subscribe on each integration shutdown/init
    // cycle so adding a brand-new instance via /instances triggers re-init.
    const ids = listInstanceMetas().map((m) => m.id);
    const idSet = new Set(ids);
    const allInstances = listInstances().filter((i) => idSet.has(i.id));

    for (const inst of allInstances) {
      const off = inst.onMessage((message: SlackMessage) => {
        if (autoReact) {
          // Use the instance-specific reaction so it posts as the right account.
          inst.addReaction({ channel: message.channel, ts: message.ts, name: 'eyes' })
            .catch(() => { /* swallow */ });
        }

        const eventData: SlackTriggerEventData = { ...message, instanceId: inst.id };
        onEvent({
          source: 'slack',
          type: 'message',
          data: eventData,
          timestamp: Date.now(),
        });
      });
      unsubscribers.push(off);
    }
  },

  async stopListening() {
    for (const off of unsubscribers) {
      try { off(); } catch { /* ignore */ }
    }
    unsubscribers.length = 0;
  },

  structuralMatch(trigger: TriggerDefinition, event: ExternalEvent): boolean {
    const msg = event.data as SlackTriggerEventData;
    const config = trigger.config as SlackTriggerConfig;

    if (config.instanceId && msg.instanceId !== config.instanceId) return false;
    if (config.channelId && msg.channel !== config.channelId) return false;
    if (config.dmOnly && !msg.channel.startsWith('D')) return false;
    if (config.excludeDms && msg.channel.startsWith('D')) return false;
    if (msg.isOwnMessage && !config.includeOwnMessages) return false;
    if (config.userFilter?.length && !config.userFilter.includes(msg.userId)) return false;
    if (config.excludeUserIds?.length && config.excludeUserIds.includes(msg.userId)) return false;
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
    const msg = event.data as SlackTriggerEventData;
    void trigger;
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
      'slack.instanceId': msg.instanceId,
    };
  },

  formatEventForLLM(event: ExternalEvent): string {
    const msg = event.data as SlackTriggerEventData;
    const files = msg.files ?? [];
    const filesLine = files.length
      ? `\nAttachments (${files.length}): ${files.map((f) => `${f.name ?? f.id} [${f.mimetype ?? 'unknown'}]`).join(', ')}`
      : '';
    const instanceLine = msg.instanceId !== 'default' ? ` [Slack instance: ${msg.instanceId}]` : '';
    return `Slack message from @${msg.userName} (${msg.userId}) in #${msg.channel}${instanceLine}:\n"${msg.text}"${filesLine}`;
  },
};

// `slackClient` import kept (re-exports SlackMessage type used above).
void slackClient;
