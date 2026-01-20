/**
 * Boss Service
 * Manages boss agents, subordinate relationships, and task delegation logic
 * Boss agents can route user commands to the most appropriate subordinate agent
 */

import { spawn } from 'child_process';
import { StringDecoder } from 'string_decoder';
import * as agentService from './agent-service.js';
import * as supervisorService from './supervisor-service.js';
import type {
  Agent,
  DelegationDecision,
  SubordinateContext,
  AgentSupervisorHistoryEntry,
} from '../../shared/types.js';
import { ClaudeBackend } from '../claude/index.js';
import {
  loadDelegationHistory,
  saveDelegationHistory,
  addDelegationDecision,
  getDelegationHistory as getHistoryFromStorage,
  deleteDelegationHistory,
} from '../data/index.js';
import { logger, sanitizeUnicode, generateId, truncateOrEmpty } from '../utils/index.js';

const log = logger.boss || console;

// Delegation history storage (persisted to disk)
let delegationHistories: Map<string, DelegationDecision[]> = new Map();

// Claude backend for delegation analysis
const claudeBackend = new ClaudeBackend();

// Event listeners
type BossListener = (event: string, data: unknown) => void;
const listeners = new Set<BossListener>();

// ============================================================================
// Initialization
// ============================================================================

export function init(): void {
  delegationHistories = loadDelegationHistory();
  log.log?.(' Initialized boss service');
  log.log?.(` Loaded delegation history for ${delegationHistories.size} bosses`);
}

export function shutdown(): void {
  // Save any pending history
  saveDelegationHistory(delegationHistories);
}

// ============================================================================
// Event System
// ============================================================================

export function subscribe(listener: BossListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: string, data: unknown): void {
  listeners.forEach((listener) => listener(event, data));
}

// ============================================================================
// Boss Validation
// ============================================================================

/**
 * Check if an agent is a boss
 * Checks both isBoss property and class === 'boss' for backward compatibility
 */
export function isBossAgent(agentId: string): boolean {
  const agent = agentService.getAgent(agentId);
  return agent?.isBoss === true || agent?.class === 'boss';
}

/**
 * Get a boss agent by ID (returns null if not a boss)
 * Checks both isBoss property and class === 'boss' for backward compatibility
 */
export function getBossAgent(agentId: string): Agent | null {
  const agent = agentService.getAgent(agentId);
  if (!agent?.isBoss && agent?.class !== 'boss') return null;
  return agent;
}

// ============================================================================
// Subordinate Management
// ============================================================================

/**
 * Assign subordinates to a boss
 * Replaces any existing subordinate assignments
 */
export function assignSubordinates(bossId: string, subordinateIds: string[]): void {
  const boss = getBossAgent(bossId);
  if (!boss) {
    throw new Error(`Agent ${bossId} is not a boss`);
  }

  // Validate subordinates
  const validSubordinates: string[] = [];
  for (const subId of subordinateIds) {
    const sub = agentService.getAgent(subId);
    if (!sub) {
      log.log?.(`  Skipping invalid subordinate ID: ${subId}`);
      continue;
    }
    if (sub.isBoss || sub.class === 'boss') {
      log.log?.(`  Skipping boss agent as subordinate: ${sub.name}`);
      continue;
    }
    if (sub.bossId && sub.bossId !== bossId) {
      log.log?.(`  Agent ${sub.name} already has a boss, reassigning`);
      // Remove from previous boss
      const prevBoss = agentService.getAgent(sub.bossId);
      if (prevBoss && prevBoss.subordinateIds) {
        agentService.updateAgent(sub.bossId, {
          subordinateIds: prevBoss.subordinateIds.filter(id => id !== subId)
        });
      }
    }
    validSubordinates.push(subId);
  }

  // Update boss with new subordinates
  agentService.updateAgent(bossId, { subordinateIds: validSubordinates });

  // Update each subordinate with their boss reference
  for (const subId of validSubordinates) {
    agentService.updateAgent(subId, { bossId });
  }

  // Remove bossId from agents no longer subordinate
  const previousSubs = boss.subordinateIds || [];
  for (const prevSubId of previousSubs) {
    if (!validSubordinates.includes(prevSubId)) {
      agentService.updateAgent(prevSubId, { bossId: undefined });
    }
  }

  log.log?.(` Assigned ${validSubordinates.length} subordinates to boss ${boss.name}`);
  emit('subordinates_updated', { bossId, subordinateIds: validSubordinates });
}

/**
 * Remove a subordinate from a boss
 */
export function removeSubordinate(bossId: string, subordinateId: string): void {
  const boss = getBossAgent(bossId);
  if (!boss) {
    throw new Error(`Agent ${bossId} is not a boss`);
  }

  const currentSubs = boss.subordinateIds || [];
  if (!currentSubs.includes(subordinateId)) {
    return; // Already not a subordinate
  }

  // Update boss
  agentService.updateAgent(bossId, {
    subordinateIds: currentSubs.filter(id => id !== subordinateId)
  });

  // Update subordinate
  agentService.updateAgent(subordinateId, { bossId: undefined });

  log.log?.(` Removed subordinate ${subordinateId} from boss ${boss.name}`);
  emit('subordinates_updated', { bossId, subordinateIds: currentSubs.filter(id => id !== subordinateId) });
}

/**
 * Get all subordinates for a boss
 */
export function getSubordinates(bossId: string): Agent[] {
  const boss = getBossAgent(bossId);
  if (!boss) return [];

  const subordinateIds = boss.subordinateIds || [];
  return subordinateIds
    .map(id => agentService.getAgent(id))
    .filter((agent): agent is Agent => agent !== null);
}

/**
 * Get the boss for an agent (if any)
 */
export function getBossForAgent(agentId: string): Agent | null {
  const agent = agentService.getAgent(agentId);
  if (!agent?.bossId) return null;
  return agentService.getAgent(agent.bossId) || null;
}

// ============================================================================
// Context Gathering
// ============================================================================

/**
 * Gather context for all subordinates of a boss
 * Used for LLM delegation decision
 */
export async function gatherSubordinateContext(bossId: string): Promise<SubordinateContext[]> {
  const subordinates = getSubordinates(bossId);

  return Promise.all(subordinates.map(async (sub) => {
    // Get latest supervisor analysis for this agent
    const history = supervisorService.getAgentSupervisorHistory(sub.id);
    const latestEntry = history.entries[0];

    const contextPercent = sub.contextLimit > 0
      ? Math.round((sub.contextUsed / sub.contextLimit) * 100)
      : 0;

    return {
      id: sub.id,
      name: sub.name,
      class: sub.class,
      status: sub.status,
      currentTask: sub.currentTask,
      lastAssignedTask: sub.lastAssignedTask,
      recentSupervisorSummary: latestEntry?.analysis?.recentWorkSummary,
      contextPercent,
      tokensUsed: sub.tokensUsed,
    };
  }));
}

/**
 * Build the system prompt for a boss agent
 * Includes information about subordinates and their current status
 */
export async function buildBossSystemPrompt(bossId: string, bossName: string): Promise<string> {
  const subordinates = await gatherSubordinateContext(bossId);

  let prompt = `You are ${bossName}, a boss agent managing a team of developer agents.

Your role is to:
1. Answer questions about your team and their status
2. Delegate coding tasks to the most appropriate subordinate
3. Coordinate work across your team

YOUR SUBORDINATES:
`;

  if (subordinates.length === 0) {
    prompt += '\nYou currently have no subordinates assigned.\n';
  } else {
    for (const sub of subordinates) {
      prompt += `\n- ${sub.name} (${sub.class}): ${sub.status}`;
      if (sub.currentTask) {
        prompt += `\n  Current task: ${sub.currentTask}`;
      }
      if (sub.lastAssignedTask) {
        prompt += `\n  Last assigned: ${sub.lastAssignedTask}`;
      }
      if (sub.recentSupervisorSummary) {
        prompt += `\n  Recent work: ${sub.recentSupervisorSummary}`;
      }
      prompt += `\n  Context: ${sub.contextPercent}% used`;
    }
  }

  prompt += `

When asked about your team, provide clear information about each subordinate's status and work.
When given a coding task, analyze which subordinate is best suited and respond with your delegation decision.`;

  return prompt;
}

// ============================================================================
// Delegation Logic
// ============================================================================

/**
 * Delegate a command to the most appropriate subordinate
 * Uses LLM to analyze subordinate context and select the best agent
 */
export async function delegateCommand(
  bossId: string,
  command: string
): Promise<DelegationDecision> {
  const boss = getBossAgent(bossId);
  if (!boss) {
    throw new Error(`Agent ${bossId} is not a boss`);
  }

  const subordinates = getSubordinates(bossId);
  if (subordinates.length === 0) {
    throw new Error(`Boss ${boss.name} has no subordinates to delegate to`);
  }

  log.log?.(` Boss ${boss.name} delegating: "${truncateOrEmpty(command, 50)}"`);

  // Gather subordinate context
  const contexts = await gatherSubordinateContext(bossId);

  // Create pending decision
  const decisionId = generateId();
  const pendingDecision: DelegationDecision = {
    id: decisionId,
    timestamp: Date.now(),
    bossId,
    userCommand: command,
    selectedAgentId: '',
    selectedAgentName: '',
    reasoning: 'Analyzing...',
    alternativeAgents: [],
    confidence: 'medium',
    status: 'pending',
  };

  emit('delegation_decision', pendingDecision);

  try {
    // Call LLM for delegation decision
    const prompt = buildDelegationPrompt(command, contexts);
    const response = await callClaudeForDelegation(prompt);
    const parsed = parseDelegationResponse(response, contexts);

    // Build final decision
    const decision: DelegationDecision = {
      id: decisionId,
      timestamp: Date.now(),
      bossId,
      userCommand: command,
      selectedAgentId: parsed.selectedAgentId,
      selectedAgentName: parsed.selectedAgentName,
      reasoning: parsed.reasoning,
      alternativeAgents: parsed.alternativeAgents,
      confidence: parsed.confidence,
      status: 'sent',
    };

    // Store decision in history
    addDelegationDecision(delegationHistories, bossId, decision);
    saveDelegationHistory(delegationHistories);

    // Emit the decision
    emit('delegation_decision', decision);

    log.log?.(` Delegated to ${decision.selectedAgentName}: ${decision.reasoning}`);

    return decision;
  } catch (err) {
    log.error?.(' Delegation LLM failed, using fallback:', err);

    // Fallback: ALWAYS prioritize idle agents over busy ones
    const idleAgent = subordinates.find(s => s.status === 'idle') || subordinates[0];

    const fallbackDecision: DelegationDecision = {
      id: decisionId,
      timestamp: Date.now(),
      bossId,
      userCommand: command,
      selectedAgentId: idleAgent.id,
      selectedAgentName: idleAgent.name,
      reasoning: idleAgent.status === 'idle'
        ? 'Fallback selection: chose idle agent to balance workload'
        : 'Fallback selection: no idle agents available, chose first agent',
      alternativeAgents: subordinates.filter(s => s.id !== idleAgent.id).map(s => s.name),
      confidence: 'low',
      status: 'sent',
    };

    addDelegationDecision(delegationHistories, bossId, fallbackDecision);
    saveDelegationHistory(delegationHistories);
    emit('delegation_decision', fallbackDecision);

    return fallbackDecision;
  }
}

// ============================================================================
// LLM Integration
// ============================================================================

const DELEGATION_PROMPT = `You are a task router. Your ONLY job is to select which agent should handle the user's request.

IMPORTANT: You MUST respond with ONLY a JSON object. No explanations, no markdown, no other text.

## Available Agents
{{SUBORDINATES_DATA}}

## User Request
"{{USER_COMMAND}}"

## Selection Rules
1. **Strongly prefer idle agents** - Balance workload by favoring idle agents, but use your judgment: if a busy agent has critical context or expertise that makes them significantly better suited for the task, it may be worth assigning to them
2. Match agent class to task type (scout=explore, builder=code, debugger=fix, architect=plan, warrior=refactor, support=docs/tests)
3. **Prefer lower context usage** - Agents with lower contextPercent can work faster and more efficiently. When choosing between agents of similar capability, prefer the one with lower context usage. Avoid agents with >80% context usage entirely
4. Consider recent work context - an agent who just worked on related code may be more efficient
5. For general questions or status queries, pick any idle agent

## Required Output Format (JSON only, no other text):
{"selectedAgentId":"<agent id>","selectedAgentName":"<agent name>","reasoning":"<why this agent>","alternativeAgents":[],"confidence":"medium"}`;

function buildDelegationPrompt(command: string, contexts: SubordinateContext[]): string {
  // Sanitize all string fields to prevent invalid Unicode surrogates
  const subordinatesData = contexts.map(ctx => ({
    id: ctx.id,
    name: sanitizeUnicode(ctx.name),
    class: ctx.class,
    status: ctx.status,
    currentTask: sanitizeUnicode(ctx.currentTask || 'None'),
    lastAssignedTask: ctx.lastAssignedTask ? sanitizeUnicode(truncateOrEmpty(ctx.lastAssignedTask, 200)) : 'None',
    recentSupervisorSummary: sanitizeUnicode(ctx.recentSupervisorSummary || 'No recent analysis'),
    contextPercent: ctx.contextPercent,
    tokensUsed: ctx.tokensUsed,
  }));

  return DELEGATION_PROMPT
    .replace('{{SUBORDINATES_DATA}}', JSON.stringify(subordinatesData, null, 2))
    .replace('{{USER_COMMAND}}', sanitizeUnicode(command));
}

async function callClaudeForDelegation(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    log.log?.(' Spawning Claude Code for delegation analysis...');

    const executable = claudeBackend.getExecutablePath();
    // Use --print mode with stream-json output - --verbose is required when using stream-json with --print
    const args = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--dangerously-skip-permissions',
    ];

    log.log?.(' Command:', executable, args.join(' '));

    const childProcess = spawn(executable, args, {
      env: {
        ...process.env,
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
      },
      shell: true,
    });

    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let textOutput = '';

    childProcess.stdout?.on('data', (data: Buffer) => {
      buffer += decoder.write(data);
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        log.log?.(' [delegation stdout line]:', line.substring(0, 200));
        try {
          const event = JSON.parse(line);
          // Handle assistant event with full message content
          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) {
                log.log?.(' [delegation] Got assistant text:', block.text.substring(0, 100));
                textOutput += block.text;
              }
            }
          }
          // Handle streaming text delta events
          if (event.type === 'stream_event' && event.event?.type === 'content_block_delta') {
            if (event.event.delta?.type === 'text_delta' && event.event.delta.text) {
              textOutput += event.event.delta.text;
            }
          }
          // Also capture result text as fallback
          if (event.type === 'result' && event.result && typeof event.result === 'string') {
            log.log?.(' [delegation] Got result with text:', event.result.substring(0, 100));
            // Only use result if we didn't get text from assistant event
            if (!textOutput) {
              textOutput = event.result;
            }
          }
        } catch {
          // Not JSON - could be raw text output
          log.log?.(' [delegation] Non-JSON line:', line.substring(0, 100));
        }
      }
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      const text = decoder.write(data);
      log.log?.(' [delegation stderr]:', text.substring(0, 200));
    });

    childProcess.on('close', (code) => {
      log.log?.(' [delegation] Process closed with code:', code);
      log.log?.(' [delegation] textOutput so far:', textOutput.substring(0, 200));

      const remaining = buffer + decoder.end();
      if (remaining.trim()) {
        log.log?.(' [delegation] Processing remaining buffer:', remaining.substring(0, 200));
        try {
          const event = JSON.parse(remaining);
          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) {
                textOutput += block.text;
              }
            }
          }
        } catch {
          // Ignore
        }
      }

      log.log?.(' [delegation] Final textOutput length:', textOutput.length);

      if (code !== 0 && textOutput.length === 0) {
        reject(new Error(`Claude Code exited with code ${code}`));
      } else if (!textOutput) {
        reject(new Error('No response from Claude Code'));
      } else {
        resolve(textOutput);
      }
    });

    childProcess.on('error', (err) => {
      log.error?.(' [delegation] Process error:', err);
      reject(err);
    });

    childProcess.on('spawn', () => {
      log.log?.(' [delegation] Process spawned, sending prompt...');
      // Sanitize prompt to remove invalid Unicode surrogates that break JSON
      const sanitizedPrompt = sanitizeUnicode(prompt);
      const stdinMessage = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: sanitizedPrompt,
        },
      });
      log.log?.(' [delegation] stdin message:', stdinMessage.substring(0, 200));
      childProcess.stdin?.write(stdinMessage + '\n');
      childProcess.stdin?.end();
      log.log?.(' [delegation] stdin closed');
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      if (!childProcess.killed) {
        log.log?.(' [delegation] Timeout - killing process');
        childProcess.kill('SIGTERM');
        reject(new Error('Claude Code timed out'));
      }
    }, 60000);
  });
}

interface ParsedDelegation {
  selectedAgentId: string;
  selectedAgentName: string;
  reasoning: string;
  alternativeAgents: string[];
  confidence: 'high' | 'medium' | 'low';
}

function parseDelegationResponse(
  response: string,
  contexts: SubordinateContext[]
): ParsedDelegation {
  try {
    let jsonStr = response.trim();

    // Remove markdown fences if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    // Try to extract JSON object from response if it contains extra text
    const jsonMatch = jsonStr.match(/\{[\s\S]*"selectedAgentId"[\s\S]*"selectedAgentName"[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    log.log?.(' [delegation] Attempting to parse JSON:', jsonStr.substring(0, 200));

    const parsed = JSON.parse(jsonStr);

    // Validate the selected agent exists
    const selectedAgent = contexts.find(
      ctx => ctx.id === parsed.selectedAgentId || ctx.name === parsed.selectedAgentName
    );

    if (!selectedAgent) {
      throw new Error('Selected agent not found in subordinates');
    }

    return {
      selectedAgentId: selectedAgent.id,
      selectedAgentName: selectedAgent.name,
      reasoning: parsed.reasoning || 'No reasoning provided',
      alternativeAgents: parsed.alternativeAgents || [],
      confidence: parsed.confidence || 'medium',
    };
  } catch (err) {
    log.error?.(' Failed to parse delegation response:', err);
    throw err;
  }
}

// ============================================================================
// History Management
// ============================================================================

/**
 * Get delegation history for a boss
 */
export function getDelegationHistory(bossId: string): DelegationDecision[] {
  return getHistoryFromStorage(delegationHistories, bossId);
}

/**
 * Delete delegation history for a boss (when boss is deleted)
 */
export function deleteBossHistory(bossId: string): void {
  deleteDelegationHistory(delegationHistories, bossId);
  saveDelegationHistory(delegationHistories);
  log.log?.(` Deleted delegation history for boss ${bossId}`);
}

/**
 * Add a delegation decision to history (used when boss includes delegation in response)
 */
export function addDelegationToHistory(bossId: string, decision: DelegationDecision): void {
  addDelegationDecision(delegationHistories, bossId, decision);
  saveDelegationHistory(delegationHistories);
  log.log?.(` Added delegation decision for boss ${bossId}: ${decision.selectedAgentName}`);
}

// ============================================================================
// Utilities
// ============================================================================
