/**
 * Workflow Chat Service
 * Context building + LLM conversation for workflow audit and exploration.
 * Retrieves relevant data from SQLite based on scope, sends to LLM with
 * user question, returns conversational response.
 */

import Anthropic from '@anthropic-ai/sdk';
import * as workflowService from './workflow-service.js';
import type { WorkflowChatScope, ChatMessage, SourceRef } from '../../shared/workflow-types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('WorkflowChat');

// Model mapping
const MODEL_MAP: Record<string, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
};

// Lazy-initialized client
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

// ─── Session Chat History (in-memory, resets on restart) ───

const chatHistories = new Map<string, ChatMessage[]>();
const MAX_HISTORY = 50;

// ─── Public API ───

export async function chat(
  workflowDefId: string,
  message: string,
  scope: WorkflowChatScope,
  conversationHistory?: Array<{ role: string; content: string }>,
): Promise<{ response: string; sources: SourceRef[] }> {
  const def = workflowService.getDefinition(workflowDefId);
  if (!def) {
    throw new Error(`Workflow definition not found: ${workflowDefId}`);
  }

  // Build context from SQLite based on scope
  const context = buildChatContext(workflowDefId, scope);

  // Build definition summary
  const defSummary = buildDefinitionSummary(def);

  // Build system prompt
  const systemPrompt = `You are a workflow assistant for the "${def.name}" workflow.
You help users understand what happened during workflow executions, audit processes,
and explore workflow history through conversation.

WORKFLOW DEFINITION:
${defSummary}

CURRENT CONTEXT (${scopeLabel(scope)}):
${context}

Answer the user's question based on the context above. Reference specific timestamps,
variable values, agent responses, and event details. If the information is not in the
current context, say so and suggest what the user might look at.

Keep responses concise and factual. Use timestamps and specific values from the data.`;

  // Build conversation messages
  const messages: Array<{ role: string; content: string }> = [];

  // Add previous conversation if provided
  if (conversationHistory) {
    for (const msg of conversationHistory.slice(-10)) { // Last 10 messages max
      messages.push(msg);
    }
  }

  // Add current message
  messages.push({ role: 'user', content: message });

  // Call LLM for conversational response
  let response: string;
  const sources = extractSources(scope);

  try {
    const anthropic = getClient();
    const llmMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (conversationHistory) {
      for (const msg of conversationHistory.slice(-10)) {
        llmMessages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
      }
    }
    llmMessages.push({ role: 'user', content: message });

    const result = await anthropic.messages.create({
      model: MODEL_MAP.haiku,
      max_tokens: 1024,
      system: systemPrompt,
      messages: llmMessages,
    });

    response = result.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  } catch (err) {
    log.error(`LLM call failed, falling back to context dump: ${err}`);
    // Fallback: return raw context
    response = `Here is the available information for the "${def.name}" workflow (${scopeLabel(scope)}):\n\n${context}`;
  }

  // Store in chat history
  const now = Date.now();
  const history = chatHistories.get(workflowDefId) || [];

  history.push({
    role: 'user',
    content: message,
    timestamp: now,
  });

  history.push({
    role: 'assistant',
    content: response,
    timestamp: now,
    sources,
  });

  // Trim history
  while (history.length > MAX_HISTORY) {
    history.shift();
  }

  chatHistories.set(workflowDefId, history);

  return { response, sources };
}

export function getChatHistory(workflowDefId: string): ChatMessage[] {
  return chatHistories.get(workflowDefId) || [];
}

// ─── Context Building ───

function buildChatContext(workflowDefId: string, scope: WorkflowChatScope): string {
  switch (scope.level) {
    case 'workflow':
      return buildWorkflowLevelContext(workflowDefId);
    case 'instance':
      return buildInstanceLevelContext(scope.instanceId);
    case 'step':
      return buildStepLevelContext(scope.instanceId, scope.stepId);
    default:
      return 'No context available.';
  }
}

function buildWorkflowLevelContext(workflowDefId: string): string {
  const instances = workflowService.listInstances({
    workflowDefId,
    limit: 20,
  });

  if (instances.length === 0) {
    return 'No workflow instances have been created yet.';
  }

  const lines: string[] = [];
  lines.push(`Total instances: ${instances.length}`);

  const running = instances.filter(i => i.status === 'running').length;
  const completed = instances.filter(i => i.status === 'completed').length;
  const failed = instances.filter(i => i.status === 'failed').length;

  lines.push(`Status breakdown: ${running} running, ${completed} completed, ${failed} failed`);
  lines.push('');
  lines.push('Recent instances:');

  for (const inst of instances.slice(0, 10)) {
    const started = new Date(inst.createdAt).toISOString();
    const duration = inst.completedAt ? `${Math.round((inst.completedAt - inst.createdAt) / 1000)}s` : 'ongoing';
    lines.push(`  - ${inst.id}: status=${inst.status}, state=${inst.currentStateId}, started=${started}, duration=${duration}`);
    if (inst.error) {
      lines.push(`    Error: ${inst.error}`);
    }
  }

  return lines.join('\n');
}

function buildInstanceLevelContext(instanceId: string): string {
  const instance = workflowService.getInstance(instanceId);
  if (!instance) {
    return `Instance ${instanceId} not found.`;
  }

  const lines: string[] = [];

  // Instance metadata
  lines.push(`Instance: ${instance.id}`);
  lines.push(`Workflow: ${instance.workflowName}`);
  lines.push(`Status: ${instance.status}`);
  lines.push(`Current State: ${instance.currentStateId}`);
  lines.push(`Created: ${new Date(instance.createdAt).toISOString()}`);
  if (instance.completedAt) {
    lines.push(`Completed: ${new Date(instance.completedAt).toISOString()}`);
    lines.push(`Duration: ${Math.round((instance.completedAt - instance.createdAt) / 1000)}s`);
  }
  if (instance.error) {
    lines.push(`Error: ${instance.error}`);
  }

  // Current variables
  lines.push('');
  lines.push('Variables:');
  for (const [key, value] of Object.entries(instance.variables)) {
    lines.push(`  ${key}: ${JSON.stringify(value)}`);
  }

  // Steps
  const steps = workflowService.getInstanceSteps(instanceId);
  if (steps.length > 0) {
    lines.push('');
    lines.push('Steps:');
    for (const step of steps) {
      const entered = new Date(step.enteredAt).toISOString();
      const duration = step.durationMs ? `${step.durationMs}ms` : 'ongoing';
      lines.push(`  [${step.status}] ${step.toStateName} (${entered}, ${duration})`);
      if (step.agentId) lines.push(`    Agent: ${step.agentId}`);
      if (step.agentResponse) lines.push(`    Response: ${step.agentResponse.slice(0, 200)}...`);
      if (step.error) lines.push(`    Error: ${step.error}`);
    }
  }

  // Variable changes
  const varChanges = workflowService.getInstanceVariableHistory(instanceId);
  if (varChanges.length > 0) {
    lines.push('');
    lines.push(`Variable changes (${varChanges.length} total):`);
    for (const vc of varChanges.slice(-20)) {
      lines.push(`  ${vc.variableName}: ${JSON.stringify(vc.oldValue)} → ${JSON.stringify(vc.newValue)} (by ${vc.changedBy}, ${new Date(vc.changedAt).toISOString()})`);
    }
  }

  return lines.join('\n');
}

function buildStepLevelContext(instanceId: string, stepId: string): string {
  const steps = workflowService.getInstanceSteps(instanceId);
  const step = steps.find(s => String(s.id) === stepId);

  if (!step) {
    return `Step ${stepId} not found in instance ${instanceId}.`;
  }

  const lines: string[] = [];

  lines.push(`Step: ${step.toStateName} (ID: ${step.id})`);
  lines.push(`Status: ${step.status}`);
  lines.push(`From: ${step.fromStateId || 'initial'} → ${step.toStateId}`);
  lines.push(`Entered: ${new Date(step.enteredAt).toISOString()}`);
  if (step.exitedAt) {
    lines.push(`Exited: ${new Date(step.exitedAt).toISOString()}`);
  }
  if (step.durationMs !== undefined) {
    lines.push(`Duration: ${step.durationMs}ms`);
  }
  if (step.transitionName) {
    lines.push(`Transition: ${step.transitionName}`);
  }

  if (step.agentId) {
    lines.push('');
    lines.push(`Agent: ${step.agentId}`);
  }

  if (step.promptSent) {
    lines.push('');
    lines.push('Prompt sent:');
    lines.push(step.promptSent);
  }

  if (step.agentResponse) {
    lines.push('');
    lines.push('Agent response:');
    lines.push(step.agentResponse);
  }

  if (step.agentReasoning) {
    lines.push('');
    lines.push('Agent reasoning:');
    lines.push(step.agentReasoning);
  }

  if (step.variablesBefore) {
    lines.push('');
    lines.push('Variables before:');
    for (const [key, value] of Object.entries(step.variablesBefore)) {
      lines.push(`  ${key}: ${JSON.stringify(value)}`);
    }
  }

  if (step.variablesAfter) {
    lines.push('');
    lines.push('Variables after:');
    for (const [key, value] of Object.entries(step.variablesAfter)) {
      lines.push(`  ${key}: ${JSON.stringify(value)}`);
    }
  }

  if (step.error) {
    lines.push('');
    lines.push(`Error: ${step.error}`);
  }

  return lines.join('\n');
}

// ─── Helpers ───

function buildDefinitionSummary(def: import('../../shared/workflow-types.js').WorkflowDefinition): string {
  const lines: string[] = [];
  lines.push(`Name: ${def.name}`);
  if (def.description) lines.push(`Description: ${def.description}`);
  lines.push(`Version: ${def.version}`);
  lines.push(`States (${def.states.length}): ${def.states.map(s => `${s.name} (${s.type})`).join(', ')}`);
  lines.push(`Initial state: ${def.initialStateId}`);
  lines.push(`Variables (${def.variables.length}): ${def.variables.map(v => `${v.name} (${v.type})`).join(', ')}`);
  return lines.join('\n');
}

function scopeLabel(scope: WorkflowChatScope): string {
  switch (scope.level) {
    case 'workflow': return 'Workflow Overview';
    case 'instance': return `Instance ${scope.instanceId}`;
    case 'step': return `Step ${scope.stepId} in Instance ${scope.instanceId}`;
    default: return 'Unknown';
  }
}

function extractSources(scope: WorkflowChatScope): SourceRef[] {
  const sources: SourceRef[] = [];

  if (scope.level === 'instance') {
    sources.push({ type: 'step', id: scope.instanceId, label: `Instance ${scope.instanceId}` });
  }

  if (scope.level === 'step') {
    sources.push({ type: 'step', id: scope.stepId, label: `Step ${scope.stepId}` });
  }

  return sources;
}
