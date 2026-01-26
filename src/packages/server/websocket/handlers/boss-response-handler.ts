/**
 * Boss Response Handler
 * Parses delegation, spawn, work-plan, and analysis-request blocks from boss agent responses
 */

import type { AgentClass, DelegationDecision, ServerMessage } from '../../../shared/types.js';
import { agentService, claudeService, bossService, workPlanService } from '../../services/index.js';
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

export type BroadcastFn = (message: ServerMessage) => void;
export type SendActivityFn = (agentId: string, message: string) => void;

/**
 * Parse delegation block from boss response
 */
export function parseBossDelegation(
  agentId: string,
  bossName: string,
  resultText: string,
  broadcast: BroadcastFn
): void {
  log.log(`🔴🔴🔴 parseBossDelegation CALLED for boss ${bossName}, resultText length: ${resultText.length}`);
  log.log(` Boss ${bossName} checking for delegation block: ${resultText.includes('```delegation')}`);

  const delegationMatch = resultText.match(/```delegation\s*\n([\s\S]*?)\n```/);
  if (!delegationMatch) return;

  log.log(` Boss ${bossName} delegation match found!`);
  try {
    const parsed = JSON.parse(delegationMatch[1].trim());
    const delegations = Array.isArray(parsed) ? parsed : [parsed];

    log.log(` Parsed ${delegations.length} delegation(s) from boss ${bossName}`);

    const originalCommand = getLastBossCommand(agentId) || '';
    const now = Date.now();

    // Clean up old entries
    for (const [key, timestamp] of processedDelegations) {
      if (now - timestamp > DELEGATION_DEDUP_WINDOW_MS) {
        processedDelegations.delete(key);
      }
    }

    for (const delegationJson of delegations) {
      const taskCommand = delegationJson.taskCommand || originalCommand;
      const targetAgentId = delegationJson.selectedAgentId;
      const dedupKey = `${agentId}:${targetAgentId}:${taskCommand}`;

      if (processedDelegations.has(dedupKey)) {
        log.log(` SKIPPING duplicate delegation to ${delegationJson.selectedAgentName}: "${taskCommand.slice(0, 50)}..." (already processed)`);
        continue;
      }

      processedDelegations.set(dedupKey, now);
      log.log(` Delegation to ${delegationJson.selectedAgentName}: "${taskCommand.slice(0, 80)}..."`);

      const decision: DelegationDecision = {
        id: `del-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        bossId: agentId,
        userCommand: taskCommand,
        selectedAgentId: delegationJson.selectedAgentId,
        selectedAgentName: delegationJson.selectedAgentName,
        reasoning: delegationJson.reasoning || '',
        alternativeAgents: delegationJson.alternativeAgents || [],
        confidence: delegationJson.confidence || 'medium',
        status: 'sent',
      };

      bossService.addDelegationToHistory(agentId, decision);
      broadcast({ type: 'delegation_decision', payload: decision });

      if (decision.selectedAgentId) {
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
      }

      if (decision.selectedAgentId && decision.userCommand) {
        log.log(`🟢🟢🟢 SENDING COMMAND to ${decision.selectedAgentName} (${decision.selectedAgentId}): "${decision.userCommand.slice(0, 50)}..."`);

        // Track this as an active delegation for progress reporting
        activeDelegations.set(decision.selectedAgentId, {
          bossId: agentId,
          taskDescription: decision.userCommand,
        });
        log.log(`[DELEGATION] Tracked active delegation: subordinate=${decision.selectedAgentId} -> boss=${agentId}, total active=${activeDelegations.size}`);

        // Broadcast agent_task_started to boss terminal
        broadcast({
          type: 'agent_task_started',
          payload: {
            bossId: agentId,
            subordinateId: decision.selectedAgentId,
            subordinateName: decision.selectedAgentName,
            taskDescription: decision.userCommand,
          },
        } as any);

        // Build customAgentConfig for the target agent to ensure it gets its class instructions
        const targetAgent = agentService.getAgent(decision.selectedAgentId);
        const customAgentConfig = targetAgent ? buildCustomAgentConfig(decision.selectedAgentId, targetAgent.class) : undefined;
        claudeService.sendCommand(decision.selectedAgentId, decision.userCommand, undefined, undefined, customAgentConfig)
          .catch(err => {
            log.error(` Failed to auto-forward command to ${decision.selectedAgentName}:`, err);
          });
      }
    }
  } catch (err) {
    log.error(` Failed to parse delegation JSON from boss ${bossName}:`, err);
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
    const validClasses = ['scout', 'builder', 'debugger', 'architect', 'warrior', 'support'];

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

      claudeService.sendCommand(draft.targetAgent, analysisCommand, undefined, undefined, customAgentConfig)
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
