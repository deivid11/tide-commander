/**
 * Custom Agent Class Handler
 * Handles CRUD operations for custom agent classes
 */

import { customClassService } from '../../services/index.js';
import { createLogger } from '../../utils/index.js';
import type { HandlerContext } from './types.js';

const log = createLogger('CustomClassHandler');

/**
 * Handle create_custom_agent_class message
 */
export function handleCreateCustomAgentClass(
  ctx: HandlerContext,
  payload: {
    name: string;
    description: string;
    instructions?: string;
    color: string;
    icon: string;
    defaultSkillIds: string[];
    model?: string;
  }
): void {
  try {
    const customClass = customClassService.createCustomClass(payload);
    ctx.broadcast({
      type: 'custom_agent_class_created',
      payload: customClass,
    });
    log.log(` Created custom agent class: ${customClass.name} (${customClass.id})`);
  } catch (err: any) {
    log.error(' Failed to create custom agent class:', err);
    ctx.sendError(err.message);
  }
}

/**
 * Handle update_custom_agent_class message
 */
export function handleUpdateCustomAgentClass(
  ctx: HandlerContext,
  payload: {
    id: string;
    updates: Partial<{
      name: string;
      description: string;
      instructions: string;
      color: string;
      defaultSkillIds: string[];
    }>;
  }
): void {
  try {
    const customClass = customClassService.updateCustomClass(payload.id, payload.updates);
    if (customClass) {
      ctx.broadcast({
        type: 'custom_agent_class_updated',
        payload: customClass,
      });
      log.log(` Updated custom agent class: ${customClass.name} (${customClass.id})`);
    } else {
      ctx.sendError(`Custom agent class not found: ${payload.id}`);
    }
  } catch (err: any) {
    log.error(' Failed to update custom agent class:', err);
    ctx.sendError(err.message);
  }
}

/**
 * Handle delete_custom_agent_class message
 */
export function handleDeleteCustomAgentClass(
  ctx: HandlerContext,
  payload: { id: string }
): void {
  try {
    const deleted = customClassService.deleteCustomClass(payload.id);
    if (deleted) {
      ctx.broadcast({
        type: 'custom_agent_class_deleted',
        payload: { id: payload.id },
      });
      log.log(` Deleted custom agent class: ${payload.id}`);
    } else {
      ctx.sendError(`Custom agent class not found: ${payload.id}`);
    }
  } catch (err: any) {
    log.error(' Failed to delete custom agent class:', err);
    ctx.sendError(err.message);
  }
}
