/**
 * Outbound message sending and connection status queries.
 */

import type { ServerMessage, ClientMessage } from '../../shared/types';
import { agentDebugger } from '../services/agentDebugger';
import { getWs, getConnectFn } from './state';
import { cb } from './callbacks';

/**
 * Extract agentId from a message payload.
 */
export function extractAgentId(message: ServerMessage | ClientMessage): string | null {
  if (message.payload && typeof message.payload === 'object') {
    const payload = message.payload as any;
    if (payload.agentId) return payload.agentId;
    if (payload.id) return payload.id;
  }
  return null;
}

export function sendMessage(message: ClientMessage): void {
  const ws = getWs();
  if (!ws) {
    getConnectFn()?.();
    cb.onToast?.('error', 'Not Connected', 'Connecting to server... Please try again in a moment.');
    return;
  }

  if (ws.readyState !== WebSocket.OPEN) {
    if (ws.readyState === WebSocket.CONNECTING) {
      cb.onToast?.('warning', 'Connecting...', 'WebSocket is still connecting. Please wait a moment and try again.');
    } else if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      getConnectFn()?.();
      cb.onToast?.('warning', 'Reconnecting...', 'Connection lost. Reconnecting to server...');
    }
    return;
  }

  try {
    const messageStr = JSON.stringify(message);

    // Capture for agent-specific debugger if message has agentId
    const isDebuggerEnabled = agentDebugger.isEnabled();
    if (isDebuggerEnabled) {
      const agentId = extractAgentId(message);
      console.log('[AgentDebugger] SENT - type:', message.type, 'agentId:', agentId, 'payload:', message.payload);
      if (agentId) {
        agentDebugger.captureSent(agentId, messageStr);
      }
    }

    ws.send(messageStr);
  } catch (error) {
    cb.onToast?.('error', 'Send Failed', `Failed to send message: ${error}`);
  }
}

export function isConnected(): boolean {
  const ws = getWs();
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

export function getSocket(): WebSocket | null {
  return getWs();
}
