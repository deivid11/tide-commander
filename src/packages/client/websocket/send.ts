/**
 * Outbound message sending and connection status queries.
 * Includes a pending-message queue backed by localStorage so that
 * send_command messages are never lost when the backend is unreachable.
 */

import type { ServerMessage, ClientMessage } from '../../shared/types';
import { agentDebugger } from '../services/agentDebugger';
import { STORAGE_KEYS } from '../utils/storage';
import { getWs, getConnectFn } from './state';
import { cb } from './callbacks';
import { appendQueuedMessage } from '../../shared/message-queue';
import { recordLocalAgentCreationIntent } from './agentCreationIntent';

/* ------------------------------------------------------------------ */
/*  Pending-message queue (localStorage-backed)                       */
/* ------------------------------------------------------------------ */

interface PendingMessage {
  message: ClientMessage;
  queuedAt: number;
}

const PENDING_KEY = STORAGE_KEYS.PENDING_MESSAGES;
const MAX_PENDING_AGE_MS = 5 * 60 * 1000; // drop messages older than 5 min

function loadPendingMessages(): PendingMessage[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    const items: PendingMessage[] = JSON.parse(raw);
    // Drop stale entries
    const now = Date.now();
    return items.filter((m) => now - m.queuedAt < MAX_PENDING_AGE_MS);
  } catch {
    return [];
  }
}

function savePendingMessages(items: PendingMessage[]): void {
  try {
    if (items.length === 0) {
      localStorage.removeItem(PENDING_KEY);
    } else {
      localStorage.setItem(PENDING_KEY, JSON.stringify(items));
    }
  } catch {
    // localStorage full or unavailable – not much we can do
  }
}

function queueMessage(message: ClientMessage): void {
  const pending = loadPendingMessages();
  if (message.type !== 'send_command') {
    pending.push({ message, queuedAt: Date.now() });
    savePendingMessages(pending);
    return;
  }

  const { agentId, command } = message.payload;
  const matchingIndexes: number[] = [];
  const commands: string[] = [];
  let forceInterrupt = message.payload.forceInterrupt === true;

  for (let index = 0; index < pending.length; index++) {
    const queued = pending[index].message;
    if (queued.type !== 'send_command' || queued.payload.agentId !== agentId) continue;
    matchingIndexes.push(index);
    commands.push(queued.payload.command);
    forceInterrupt ||= queued.payload.forceInterrupt === true;
  }

  appendQueuedMessage(commands, command);
  if (matchingIndexes.length === 0) {
    pending.push({
      message: {
        ...message,
        payload: { ...message.payload, command: commands[0] },
      },
      queuedAt: Date.now(),
    });
  } else {
    const firstIndex = matchingIndexes[0];
    pending[firstIndex] = {
      message: {
        ...message,
        payload: {
          ...message.payload,
          command: commands[0],
          ...(forceInterrupt ? { forceInterrupt: true } : {}),
        },
      },
      // Refresh the age because the combined entry now contains new content.
      queuedAt: Date.now(),
    };
    for (let index = matchingIndexes.length - 1; index >= 1; index--) {
      pending.splice(matchingIndexes[index], 1);
    }
  }
  savePendingMessages(pending);
}

/**
 * Flush any queued messages. Called from connection.ts on reconnect.
 * Returns the number of messages successfully sent.
 */
export function flushPendingMessages(): number {
  const pending = loadPendingMessages();
  if (pending.length === 0) return 0;

  let sent = 0;
  const stillPending: PendingMessage[] = [];

  for (const entry of pending) {
    if (sendMessageDirect(entry.message)) {
      sent++;
    } else {
      stillPending.push(entry);
    }
  }

  savePendingMessages(stillPending);

  if (sent > 0) {
    const label = sent === 1 ? 'queued message' : 'queued messages';
    cb.onToast?.('success', 'Messages Sent', `${sent} ${label} delivered after reconnecting.`);
  }

  return sent;
}

/**
 * Check whether there are messages waiting to be sent.
 */
export function hasPendingMessages(): boolean {
  return loadPendingMessages().length > 0;
}

/**
 * Get pending send_command messages for a specific agent.
 */
export function getPendingMessagesForAgent(agentId: string): Array<{ command: string; queuedAt: number }> {
  const pending = loadPendingMessages();
  return pending
    .filter((entry) => {
      if (entry.message.type !== 'send_command') return false;
      const payload = entry.message.payload as { agentId?: string } | undefined;
      return payload?.agentId === agentId;
    })
    .map((entry) => ({
      command: (entry.message.payload as { command?: string } | undefined)?.command || '',
      queuedAt: entry.queuedAt,
    }));
}

/**
 * Remove a pending send_command message for a specific agent by index.
 */
export function removePendingMessageForAgent(agentId: string, index: number): void {
  const pending = loadPendingMessages();
  let agentIndex = 0;
  const filtered = pending.filter((entry) => {
    if (entry.message.type !== 'send_command') return true;
    const payload = entry.message.payload as { agentId?: string } | undefined;
    if (payload?.agentId === agentId) {
      if (agentIndex === index) {
        agentIndex++;
        return false;
      }
      agentIndex++;
    }
    return true;
  });
  savePendingMessages(filtered);
}

/* ------------------------------------------------------------------ */
/*  Core send helpers                                                 */
/* ------------------------------------------------------------------ */

/**
 * Extract agentId from a message payload.
 */
export function extractAgentId(message: ServerMessage | ClientMessage): string | null {
  if (message.payload && typeof message.payload === 'object') {
    const payload = message.payload as any;
    if (payload.agentId) return payload.agentId;
    if (payload.parentAgentId) return payload.parentAgentId;
    if (payload.bossId) return payload.bossId;
    if (payload.id) return payload.id;
  }
  return null;
}

/**
 * Low-level send – does NOT queue on failure.
 */
function sendMessageDirect(message: ClientMessage): boolean {
  const ws = getWs();
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;

  try {
    const messageStr = JSON.stringify(message);

    const agentId = extractAgentId(message);
    if (agentId) {
      agentDebugger.captureSent(agentId, messageStr);
    }

    ws.send(messageStr);
    recordLocalAgentCreationIntent(message);
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a message over the WebSocket.
 *
 * For `send_command` messages: if the connection is down the message is
 * queued in localStorage and will be automatically delivered when the
 * connection is restored.
 *
 * Returns `true` if the message was sent immediately, `false` if it was
 * queued or dropped.
 */
export function sendMessage(message: ClientMessage): boolean {
  const ws = getWs();
  if (!ws) {
    getConnectFn()?.();
    if (message.type === 'send_command') {
      queueMessage(message);
      cb.onToast?.('warning', 'Message Queued', 'Connection lost. Your message will be sent when reconnected.');
    } else {
      cb.onToast?.('error', 'Not Connected', 'Connecting to server... Please try again in a moment.');
    }
    return false;
  }

  if (ws.readyState !== WebSocket.OPEN) {
    if (ws.readyState === WebSocket.CONNECTING) {
      if (message.type === 'send_command') {
        queueMessage(message);
        cb.onToast?.('warning', 'Message Queued', 'Still connecting. Your message will be sent automatically.');
      } else {
        cb.onToast?.('warning', 'Connecting...', 'WebSocket is still connecting. Please wait a moment and try again.');
      }
    } else if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      getConnectFn()?.();
      if (message.type === 'send_command') {
        queueMessage(message);
        cb.onToast?.('warning', 'Message Queued', 'Connection lost. Your message will be sent when reconnected.');
      } else {
        cb.onToast?.('warning', 'Reconnecting...', 'Connection lost. Reconnecting to server...');
      }
    }
    return false;
  }

  try {
    const messageStr = JSON.stringify(message);

    // Capture for agent-specific debugger if message has an extractable agent id.
    // No console.log here — this runs for every outbound message.
    const agentId = extractAgentId(message);
    if (agentId) {
      agentDebugger.captureSent(agentId, messageStr);
    }

    ws.send(messageStr);
    recordLocalAgentCreationIntent(message);
    return true;
  } catch (error) {
    if (message.type === 'send_command') {
      queueMessage(message);
      cb.onToast?.('warning', 'Message Queued', 'Send failed. Your message will be retried when reconnected.');
    } else {
      cb.onToast?.('error', 'Send Failed', `Failed to send message: ${error}`);
    }
    return false;
  }
}

export function isConnected(): boolean {
  const ws = getWs();
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

export function getSocket(): WebSocket | null {
  return getWs();
}
