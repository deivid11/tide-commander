/**
 * Boss Response Handler
 * Parses delegation, spawn, work-plan, and analysis-request blocks from boss agent responses
 */

import type { AgentClass, DelegationDecision, ServerMessage } from '../../../shared/types.js';
import { BUILT_IN_AGENT_CLASSES } from '../../../shared/agent-types.js';
import { agentService, runtimeService, bossService, workPlanService } from '../../services/index.js';
import { getAllCustomClasses } from '../../services/custom-class-service.js';
import { logger } from '../../utils/index.js';
import { getLastBossCommand, buildCustomAgentConfig } from './command-handler.js';

const log = logger.ws;

// Track recently processed delegations to prevent duplicates
const processedDelegations = new Map<string, number>();
const DELEGATION_DEDUP_WINDOW_MS = 60000; // 1 minute window

// Track active delegations: subordinateId -> { bossId, taskDescription }
// Used to route subordinate outputs/completion to the boss terminal
export const activeDelegations = new Map<string, { bossId: string; taskDescription: string }>();

/**
 * Get the boss ID for an active delegation (if any)
 */
export function getBossForSubordinate(subordinateId: string): { bossId: string; taskDescription: string } | undefined {
  return activeDelegations.get(subordinateId);
}

/**
 * Clear delegation for a subordinate (call when task completes)
 */
export function clearDelegation(subordinateId: string): void {
  activeDelegations.delete(subordinateId);
}

/**
 * Test helper to clear delegation parser state.
 */
export function resetBossDelegationStateForTests(): void {
  processedDelegations.clear();
  activeDelegations.clear();
}

export type BroadcastFn = (message: ServerMessage) => void;
export type SendActivityFn = (agentId: string, message: string) => void;

type DelegationPayload = {
  selectedAgentId: string;
  selectedAgentName: string;
  taskCommand: string;
  reasoning: string;
  alternativeAgents: string[];
  confidence: 'high' | 'medium' | 'low';
};

function broadcastDelegationError(
  broadcast: BroadcastFn,
  bossId: string,
  bossName: string,
  message: string
): void {
  broadcast({
    type: 'output',
    payload: {
      agentId: bossId,
      text: `Delegation parse error (${bossName}): ${message}`,
      isStreaming: false,
      timestamp: Date.now(),
      isDelegation: true,
    },
  });
}

function extractDelegationBlocks(resultText: string): string[] {
  const blocks: string[] = [];
  const regex = /```delegation\s*\n([\s\S]*?)\n```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(resultText)) !== null) {
    blocks.push(match[1].trim());
  }
  return blocks;
}

function extractJsonSegments(text: string): string[] {
  const segments: string[] = [];
  let i = 0;

  while (i < text.length) {
    const startArray = text.indexOf('[', i);
    const startObject = text.indexOf('{', i);
    let start = -1;
    if (startArray === -1) {
      start = startObject;
    } else if (startObject === -1) {
      start = startArray;
    } else {
      start = Math.min(startArray, startObject);
    }
    if (start === -1) break;

    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let j = start; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '[' || ch === '{') {
        stack.push(ch);
        continue;
      }

      if (ch === ']' || ch === '}') {
        const open = stack[stack.length - 1];
        const validPair = (open === '[' && ch === ']') || (open === '{' && ch === '}');
        if (!validPair) {
          break;
        }
        stack.pop();
        if (stack.length === 0) {
          end = j + 1;
          break;
        }
      }
    }

    if (end === -1) break;
    segments.push(text.slice(start, end));
    i = end;
  }

  return segments;
}

function parseDelegationBlockToArray(block: string): unknown[] {
  const direct = block.trim();
  if (!direct) return [];
  try {
    const parsed = JSON.parse(direct);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    const parsedSegments: unknown[] = [];
    for (const segment of extractJsonSegments(block)) {
      try {
        const parsed = JSON.parse(segment);
        if (Array.isArray(parsed)) {
          parsedSegments.push(...parsed);
        } else {
          parsedSegments.push(parsed);
        }
      } catch {
        // Continue trying subsequent JSON-like segments.
      }
    }
    return parsedSegments;
  }
}

function validateDelegationPayload(
  raw: unknown,
  originalCommand: string
): { payload?: DelegationPayload; error?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'delegation item must be an object' };
  }

  const item = raw as Record<string, unknown>;
  const selectedAgentId = typeof item.selectedAgentId === 'string' ? item.selectedAgentId.trim() : '';
  const selectedAgentName = typeof item.selectedAgentName === 'string' ? item.selectedAgentName.trim() : '';
  const explicitTask = typeof item.taskCommand === 'string' ? item.taskCommand.trim() : '';
  const fallbackTask = originalCommand.trim();
  const taskCommand = explicitTask || fallbackTask;

  if (!selectedAgentId) return { error: 'selectedAgentId is required' };
  if (!selectedAgentName) return { error: 'selectedAgentName is required' };
  if (!taskCommand) return { error: 'taskCommand is required (or last boss command must be available)' };

  const reasoning = typeof item.reasoning === 'string' ? item.reasoning : '';

  let alternativeAgents: string[] = [];
  if (item.alternativeAgents !== undefined) {
    if (!Array.isArray(item.alternativeAgents) || item.alternativeAgents.some((a) => typeof a !== 'string')) {
      return { error: 'alternativeAgents must be an array of strings' };
    }
    alternativeAgents = item.alternativeAgents;
  }

  let confidence: 'high' | 'medium' | 'low' = 'medium';
  if (item.confidence !== undefined) {
    if (item.confidence !== 'high' && item.confidence !== 'medium' && item.confidence !== 'low') {
      return { error: 'confidence must be one of high|medium|low' };
    }
    confidence = item.confidence;
  }

  return {
    payload: {
      selectedAgentId,
      selectedAgentName,
      taskCommand,
      reasoning,
      alternativeAgents,
      confidence,
    },
  };
}

/**
 * Parse delegation block from boss response
 */
export function parseBossDelegation(
  agentId: string,
  bossName: string,
  resultText: string,
  broadcast: BroadcastFn
): void {
  log.log(`parseBossDelegation called for boss ${bossName}, resultText length=${resultText.length}`);
  const blocks = extractDelegationBlocks(resultText);
  if (blocks.length === 0) return;

  log.log(`Boss ${bossName} found ${blocks.length} delegation block(s)`);
  const originalCommand = getLastBossCommand(agentId) || '';
  const now = Date.now();

  for (const [key, timestamp] of processedDelegations) {
    if (now - timestamp > DELEGATION_DEDUP_WINDOW_MS) {
      processedDelegations.delete(key);
    }
  }

  let anyParsed = false;
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex];
    const parsedItems = parseDelegationBlockToArray(block);

    if (parsedItems.length === 0) {
      const message = `block #${blockIndex + 1} has no valid JSON object/array`;
      log.error(`Failed to parse delegation JSON from boss ${bossName}: ${message}`);
      broadcastDelegationError(broadcast, agentId, bossName, message);
      continue;
    }

    anyParsed = true;
    log.log(`Boss ${bossName} parsed ${parsedItems.length} delegation item(s) from block #${blockIndex + 1}`);

    for (let itemIndex = 0; itemIndex < parsedItems.length; itemIndex++) {
      const rawItem = parsedItems[itemIndex];
      const validated = validateDelegationPayload(rawItem, originalCommand);

      if (!validated.payload) {
        const message = `block #${blockIndex + 1}, item #${itemIndex + 1}: ${validated.error}`;
        log.error(`Invalid delegation payload from boss ${bossName}: ${message}`);
        broadcastDelegationError(broadcast, agentId, bossName, message);
        continue;
      }

      const delegationJson = validated.payload;
      const dedupKey = `${agentId}:${delegationJson.selectedAgentId}:${delegationJson.taskCommand}`;
      if (processedDelegations.has(dedupKey)) {
        log.log(`Skipping duplicate delegation to ${delegationJson.selectedAgentName}: "${delegationJson.taskCommand.slice(0, 50)}..."`);
        continue;
      }

      processedDelegations.set(dedupKey, now);
      log.log(`Delegation to ${delegationJson.selectedAgentName}: "${delegationJson.taskCommand.slice(0, 80)}..."`);

      const decision: DelegationDecision = {
        id: `del-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        timestamp: Date.now(),
        bossId: agentId,
        userCommand: delegationJson.taskCommand,
        selectedAgentId: delegationJson.selectedAgentId,
        selectedAgentName: delegationJson.selectedAgentName,
        reasoning: delegationJson.reasoning,
        alternativeAgents: delegationJson.alternativeAgents,
        confidence: delegationJson.confidence,
        status: 'sent',
      };

      bossService.addDelegationToHistory(agentId, decision);
      broadcast({ type: 'delegation_decision', payload: decision });

      broadcast({
        type: 'output',
        payload: {
          agentId: decision.selectedAgentId,
          text: `📋 **Task delegated from ${bossName}:**\n\n${decision.userCommand}`,
          isStreaming: false,
          timestamp: Date.now(),
          isDelegation: true,
        },
      });

      log.log(`Sending command to ${decision.selectedAgentName} (${decision.selectedAgentId}): "${decision.userCommand.slice(0, 50)}..."`);

      activeDelegations.set(decision.selectedAgentId, {
        bossId: agentId,
        taskDescription: decision.userCommand,
      });

      broadcast({
        type: 'agent_task_started',
        payload: {
          bossId: agentId,
          subordinateId: decision.selectedAgentId,
          subordinateName: decision.selectedAgentName,
          taskDescription: decision.userCommand,
        },
      } as any);

      const targetAgent = agentService.getAgent(decision.selectedAgentId);
      const customAgentConfig = targetAgent ? buildCustomAgentConfig(decision.selectedAgentId, targetAgent.class) : undefined;

      // Wrap the task command with boss delegation context so the subordinate knows:
      // - Who delegated the task (boss name + ID)
      // - That it should report back when done using the report-task endpoint
      const delegatedMessage = `[DELEGATED TASK from boss "${bossName}" (${agentId})]\n\n${decision.userCommand}\n\n---\nThis task was delegated by your boss agent. When you finish, report completion using:\ncurl -s -X POST http://localhost:5174/api/agents/YOUR_AGENT_ID/report-task -H "Content-Type: application/json" -d '{"summary":"Brief result summary","status":"completed"}'`;

      runtimeService.sendCommand(decision.selectedAgentId, delegatedMessage, undefined, undefined, customAgentConfig)
        .catch(err => {
          log.error(`Failed to auto-forward command to ${decision.selectedAgentName}:`, err);
        });
    }
  }

  if (!anyParsed) {
    const message = 'no valid delegation payloads were parsed';
    log.error(`Failed to parse delegation JSON from boss ${bossName}: ${message}`);
    broadcastDelegationError(broadcast, agentId, bossName, message);
  }
}

/**
 * Parse spawn block from boss response
 */
export async function parseBossSpawn(
  bossId: string,
  bossName: string,
  resultText: string,
  broadcast: BroadcastFn,
  sendActivity: SendActivityFn
): Promise<void> {
  log.log(` Boss ${bossName} checking for spawn block: ${resultText.includes('```spawn')}`);

  const spawnMatch = resultText.match(/```spawn\s*\n([\s\S]*?)\n```/);
  if (!spawnMatch) return;

  log.log(` Boss ${bossName} spawn match found!`);
  try {
    const parsed = JSON.parse(spawnMatch[1].trim());
    const spawns = Array.isArray(parsed) ? parsed : [parsed];

    log.log(` Parsed ${spawns.length} spawn request(s) from boss ${bossName}`);

    const boss = agentService.getAgent(bossId);
    const bossCwd = boss?.cwd || process.cwd();
    const builtInClassIds = Object.keys(BUILT_IN_AGENT_CLASSES).filter(c => c !== 'boss');
    const customClassIds = getAllCustomClasses().map(c => c.id);
    const validClasses = [...builtInClassIds, ...customClassIds];

    for (const spawnRequest of spawns) {
      const { name, class: agentClass, cwd } = spawnRequest;

      if (!name || !agentClass) {
        log.error(` Spawn request missing required fields (name, class):`, spawnRequest);
        continue;
      }

      if (!validClasses.includes(agentClass)) {
        log.error(` Invalid agent class "${agentClass}". Must be one of: ${validClasses.join(', ')}`);
        continue;
      }

      const agentCwd = cwd || bossCwd;
      log.log(` Boss ${bossName} spawning new ${agentClass} agent: "${name}" in ${agentCwd}`);

      try {
        const newAgent = await agentService.createAgent(name, agentClass as AgentClass, agentCwd);
        const currentSubordinates = bossService.getSubordinates(bossId).map(a => a.id);
        const newSubordinates = [...currentSubordinates, newAgent.id];
        bossService.assignSubordinates(bossId, newSubordinates);

        log.log(` Successfully spawned agent ${newAgent.name} (${newAgent.id}) for boss ${bossName}`);

        broadcast({
          type: 'boss_spawned_agent',
          payload: {
            agent: newAgent,
            bossId,
            bossPosition: boss?.position || { x: 0, y: 0, z: 0 },
          },
        });

        sendActivity(newAgent.id, `${newAgent.name} deployed by ${bossName}`);
        broadcast({
          type: 'boss_subordinates_updated',
          payload: { bossId, subordinateIds: newSubordinates },
        });
      } catch (err) {
        log.error(` Failed to spawn agent "${name}" for boss ${bossName}:`, err);
      }
    }
  } catch (err) {
    log.error(` Failed to parse spawn JSON from boss ${bossName}:`, err);
  }
}

/**
 * Parse work-plan block from boss response
 */
export function parseBossWorkPlan(
  bossId: string,
  bossName: string,
  resultText: string,
  broadcast: BroadcastFn
): void {
  log.log(` Boss ${bossName} checking for work-plan block: ${resultText.includes('```work-plan')}`);

  const workPlanDraft = workPlanService.parseWorkPlanBlock(resultText);
  if (!workPlanDraft) return;

  log.log(` Boss ${bossName} work-plan match found! Creating plan: "${workPlanDraft.name}"`);

  try {
    const workPlan = workPlanService.createWorkPlan(bossId, workPlanDraft);

    // Broadcast the created work plan
    broadcast({
      type: 'work_plan_created',
      payload: workPlan,
    });

    log.log(` Created work plan "${workPlan.name}" with ${workPlan.totalTasks} tasks (${workPlan.parallelizableTasks.length} parallelizable)`);
  } catch (err) {
    log.error(` Failed to create work plan from boss ${bossName}:`, err);
  }
}

/**
 * Parse analysis-request block from boss response
 */
export function parseBossAnalysisRequest(
  bossId: string,
  bossName: string,
  resultText: string,
  broadcast: BroadcastFn,
  sendActivity: SendActivityFn
): void {
  log.log(` Boss ${bossName} checking for analysis-request block: ${resultText.includes('```analysis-request')}`);

  const analysisDrafts = workPlanService.parseAnalysisRequestBlock(resultText);
  if (analysisDrafts.length === 0) return;

  log.log(` Boss ${bossName} analysis-request match found! ${analysisDrafts.length} request(s)`);

  for (const draft of analysisDrafts) {
    try {
      // Create the analysis request
      const request = workPlanService.createAnalysisRequest(bossId, draft);

      // Broadcast the created request
      broadcast({
        type: 'analysis_request_created',
        payload: request,
      });

      // Start the analysis by sending the query to the target agent
      workPlanService.startAnalysisRequest(request.id);

      // Get agent name for activity message
      const targetAgent = agentService.getAgent(draft.targetAgent);
      const agentName = targetAgent?.name || draft.targetAgent;

      // Send activity notification
      sendActivity(draft.targetAgent, `Analysis requested by ${bossName}`);

      // Send the analysis query as a command to the scout
      const focusContext = draft.focus && draft.focus.length > 0
        ? `\n\nFocus areas: ${draft.focus.join(', ')}`
        : '';

      const analysisCommand = `[ANALYSIS REQUEST from ${bossName}]\n\n${draft.query}${focusContext}\n\nPlease provide a detailed analysis and report back your findings.`;

      // Build custom config for the target agent
      const customAgentConfig = targetAgent ? buildCustomAgentConfig(draft.targetAgent, targetAgent.class) : undefined;

      runtimeService.sendCommand(draft.targetAgent, analysisCommand, undefined, undefined, customAgentConfig)
        .catch(err => {
          log.error(` Failed to send analysis request to ${agentName}:`, err);
        });

      log.log(` Started analysis request to ${agentName}: "${draft.query.slice(0, 60)}..."`);
    } catch (err) {
      log.error(` Failed to create analysis request from boss ${bossName}:`, err);
    }
  }
}

/**
 * Parse all boss response blocks (delegation, spawn, work-plan, analysis-request)
 * Call this from the output handler when a boss agent completes a response
 */
export async function parseAllBossBlocks(
  bossId: string,
  bossName: string,
  resultText: string,
  broadcast: BroadcastFn,
  sendActivity: SendActivityFn
): Promise<void> {
  // Parse in order: analysis-request, work-plan, delegation, spawn
  // This order allows the boss to first request analysis, then create plans, then delegate
  parseBossAnalysisRequest(bossId, bossName, resultText, broadcast, sendActivity);
  parseBossWorkPlan(bossId, bossName, resultText, broadcast);
  parseBossDelegation(bossId, bossName, resultText, broadcast);
  await parseBossSpawn(bossId, bossName, resultText, broadcast, sendActivity);
}
