/**
 * Workflow WebSocket Handler
 * Handles workflow definition CRUD, instance lifecycle, and manual transitions via WebSocket.
 */

import type { HandlerContext } from './types.js';
import * as workflowService from '../../services/workflow-service.js';
import type { WorkflowDefinition } from '../../../shared/workflow-types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('WorkflowWS');

// ============================================================================
// Definition Handlers
// ============================================================================

export async function handleCreateWorkflowDef(
  ctx: HandlerContext,
  payload: Omit<WorkflowDefinition, 'id' | 'version' | 'createdAt' | 'updatedAt'>
): Promise<void> {
  try {
    const def = workflowService.createDefinition(payload);
    ctx.broadcast({ type: 'workflow_definition_created', payload: def } as any);
  } catch (err: any) {
    log.error('Failed to create workflow definition:', err);
    ctx.sendError(err.message || 'Failed to create workflow definition');
  }
}

export async function handleUpdateWorkflowDef(
  ctx: HandlerContext,
  payload: { id: string; updates: Partial<WorkflowDefinition> }
): Promise<void> {
  try {
    const def = workflowService.updateDefinition(payload.id, payload.updates);
    if (!def) {
      ctx.sendError(`Workflow definition not found: ${payload.id}`);
      return;
    }
    ctx.broadcast({ type: 'workflow_definition_updated', payload: def } as any);
  } catch (err: any) {
    log.error('Failed to update workflow definition:', err);
    ctx.sendError(err.message || 'Failed to update workflow definition');
  }
}

export async function handleDeleteWorkflowDef(
  ctx: HandlerContext,
  payload: { id: string }
): Promise<void> {
  try {
    const success = workflowService.deleteDefinition(payload.id);
    if (!success) {
      ctx.sendError(`Workflow definition not found: ${payload.id}`);
      return;
    }
    ctx.broadcast({ type: 'workflow_definition_deleted', payload: { id: payload.id } } as any);
  } catch (err: any) {
    log.error('Failed to delete workflow definition:', err);
    ctx.sendError(err.message || 'Failed to delete workflow definition');
  }
}

// ============================================================================
// Instance Handlers
// ============================================================================

export async function handleStartWorkflow(
  ctx: HandlerContext,
  payload: { workflowDefId: string; initialVariables?: Record<string, unknown> }
): Promise<void> {
  try {
    const instance = await workflowService.startWorkflow(payload);
    ctx.broadcast({ type: 'workflow_instance_created', payload: instance } as any);
  } catch (err: any) {
    log.error('Failed to start workflow:', err);
    ctx.sendError(err.message || 'Failed to start workflow');
  }
}

export async function handlePauseWorkflow(
  ctx: HandlerContext,
  payload: { instanceId: string }
): Promise<void> {
  try {
    const instance = workflowService.pauseWorkflow(payload.instanceId);
    if (!instance) {
      ctx.sendError(`Instance not found or not running: ${payload.instanceId}`);
      return;
    }
    ctx.broadcast({ type: 'workflow_instance_updated', payload: instance } as any);
  } catch (err: any) {
    log.error('Failed to pause workflow:', err);
    ctx.sendError(err.message || 'Failed to pause workflow');
  }
}

export async function handleResumeWorkflow(
  ctx: HandlerContext,
  payload: { instanceId: string }
): Promise<void> {
  try {
    const instance = await workflowService.resumeWorkflow(payload.instanceId);
    if (!instance) {
      ctx.sendError(`Instance not found or not paused: ${payload.instanceId}`);
      return;
    }
    ctx.broadcast({ type: 'workflow_instance_updated', payload: instance } as any);
  } catch (err: any) {
    log.error('Failed to resume workflow:', err);
    ctx.sendError(err.message || 'Failed to resume workflow');
  }
}

export async function handleCancelWorkflow(
  ctx: HandlerContext,
  payload: { instanceId: string }
): Promise<void> {
  try {
    const instance = workflowService.cancelWorkflow(payload.instanceId);
    if (!instance) {
      ctx.sendError(`Instance not found or already terminal: ${payload.instanceId}`);
      return;
    }
    ctx.broadcast({ type: 'workflow_instance_updated', payload: instance } as any);
  } catch (err: any) {
    log.error('Failed to cancel workflow:', err);
    ctx.sendError(err.message || 'Failed to cancel workflow');
  }
}

export async function handleManualTransition(
  ctx: HandlerContext,
  payload: { instanceId: string; transitionId: string }
): Promise<void> {
  try {
    await workflowService.notifyEvent({
      instanceId: payload.instanceId,
      eventType: 'manual_transition',
      transitionId: payload.transitionId,
    });
    const instance = workflowService.getInstance(payload.instanceId);
    if (instance) {
      ctx.broadcast({ type: 'workflow_instance_updated', payload: instance } as any);
    }
  } catch (err: any) {
    log.error('Failed to execute manual transition:', err);
    ctx.sendError(err.message || 'Failed to execute manual transition');
  }
}
