/**
 * WebSocket Handler
 * Real-time communication with clients
 */

import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as fs from 'fs';
import type { Agent, AgentClass, ClientMessage, ServerMessage, DrawingArea, Building, PermissionRequest, DelegationDecision, Skill, CustomAgentClass, BuiltInAgentClass } from '../../shared/types.js';
import { BOSS_CONTEXT_START, BOSS_CONTEXT_END, BUILT_IN_AGENT_CLASSES } from '../../shared/types.js';
import { agentService, claudeService, supervisorService, permissionService, bossService, skillService, customClassService } from '../services/index.js';
import { loadAreas, saveAreas, loadBuildings, saveBuildings } from '../data/index.js';
import { loadSession, loadToolHistory } from '../claude/session-loader.js';
import { parseContextOutput } from '../claude/backend.js';
import { logger, createLogger } from '../utils/logger.js';

const log = logger.ws;
const supervisorLog = createLogger('Supervisor');

// Connected clients
const clients = new Set<WebSocket>();

// Track last command sent to each boss agent (for delegation parsing)
const lastBossCommands = new Map<string, string>();

// Track recently processed delegations to prevent duplicates
// Key: bossId:agentId:command, Value: timestamp
const processedDelegations = new Map<string, number>();
const DELEGATION_DEDUP_WINDOW_MS = 60000; // 1 minute window

// ============================================================================
// Broadcasting
// ============================================================================

export function broadcast(message: ServerMessage): void {
  const data = JSON.stringify(message);
  log.log(`📡 [BROADCAST] Sending ${message.type} to ${clients.size} clients`);

  let sentCount = 0;
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(data);
        sentCount++;
      } catch (err) {
        log.error(`  Failed to send to client:`, err);
      }
    } else {
      log.log(`  Skipping client with readyState: ${client.readyState}`);
    }
  }

  log.log(`  Successfully sent to ${sentCount}/${clients.size} clients`);
}

function sendActivity(agentId: string, message: string): void {
  const agent = agentService.getAgent(agentId);
  broadcast({
    type: 'activity',
    payload: {
      agentId,
      agentName: agent?.name || 'Unknown',
      message,
      timestamp: Date.now(),
    },
  });
}

/**
 * Unlink an agent from boss hierarchy before deletion.
 * If agent is a subordinate, remove from their boss.
 * If agent is a boss, unlink all their subordinates.
 */
function unlinkAgentFromBossHierarchy(agentId: string): void {
  const agent = agentService.getAgent(agentId);
  if (!agent) return;

  // If this agent has a boss, remove from boss's subordinate list
  if (agent.bossId) {
    try {
      bossService.removeSubordinate(agent.bossId, agentId);
    } catch (err) {
      log.error(` Failed to unlink from boss: ${err}`);
    }
  }

  // If this agent is a boss, unlink all subordinates
  if (agent.class === 'boss' && agent.subordinateIds?.length) {
    for (const subId of agent.subordinateIds) {
      try {
        // Clear the bossId from subordinate
        agentService.updateAgent(subId, { bossId: undefined });
      } catch (err) {
        log.error(` Failed to unlink subordinate ${subId}: ${err}`);
      }
    }
  }
}

// ============================================================================
// Message Handling
// ============================================================================

function handleClientMessage(ws: WebSocket, message: ClientMessage): void {
  log.log(` Received: ${message.type}`);

  switch (message.type) {
    case 'spawn_agent':
      log.log('🚀 [SPAWN_AGENT] Request received:', {
        name: message.payload.name,
        class: message.payload.class,
        cwd: message.payload.cwd,
        sessionId: message.payload.sessionId,
        useChrome: message.payload.useChrome,
        permissionMode: message.payload.permissionMode,
        position: message.payload.position,
        initialSkillIds: message.payload.initialSkillIds,
      });

      agentService
        .createAgent(
          message.payload.name,
          message.payload.class,
          message.payload.cwd,
          message.payload.position,
          message.payload.sessionId,
          message.payload.useChrome,
          message.payload.permissionMode
        )
        .then((agent) => {
          log.log('✅ [SPAWN_AGENT] Agent created successfully:', {
            id: agent.id,
            name: agent.name,
            class: agent.class,
            sessionId: agent.sessionId,
          });

          // Assign initial skills if provided
          const initialSkillIds = message.payload.initialSkillIds || [];

          // Also get default skills from custom class if applicable
          const classDefaultSkills = customClassService.getClassDefaultSkillIds(agent.class);
          const allSkillIds = [...new Set([...initialSkillIds, ...classDefaultSkills])];

          if (allSkillIds.length > 0) {
            log.log(`📦 [SPAWN_AGENT] Assigning ${allSkillIds.length} skills to ${agent.name}`);
            for (const skillId of allSkillIds) {
              skillService.assignSkillToAgent(skillId, agent.id);
            }
          }

          const createMessage = {
            type: 'agent_created' as const,
            payload: agent,
          };
          log.log('📤 [SPAWN_AGENT] Broadcasting agent_created message');
          broadcast(createMessage);

          log.log('📤 [SPAWN_AGENT] Sending activity message');
          sendActivity(agent.id, `${agent.name} deployed`);
        })
        .catch((err) => {
          log.error('❌ [SPAWN_AGENT] Failed to spawn agent:', err);
          log.error('   Error details:', {
            message: err.message,
            stack: err.stack,
            name: err.name,
          });

          // Check if this is a directory not found error
          if (err.message?.includes('Directory does not exist')) {
            const dirNotFoundMsg = {
              type: 'directory_not_found',
              payload: {
                path: message.payload.cwd,
                name: message.payload.name,
                class: message.payload.class,
              },
            };
            log.log('📤 [SPAWN_AGENT] Sending directory_not_found message');
            ws.send(JSON.stringify(dirNotFoundMsg));
          } else {
            const errorMsg = {
              type: 'error',
              payload: { message: err.message },
            };
            log.log('📤 [SPAWN_AGENT] Sending error message:', errorMsg);
            ws.send(JSON.stringify(errorMsg));
          }
        });
      break;

    case 'send_command':
      {
        const { agentId, command } = message.payload;
        const agent = agentService.getAgent(agentId);

        // If this is a boss agent, handle differently based on command type
        if (agent?.class === 'boss') {
          log.log(` Boss ${agent.name} received command: "${command.slice(0, 50)}..."`);

          // Track the last command sent to this boss (for delegation parsing)
          lastBossCommands.set(agentId, command);

          // Detect if this is a team/status question vs a coding task
          // Team questions: status, what are they doing, subordinates, team, report, etc.
          const isTeamQuestion = /\b(subordinat|team|equipo|status|estado|hacen|doing|trabajando|working|progress|reporte|report|agentes|agents|chavos|who are you|hello|hola|hi\b)\b/i.test(command);

          // Boss agents get context injected in the user message with delimiters
          // Instructions go via system prompt, context is in the message for visibility
          buildBossMessage(agentId, command)
            .then(({ message: bossMessage, systemPrompt }) => {
              claudeService.sendCommand(agentId, bossMessage, systemPrompt);
            })
            .catch((err) => {
              log.error(` Boss ${agent.name}: failed to build boss message:`, err);
              claudeService.sendCommand(agentId, command);
            });

          if (isTeamQuestion) {
            log.log(` Boss ${agent.name}: detected team question`);
          } else {
            log.log(` Boss ${agent.name}: detected coding task, delegation will be in response`);
          }
        } else if (agent) {
          // Regular agent - build custom agent config combining:
          // 1. Custom class instructions (if any)
          // 2. Skills assigned to this agent (via class or directly)

          const classInstructions = customClassService.getClassInstructions(agent.class);
          const skillsContent = skillService.buildSkillPromptContent(agentId, agent.class);

          // Combine instructions and skills into a single prompt
          let combinedPrompt = '';
          if (classInstructions) {
            combinedPrompt += classInstructions;
          }
          if (skillsContent) {
            if (combinedPrompt) combinedPrompt += '\n\n';
            combinedPrompt += skillsContent;
          }

          // Build custom agent config if we have any instructions or skills
          let customAgentConfig: { name: string; definition: { description: string; prompt: string } } | undefined;
          if (combinedPrompt) {
            const customClass = customClassService.getCustomClass(agent.class);
            customAgentConfig = {
              name: customClass?.id || agent.class,
              definition: {
                description: customClass?.description || `Agent class: ${agent.class}`,
                prompt: combinedPrompt,
              },
            };
            log.log(` Agent ${agent.name} using custom agent config (${combinedPrompt.length} chars: ${classInstructions ? 'instructions' : ''}${classInstructions && skillsContent ? ' + ' : ''}${skillsContent ? 'skills' : ''})`);
          }

          claudeService
            .sendCommand(agentId, command, undefined, undefined, customAgentConfig)
            .catch((err) => {
              log.error(' Failed to send command:', err);
              sendActivity(agentId, `Error: ${err.message}`);
            });
        } else {
          log.error(` Agent not found: ${agentId}`);
        }
      }
      break;

    case 'move_agent':
      // Don't update lastActivity for position changes (false = don't update activity timer)
      agentService.updateAgent(message.payload.agentId, {
        position: message.payload.position,
      }, false);
      break;

    case 'kill_agent':
      {
        const agent = agentService.getAgent(message.payload.agentId);
        log.log(`🗑️ [KILL_AGENT] Agent ${agent?.name || message.payload.agentId}: User requested agent deletion`);
        claudeService.stopAgent(message.payload.agentId).then(() => {
          // Unlink from boss/subordinates before deleting
          unlinkAgentFromBossHierarchy(message.payload.agentId);
          agentService.deleteAgent(message.payload.agentId);
          log.log(`🗑️ [KILL_AGENT] Agent ${agent?.name || message.payload.agentId}: Agent deleted successfully`);
        });
      }
      break;

    case 'stop_agent':
      // Stop current operation but keep agent alive
      {
        const agent = agentService.getAgent(message.payload.agentId);
        log.log(`🛑 [STOP_AGENT] Agent ${agent?.name || message.payload.agentId}: User requested operation cancellation`);
        claudeService.stopAgent(message.payload.agentId).then(() => {
          agentService.updateAgent(message.payload.agentId, {
            status: 'idle',
            currentTask: undefined,
            currentTool: undefined,
          });
          sendActivity(message.payload.agentId, 'Operation cancelled');
          log.log(`🛑 [STOP_AGENT] Agent ${agent?.name || message.payload.agentId}: Operation cancelled, agent now idle`);
        });
      }
      break;

    case 'clear_context':
      // Clear agent's context - force new session on next command
      {
        const agent = agentService.getAgent(message.payload.agentId);
        log.log(`🧹 [CLEAR_CONTEXT] Agent ${agent?.name || message.payload.agentId}: User requested context clear`);
        claudeService.stopAgent(message.payload.agentId).then(() => {
          agentService.updateAgent(message.payload.agentId, {
            status: 'idle',
            currentTask: undefined,
            currentTool: undefined,
            sessionId: undefined, // Clear session to force new one
            tokensUsed: 0,
            contextUsed: 0,
          });
          sendActivity(message.payload.agentId, 'Context cleared - new session on next command');
          log.log(`🧹 [CLEAR_CONTEXT] Agent ${agent?.name || message.payload.agentId}: Context cleared, session reset`);
        });
      }
      break;

    case 'collapse_context':
      // Collapse context - send /compact command to Claude
      {
        const agent = agentService.getAgent(message.payload.agentId);
        if (agent && agent.status === 'idle') {
          // Send the /compact command which tells Claude to summarize context
          claudeService.sendCommand(message.payload.agentId, '/compact').then(() => {
            sendActivity(message.payload.agentId, 'Context collapse initiated');
          }).catch(err => {
            log.error(` Failed to collapse context: ${err}`);
            sendActivity(message.payload.agentId, 'Failed to collapse context');
          });
        } else {
          sendActivity(message.payload.agentId, 'Cannot collapse context while agent is busy');
        }
      }
      break;

    case 'request_context_stats':
      // Request detailed context stats - send /context command to Claude
      {
        const agentId = message.payload.agentId;
        const agent = agentService.getAgent(agentId);
        if (agent && agent.status === 'idle') {
          // Send the /context command which returns detailed breakdown
          claudeService.sendCommand(agentId, '/context').catch(err => {
            log.error(` Failed to request context stats: ${err}`);
          });
        } else {
          log.log(` Cannot request context stats while agent ${agentId} is busy`);
        }
      }
      break;

    case 'remove_agent':
      // Unlink from boss/subordinates before deleting
      unlinkAgentFromBossHierarchy(message.payload.agentId);
      // Remove from persistence only (keeps Claude session running)
      agentService.deleteAgent(message.payload.agentId);
      break;

    case 'rename_agent':
      // Don't update lastActivity for name changes
      agentService.updateAgent(message.payload.agentId, {
        name: message.payload.name,
      }, false);
      break;

    case 'update_agent_properties': {
      const { agentId, updates } = message.payload;
      const agent = agentService.getAgent(agentId);

      if (!agent) {
        ws.send(JSON.stringify({
          type: 'error',
          payload: { message: `Agent not found: ${agentId}` },
        }));
        break;
      }

      // Update agent properties
      const agentUpdates: Partial<Agent> = {};

      if (updates.class !== undefined) {
        agentUpdates.class = updates.class;
      }

      if (updates.permissionMode !== undefined) {
        agentUpdates.permissionMode = updates.permissionMode;
      }

      // Apply agent property updates if any
      if (Object.keys(agentUpdates).length > 0) {
        agentService.updateAgent(agentId, agentUpdates, false);
      }

      // Handle skill reassignment
      if (updates.skillIds !== undefined) {
        // First, unassign all current skills from this agent
        const currentSkills = skillService.getSkillsForAgent(agentId, agent.class);
        for (const skill of currentSkills) {
          // Only unassign if it's a direct assignment (not class-based)
          if (skill.assignedAgentIds.includes(agentId)) {
            skillService.unassignSkillFromAgent(skill.id, agentId);
          }
        }

        // Then assign the new skills
        for (const skillId of updates.skillIds) {
          skillService.assignSkillToAgent(skillId, agentId);
        }
      }

      log.log(`Updated agent properties for ${agent.name}: ${JSON.stringify(updates)}`);
      break;
    }

    case 'create_directory':
      try {
        // Create directory recursively
        fs.mkdirSync(message.payload.path, { recursive: true });
        log.log(` Created directory: ${message.payload.path}`);

        // Now spawn the agent
        agentService
          .createAgent(
            message.payload.name,
            message.payload.class,
            message.payload.path
          )
          .then((agent) => {
            broadcast({
              type: 'agent_created',
              payload: agent,
            });
            sendActivity(agent.id, `${agent.name} deployed`);
          })
          .catch((err) => {
            log.error(' Failed to spawn agent after creating directory:', err);
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: { message: err.message },
              })
            );
          });
      } catch (err: any) {
        log.error(' Failed to create directory:', err);
        ws.send(
          JSON.stringify({
            type: 'error',
            payload: { message: `Failed to create directory: ${err.message}` },
          })
        );
      }
      break;

    case 'set_supervisor_config':
      supervisorService.setConfig(message.payload);
      break;

    case 'request_supervisor_report':
      supervisorLog.log('Report requested by frontend');
      supervisorService
        .generateReport()
        .then((report) => {
          ws.send(
            JSON.stringify({
              type: 'supervisor_report',
              payload: report,
            })
          );
        })
        .catch((err) => {
          log.error(' Supervisor report failed:', err);
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { message: `Supervisor report failed: ${err.message}` },
            })
          );
        });
      break;

    case 'request_agent_supervisor_history':
      {
        const history = supervisorService.getAgentSupervisorHistory(message.payload.agentId);
        ws.send(
          JSON.stringify({
            type: 'agent_supervisor_history',
            payload: history,
          })
        );
      }
      break;

    case 'sync_areas':
      // Save areas to persistent storage and broadcast to all clients
      saveAreas(message.payload);
      log.log(` Saved ${message.payload.length} areas`);
      // Broadcast to all other clients
      for (const client of clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'areas_update',
            payload: message.payload,
          }));
        }
      }
      break;

    case 'sync_buildings':
      // Save buildings to persistent storage and broadcast to all clients
      saveBuildings(message.payload);
      log.log(` Saved ${message.payload.length} buildings`);
      // Broadcast to all other clients
      for (const client of clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'buildings_update',
            payload: message.payload,
          }));
        }
      }
      break;

    case 'building_command':
      handleBuildingCommand(ws, message.payload.buildingId, message.payload.command);
      break;

    case 'permission_response':
      {
        const { requestId, approved, reason, remember } = message.payload;
        log.log(` Permission response: ${requestId} -> ${approved ? 'approved' : 'denied'}${remember ? ' (remember)' : ''}`);
        const handled = permissionService.respondToPermissionRequest({
          requestId,
          approved,
          reason,
          remember,
        });
        if (handled) {
          // Broadcast that the permission was resolved
          broadcast({
            type: 'permission_resolved',
            payload: { requestId, approved },
          });
        } else {
          log.log(` No pending request found for ${requestId}`);
        }
      }
      break;

    // ========================================================================
    // Boss Agent Messages
    // ========================================================================

    case 'spawn_boss_agent':
      agentService
        .createAgent(
          message.payload.name,
          'boss', // Always boss class
          message.payload.cwd,
          message.payload.position,
          undefined, // sessionId - bosses start fresh
          message.payload.useChrome,
          message.payload.permissionMode
        )
        .then((agent) => {
          // Assign initial subordinates if provided
          if (message.payload.subordinateIds && message.payload.subordinateIds.length > 0) {
            bossService.assignSubordinates(agent.id, message.payload.subordinateIds);
          }
          broadcast({
            type: 'agent_created',
            payload: agentService.getAgent(agent.id) || agent, // Get updated version with subordinates
          });
          sendActivity(agent.id, `Boss ${agent.name} deployed`);
        })
        .catch((err) => {
          log.error(' Failed to spawn boss agent:', err);
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { message: err.message },
            })
          );
        });
      break;

    case 'assign_subordinates':
      try {
        bossService.assignSubordinates(
          message.payload.bossId,
          message.payload.subordinateIds
        );
        const boss = agentService.getAgent(message.payload.bossId);
        if (boss) {
          broadcast({
            type: 'boss_subordinates_updated',
            payload: {
              bossId: message.payload.bossId,
              subordinateIds: boss.subordinateIds || [],
            },
          });
          sendActivity(message.payload.bossId, `Team updated: ${message.payload.subordinateIds.length} subordinates`);
        }
      } catch (err: any) {
        log.error(' Failed to assign subordinates:', err);
        ws.send(
          JSON.stringify({
            type: 'error',
            payload: { message: err.message },
          })
        );
      }
      break;

    case 'remove_subordinate':
      try {
        bossService.removeSubordinate(
          message.payload.bossId,
          message.payload.subordinateId
        );
        const boss = agentService.getAgent(message.payload.bossId);
        if (boss) {
          broadcast({
            type: 'boss_subordinates_updated',
            payload: {
              bossId: message.payload.bossId,
              subordinateIds: boss.subordinateIds || [],
            },
          });
        }
      } catch (err: any) {
        log.error(' Failed to remove subordinate:', err);
        ws.send(
          JSON.stringify({
            type: 'error',
            payload: { message: err.message },
          })
        );
      }
      break;

    case 'send_boss_command':
      {
        const { bossId, command } = message.payload;
        log.log(` Boss command: ${bossId} -> "${command.slice(0, 50)}..."`);

        bossService
          .delegateCommand(bossId, command)
          .then((decision) => {
            // Send the command to the selected subordinate
            claudeService
              .sendCommand(decision.selectedAgentId, command)
              .then(() => {
                sendActivity(bossId, `Delegated to ${decision.selectedAgentName}`);
              })
              .catch((err) => {
                log.error(' Failed to send delegated command:', err);
                sendActivity(bossId, `Delegation failed: ${err.message}`);
              });
          })
          .catch((err) => {
            log.error(' Delegation failed:', err);
            sendActivity(bossId, `Delegation error: ${err.message}`);
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: { message: `Delegation failed: ${err.message}` },
              })
            );
          });
      }
      break;

    case 'request_delegation_history':
      {
        const history = bossService.getDelegationHistory(message.payload.bossId);
        ws.send(
          JSON.stringify({
            type: 'delegation_history',
            payload: {
              bossId: message.payload.bossId,
              decisions: history,
            },
          })
        );
      }
      break;

    // ========================================================================
    // Skill Messages
    // ========================================================================

    case 'create_skill':
      try {
        const skill = skillService.createSkill(message.payload);
        broadcast({
          type: 'skill_created',
          payload: skill,
        });
        log.log(` Created skill: ${skill.name} (${skill.id})`);
      } catch (err: any) {
        log.error(' Failed to create skill:', err);
        ws.send(
          JSON.stringify({
            type: 'error',
            payload: { message: err.message },
          })
        );
      }
      break;

    case 'update_skill':
      try {
        const skill = skillService.updateSkill(message.payload.id, message.payload.updates);
        if (skill) {
          broadcast({
            type: 'skill_updated',
            payload: skill,
          });
          log.log(` Updated skill: ${skill.name} (${skill.id})`);
        } else {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { message: `Skill not found: ${message.payload.id}` },
            })
          );
        }
      } catch (err: any) {
        log.error(' Failed to update skill:', err);
        ws.send(
          JSON.stringify({
            type: 'error',
            payload: { message: err.message },
          })
        );
      }
      break;

    case 'delete_skill':
      try {
        const deleted = skillService.deleteSkill(message.payload.id);
        if (deleted) {
          broadcast({
            type: 'skill_deleted',
            payload: { id: message.payload.id },
          });
          log.log(` Deleted skill: ${message.payload.id}`);
        } else {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { message: `Skill not found: ${message.payload.id}` },
            })
          );
        }
      } catch (err: any) {
        log.error(' Failed to delete skill:', err);
        ws.send(
          JSON.stringify({
            type: 'error',
            payload: { message: err.message },
          })
        );
      }
      break;

    case 'assign_skill':
      try {
        const skill = skillService.assignSkillToAgent(
          message.payload.skillId,
          message.payload.agentId
        );
        if (skill) {
          broadcast({
            type: 'skill_updated',
            payload: skill,
          });
          log.log(` Assigned skill ${skill.name} to agent ${message.payload.agentId}`);
        } else {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { message: `Skill not found: ${message.payload.skillId}` },
            })
          );
        }
      } catch (err: any) {
        log.error(' Failed to assign skill:', err);
        ws.send(
          JSON.stringify({
            type: 'error',
            payload: { message: err.message },
          })
        );
      }
      break;

    case 'unassign_skill':
      try {
        const skill = skillService.unassignSkillFromAgent(
          message.payload.skillId,
          message.payload.agentId
        );
        if (skill) {
          broadcast({
            type: 'skill_updated',
            payload: skill,
          });
          log.log(` Unassigned skill ${skill.name} from agent ${message.payload.agentId}`);
        } else {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { message: `Skill not found: ${message.payload.skillId}` },
            })
          );
        }
      } catch (err: any) {
        log.error(' Failed to unassign skill:', err);
        ws.send(
          JSON.stringify({
            type: 'error',
            payload: { message: err.message },
          })
        );
      }
      break;

    case 'request_agent_skills':
      {
        const agent = agentService.getAgent(message.payload.agentId);
        if (agent) {
          const skills = skillService.getSkillsForAgent(agent.id, agent.class);
          ws.send(
            JSON.stringify({
              type: 'agent_skills',
              payload: {
                agentId: message.payload.agentId,
                skills,
              },
            })
          );
        } else {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { message: `Agent not found: ${message.payload.agentId}` },
            })
          );
        }
      }
      break;

    // ========================================================================
    // Custom Agent Class Messages
    // ========================================================================

    case 'create_custom_agent_class':
      try {
        const customClass = customClassService.createCustomClass(message.payload);
        broadcast({
          type: 'custom_agent_class_created',
          payload: customClass,
        });
        log.log(` Created custom agent class: ${customClass.name} (${customClass.id})`);
      } catch (err: any) {
        log.error(' Failed to create custom agent class:', err);
        ws.send(
          JSON.stringify({
            type: 'error',
            payload: { message: err.message },
          })
        );
      }
      break;

    case 'update_custom_agent_class':
      try {
        const customClass = customClassService.updateCustomClass(message.payload.id, message.payload.updates);
        if (customClass) {
          broadcast({
            type: 'custom_agent_class_updated',
            payload: customClass,
          });
          log.log(` Updated custom agent class: ${customClass.name} (${customClass.id})`);
        } else {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { message: `Custom agent class not found: ${message.payload.id}` },
            })
          );
        }
      } catch (err: any) {
        log.error(' Failed to update custom agent class:', err);
        ws.send(
          JSON.stringify({
            type: 'error',
            payload: { message: err.message },
          })
        );
      }
      break;

    case 'delete_custom_agent_class':
      try {
        const deleted = customClassService.deleteCustomClass(message.payload.id);
        if (deleted) {
          broadcast({
            type: 'custom_agent_class_deleted',
            payload: { id: message.payload.id },
          });
          log.log(` Deleted custom agent class: ${message.payload.id}`);
        } else {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { message: `Custom agent class not found: ${message.payload.id}` },
            })
          );
        }
      } catch (err: any) {
        log.error(' Failed to delete custom agent class:', err);
        ws.send(
          JSON.stringify({
            type: 'error',
            payload: { message: err.message },
          })
        );
      }
      break;
  }
}

// ============================================================================
// Building Command Handling
// ============================================================================

async function handleBuildingCommand(
  ws: WebSocket,
  buildingId: string,
  command: 'start' | 'stop' | 'restart' | 'healthCheck' | 'logs'
): Promise<void> {
  const buildings = loadBuildings();
  const building = buildings.find(b => b.id === buildingId);

  if (!building) {
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: `Building not found: ${buildingId}` },
    }));
    return;
  }

  const cmdString = building.commands?.[command];
  if (!cmdString && command !== 'logs') {
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: `No ${command} command configured for building: ${building.name}` },
    }));
    return;
  }

  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    // Update building status
    const updateStatus = (status: Building['status']) => {
      const idx = buildings.findIndex(b => b.id === buildingId);
      if (idx !== -1) {
        buildings[idx] = { ...buildings[idx], status, lastActivity: Date.now() };
        saveBuildings(buildings);
        broadcast({
          type: 'building_updated',
          payload: buildings[idx],
        });
      }
    };

    if (command === 'start') {
      updateStatus('starting');
      exec(cmdString!, { cwd: building.cwd }, (error) => {
        if (error) {
          updateStatus('error');
          broadcast({
            type: 'building_logs',
            payload: { buildingId, logs: `Start error: ${error.message}`, timestamp: Date.now() },
          });
        } else {
          updateStatus('running');
        }
      });
      log.log(` Building ${building.name}: starting with command: ${cmdString}`);

    } else if (command === 'stop') {
      updateStatus('stopping');
      exec(cmdString!, { cwd: building.cwd }, (error) => {
        if (error) {
          broadcast({
            type: 'building_logs',
            payload: { buildingId, logs: `Stop error: ${error.message}`, timestamp: Date.now() },
          });
        }
        updateStatus('stopped');
      });
      log.log(` Building ${building.name}: stopping with command: ${cmdString}`);

    } else if (command === 'restart') {
      updateStatus('starting');
      exec(cmdString!, { cwd: building.cwd }, (error) => {
        if (error) {
          updateStatus('error');
          broadcast({
            type: 'building_logs',
            payload: { buildingId, logs: `Restart error: ${error.message}`, timestamp: Date.now() },
          });
        } else {
          updateStatus('running');
        }
      });
      log.log(` Building ${building.name}: restarting with command: ${cmdString}`);

    } else if (command === 'healthCheck') {
      try {
        const { stdout, stderr } = await execAsync(cmdString!, { cwd: building.cwd, timeout: 10000 });
        const idx = buildings.findIndex(b => b.id === buildingId);
        if (idx !== -1) {
          buildings[idx] = {
            ...buildings[idx],
            status: 'running',
            lastHealthCheck: Date.now(),
          };
          saveBuildings(buildings);
          broadcast({
            type: 'building_updated',
            payload: buildings[idx],
          });
        }
        log.log(` Building ${building.name}: health check passed`);
      } catch (error: any) {
        const idx = buildings.findIndex(b => b.id === buildingId);
        if (idx !== -1) {
          buildings[idx] = {
            ...buildings[idx],
            status: 'error',
            lastHealthCheck: Date.now(),
            lastError: error.message,
          };
          saveBuildings(buildings);
          broadcast({
            type: 'building_updated',
            payload: buildings[idx],
          });
        }
        log.log(` Building ${building.name}: health check failed: ${error.message}`);
      }

    } else if (command === 'logs') {
      const logsCmd = building.commands?.logs || 'echo "No logs command configured"';
      exec(logsCmd, { cwd: building.cwd, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        const logs = error ? `Error: ${error.message}\n${stderr}` : stdout;
        broadcast({
          type: 'building_logs',
          payload: { buildingId, logs, timestamp: Date.now() },
        });
      });
      log.log(` Building ${building.name}: fetching logs`);
    }

  } catch (error: any) {
    log.error(` Building command error:`, error);
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: `Building command error: ${error.message}` },
    }));
  }
}

// ============================================================================
// Tool Details Formatting
// ============================================================================

function formatToolDetails(
  toolName?: string,
  toolInput?: Record<string, unknown>
): string {
  if (!toolName) return 'Using unknown tool';

  // Get the key parameter for this tool type
  const param = toolInput ? getKeyParam(toolName, toolInput) : null;

  if (param) {
    return `${toolName}: ${param}`;
  }
  return `Using ${toolName}`;
}

function getKeyParam(
  toolName: string,
  input: Record<string, unknown>
): string | null {
  switch (toolName) {
    case 'WebSearch':
      return truncate(input.query as string, 50);
    case 'WebFetch':
      return truncate(input.url as string, 60);
    case 'Read':
    case 'Write':
    case 'Edit':
      const filePath = (input.file_path || input.path) as string;
      if (!filePath) return null;
      // Show just the filename for long paths
      if (filePath.length > 40) {
        const parts = filePath.split('/');
        return '.../' + parts.slice(-2).join('/');
      }
      return filePath;
    case 'Bash':
      const cmd = input.command as string;
      return cmd ? truncate(cmd, 60) : null;
    case 'Grep':
      return input.pattern ? `"${truncate(input.pattern as string, 40)}"` : null;
    case 'Glob':
      return truncate(input.pattern as string, 50);
    case 'Task':
      return truncate(input.description as string, 50);
    case 'TodoWrite':
      const todos = input.todos as unknown[];
      if (todos?.length) {
        return `${todos.length} item${todos.length > 1 ? 's' : ''}`;
      }
      return null;
    default:
      // Try to find any meaningful string parameter
      for (const [key, value] of Object.entries(input)) {
        if (typeof value === 'string' && value.length > 0 && value.length < 100) {
          return truncate(value, 50);
        }
      }
      return null;
  }
}

function truncate(str: string | undefined | null, maxLen: number): string | null {
  if (!str) return null;
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

// ============================================================================
// Boss System Prompt Builder
// ============================================================================

/**
 * Build the context portion for boss agent (injected into user message).
 * This includes subordinate status, tasks, and supervisor history.
 * Returns null if no subordinates are assigned.
 */
async function buildBossContext(bossId: string): Promise<string | null> {
  const contexts = await bossService.gatherSubordinateContext(bossId);
  const subordinates = bossService.getSubordinates(bossId);

  if (contexts.length === 0) {
    return null;
  }

  // Build detailed subordinate info with session history and supervisor analysis
  const subordinateDetails = await Promise.all(contexts.map(async (ctx, i) => {
    const sub = subordinates[i];
    const history = supervisorService.getAgentSupervisorHistory(ctx.id);

    // Get working directory
    const cwd = sub?.cwd || 'Unknown';

    // Get last assigned task with time
    const lastTask = ctx.lastAssignedTask || sub?.lastAssignedTask;
    const lastTaskTime = sub?.lastAssignedTaskTime;
    let lastTaskInfo = 'None';
    if (lastTask) {
      const timeSince = lastTaskTime ? formatTimeSince(lastTaskTime) : '';
      lastTaskInfo = `"${truncate(lastTask, 200)}"${timeSince ? ` (${timeSince} ago)` : ''}`;
    }

    // Calculate idle time
    const idleTime = sub ? formatTimeSince(sub.lastActivity) : 'Unknown';

    // Get latest analysis summary
    const latestAnalysis = history.entries[0]?.analysis;
    const statusDesc = latestAnalysis?.statusDescription || ctx.status;

    // Load recent conversation and file changes from session
    let conversationSection = '';
    let fileChangesSection = '';
    if (sub?.sessionId) {
      try {
        // Load conversation
        const session = await loadSession(sub.cwd, sub.sessionId, 10);
        if (session && session.messages.length > 0) {
          const recentMessages = session.messages.slice(-6); // Last 6 messages
          const conversationLines = recentMessages.map(msg => {
            const role = msg.type === 'user' ? '👤 User' :
                        msg.type === 'assistant' ? '🤖 Claude' :
                        msg.type === 'tool_use' ? `🔧 Tool: ${msg.toolName}` :
                        '📤 Result';
            const content = truncate(msg.content, 120) || '(empty)';
            return `  - **${role}**: ${content}`;
          });
          conversationSection = `\n### Recent Conversation:\n${conversationLines.join('\n')}`;
        }

        // Load file changes (last 20 files)
        const { fileChanges } = await loadToolHistory(sub.cwd, sub.sessionId, sub.id, sub.name, 20);
        if (fileChanges.length > 0) {
          const fileLines = fileChanges.map(fc => {
            const actionIcon = fc.action === 'created' ? '✨' :
                              fc.action === 'modified' ? '📝' :
                              fc.action === 'deleted' ? '🗑️' :
                              fc.action === 'read' ? '📖' : '📄';
            const timeSince = formatTimeSince(fc.timestamp);
            // Shorten the file path for display
            const shortPath = fc.filePath.length > 60
              ? '...' + fc.filePath.slice(-57)
              : fc.filePath;
            return `  - ${actionIcon} \`${shortPath}\` (${timeSince} ago)`;
          });
          fileChangesSection = `\n### File History (Last ${fileChanges.length}):\n${fileLines.join('\n')}`;
        }
      } catch (err) {
        // Silently ignore session loading errors
      }
    }

    // Build agent capabilities section (class info, skills, specialization)
    let capabilitiesSection = '';
    const customClass = customClassService.getCustomClass(ctx.class);
    const isBuiltIn = ctx.class in BUILT_IN_AGENT_CLASSES;

    if (customClass) {
      // Custom class - show name, description, and instructions summary
      const instructionsSummary = customClass.instructions
        ? truncate(customClass.instructions.replace(/\n/g, ' ').trim(), 150)
        : null;

      capabilitiesSection = `\n### Capabilities:
- **Class Type**: Custom Class "${customClass.name}" ${customClass.icon}
- **Specialization**: ${customClass.description}`;

      if (instructionsSummary) {
        capabilitiesSection += `\n- **Custom Instructions**: ${instructionsSummary}`;
      }
    } else if (isBuiltIn) {
      // Built-in class - show specialization
      const builtInConfig = BUILT_IN_AGENT_CLASSES[ctx.class as BuiltInAgentClass];
      capabilitiesSection = `\n### Capabilities:
- **Class Type**: ${builtInConfig.icon} ${ctx.class.charAt(0).toUpperCase() + ctx.class.slice(1)} (built-in)
- **Specialization**: ${builtInConfig.description}`;
    }

    // Get agent skills
    const agentSkills = sub ? skillService.getSkillsForAgent(sub.id, sub.class) : [];
    if (agentSkills.length > 0) {
      const skillsList = agentSkills.map(s => `${s.name}`).join(', ');
      capabilitiesSection += `\n- **Skills**: ${skillsList}`;
    }

    // Build supervisor status updates (last 3 with FULL details)
    let supervisorUpdates = '';
    if (history.entries && history.entries.length > 0) {
      const updates = history.entries.slice(0, 3).map((entry) => {
        const analysis = entry.analysis;
        const timeSince = formatTimeSince(entry.timestamp);
        const progress = analysis?.progress || 'unknown';
        const progressEmoji = progress === 'on_track' ? '🟢' :
                             progress === 'completed' ? '✅' :
                             progress === 'idle' ? '💤' :
                             progress === 'stalled' ? '🟡' :
                             progress === 'blocked' ? '🔴' : '⚪';

        const lines: string[] = [];
        lines.push(`#### ${progressEmoji} [${timeSince} ago] ${analysis?.statusDescription || 'No status'}`);

        if (analysis?.recentWorkSummary) {
          lines.push(`> 📝 ${analysis.recentWorkSummary}`);
        }
        if (analysis?.currentFocus && analysis.currentFocus !== analysis.statusDescription) {
          lines.push(`> 🎯 **Focus**: ${analysis.currentFocus}`);
        }
        if (analysis?.blockers && analysis.blockers.length > 0) {
          lines.push(`> 🚧 **Blockers**: ${analysis.blockers.join(', ')}`);
        }
        if (analysis?.suggestions && analysis.suggestions.length > 0) {
          lines.push(`> 💡 **Suggestions**: ${analysis.suggestions.join('; ')}`);
        }
        if (analysis?.filesModified && analysis.filesModified.length > 0) {
          lines.push(`> 📁 **Files**: ${analysis.filesModified.slice(0, 5).join(', ')}`);
        }
        if (analysis?.concerns && analysis.concerns.length > 0) {
          lines.push(`> ⚠️ **Concerns**: ${analysis.concerns.join('; ')}`);
        }

        return lines.join('\n');
      });
      supervisorUpdates = `\n### Supervisor Status Updates:\n${updates.join('\n\n')}`;
    }

    return `## ${ctx.name} (${ctx.class})
- **Agent ID**: \`${ctx.id}\`
- **Status**: ${statusDesc} (${ctx.status})
- **Idle Time**: ${idleTime}
- **Last Assigned Task**: ${lastTaskInfo}
- **Working Directory**: ${cwd}
- **Context Usage**: ${ctx.contextPercent}% (${ctx.tokensUsed?.toLocaleString() || 0} tokens)${capabilitiesSection}${fileChangesSection}${conversationSection}${supervisorUpdates}`;
  }));

  // Get recent delegation history for this boss
  const delegationHistory = bossService.getDelegationHistory(bossId).slice(0, 5);
  const delegationSummary = delegationHistory.length > 0
    ? delegationHistory.map(d => {
        const time = formatTimeSince(d.timestamp);
        return `- [${time} ago] "${truncate(d.userCommand, 60)}" → **${d.selectedAgentName}** (${d.confidence})`;
      }).join('\n')
    : 'No recent delegations.';

  return `# YOUR TEAM (${contexts.length} agents)
${subordinateDetails.join('\n\n')}

# RECENT DELEGATION HISTORY
${delegationSummary}`;
}

/**
 * Build minimal system prompt for boss agent.
 * The detailed instructions are injected in the user message instead.
 */
function buildBossInstructions(bossName: string): string {
  return `You are "${bossName}", a Boss Agent manager. DO NOT USE ANY TOOLS. Respond with plain text only.`;
}

/**
 * Build the instructions to inject in user message for boss agents.
 * These are placed inside the BOSS_CONTEXT delimiters so the frontend can collapse them.
 */
function buildBossInstructionsForMessage(bossName: string, hasSubordinates: boolean): string {
  if (!hasSubordinates) {
    return `# BOSS INSTRUCTIONS

You are "${bossName}", a Boss Agent in Tide Commander.

**ROLE:** You are a team coordinator and task router. Your job is to:
1. Understand your team's capabilities and current work
2. Route incoming tasks to the most appropriate subordinate
3. Monitor team progress and provide status updates
4. Coordinate work across multiple agents when needed

**CURRENT TEAM:** No subordinates assigned yet.

To be effective, you need subordinate agents assigned to your team. Ask the user to assign agents to you.`;
  }

  return `# BOSS INSTRUCTIONS

**CRITICAL - YOU MUST FOLLOW THESE:**
You are "${bossName}", a Boss Agent manager. DO NOT USE ANY TOOLS. Respond with plain text only.

## RULES:
1. When asked about team/subordinates/status → Answer about the agents in YOUR TEAM section below
2. For coding tasks → Explain your delegation decision, then include the delegation block at the end
3. NEVER use tools like Task, Bash, TaskOutput, Grep, etc. Just answer from the context provided.
4. NEVER mention "agents" like Bash, Explore, general-purpose - those are NOT your team.

## AGENT CLASSES: scout=explore, builder=code, debugger=fix, architect=plan, warrior=refactor, support=docs

## DELEGATION RESPONSE FORMAT:
When delegating a coding task, your response MUST follow this structure:

### 1. Task Summary (brief)
Acknowledge what the user is asking for in 1-2 sentences.

### 2. Delegation Decision
Use this format to explain your decision clearly:

**📋 Delegating to: [Agent Name]** ([class])
**📝 Task:** [Brief description of what they will do]
**💡 Reason:** [Why this agent is the best choice - their expertise, current status, relevant experience]

If there are alternative agents, briefly mention:
**🔄 Alternatives:** [Other agents who could do this and why you didn't pick them]

### 3. Delegation Block (REQUIRED for auto-forwarding)
At the END of your response, include a JSON block with delegations:

\`\`\`delegation
[
  {
    "selectedAgentId": "<EXACT Agent ID from agent's 'Agent ID' field>",
    "selectedAgentName": "<Agent Name>",
    "taskCommand": "<SPECIFIC task command for THIS agent>",
    "reasoning": "<why this agent>",
    "confidence": "high|medium|low"
  }
]
\`\`\`

**CRITICAL RULES:**
- Use an ARRAY format - even for single delegation, wrap in [ ]
- "selectedAgentId" MUST be the exact Agent ID string (e.g., \`hj8ojr7i\`). Copy it exactly!
- "taskCommand" is what gets sent to each agent

## SINGLE vs MULTI-AGENT DELEGATION:

**⚠️ DEFAULT TO SINGLE AGENT.** One capable agent with full context beats multiple agents with fragmented knowledge.

### When to use SINGLE agent (the default):
- Tasks are sequential phases of the same work (review → implement → test)
- One step needs context from a previous step
- A single competent agent can handle the full scope
- Example: "review POC, improve stdin feature, add tests" → ONE agent does all three because they build on each other

### When MULTI-agent delegation is appropriate:
- Tasks are truly independent (no shared context needed)
- Tasks require different specializations AND can run in parallel (e.g., frontend UI + backend API)
- User explicitly asks to split work across agents
- Broadcasting a message to all agents (like "tell everyone hello")

### DON'T split tasks when:
- The tasks share context (investigating → implementing → testing is ONE workflow)
- One agent would need to re-discover what another agent already learned
- The tasks are phases of one larger task, not independent units

---

## SPAWNING NEW AGENTS:
You can ONLY spawn new agents when the user EXPLICITLY requests it.

### When to Spawn:
- User explicitly says "create an agent", "spawn a debugger", "add X to the team", etc.
- User directly asks you to add a new team member
- **NEVER spawn automatically** just because no suitable agent exists

### When NOT to Spawn:
- User asks for a task but you have no suitable agent → **Delegate to the closest available agent** OR **ask the user if they want to spawn a specialist**
- You think you need a specialist → **Ask the user first** before spawning

### What to Do When No Suitable Agent Exists:
1. **Option A:** Delegate to the closest matching agent (e.g., a builder can do debugging tasks, a scout can help with planning)
2. **Option B:** Ask the user: "I don't have a specialized [agent type] on my team. Would you like me to spawn one, or should I delegate this to [available agent]?"

### Spawn Block Format (ONLY when user explicitly requests):
Include at the END of your response (can be combined with delegation):

\`\`\`spawn
[{"name": "<Agent Name>", "class": "<agent class>", "cwd": "<optional working directory>"}]
\`\`\`

Valid classes:
- **scout**: Exploration, finding files, understanding codebase
- **builder**: Implementing features, writing new code
- **debugger**: Fixing bugs, debugging issues
- **architect**: Planning, design decisions
- **warrior**: Aggressive refactoring, migrations
- **support**: Documentation, tests, cleanup

---`;
}

/**
 * Build full boss message with instructions and context injected at the beginning.
 * Both instructions and context are wrapped in delimiters for the frontend to detect and collapse.
 */
async function buildBossMessage(bossId: string, command: string): Promise<{ message: string; systemPrompt: string }> {
  const agent = agentService.getAgent(bossId);
  const bossName = agent?.name || 'Boss';

  const context = await buildBossContext(bossId);
  const hasSubordinates = context !== null;
  const systemPrompt = buildBossInstructions(bossName);
  const instructions = buildBossInstructionsForMessage(bossName, hasSubordinates);

  if (!context) {
    // No subordinates - just inject instructions
    const message = `${BOSS_CONTEXT_START}
${instructions}
${BOSS_CONTEXT_END}

${command}`;
    return { message, systemPrompt };
  }

  // Inject instructions + context at the beginning of the user message with delimiters
  const message = `${BOSS_CONTEXT_START}
${instructions}

${context}
${BOSS_CONTEXT_END}

${command}`;

  return { message, systemPrompt };
}

/**
 * Format time since a timestamp (e.g., "5 minutes", "2 hours")
 */
function formatTimeSince(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}



// ============================================================================
// Agent Restart on Class Update
// ============================================================================

/**
 * Restart all agents using a given skill when the skill is updated.
 * An agent uses a skill if:
 * 1. The skill is directly assigned to the agent
 * 2. The skill is assigned to the agent's class
 * 3. The agent's custom class has the skill as a default
 */
async function restartAgentsWithSkill(skill: Skill): Promise<void> {
  const allAgents = agentService.getAllAgents();
  const affectedAgents = allAgents.filter(agent => {
    // Check direct assignment
    if (skill.assignedAgentIds.includes(agent.id)) return true;

    // Check class assignment (skill assigned to agent's class)
    if (skill.assignedAgentClasses.includes(agent.class)) return true;

    // Check custom class default skills
    const customClass = customClassService.getCustomClass(agent.class);
    if (customClass?.defaultSkillIds?.includes(skill.id)) return true;

    return false;
  });

  if (affectedAgents.length === 0) {
    log.log(`🔄 No agents using skill "${skill.name}" to restart`);
    return;
  }

  log.log(`🔄 Restarting ${affectedAgents.length} agent(s) using skill "${skill.name}" due to skill update`);

  for (const agent of affectedAgents) {
    try {
      log.log(`🔄 Restarting agent ${agent.name} (${agent.id}) due to skill update`);

      // Stop the current process if running
      await claudeService.stopAgent(agent.id);

      // Clear session to force a fresh start with new skill content
      agentService.updateAgent(agent.id, {
        status: 'idle',
        currentTask: undefined,
        currentTool: undefined,
        sessionId: undefined, // Clear session to start fresh
        tokensUsed: 0,
        contextUsed: 0,
      });

      // Notify the user
      sendActivity(agent.id, `Session restarted - skill "${skill.name}" updated`);

      log.log(`🔄 Agent ${agent.name} restarted successfully`);
    } catch (err) {
      log.error(`🔄 Failed to restart agent ${agent.name}:`, err);
      sendActivity(agent.id, `Failed to restart after skill update`);
    }
  }
}

/**
 * Restart all agents with a given class when the class instructions are updated.
 * This stops the agent's current session and clears the sessionId so the next
 * command will start a fresh session with the new instructions.
 */
async function restartAgentsWithClass(classId: string): Promise<void> {
  const allAgents = agentService.getAllAgents();
  const affectedAgents = allAgents.filter(agent => agent.class === classId);

  if (affectedAgents.length === 0) {
    log.log(`🔄 No agents with class "${classId}" to restart`);
    return;
  }

  log.log(`🔄 Restarting ${affectedAgents.length} agent(s) with class "${classId}" due to instructions update`);

  for (const agent of affectedAgents) {
    try {
      log.log(`🔄 Restarting agent ${agent.name} (${agent.id}) due to class update`);

      // Stop the current process if running
      await claudeService.stopAgent(agent.id);

      // Clear session to force a fresh start with new instructions
      agentService.updateAgent(agent.id, {
        status: 'idle',
        currentTask: undefined,
        currentTool: undefined,
        sessionId: undefined, // Clear session to start fresh
        tokensUsed: 0,
        contextUsed: 0,
      });

      // Notify the user
      sendActivity(agent.id, `Session restarted - class instructions updated`);

      log.log(`🔄 Agent ${agent.name} restarted successfully`);
    } catch (err) {
      log.error(`🔄 Failed to restart agent ${agent.name}:`, err);
      sendActivity(agent.id, `Failed to restart after class update`);
    }
  }
}

// ============================================================================
// Service Event Handlers
// ============================================================================

function setupServiceListeners(): void {
  // Agent events
  agentService.subscribe((event, data) => {
    switch (event) {
      case 'created':
        // Already handled in handleClientMessage
        break;
      case 'updated':
        const updatedAgent = data as Agent;
        log.log(` Broadcasting agent_updated: ${updatedAgent.id} name=${updatedAgent.name} status=${updatedAgent.status}, contextUsed=${updatedAgent.contextUsed}, tokensUsed=${updatedAgent.tokensUsed}, clients=${clients.size}`);
        broadcast({
          type: 'agent_updated',
          payload: updatedAgent,
        });
        break;
      case 'deleted':
        broadcast({
          type: 'agent_deleted',
          payload: { id: data as string },
        });
        sendActivity(data as string, 'Agent terminated');
        break;
    }
  });

  // Claude events
  claudeService.on('event', (agentId, event) => {
    // Send activity for important events
    if (event.type === 'init') {
      sendActivity(agentId, `Session initialized (${event.model})`);
    } else if (event.type === 'tool_start') {
      const details = formatToolDetails(event.toolName, event.toolInput);
      sendActivity(agentId, details);
    } else if (event.type === 'error') {
      sendActivity(agentId, `Error: ${event.errorMessage}`);
    }

    // For boss agents, parse delegation and spawn blocks from step_complete result text
    if (event.type === 'step_complete' && event.resultText) {
      const agent = agentService.getAgent(agentId);
      if (agent?.class === 'boss') {
        log.log(`🟣🟣🟣 step_complete EVENT for boss ${agent.name}, resultText length: ${event.resultText.length}`);
        parseBossDelegation(agentId, agent.name, event.resultText);
        parseBossSpawn(agentId, agent.name, event.resultText);
      }
    }

    // Parse and broadcast context stats from /context command
    if (event.type === 'context_stats' && event.contextStatsRaw) {
      const stats = parseContextOutput(event.contextStatsRaw);
      if (stats) {
        log.log(` Parsed context stats for ${agentId}: ${stats.usedPercent}% used (${stats.totalTokens}/${stats.contextWindow})`);
        // Update agent with the parsed stats
        agentService.updateAgent(agentId, { contextStats: stats }, false);
        // Broadcast to clients
        broadcast({
          type: 'context_stats',
          payload: { agentId, stats },
        });
      }
    }

    // Broadcast raw event
    broadcast({
      type: 'event',
      payload: { ...event, agentId } as any,
    });
  });

  // Helper to parse delegation from boss response (supports single object or array of delegations)
  function parseBossDelegation(agentId: string, bossName: string, resultText: string): void {
    log.log(`🔴🔴🔴 parseBossDelegation CALLED for boss ${bossName}, resultText length: ${resultText.length}`);
    log.log(` Boss ${bossName} checking for delegation block: ${resultText.includes('```delegation')}`);

    // Parse delegation block: ```delegation\n[...]\n``` or ```delegation\n{...}\n```
    const delegationMatch = resultText.match(/```delegation\s*\n([\s\S]*?)\n```/);
    if (delegationMatch) {
      log.log(` Boss ${bossName} delegation match found!`);
      try {
        const parsed = JSON.parse(delegationMatch[1].trim());

        // Support both array and single object format
        const delegations = Array.isArray(parsed) ? parsed : [parsed];

        log.log(` Parsed ${delegations.length} delegation(s) from boss ${bossName}`);

        const originalCommand = lastBossCommands.get(agentId) || '';

        // Clean up old entries from dedup map
        const now = Date.now();
        for (const [key, timestamp] of processedDelegations) {
          if (now - timestamp > DELEGATION_DEDUP_WINDOW_MS) {
            processedDelegations.delete(key);
          }
        }

        // Process each delegation
        for (const delegationJson of delegations) {
          const taskCommand = delegationJson.taskCommand || originalCommand;
          const targetAgentId = delegationJson.selectedAgentId;

          // Create dedup key based on boss, target agent, and command
          const dedupKey = `${agentId}:${targetAgentId}:${taskCommand}`;

          // Check if this delegation was already processed recently
          if (processedDelegations.has(dedupKey)) {
            log.log(` SKIPPING duplicate delegation to ${delegationJson.selectedAgentName}: "${taskCommand.slice(0, 50)}..." (already processed)`);
            continue;
          }

          // Mark as processed
          processedDelegations.set(dedupKey, now);

          log.log(` Delegation to ${delegationJson.selectedAgentName}: "${taskCommand.slice(0, 80)}..."`);

          const decision: DelegationDecision = {
            id: `del-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
            bossId: agentId,
            userCommand: taskCommand,  // Use the task command for forwarding
            selectedAgentId: delegationJson.selectedAgentId,
            selectedAgentName: delegationJson.selectedAgentName,
            reasoning: delegationJson.reasoning || '',
            alternativeAgents: delegationJson.alternativeAgents || [],
            confidence: delegationJson.confidence || 'medium',
            status: 'sent',
          };

          // Store in boss history
          bossService.addDelegationToHistory(agentId, decision);

          // Broadcast the delegation decision (for UI updates/animations)
          broadcast({
            type: 'delegation_decision',
            payload: decision,
          });

          // Broadcast delegation message as output for the subordinate's conversation panel
          if (decision.selectedAgentId) {
            const delegationMessage = `📋 **Task delegated from ${bossName}:**\n\n${decision.userCommand}`;
            broadcast({
              type: 'output',
              payload: {
                agentId: decision.selectedAgentId,
                text: delegationMessage,
                isStreaming: false,
                timestamp: Date.now(),
                isDelegation: true,
              },
            });
          }

          // Auto-forward the command to the subordinate agent (backend handles this to prevent duplicates)
          if (decision.selectedAgentId && decision.userCommand) {
            log.log(`🟢🟢🟢 SENDING COMMAND to ${decision.selectedAgentName} (${decision.selectedAgentId}): "${decision.userCommand.slice(0, 50)}..."`);
            claudeService.sendCommand(decision.selectedAgentId, decision.userCommand)
              .catch(err => {
                log.error(` Failed to auto-forward command to ${decision.selectedAgentName}:`, err);
              });
          }
        }
      } catch (err) {
        log.error(` Failed to parse delegation JSON from boss ${bossName}:`, err);
      }
    }
  }

  // Helper to parse spawn requests from boss response
  async function parseBossSpawn(bossId: string, bossName: string, resultText: string): Promise<void> {
    log.log(` Boss ${bossName} checking for spawn block: ${resultText.includes('```spawn')}`);

    // Parse spawn block: ```spawn\n[...]\n``` or ```spawn\n{...}\n```
    const spawnMatch = resultText.match(/```spawn\s*\n([\s\S]*?)\n```/);
    if (spawnMatch) {
      log.log(` Boss ${bossName} spawn match found!`);
      try {
        const parsed = JSON.parse(spawnMatch[1].trim());

        // Support both array and single object format
        const spawns = Array.isArray(parsed) ? parsed : [parsed];

        log.log(` Parsed ${spawns.length} spawn request(s) from boss ${bossName}`);

        const boss = agentService.getAgent(bossId);
        const bossCwd = boss?.cwd || process.cwd();

        for (const spawnRequest of spawns) {
          const { name, class: agentClass, cwd } = spawnRequest;

          // Validate required fields
          if (!name || !agentClass) {
            log.error(` Spawn request missing required fields (name, class):`, spawnRequest);
            continue;
          }

          // Validate agent class
          const validClasses = ['scout', 'builder', 'debugger', 'architect', 'warrior', 'support'];
          if (!validClasses.includes(agentClass)) {
            log.error(` Invalid agent class "${agentClass}". Must be one of: ${validClasses.join(', ')}`);
            continue;
          }

          // Use boss's cwd if not specified
          const agentCwd = cwd || bossCwd;

          log.log(` Boss ${bossName} spawning new ${agentClass} agent: "${name}" in ${agentCwd}`);

          try {
            const newAgent = await agentService.createAgent(
              name,
              agentClass as AgentClass,
              agentCwd
            );

            // Add new agent to boss's subordinates
            const currentSubordinates = bossService.getSubordinates(bossId).map(a => a.id);
            const newSubordinates = [...currentSubordinates, newAgent.id];
            bossService.assignSubordinates(bossId, newSubordinates);

            log.log(` Successfully spawned agent ${newAgent.name} (${newAgent.id}) for boss ${bossName}`);

            // Broadcast boss_spawned_agent - client should NOT auto-select and should walk to boss
            broadcast({
              type: 'boss_spawned_agent' as const,
              payload: {
                agent: newAgent,
                bossId,
                bossPosition: boss?.position || { x: 0, y: 0, z: 0 },
              },
            });

            sendActivity(newAgent.id, `${newAgent.name} deployed by ${bossName}`);

            // Notify about subordinate assignment
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
  }

  claudeService.on('output', (agentId, text, isStreaming) => {
    const timestamp = Date.now();
    log.log(`📤 [OUTPUT] Received output for agent ${agentId}, isStreaming=${isStreaming}, textLen=${text.length}, timestamp=${timestamp}`);
    log.log(`📤 [OUTPUT] Text preview: "${text.substring(0, 100)}..."`);
    broadcast({
      type: 'output' as any,
      payload: {
        agentId,
        text,
        isStreaming: isStreaming || false,
        timestamp,
      },
    });
    log.log(`📤 [OUTPUT] Broadcast complete for timestamp=${timestamp}`);
  });

  claudeService.on('complete', (agentId, success) => {
    sendActivity(agentId, success ? 'Task completed' : 'Task failed');
  });

  claudeService.on('error', (agentId, error) => {
    sendActivity(agentId, `Error: ${error}`);
  });

  // Set up command started callback
  claudeService.setCommandStartedCallback((agentId, command) => {
    broadcast({
      type: 'command_started',
      payload: { agentId, command },
    });
  });

  // Permission events
  permissionService.subscribe((request: PermissionRequest) => {
    log.log(` Broadcasting permission_request: ${request.id} for tool ${request.tool}`);
    broadcast({
      type: 'permission_request',
      payload: request,
    });
    // Also update agent status to 'waiting' while waiting for permission
    const agent = agentService.getAgent(request.agentId);
    if (agent) {
      agentService.updateAgent(request.agentId, {
        status: 'waiting',
        currentTask: `Waiting for permission: ${request.tool}`,
      });
    }
  });

  // Supervisor events
  supervisorService.subscribe((event, data) => {
    switch (event) {
      case 'report':
        broadcast({
          type: 'supervisor_report',
          payload: data,
        } as ServerMessage);
        break;
      case 'agent_analysis':
        // Single agent analysis update
        broadcast({
          type: 'agent_analysis',
          payload: data,
        } as ServerMessage);
        break;
      case 'narrative':
        broadcast({
          type: 'narrative_update',
          payload: data,
        } as ServerMessage);
        break;
      case 'config_changed':
        broadcast({
          type: 'supervisor_status',
          payload: supervisorService.getStatus(),
        } as ServerMessage);
        break;
    }
  });

  // Boss service events
  bossService.subscribe((event, data) => {
    switch (event) {
      case 'delegation_decision':
        broadcast({
          type: 'delegation_decision',
          payload: data as DelegationDecision,
        });
        break;
      case 'subordinates_updated':
        const { bossId, subordinateIds } = data as { bossId: string; subordinateIds: string[] };
        broadcast({
          type: 'boss_subordinates_updated',
          payload: { bossId, subordinateIds },
        });
        break;
    }
  });

  // Skill service events
  skillService.subscribe((event, data) => {
    switch (event) {
      case 'created':
        broadcast({
          type: 'skill_created',
          payload: data as Skill,
        });
        break;
      case 'updated':
        broadcast({
          type: 'skill_updated',
          payload: data as Skill,
        });
        // Auto-restart agents using this skill so they get the updated content
        restartAgentsWithSkill(data as Skill);
        break;
      case 'deleted':
        broadcast({
          type: 'skill_deleted',
          payload: { id: data as string },
        });
        break;
    }
  });

  // Custom agent class service events
  customClassService.customClassEvents.on('created', (customClass: CustomAgentClass) => {
    broadcast({
      type: 'custom_agent_class_created',
      payload: customClass,
    });
  });

  customClassService.customClassEvents.on('updated', (customClass: CustomAgentClass) => {
    broadcast({
      type: 'custom_agent_class_updated',
      payload: customClass,
    });

    // Auto-restart agents when their class instructions are updated
    // This ensures running agents get the new instructions
    restartAgentsWithClass(customClass.id);
  });

  customClassService.customClassEvents.on('deleted', (id: string) => {
    broadcast({
      type: 'custom_agent_class_deleted',
      payload: { id },
    });
  });
}

// ============================================================================
// Initialization
// ============================================================================

export function init(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws) => {
    log.log('🔗 [CONNECTION] New client connected');
    log.log(`  Total clients: ${clients.size + 1}`);
    clients.add(ws);
    log.log(`  Client added to set`);

    // Sync agent status with actual process state before sending to client
    // This only corrects 'working' -> 'idle' if the process is dead
    await claudeService.syncAllAgentStatus();

    // Send current state
    const agents = agentService.getAllAgents();
    log.log(` Sending initial agents_update with ${agents.length} agents:`);
    for (const agent of agents) {
      console.log(`  - ${agent.name}: status=${agent.status}`);
    }

    ws.send(
      JSON.stringify({
        type: 'agents_update',
        payload: agents,
      })
    );

    // Send current areas
    const areas = loadAreas();
    log.log(` Sending initial areas_update with ${areas.length} areas`);
    ws.send(
      JSON.stringify({
        type: 'areas_update',
        payload: areas,
      })
    );

    // Send current buildings
    const buildings = loadBuildings();
    log.log(` Sending initial buildings_update with ${buildings.length} buildings`);
    ws.send(
      JSON.stringify({
        type: 'buildings_update',
        payload: buildings,
      })
    );

    // Send current skills
    const skills = skillService.getAllSkills();
    log.log(` Sending initial skills_update with ${skills.length} skills`);
    ws.send(
      JSON.stringify({
        type: 'skills_update',
        payload: skills,
      })
    );

    // Send current custom agent classes
    const customClasses = customClassService.getAllCustomClasses();
    log.log(` Sending initial custom_agent_classes_update with ${customClasses.length} custom classes`);
    ws.send(
      JSON.stringify({
        type: 'custom_agent_classes_update',
        payload: customClasses,
      })
    );

    // Send pending permission requests
    const pendingPermissions = permissionService.getPendingRequests();
    if (pendingPermissions.length > 0) {
      log.log(` Sending ${pendingPermissions.length} pending permission requests`);
      for (const request of pendingPermissions) {
        ws.send(
          JSON.stringify({
            type: 'permission_request',
            payload: request,
          })
        );
      }
    }

    ws.on('message', (data) => {
      const dataStr = data.toString();
      log.log('📨 [MESSAGE] Received from client:', dataStr.substring(0, 200));
      try {
        const message = JSON.parse(dataStr) as ClientMessage;
        log.log(`  Message type: ${message.type}`);
        handleClientMessage(ws, message);
      } catch (err) {
        log.error('❌ Invalid message:', err);
        log.error('  Raw data:', dataStr);
      }
    });

    ws.on('close', () => {
      log.log('🔴 [DISCONNECT] Client disconnected');
      clients.delete(ws);
      log.log(`  Remaining clients: ${clients.size}`);
    });
  });

  // Set up service event listeners
  setupServiceListeners();

  log.log(' Handler initialized');
  return wss;
}
