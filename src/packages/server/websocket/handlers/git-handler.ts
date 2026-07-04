/**
 * Git watch message handlers — subscribe a socket to server-side git status
 * polling (git_watch) and force an immediate recompute (git_refresh).
 */

import type { ClientMessage } from '../../../shared/types.js';
import { gitWatchService } from '../../services/git-watch-service.js';
import type { HandlerContext } from './types.js';

type GitWatchPayload = Extract<ClientMessage, { type: 'git_watch' }>['payload'];
type GitRefreshPayload = Extract<ClientMessage, { type: 'git_refresh' }>['payload'];

export function handleGitWatch(ctx: HandlerContext, payload: GitWatchPayload): void {
  gitWatchService.setWatchList(ctx.ws, payload?.paths || []);
}

export function handleGitRefresh(ctx: HandlerContext, payload: GitRefreshPayload): void {
  void gitWatchService.refreshPaths(payload?.paths || [], ctx.ws);
}
