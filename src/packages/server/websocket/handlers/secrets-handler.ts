/**
 * Secrets WebSocket Handler
 * Handles client requests for secret management
 */

import type { HandlerContext } from './types.js';
import type { Secret } from '../../../shared/types.js';
import { secretsService } from '../../services/secrets-service.js';
import { createLogger } from '../../utils/index.js';

const log = createLogger('SecretsHandler');

/**
 * Handle create_secret message
 */
export function handleCreateSecret(
  ctx: HandlerContext,
  payload: Omit<Secret, 'id' | 'createdAt' | 'updatedAt'>
): void {
  log.log(` Creating secret: ${payload.name} (${payload.key})`);

  const result = secretsService.createSecret({
    name: payload.name,
    key: payload.key,
    value: payload.value,
    description: payload.description,
  });

  if ('error' in result) {
    ctx.sendError(result.error);
    return;
  }

  ctx.broadcast({
    type: 'secret_created',
    payload: result,
  });
}

/**
 * Handle update_secret message
 */
export function handleUpdateSecret(
  ctx: HandlerContext,
  payload: { id: string; updates: Partial<Omit<Secret, 'id' | 'createdAt' | 'updatedAt'>> }
): void {
  log.log(` Updating secret: ${payload.id}`);

  const result = secretsService.updateSecret(payload.id, payload.updates);

  if (!result) {
    ctx.sendError('Secret not found');
    return;
  }

  if ('error' in result) {
    ctx.sendError(result.error);
    return;
  }

  ctx.broadcast({
    type: 'secret_updated',
    payload: result,
  });
}

/**
 * Handle delete_secret message
 */
export function handleDeleteSecret(
  ctx: HandlerContext,
  payload: { id: string }
): void {
  log.log(` Deleting secret: ${payload.id}`);

  const success = secretsService.deleteSecret(payload.id);

  if (!success) {
    ctx.sendError('Failed to delete secret');
    return;
  }

  ctx.broadcast({
    type: 'secret_deleted',
    payload: { id: payload.id },
  });
}
