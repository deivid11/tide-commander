/**
 * Workflow Routes
 * REST endpoints for workflow definitions CRUD, instances lifecycle,
 * transitions, variables, event injection, timeline, steps, reasoning, and chat.
 */

import { Router, type Request, type Response } from 'express';
import * as workflowService from '../services/workflow-service.js';
import * as workflowExecutor from '../services/workflow-executor.js';
import * as workflowChatService from '../services/workflow-chat-service.js';
import type { WorkflowChatScope } from '../../shared/workflow-types.js';

const router = Router();

// ─── Query Helpers (same pattern as event-routes.ts) ───

function qs(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val[0] as string;
  return undefined;
}

function qn(val: unknown): number | undefined {
  const s = qs(val);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isNaN(n) ? undefined : n;
}

// ============================================================================
// Definitions (CRUD — stored in JSON)
// ============================================================================

router.get('/definitions', (_req: Request, res: Response) => {
  const definitions = workflowService.listDefinitions();
  res.json(definitions);
});

router.get('/definitions/:id', (req: Request, res: Response) => {
  const def = workflowService.getDefinition(req.params.id as string);
  if (!def) {
    res.status(404).json({ error: 'Workflow definition not found' });
    return;
  }
  res.json(def);
});

router.post('/definitions', (req: Request, res: Response) => {
  try {
    const def = workflowService.createDefinition(req.body);
    res.status(201).json(def);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create workflow definition';
    res.status(400).json({ error: msg });
  }
});

router.patch('/definitions/:id', (req: Request, res: Response) => {
  const def = workflowService.updateDefinition(req.params.id as string, req.body);
  if (!def) {
    res.status(404).json({ error: 'Workflow definition not found' });
    return;
  }
  res.json(def);
});

router.delete('/definitions/:id', (req: Request, res: Response) => {
  const deleted = workflowService.deleteDefinition(req.params.id as string);
  if (!deleted) {
    res.status(404).json({ error: 'Workflow definition not found' });
    return;
  }
  res.json({ success: true });
});

// ============================================================================
// Instances (runtime — stored in SQLite)
// ============================================================================

router.get('/instances', (req: Request, res: Response) => {
  const instances = workflowService.listInstances({
    status: qs(req.query.status),
    workflowDefId: qs(req.query.workflowDefId),
    limit: qn(req.query.limit),
    offset: qn(req.query.offset),
  });
  const total = workflowService.countInstances({
    status: qs(req.query.status),
    workflowDefId: qs(req.query.workflowDefId),
  });
  res.json({ instances, total });
});

router.get('/instances/:id', (req: Request, res: Response) => {
  const instance = workflowService.getInstance(req.params.id as string);
  if (!instance) {
    res.status(404).json({ error: 'Workflow instance not found' });
    return;
  }
  res.json(instance);
});

router.post('/instances', async (req: Request, res: Response) => {
  try {
    const instance = await workflowService.startWorkflow({
      workflowDefId: req.body.workflowDefId,
      initialVariables: req.body.initialVariables,
    });
    res.status(201).json(instance);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to start workflow';
    res.status(400).json({ error: msg });
  }
});

// ─── Instance Lifecycle ───

router.patch('/instances/:id/pause', (req: Request, res: Response) => {
  const instance = workflowService.pauseWorkflow(req.params.id as string);
  if (!instance) {
    res.status(404).json({ error: 'Instance not found or not running' });
    return;
  }
  res.json(instance);
});

router.patch('/instances/:id/resume', async (req: Request, res: Response) => {
  const instance = await workflowService.resumeWorkflow(req.params.id as string);
  if (!instance) {
    res.status(404).json({ error: 'Instance not found or not paused' });
    return;
  }
  res.json(instance);
});

router.patch('/instances/:id/cancel', (req: Request, res: Response) => {
  const instance = workflowService.cancelWorkflow(req.params.id as string);
  if (!instance) {
    res.status(404).json({ error: 'Instance not found or already terminal' });
    return;
  }
  res.json(instance);
});

// ─── Explicit Transition (agent-driven) ───

router.put('/instances/:id/transition', async (req: Request, res: Response) => {
  try {
    const { targetStateId, reason } = req.body as { targetStateId: string; reason?: string };
    if (!targetStateId) {
      res.status(400).json({ error: 'targetStateId is required' });
      return;
    }
    const instance = await workflowService.transitionTo(
      req.params.id as string,
      targetStateId,
      reason
    );
    res.json(instance);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Transition failed';
    res.status(400).json({ error: msg });
  }
});

router.get('/instances/:id/available-transitions', (req: Request, res: Response) => {
  try {
    const transitions = workflowService.getAvailableTransitions(req.params.id as string);
    res.json({ transitions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to get transitions';
    res.status(400).json({ error: msg });
  }
});

// ─── Legacy Manual Transition (event-based) ───

router.post('/instances/:id/transition', async (req: Request, res: Response) => {
  try {
    await workflowService.notifyEvent({
      instanceId: req.params.id as string,
      eventType: 'manual_transition',
      transitionId: req.body.transitionId,
    });
    const instance = workflowService.getInstance(req.params.id as string);
    res.json(instance);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Transition failed';
    res.status(400).json({ error: msg });
  }
});

// ─── Variable Updates (agents call this via curl) ───

router.patch('/instances/:id/variables', (req: Request, res: Response) => {
  try {
    const changedBy = req.body.changedBy || 'api';
    workflowService.updateVariables(
      req.params.id as string,
      req.body.variables,
      changedBy
    );
    const instance = workflowService.getInstance(req.params.id as string);
    res.json(instance);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update variables';
    res.status(400).json({ error: msg });
  }
});

// ─── Event Injection (for triggers/agents to notify workflows) ───

router.post('/instances/:id/event', async (req: Request, res: Response) => {
  try {
    await workflowService.notifyEvent({
      instanceId: req.params.id as string,
      eventType: req.body.eventType,
      triggerId: req.body.triggerId,
      transitionId: req.body.transitionId,
      data: req.body.data,
    });
    const instance = workflowService.getInstance(req.params.id as string);
    res.json(instance);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Event injection failed';
    res.status(400).json({ error: msg });
  }
});

// ─── Trigger Routing (workflow-executor) ───

router.post('/trigger', async (req: Request, res: Response) => {
  try {
    const { triggerId, triggerData, agentId } = req.body as {
      triggerId: string;
      triggerData?: Record<string, unknown>;
      agentId?: string;
    };

    if (!triggerId) {
      res.status(400).json({ error: 'triggerId is required' });
      return;
    }

    await workflowExecutor.handleTrigger({
      triggerId,
      triggerData: triggerData ?? {},
      agentId,
    });

    res.json({ routed: true, triggerId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Trigger routing failed';
    res.status(500).json({ error: msg });
  }
});

// ─── Agent Complete with Reasoning (workflow-executor) ───

router.post('/instances/:id/agent-complete', async (req: Request, res: Response) => {
  try {
    const { agentResponse, agentReasoning, agentSummary, variables, triggerId, transitionId } = req.body as {
      agentResponse?: string;
      agentReasoning?: string;
      agentSummary?: string;
      variables?: Record<string, unknown>;
      triggerId?: string;
      transitionId?: string;
    };

    const instance = await workflowExecutor.transitionInstance(
      req.params.id as string,
      'agent_complete',
      { agentResponse, agentReasoning, agentSummary, variables },
      { triggerId, transitionId }
    );

    if (!instance) {
      res.status(404).json({ error: 'Instance not found' });
      return;
    }

    res.json(instance);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Agent complete failed';
    res.status(400).json({ error: msg });
  }
});

// ─── Bind Agent to Instance (workflow-executor) ───

router.post('/instances/:id/bind-agent', (req: Request, res: Response) => {
  try {
    const { agentId, stateId } = req.body as { agentId: string; stateId?: string };

    if (!agentId) {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }

    const result = workflowExecutor.executeInstanceState(
      req.params.id as string,
      stateId || workflowService.getInstance(req.params.id as string)?.currentStateId || '',
      agentId
    );

    res.json({
      instanceId: result.instance.id,
      stateId: result.state.id,
      stateName: result.state.name,
      currentStepId: result.currentStep?.id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Bind agent failed';
    res.status(400).json({ error: msg });
  }
});

// ============================================================================
// History & Audit (reads from SQLite)
// ============================================================================

router.get('/instances/:id/timeline', (req: Request, res: Response) => {
  const instance = workflowService.getInstance(req.params.id as string);
  if (!instance) {
    res.status(404).json({ error: 'Workflow instance not found' });
    return;
  }
  const timeline = workflowService.getInstanceTimeline(req.params.id as string);
  res.json({ timeline, instance });
});

router.get('/instances/:id/steps', (req: Request, res: Response) => {
  const steps = workflowService.getInstanceSteps(req.params.id as string);
  res.json({ steps });
});

router.get('/instances/:id/variables', (req: Request, res: Response) => {
  const changes = workflowService.getInstanceVariableHistory(
    req.params.id as string,
    qs(req.query.variableName)
  );
  res.json({ changes });
});

router.get('/instances/:id/reasoning', (req: Request, res: Response) => {
  const steps = workflowExecutor.getReasoningChain(req.params.id as string);
  res.json({ steps });
});

// ============================================================================
// Workflow Chat (conversational audit)
// ============================================================================

router.post('/:defId/chat', async (req: Request, res: Response) => {
  try {
    const { message, scope, conversationHistory } = req.body as {
      message: string;
      scope: WorkflowChatScope;
      conversationHistory?: Array<{ role: string; content: string }>;
    };

    const result = await workflowChatService.chat(
      req.params.defId as string,
      message,
      scope,
      conversationHistory
    );
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Chat failed';
    res.status(500).json({ error: msg });
  }
});

router.get('/:defId/chat/history', (req: Request, res: Response) => {
  const history = workflowChatService.getChatHistory(req.params.defId as string);
  res.json({ messages: history });
});

export default router;
