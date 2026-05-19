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
import { loadConfig } from './slack-config.js';
import { formatAttachmentLine } from '../../services/attachment-downloader.js';

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

/**
 * Global kill-switch: `SLACK_REACT_ON_TRIGGER=false` (or 0/no/off) disables the
 * auto-:eyes: ack across every instance regardless of per-instance config.
 * Defaults to enabled when unset.
 */
function envAllowsReact(): boolean {
  const raw = (process.env.SLACK_REACT_ON_TRIGGER ?? '').toLowerCase().trim();
  if (!raw) return true;
  return !['false', '0', 'no', 'off'].includes(raw);
}

export const slackTriggerHandler: TriggerHandler = {
  triggerType: 'slack',

  async startListening(onEvent) {
    const envOn = envAllowsReact();

    // Subscribe to every instance the manifest knows about. Unknown instances
    // (created later via the UI) are auto-created with `getInstance()` when
    // reconnect runs, but we re-subscribe on each integration shutdown/init
    // cycle so adding a brand-new instance via /instances triggers re-init.
    const ids = listInstanceMetas().map((m) => m.id);
    const idSet = new Set(ids);
    const allInstances = listInstances().filter((i) => idSet.has(i.id));

    for (const inst of allInstances) {
      const off = inst.onMessage((message: SlackMessage) => {
        // Per-instance toggle is read fresh on each message so flipping the
        // checkbox in the UI takes effect without restarting the trigger.
        const perInstance = loadConfig(inst.id).reactOnTrigger ?? true;
        if (envOn && perInstance) {
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
    const downloaded = msg.attachmentPaths ?? [];
    const skipped = msg.skippedAttachments ?? [];
    // Resolved channel label: `#name` / `DM con @user` / `Grupo: @a, @b…`.
    // Falls back to the raw id when the resolver couldn't fetch metadata
    // (network blip, missing scope, deleted channel).
    const channelLabel = (msg as SlackTriggerEventData & { channelName?: string }).channelName || msg.channel;

    // Build the "attachments block" agents can ingest verbatim — one line per
    // downloaded file with absolute path, plus a line per skipped file with
    // the reason. Empty string when there are no attachments.
    const blockLines: string[] = [];
    for (const att of downloaded) {
      blockLines.push(formatAttachmentLine(att));
    }
    for (const sk of skipped) {
      const sizeMb = typeof sk.size === 'number' ? `${Math.round(sk.size / (1024 * 1024))}MB` : 'unknown';
      blockLines.push(
        `[attachment-skipped: ${sk.reason} name=${sk.filename ?? 'unknown'} size=${sizeMb}${sk.detail ? ` detail=${sk.detail}` : ''}]`,
      );
    }
    const attachmentsBlock = blockLines.join('\n');

    return {
      'slack.user': msg.userName,
      // fromName/fromId are the boss-canonical names mirroring the Slack
      // template the trigger renderer uses. Aliases for slack.user/userId so
      // user-authored templates can pick whichever reads better.
      'slack.fromName': msg.userName,
      'slack.userId': msg.userId,
      'slack.fromId': msg.userId,
      'slack.message': msg.text,
      'slack.body': msg.text,
      'slack.channel': msg.channel,
      'slack.channelId': msg.channel,
      'slack.channelName': channelLabel,
      'slack.threadTs': msg.threadTs || msg.ts,
      'slack.fileCount': String(files.length),
      'slack.attachmentsCount': String(files.length),
      'slack.fileIds': files.map((f) => f.id).join(','),
      'slack.fileNames': files.map((f) => f.name ?? '').filter(Boolean).join(','),
      'slack.attachmentsList': files.map((f) => f.name ?? '').filter(Boolean).join(','),
      // New: absolute paths and ready-to-paste attachments block. Additive —
      // existing user templates that don't reference these vars keep working.
      'slack.filePaths': downloaded.map((a) => a.path).join(','),
      'slack.attachmentsBlock': attachmentsBlock,
      'slack.instanceId': msg.instanceId,
      'slack.instanceName': msg.instanceId,
    };
  },

  formatEventForLLM(event: ExternalEvent): string {
    const msg = event.data as SlackTriggerEventData;
    const files = msg.files ?? [];
    const filesLine = files.length
      ? `\nAttachments (${files.length}): ${files.map((f) => `${f.name ?? f.id} [${f.mimetype ?? 'unknown'}]`).join(', ')}`
      : '';
    const instanceLine = msg.instanceId !== 'default' ? ` [Slack instance: ${msg.instanceId}]` : '';
    const channelDisplay = (msg as SlackTriggerEventData & { channelName?: string }).channelName || msg.channel;
    return `Slack message from @${msg.userName} (${msg.userId}) in ${channelDisplay} (${msg.channel})${instanceLine}:\n"${msg.text}"${filesLine}`;
  },
};

// `slackClient` import kept (re-exports SlackMessage type used above).
void slackClient;
