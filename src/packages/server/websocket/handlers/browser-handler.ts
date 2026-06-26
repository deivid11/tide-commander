/**
 * browser-handler.ts — WebSocket handlers for the browser bridge.
 *
 * `browser_register` marks the sending socket (an extension side panel) as a
 * browser-command target; `browser_result` delivers a relayed command's reply
 * back to the awaiting server-side request.
 */

import type { HandlerContext } from './types.js';
import { registerBrowserSocket, resolveBrowserResult } from '../../services/browser-bridge-service.js';

export function handleBrowserRegister(ctx: HandlerContext): void {
  registerBrowserSocket(ctx.ws);
}

export function handleBrowserResult(
  _ctx: HandlerContext,
  payload: { reqId: string; ok: boolean; result?: unknown; error?: string },
): void {
  resolveBrowserResult(payload.reqId, payload.ok, payload.result, payload.error);
}
