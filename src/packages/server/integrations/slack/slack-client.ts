/**
 * Slack Client (single-instance facade)
 *
 * Thin re-export layer over the `default` SlackInstance. Existing callers
 * (slack-routes, slack-trigger-handler, slack/index.ts) keep using these
 * exports unchanged. Multi-instance plumbing lives in slack-instance.ts and
 * gets surfaced in chunk 2.
 */

import type { IntegrationContext, IntegrationStatus } from '../../../shared/integration-types.js';
import {
  getInstance,
  listInstances,
  clearInstances,
  type AddReactionParams,
  type GetMessagesParams,
  type GetThreadParams,
  type ListFilesParams,
  type SendDmParams,
  type SendMessageParams,
  type SlackChannel,
  type SlackFile,
  type SlackMessage,
  type SlackUser,
  type UploadFileParams,
  type WaitForReplyParams,
} from './slack-instance.js';

// ─── Re-exported types (backward compat for existing imports) ───

export type {
  AddReactionParams,
  GetMessagesParams,
  GetThreadParams,
  ListFilesParams,
  SendDmParams,
  SendMessageParams,
  SlackChannel,
  SlackFile,
  SlackMessage,
  SlackUser,
  UploadFileParams,
  WaitForReplyParams,
};

// ─── Init / Shutdown ───

export async function init(integrationCtx: IntegrationContext): Promise<void> {
  const inst = getInstance();
  inst.setContext(integrationCtx);
  await inst.init();
}

export async function shutdown(): Promise<void> {
  // Shut down every loaded instance (only `default` exists in chunk 1).
  for (const inst of listInstances()) {
    await inst.shutdown();
  }
  clearInstances();
}

// ─── Connection Management ───

export async function reconnect(): Promise<void> {
  await getInstance().reconnect();
}

export async function disconnect(): Promise<void> {
  await getInstance().disconnect();
}

// ─── Sending ───

export async function sendMessage(params: SendMessageParams): Promise<{ ts: string; channel: string }> {
  return getInstance().sendMessage(params);
}

// ─── Reactions ───

export async function addReaction(params: AddReactionParams): Promise<void> {
  return getInstance().addReaction(params);
}

// ─── Reading ───

export async function getChannelMessages(params: GetMessagesParams): Promise<SlackMessage[]> {
  return getInstance().getChannelMessages(params);
}

export async function getThreadReplies(params: GetThreadParams): Promise<SlackMessage[]> {
  return getInstance().getThreadReplies(params);
}

// ─── Wait For Reply (Long-Poll) ───

export function waitForReply(params: WaitForReplyParams): Promise<SlackMessage | null> {
  return getInstance().waitForReply(params);
}

// ─── Channel Management ───

export async function joinChannel(channel: string): Promise<{ id: string; name: string }> {
  return getInstance().joinChannel(channel);
}

// ─── Lookup ───

export async function listChannels(): Promise<SlackChannel[]> {
  return getInstance().listChannels();
}

export async function resolveUser(userId: string): Promise<SlackUser> {
  return getInstance().resolveUser(userId);
}

export async function findUserByEmail(email: string): Promise<SlackUser | null> {
  return getInstance().findUserByEmail(email);
}

export async function findUserByName(displayName: string): Promise<SlackUser | null> {
  return getInstance().findUserByName(displayName);
}

export async function searchUsers(query: string): Promise<SlackUser[]> {
  return getInstance().searchUsers(query);
}

// ─── Direct Messages ───

export async function openDmChannel(userId: string): Promise<string> {
  return getInstance().openDmChannel(userId);
}

export async function sendDm(params: SendDmParams): Promise<{ ts: string; channel: string }> {
  return getInstance().sendDm(params);
}

// ─── File Upload / Read / Download ───

export async function uploadFile(params: UploadFileParams): Promise<{ fileId: string; file: SlackFile }> {
  return getInstance().uploadFile(params);
}

export async function listFiles(params: ListFilesParams = {}): Promise<SlackFile[]> {
  return getInstance().listFiles(params);
}

export async function getFileInfo(fileId: string): Promise<SlackFile> {
  return getInstance().getFileInfo(fileId);
}

export async function fetchFileBytes(fileId: string): Promise<{
  buffer: Buffer;
  contentType: string | null;
  contentDisposition: string | null;
  contentLength: string | null;
  filename?: string;
}> {
  return getInstance().fetchFileBytes(fileId);
}

export async function downloadFile(
  file: string | SlackFile,
  outputPath: string,
): Promise<{ path: string; bytes: number; filename?: string; mimeType?: string }> {
  return getInstance().downloadFile(file, outputPath);
}

// ─── Event Subscription (for triggers) ───

export function onMessage(callback: (message: SlackMessage) => void): () => void {
  return getInstance().onMessage(callback);
}

// ─── Status ───

export function getStatus(): IntegrationStatus {
  return getInstance().getStatus();
}

export function isConnected(): boolean {
  return getInstance().isConnected();
}
