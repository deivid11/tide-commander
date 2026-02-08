/**
 * Server message router – maps every ServerMessage.type to its handler logic.
 */

import type { Agent, ServerMessage, DelegationDecision, CustomAgentClass, Subagent } from '../../shared/types';
import { store } from '../store';
import { perf } from '../utils/profiling';
import { debugLog } from '../services/agentDebugger';
import { cb } from './callbacks';
import { sendMessage } from './send';

const reattachInFlight = new Set<string>();
const REATTACH_RETRY_DELAY_MS = 5000;

function maybeRequestReattach(agent: Agent): void {
  if (!agent.isDetached || !agent.sessionId) {
    reattachInFlight.delete(agent.id);
    return;
  }

  if (reattachInFlight.has(agent.id)) {
    return;
  }

  reattachInFlight.add(agent.id);
  sendMessage({
    type: 'reattach_agent',
    payload: {
      agentId: agent.id,
    },
  });

  setTimeout(() => {
    reattachInFlight.delete(agent.id);
  }, REATTACH_RETRY_DELAY_MS);
}

export function handleServerMessage(message: ServerMessage): void {
  perf.start(`ws:${message.type}`);

  switch (message.type) {
    case 'agents_update': {
      const agentList = message.payload as Agent[];
      // Debug: log boss agents with their subordinateIds
      const bossAgents = agentList.filter(a => a.class === 'boss' || a.isBoss);
      if (bossAgents.length > 0) {
        console.log('[WS agents_update] Boss agents received:', bossAgents.map(b => ({
          id: b.id,
          name: b.name,
          subordinateIds: b.subordinateIds,
        })));
      }
      store.setAgents(agentList);
      cb.onAgentsSync?.(agentList);
      // Load tool history after agents are synced
      store.loadToolHistory();
      for (const agent of agentList) {
        maybeRequestReattach(agent);
      }
      break;
    }

    case 'agent_created': {
      const newAgent = message.payload as Agent;
      console.log('[WebSocket] Agent created:', newAgent);
      store.addAgent(newAgent);
      store.selectAgent(newAgent.id);
      cb.onAgentCreated?.(newAgent);
      cb.onSpawnSuccess?.();

      // Call global handler if it exists (for SpawnModal)
      if ((window as any).__spawnModalSuccess) {
        console.log('[WebSocket] Calling __spawnModalSuccess');
        (window as any).__spawnModalSuccess();
      }

      cb.onToast?.('success', 'Agent Deployed', `${newAgent.name} is ready for commands`);
      break;
    }

    case 'agent_updated': {
      const updatedAgent = message.payload as Agent;
      const state = store.getState();
      const previousAgent = state.agents.get(updatedAgent.id);

      const statusChanged = previousAgent?.status !== updatedAgent.status;
      console.log(`[Tide] Agent updated: ${updatedAgent.name} (${updatedAgent.id}) status=${updatedAgent.status} (was ${previousAgent?.status})${statusChanged ? ' ⚡ STATUS CHANGED' : ''}`);

      if (statusChanged) {
        console.log(`[Tide] 🔔 Status change for ${updatedAgent.name}: ${previousAgent?.status} → ${updatedAgent.status}`);
      }

      const positionChanged = previousAgent
        ? previousAgent.position.x !== updatedAgent.position.x ||
          previousAgent.position.z !== updatedAgent.position.z
        : false;

      store.updateAgent(updatedAgent);
      maybeRequestReattach(updatedAgent);
      cb.onAgentUpdated?.(updatedAgent, positionChanged);
      break;
    }

    case 'agent_deleted': {
      const { id } = message.payload as { id: string };
      reattachInFlight.delete(id);
      store.removeAgent(id);
      cb.onAgentDeleted?.(id);
      break;
    }

    case 'activity': {
      const activity = message.payload as {
        agentId: string;
        agentName: string;
        message: string;
        timestamp: number;
      };
      store.addActivity(activity);
      break;
    }

    case 'event': {
      // Claude event - trigger visual effects and track tools
      const event = message.payload as {
        agentId: string;
        type: string;
        toolName?: string;
        toolInput?: Record<string, unknown>;
      };
      debugLog.debug(`Event: ${event.type}`, {
        agentId: event.agentId,
        toolName: event.toolName,
      }, 'ws:event');
      if (event.type === 'tool_start' && event.toolName) {
        cb.onToolUse?.(event.agentId, event.toolName, event.toolInput);
        // Track tool execution with input
        store.addToolExecution(event.agentId, event.toolName, event.toolInput);
        // Track file changes from file-related tools
        if (event.toolInput) {
          const filePath = (event.toolInput.file_path || event.toolInput.path) as string | undefined;
          if (filePath) {
            if (event.toolName === 'Write') {
              store.addFileChange(event.agentId, 'created', filePath);
            } else if (event.toolName === 'Edit') {
              store.addFileChange(event.agentId, 'modified', filePath);
            } else if (event.toolName === 'Read') {
              store.addFileChange(event.agentId, 'read', filePath);
            }
          }
        }
      }
      break;
    }

    case 'output': {
      // Streaming output from Claude - goes to dedicated output store
      const output = message.payload as {
        agentId: string;
        text: string;
        isStreaming: boolean;
        timestamp: number;
        isDelegation?: boolean;
        skillUpdate?: import('../../shared/types').SkillUpdateData;
        subagentName?: string;
        uuid?: string;
        toolName?: string;
        toolInput?: Record<string, unknown>;
        toolInputRaw?: string;
        toolOutput?: string;
      };
      debugLog.debug(`Output: "${output.text.slice(0, 80)}..."`, {
        agentId: output.agentId,
        isStreaming: output.isStreaming,
        length: output.text.length,
        hasSkillUpdate: !!output.skillUpdate,
        uuid: output.uuid,
        toolName: output.toolName,
      }, 'ws:output');
      store.addOutput(output.agentId, {
        text: output.text,
        isStreaming: output.isStreaming,
        timestamp: output.timestamp,
        isDelegation: output.isDelegation,
        skillUpdate: output.skillUpdate,
        subagentName: output.subagentName,
        uuid: output.uuid,
        toolName: output.toolName,
        toolInput: output.toolInput,
        toolOutput: output.toolOutput,
      });
      break;
    }

    case 'context_stats': {
      const { agentId, stats } = message.payload as {
        agentId: string;
        stats: import('../../shared/types').ContextStats;
      };
      console.log(`[Tide] Received context stats for agent ${agentId}: ${stats.usedPercent}% used`);
      store.updateAgentContextStats(agentId, stats);
      break;
    }

    case 'error': {
      const errorPayload = message.payload as { message: string };
      console.error('[WebSocket] Error from server:', errorPayload.message);
      cb.onToast?.('error', 'Error', errorPayload.message);
      cb.onSpawnError?.();

      // Call global handler if it exists (for SpawnModal)
      if ((window as any).__spawnModalError) {
        console.log('[WebSocket] Calling __spawnModalError');
        (window as any).__spawnModalError();
      }
      break;
    }

    case 'directory_not_found': {
      const { path } = message.payload as { path: string };
      console.log('[WebSocket] Directory not found:', path);
      cb.onDirectoryNotFound?.(path);

      // Call global handler if it exists (for SpawnModal)
      if ((window as any).__spawnModalDirNotFound) {
        console.log('[WebSocket] Calling __spawnModalDirNotFound');
        (window as any).__spawnModalDirNotFound(path);
      }
      break;
    }

    case 'command_started': {
      const { agentId, command } = message.payload as {
        agentId: string;
        command: string;
      };
      // Skip adding utility slash commands to output (they're handled specially)
      const trimmedCommand = command.trim();
      if (trimmedCommand === '/context' || trimmedCommand === '/cost' || trimmedCommand === '/compact') {
        break;
      }
      // Add user prompt to output when command actually starts executing
      store.addUserPromptToOutput(agentId, command);
      break;
    }

    case 'session_updated': {
      // An orphaned agent's session file was updated - refresh its history
      const { agentId } = message.payload as { agentId: string };
      // Reload the tool history to get the latest updates from the detached process
      store.loadToolHistory();
      // Also update the agent to trigger a UI refresh
      const agent = store.getState().agents.get(agentId);
      if (agent) {
        store.updateAgent({ ...agent });
      }
      break;
    }

    case 'supervisor_report': {
      const report = message.payload as import('../../shared/types').SupervisorReport;
      store.setSupervisorReport(report);
      break;
    }

    case 'narrative_update': {
      const { agentId, narrative } = message.payload as {
        agentId: string;
        narrative: import('../../shared/types').ActivityNarrative;
      };
      store.addNarrative(agentId, narrative);
      break;
    }

    case 'supervisor_status': {
      const status = message.payload as {
        enabled: boolean;
        autoReportOnComplete?: boolean;
        lastReportTime: number | null;
        nextReportTime: number | null;
      };
      store.setSupervisorStatus(status);
      break;
    }

    case 'agent_supervisor_history': {
      const history = message.payload as import('../../shared/types').AgentSupervisorHistory;
      store.setAgentSupervisorHistory(history);
      break;
    }

    case 'agent_analysis': {
      const { agentId, analysis } = message.payload as {
        agentId: string;
        analysis: import('../../shared/types').AgentAnalysis;
      };
      store.addAgentAnalysis(agentId, analysis);
      break;
    }

    case 'areas_update': {
      const areasArray = message.payload as import('../../shared/types').DrawingArea[];
      store.setAreasFromServer(areasArray);
      // Notify scene to re-sync agents (to filter out those in archived areas)
      cb.onAreasSync?.();
      break;
    }

    case 'buildings_update': {
      const buildingsArray = message.payload as import('../../shared/types').Building[];
      store.setBuildingsFromServer(buildingsArray);
      break;
    }

    case 'building_created': {
      const building = message.payload as import('../../shared/types').Building;
      store.addBuilding(building);
      break;
    }

    case 'building_updated': {
      const building = message.payload as import('../../shared/types').Building;
      store.updateBuildingFromServer(building);
      cb.onBuildingUpdated?.(building);
      break;
    }

    case 'building_deleted': {
      const { id } = message.payload as { id: string };
      store.removeBuildingFromServer(id);
      break;
    }

    case 'building_logs': {
      const { buildingId, logs } = message.payload as {
        buildingId: string;
        logs: string;
        timestamp: number;
      };
      store.addBuildingLogs(buildingId, logs);
      break;
    }

    case 'pm2_logs_chunk': {
      const { buildingId, chunk } = message.payload as {
        buildingId: string;
        chunk: string;
        timestamp: number;
        isError?: boolean;
      };
      store.appendStreamingLogChunk(buildingId, chunk);
      break;
    }

    case 'pm2_logs_streaming': {
      const { buildingId, streaming } = message.payload as {
        buildingId: string;
        streaming: boolean;
      };
      store.setStreamingStatus(buildingId, streaming);
      break;
    }

    // ========================================================================
    // Docker Log Streaming Messages
    // ========================================================================

    case 'docker_logs_chunk': {
      const { buildingId, chunk } = message.payload as {
        buildingId: string;
        chunk: string;
        timestamp: number;
        isError?: boolean;
        service?: string;
      };
      store.appendStreamingLogChunk(buildingId, chunk);
      break;
    }

    case 'docker_logs_streaming': {
      const { buildingId, streaming } = message.payload as {
        buildingId: string;
        streaming: boolean;
      };
      store.setStreamingStatus(buildingId, streaming);
      break;
    }

    case 'docker_containers_list': {
      const { containers, composeProjects } = message.payload as {
        containers: import('../../shared/types').ExistingDockerContainer[];
        composeProjects: import('../../shared/types').ExistingComposeProject[];
      };
      console.log(`[WebSocket] Received ${containers.length} containers, ${composeProjects.length} compose projects`);
      store.setDockerContainersList(containers, composeProjects);
      break;
    }

    // ========================================================================
    // Boss Building Messages
    // ========================================================================

    case 'boss_building_logs_chunk': {
      const { bossBuildingId, subordinateBuildingId, subordinateBuildingName, chunk, isError } = message.payload as {
        bossBuildingId: string;
        subordinateBuildingId: string;
        subordinateBuildingName: string;
        chunk: string;
        timestamp: number;
        isError?: boolean;
      };
      store.appendBossStreamingLogChunk(bossBuildingId, subordinateBuildingId, subordinateBuildingName, chunk, isError);
      break;
    }

    case 'boss_building_subordinates_updated': {
      const { bossBuildingId, subordinateBuildingIds } = message.payload as {
        bossBuildingId: string;
        subordinateBuildingIds: string[];
      };
      // Update the building's subordinateBuildingIds
      store.updateBuilding(bossBuildingId, { subordinateBuildingIds });
      break;
    }

    case 'permission_request': {
      const request = message.payload as import('../../shared/types').PermissionRequest;
      store.addPermissionRequest(request);
      break;
    }

    case 'permission_resolved': {
      const { requestId, approved } = message.payload as {
        requestId: string;
        approved: boolean;
      };
      store.resolvePermissionRequest(requestId, approved);
      break;
    }

    // ========================================================================
    // Boss Agent Messages
    // ========================================================================

    case 'delegation_decision': {
      const decision = message.payload as DelegationDecision;
      store.handleDelegationDecision(decision);
      // Show toast for the delegation
      if (decision.status === 'sent') {
        cb.onToast?.('info', 'Task Delegated', `Delegated to ${decision.selectedAgentName}: ${decision.reasoning.slice(0, 80)}...`);

        // Trigger delegation animation (paper flying from boss to subordinate)
        if (decision.bossId && decision.selectedAgentId) {
          cb.onDelegation?.(decision.bossId, decision.selectedAgentId);
        }

        // NOTE: Auto-forward is now handled by the backend to prevent duplicate commands
        // when multiple clients are connected
      }
      break;
    }

    case 'boss_subordinates_updated': {
      const { bossId, subordinateIds } = message.payload as {
        bossId: string;
        subordinateIds: string[];
      };
      store.updateBossSubordinates(bossId, subordinateIds);
      break;
    }

    case 'delegation_history': {
      const { bossId, decisions } = message.payload as {
        bossId: string;
        decisions: DelegationDecision[];
      };
      store.setDelegationHistory(bossId, decisions);
      break;
    }

    case 'boss_spawned_agent': {
      // Boss spawned a subordinate agent - do NOT auto-select, walk to boss position
      const { agent, bossPosition } = message.payload as {
        agent: Agent;
        bossId: string;
        bossPosition: { x: number; y: number; z: number };
      };
      console.log('[WebSocket] Boss spawned agent:', agent.name, '- walking to boss at', bossPosition);

      // Add agent without selecting it
      store.addAgent(agent);
      cb.onAgentCreated?.(agent);

      // Issue move command to walk toward boss position
      sendMessage({
        type: 'move_agent',
        payload: {
          agentId: agent.id,
          position: bossPosition,
        },
      });

      cb.onToast?.('success', 'Agent Deployed', `${agent.name} spawned by boss, walking to position`);
      break;
    }

    case 'agent_task_started': {
      const { bossId, subordinateId, subordinateName, taskDescription } = message.payload as {
        bossId: string;
        subordinateId: string;
        subordinateName: string;
        taskDescription: string;
      };
      console.log(`[WebSocket] Agent ${subordinateName} started task for boss ${bossId}: ${taskDescription.slice(0, 50)}...`);
      store.handleAgentTaskStarted(bossId, subordinateId, subordinateName, taskDescription);
      break;
    }

    case 'agent_task_output': {
      const { bossId, subordinateId, output } = message.payload as {
        bossId: string;
        subordinateId: string;
        output: string;
      };
      store.handleAgentTaskOutput(bossId, subordinateId, output);
      break;
    }

    case 'agent_task_completed': {
      const { bossId, subordinateId, success } = message.payload as {
        bossId: string;
        subordinateId: string;
        success: boolean;
      };
      console.log(`[WebSocket] Agent task completed for boss ${bossId}, subordinate ${subordinateId}, success: ${success}`);
      store.handleAgentTaskCompleted(bossId, subordinateId, success);
      break;
    }

    // ========================================================================
    // Skill Messages
    // ========================================================================

    case 'skills_update': {
      const skillsArray = message.payload as import('../../shared/types').Skill[];
      store.setSkillsFromServer(skillsArray);
      break;
    }

    case 'skill_created': {
      const skill = message.payload as import('../../shared/types').Skill;
      store.addSkillFromServer(skill);
      console.log(`[WebSocket] Skill created: ${skill.name}`);
      break;
    }

    case 'skill_updated': {
      const skill = message.payload as import('../../shared/types').Skill;
      store.updateSkillFromServer(skill);
      console.log(`[WebSocket] Skill updated: ${skill.name}`);
      break;
    }

    case 'skill_deleted': {
      const { id } = message.payload as { id: string };
      store.removeSkillFromServer(id);
      console.log(`[WebSocket] Skill deleted: ${id}`);
      break;
    }

    case 'agent_skills': {
      // Response to request_agent_skills - currently just logged, could be used for validation
      const { agentId, skills } = message.payload as {
        agentId: string;
        skills: import('../../shared/types').Skill[];
      };
      console.log(`[WebSocket] Agent ${agentId} has ${skills.length} skills`);
      break;
    }

    // ========================================================================
    // Custom Agent Class Messages
    // ========================================================================

    case 'custom_agent_classes_update': {
      const classesArray = message.payload as import('../../shared/types').CustomAgentClass[];
      store.setCustomAgentClassesFromServer(classesArray);
      console.log(`[WebSocket] Received ${classesArray.length} custom agent classes`);
      // Notify scene to update custom classes for model lookups
      const classesMap = new Map<string, CustomAgentClass>();
      for (const c of classesArray) {
        classesMap.set(c.id, c);
      }
      cb.onCustomClassesSync?.(classesMap);
      break;
    }

    case 'custom_agent_class_created': {
      const customClass = message.payload as import('../../shared/types').CustomAgentClass;
      store.addCustomAgentClassFromServer(customClass);
      console.log(`[WebSocket] Custom agent class created: ${customClass.name}`);
      // Update scene with new custom classes
      cb.onCustomClassesSync?.(store.getState().customAgentClasses);
      break;
    }

    case 'custom_agent_class_updated': {
      const customClass = message.payload as import('../../shared/types').CustomAgentClass;
      store.updateCustomAgentClassFromServer(customClass);
      console.log(`[WebSocket] Custom agent class updated: ${customClass.name}`);
      // Update scene with updated custom classes
      cb.onCustomClassesSync?.(store.getState().customAgentClasses);
      break;
    }

    case 'custom_agent_class_deleted': {
      const { id } = message.payload as { id: string };
      store.removeCustomAgentClassFromServer(id);
      console.log(`[WebSocket] Custom agent class deleted: ${id}`);
      // Update scene with remaining custom classes
      cb.onCustomClassesSync?.(store.getState().customAgentClasses);
      break;
    }

    // ========================================================================
    // Global Usage Messages
    // ========================================================================

    case 'global_usage': {
      const usage = message.payload as import('../../shared/types').GlobalUsageStats | null;
      console.log(`[WebSocket] Global usage update:`, usage);
      store.setGlobalUsage(usage);
      break;
    }

    // ========================================================================
    // Agent Notification Messages
    // ========================================================================

    case 'agent_notification': {
      const notification = message.payload as import('../../shared/types').AgentNotification;
      console.log(`[WebSocket] Agent notification from ${notification.agentName}: ${notification.title}`);
      cb.onAgentNotification?.(notification);
      break;
    }

    // ========================================================================
    // Exec Task Messages (Streaming Command Execution)
    // ========================================================================

    case 'exec_task_started': {
      const { taskId, agentId, agentName, command, cwd } = message.payload as {
        taskId: string;
        agentId: string;
        agentName: string;
        command: string;
        cwd: string;
      };
      console.log(`[WebSocket] Exec task started: ${taskId} for agent ${agentName}: ${command.slice(0, 50)}...`);
      store.handleExecTaskStarted(taskId, agentId, agentName, command, cwd);
      break;
    }

    case 'exec_task_output': {
      const { taskId, agentId, output, isError } = message.payload as {
        taskId: string;
        agentId: string;
        output: string;
        isError?: boolean;
      };
      store.handleExecTaskOutput(taskId, agentId, output, isError);
      break;
    }

    case 'exec_task_completed': {
      const { taskId, agentId, exitCode, success } = message.payload as {
        taskId: string;
        agentId: string;
        exitCode: number | null;
        success: boolean;
      };
      console.log(`[WebSocket] Exec task completed: ${taskId} for agent ${agentId}, success: ${success}`);
      store.handleExecTaskCompleted(taskId, agentId, exitCode, success);
      break;
    }

    // ========================================================================
    // Subagent Messages (Claude Code Task tool)
    // ========================================================================

    case 'subagent_started': {
      const subagent = message.payload as Subagent;
      console.log(`[WebSocket] Subagent started: ${subagent.name} (${subagent.id}) for agent ${subagent.parentAgentId}`);
      store.addSubagent(subagent);
      cb.onSubagentStarted?.(subagent);
      // Also add an output line to the parent agent's terminal
      store.addOutput(subagent.parentAgentId, {
        text: `🔀 Spawned subagent: ${subagent.name} (${subagent.subagentType})`,
        isStreaming: false,
        timestamp: subagent.startedAt,
        subagentName: subagent.name,
      });
      break;
    }

    case 'subagent_output': {
      const { subagentId, parentAgentId, text, isStreaming, timestamp } = message.payload as {
        subagentId: string;
        parentAgentId: string;
        text: string;
        isStreaming: boolean;
        timestamp: number;
      };
      // Resolve subagent name for badge display
      const subForOutput = store.getSubagent(subagentId) || store.getSubagentByToolUseId(subagentId);
      const subOutputName = subForOutput?.name || subagentId;
      // Route subagent output to the parent agent's terminal with a prefix
      store.addOutput(parentAgentId, {
        text: `[${subagentId}] ${text}`,
        isStreaming,
        timestamp,
        subagentName: subOutputName,
      });
      break;
    }

    case 'subagent_completed': {
      const { subagentId, parentAgentId, success, resultPreview, subagentName: completedSubName } = message.payload as {
        subagentId: string;
        parentAgentId: string;
        success: boolean;
        resultPreview?: string;
        subagentName?: string;
      };
      console.log(`[WebSocket] Subagent completed: ${subagentId} for agent ${parentAgentId}, success: ${success}`);
      store.completeSubagent(subagentId, parentAgentId, success);
      cb.onSubagentCompleted?.(subagentId);
      // Resolve name: prefer server-provided name, then store lookup, then ID
      const sub = store.getSubagent(subagentId) || store.getSubagentByToolUseId(subagentId);
      const subName = completedSubName || sub?.name || subagentId;
      const statusEmoji = success ? '✅' : '❌';
      const preview = resultPreview ? `: ${resultPreview.slice(0, 100)}` : '';
      store.addOutput(parentAgentId, {
        text: `${statusEmoji} Subagent ${subName} ${success ? 'completed' : 'failed'}${preview}`,
        isStreaming: false,
        timestamp: Date.now(),
        subagentName: subName,
      });
      break;
    }

    // ========================================================================
    // Secrets Messages
    // ========================================================================

    case 'secrets_update': {
      const secretsArray = message.payload as import('../../shared/types').Secret[];
      store.setSecretsFromServer(secretsArray);
      console.log(`[WebSocket] Received ${secretsArray.length} secrets`);
      break;
    }

    case 'secret_created': {
      const secret = message.payload as import('../../shared/types').Secret;
      store.addSecretFromServer(secret);
      console.log(`[WebSocket] Secret created: ${secret.name}`);
      break;
    }

    case 'secret_updated': {
      const secret = message.payload as import('../../shared/types').Secret;
      store.updateSecretFromServer(secret);
      console.log(`[WebSocket] Secret updated: ${secret.name}`);
      break;
    }

    case 'secret_deleted': {
      const { id } = message.payload as { id: string };
      store.removeSecretFromServer(id);
      console.log(`[WebSocket] Secret deleted: ${id}`);
      break;
    }

    // ========================================================================
    // Database Messages
    // ========================================================================

    case 'database_connection_result': {
      const { buildingId, connectionId, success, error, serverVersion } = message.payload as {
        buildingId: string;
        connectionId: string;
        success: boolean;
        error?: string;
        serverVersion?: string;
      };
      store.setConnectionStatus(buildingId, connectionId, { connected: success, error, serverVersion });
      console.log(`[WebSocket] Database connection ${success ? 'succeeded' : 'failed'}: ${connectionId}`);
      break;
    }

    case 'databases_list': {
      const { buildingId, connectionId, databases } = message.payload as {
        buildingId: string;
        connectionId: string;
        databases: string[];
      };
      store.setDatabases(buildingId, connectionId, databases);
      console.log(`[WebSocket] Received ${databases.length} databases for ${connectionId}`);
      break;
    }

    case 'tables_list': {
      const { buildingId, connectionId, database, tables } = message.payload as {
        buildingId: string;
        connectionId: string;
        database: string;
        tables: import('../../shared/types').TableInfo[];
      };
      store.setTables(buildingId, connectionId, database, tables);
      console.log(`[WebSocket] Received ${tables.length} tables for ${database}`);
      break;
    }

    case 'table_schema': {
      const { buildingId, connectionId, database, table, columns, indexes, foreignKeys } = message.payload as {
        buildingId: string;
        connectionId: string;
        database: string;
        table: string;
        columns: import('../../shared/types').TableColumn[];
        indexes?: import('../../shared/types').TableIndex[];
        foreignKeys?: import('../../shared/types').ForeignKey[];
      };
      store.setTableSchema(buildingId, connectionId, database, table, { columns, indexes: indexes || [], foreignKeys: foreignKeys || [] });
      console.log(`[WebSocket] Received schema for ${table}`);
      break;
    }

    case 'query_result': {
      const { buildingId, result } = message.payload as {
        buildingId: string;
        result: import('../../shared/types').QueryResult;
      };
      store.setQueryResult(buildingId, result);
      console.log(`[WebSocket] Query ${result.status}: ${result.rowCount ?? result.affectedRows ?? 0} rows in ${result.duration}ms`);
      break;
    }

    case 'query_history_update': {
      const { buildingId, history } = message.payload as {
        buildingId: string;
        history: import('../../shared/types').QueryHistoryEntry[];
      };
      store.setQueryHistory(buildingId, history);
      console.log(`[WebSocket] Received ${history.length} query history entries for ${buildingId}`);
      break;
    }

  }

  perf.end(`ws:${message.type}`);
}
