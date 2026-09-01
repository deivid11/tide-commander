/**
 * Slack Trigger Handler
 * Implements TriggerHandler for 'slack' type triggers.
 *
 * Multi-instance, with DYNAMIC wiring:
 *   - At `startListening`, seeds an `onMessage` subscription for every instance
 *     the manifest currently knows about (via `listInstanceMetas()` +
 *     `getInstance(id)` — idempotent, no connection required to register the
 *     callback).
 *   - Also subscribes to `onInstanceChange` from the manifest, so instances
 *     added at runtime via `POST /api/slack/instances` are wired automatically,
 *     and instances deleted via `DELETE /api/slack/instances/:id` get their
 *     subscription torn down — without restarting the trigger handler.
 *   - Unsubscribers are tracked in a `Map<instanceId, off>` so individual
 *     instances can be detached without affecting the others.
 *   - `stopListening` removes the manifest hook and every per-instance listener,
 *     so post-stop manifest changes do NOT resurrect subscriptions.
 *
 * The source `instanceId` is propagated through the ExternalEvent payload so
 * triggers can scope themselves to a specific Slack connection (or accept any).
 */

import type { TriggerHandler, TriggerDefinition, ExternalEvent } from '../../../shared/integration-types.js';
import * as slackClient from './slack-client.js';
import type { SlackMessage } from './slack-client.js';
import { getInstance, type SlackInstance } from './slack-instance.js';
import { listInstanceMetas, onInstanceChange } from './slack-instance-manifest.js';
import { formatAttachmentLine } from '../../services/attachment-downloader.js';

/**
 * Trigger config recognised by `slack` triggers. `instanceId` is optional —
 * triggers without it match messages from ANY instance.
 *
 * Channel-id filters (`excludeChannelIds`, `channelIdAllowlist`) are matched
 * as LITERAL Slack channel ids against `msg.channel` — no regex, no prefix.
 * Use the canonical Slack id: `C…` for public/private channels, `G…` for
 * legacy private groups, `D…` for 1:1 DMs (e.g. `C06UCC5FFST`, `D0AMP833LDQ`).
 * Both filters are evaluated EARLY (before `userFilter` / `messagePattern`)
 * so muted/noisy channels short-circuit before the more expensive checks.
 *
 * Distinct from the single-value `channelId` — that one is back-compat for
 * legacy "fire only on this channel" triggers; the new array filters compose
 * with it and with each other.
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
  /** Literal Slack channel ids whose messages must NOT fire the trigger. */
  excludeChannelIds?: string[];
  /** When set + non-empty, only messages whose `channel` is in this list fire. Literal channel ids. */
  channelIdAllowlist?: string[];
}

/** ExternalEvent.data shape for Slack — message + the instance it came from. */
export interface SlackTriggerEventData extends SlackMessage {
  /** Which Slack instance dispatched this event. */
  instanceId: string;
}

/**
 * Per-instance `onMessage` unsubscribers, keyed by instance id. We track them
 * individually so an instance removed at runtime (DELETE /api/slack/instances/:id)
 * can be detached without tearing down everyone else's subscription.
 */
const instanceUnsubscribers = new Map<string, () => void>();
/** Unsubscribe from manifest add/remove events while the handler is active. */
let manifestUnsubscribe: (() => void) | null = null;

/**
 * Subscribe to `onMessage` for a single instance. Idempotent — calling twice
 * for the same id keeps the original subscription. Returns nothing; the
 * unsubscribe callback is stashed in `instanceUnsubscribers`.
 */
function subscribeInstance(
  inst: SlackInstance,
  onEvent: (event: ExternalEvent) => void,
): void {
  if (instanceUnsubscribers.has(inst.id)) return;

  const off = inst.onMessage((message: SlackMessage) => {
    const eventData: SlackTriggerEventData = { ...message, instanceId: inst.id };
    onEvent({
      source: 'slack',
      type: 'message',
      data: eventData,
      timestamp: Date.now(),
    });
  });
  instanceUnsubscribers.set(inst.id, off);
}

/** Detach an instance's listener. No-op when not subscribed. */
function unsubscribeInstance(id: string): void {
  const off = instanceUnsubscribers.get(id);
  if (!off) return;
  try { off(); } catch { /* ignore */ }
  instanceUnsubscribers.delete(id);
}

export const slackTriggerHandler: TriggerHandler = {
  triggerType: 'slack',

  async startListening(onEvent) {
    // Seed: subscribe to every instance the manifest already knows about.
    // `getInstance()` is lazy + idempotent — it returns the existing instance
    // when present, or creates one if the registry hasn't seen this id yet
    // (which is fine because `onMessage` only registers a callback; no
    // connection is required for the listener to be in place once the
    // instance connects later).
    for (const meta of listInstanceMetas()) {
      subscribeInstance(getInstance(meta.id), onEvent);
    }

    // Wire dynamically when a new instance shows up (POST /api/slack/instances)
    // or detach when one is deleted. This is what makes triggers configured for
    // instances created AFTER server start actually fire.
    manifestUnsubscribe = onInstanceChange((change) => {
      if (change.type === 'added') {
        subscribeInstance(getInstance(change.id), onEvent);
      } else {
        unsubscribeInstance(change.id);
      }
    });
  },

  async stopListening() {
    if (manifestUnsubscribe) {
      try { manifestUnsubscribe(); } catch { /* ignore */ }
      manifestUnsubscribe = null;
    }
    for (const id of Array.from(instanceUnsubscribers.keys())) {
      unsubscribeInstance(id);
    }
  },

  structuralMatch(trigger: TriggerDefinition, event: ExternalEvent): boolean {
    const msg = event.data as SlackTriggerEventData;
    const config = trigger.config as SlackTriggerConfig;

    if (config.instanceId && msg.instanceId !== config.instanceId) return false;
    if (config.channelId && msg.channel !== config.channelId) return false;

    // Channel-id filters run BEFORE userFilter / messagePattern so muted/noisy
    // channels short-circuit the cheapest way possible. Match is exact —
    // no normalization, no prefix.
    if (config.excludeChannelIds?.length && config.excludeChannelIds.includes(msg.channel)) return false;
    if (config.channelIdAllowlist?.length && !config.channelIdAllowlist.includes(msg.channel)) return false;

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
