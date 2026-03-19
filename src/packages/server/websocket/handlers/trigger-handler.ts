/**
 * Trigger WebSocket Handler
 * Handles create, update, delete, and fire trigger messages over WebSocket.
 */

import type { HandlerContext } from './types.js';
import type { Trigger } from '../../../shared/trigger-types.js';
import * as triggerService from '../../services/trigger-service.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('TriggerWS');

// ─── Create Trigger ───

export async function handleCreateTrigger(
  ctx: HandlerContext,
  payload: Omit<Trigger, 'id' | 'createdAt' | 'updatedAt' | 'fireCount'>
): Promise<void> {
  try {
    const trigger = triggerService.createTrigger(payload);
    ctx.broadcast({ type: 'trigger_created', payload: trigger } as any);
    ctx.sendActivity(trigger.agentId, `Trigger "${trigger.name}" created`);
  } catch (err: any) {
    log.error('Failed to create trigger:', err);
    ctx.sendError(err.message || 'Failed to create trigger');
  }
}

// ─── Update Trigger ───

export async function handleUpdateTrigger(
  ctx: HandlerContext,
  payload: { id: string; updates: Partial<Trigger> }
): Promise<void> {
  try {
    const trigger = triggerService.updateTrigger(payload.id, payload.updates);
    if (!trigger) {
      ctx.sendError(`Trigger not found: ${payload.id}`);
      return;
    }
    ctx.broadcast({ type: 'trigger_updated', payload: trigger } as any);
  } catch (err: any) {
    log.error('Failed to update trigger:', err);
    ctx.sendError(err.message || 'Failed to update trigger');
  }
}

// ─── Delete Trigger ───

export async function handleDeleteTrigger(
  ctx: HandlerContext,
  payload: { id: string }
): Promise<void> {
  try {
    const success = triggerService.deleteTrigger(payload.id);
    if (!success) {
      ctx.sendError(`Trigger not found: ${payload.id}`);
      return;
    }
    ctx.broadcast({ type: 'trigger_deleted', payload: { id: payload.id } } as any);
  } catch (err: any) {
    log.error('Failed to delete trigger:', err);
    ctx.sendError(err.message || 'Failed to delete trigger');
  }
}

// ─── Fire Trigger ───

export async function handleFireTrigger(
  ctx: HandlerContext,
  payload: { id: string; variables?: Record<string, string> }
): Promise<void> {
  try {
    const trigger = triggerService.getTrigger(payload.id);
    if (!trigger) {
      ctx.sendError(`Trigger not found: ${payload.id}`);
      return;
    }

    await triggerService.fireTrigger(payload.id, payload.variables || {});

    ctx.broadcast({
      type: 'trigger_fired',
      payload: {
        triggerId: payload.id,
        agentId: trigger.agentId,
        timestamp: Date.now(),
      },
    } as any);

    ctx.sendActivity(trigger.agentId, `Trigger "${trigger.name}" fired manually`);
  } catch (err: any) {
    log.error('Failed to fire trigger:', err);
    ctx.sendError(err.message || 'Failed to fire trigger');

    const trigger = triggerService.getTrigger(payload.id);
    if (trigger) {
      ctx.broadcast({
        type: 'trigger_error',
        payload: {
          triggerId: payload.id,
          error: err.message || 'Unknown error',
        },
      } as any);
    }
  }
}
