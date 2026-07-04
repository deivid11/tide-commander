/**
 * Server message router – maps every ServerMessage.type to its handler logic.
 */

import type { Agent, ServerMessage, DelegationDecision, CustomAgentClass, Subagent } from '../../shared/types';
import { store } from '../store';
import { noteServerTimestamp, serverNow } from '../store/outputs';
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
      const pendingAreaId = (window as Window & {
        __spawnModalAreaContext?: { areaId: string } | null;
      }).__spawnModalAreaContext?.areaId;
      if (pendingAreaId) {
        store.assignAgentToArea(newAgent.id, pendingAreaId);
        (window as Window & {
          __spawnModalAreaContext?: { areaId: string } | null;
        }).__spawnModalAreaContext = null;
      }
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
      if (statusChanged) {
        debugLog.info(`Status change for ${updatedAgent.name}: ${previousAgent?.status} → ${updatedAgent.status}`, {
          agentId: updatedAgent.id,
        }, 'ws:agent_updated');
      }

      // When agent transitions from working to idle, refresh conversation history
      // to catch up on events missed during backend disconnects
      if (statusChanged && previousAgent?.status === 'working' && updatedAgent.status === 'idle') {
        store.triggerHistoryRefresh(updatedAgent.id);
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
      noteServerTimestamp(activity.timestamp);
      store.addActivity(activity);
      break;
    }

    case 'server_time': {
      // First message on connection — seeds the server↔client clock offset so
      // serverNow() is accurate before any output/activity arrives.
      const { timestamp } = message.payload as { timestamp: number };
      noteServerTimestamp(timestamp);
      break;
    }

    case 'git_status_update': {
      store.applyGitStatusUpdate(message.payload as import('../../shared/types').GitWatchedDirStatus);
      break;
    }

    case 'event': {
      // Claude event - trigger visual effects and track tools
      const event = message.payload as {
        agentId: string;
        type: string;
        toolName?: string;
        toolInput?: Record<string, unknown>;
        toolOutput?: string;
        errorMessage?: string;
        // Present on subagent-internal tools: the tool_use id of the Task/Agent
        // that spawned the subagent. Absent on the parent agent's own tools.
        parentToolUseId?: string;
        uuid?: string;
      };
      debugLog.debug(`Event: ${event.type}`, {
        agentId: event.agentId,
        toolName: event.toolName,
      }, 'ws:event');
      if (event.type === 'error' && event.errorMessage) {
        store.addOutput(event.agentId, {
          text: event.errorMessage,
          isStreaming: false,
          // Server time domain: a device-clock ahead of the server would sort
          // this row after later server-stamped outputs (visible on mobile).
          timestamp: serverNow(),
          isError: true,
        });
      } else if (event.type === 'tool_start' && event.toolName) {
        cb.onToolUse?.(event.agentId, event.toolName, event.toolInput);
        // Keep agent.currentTool fresh locally — the server no longer
        // broadcasts a full agent_updated for tool churn (quiet updates).
        store.setAgentCurrentTool(event.agentId, event.toolName);
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
        // Subagent internal tool-use carries a parentToolUseId (the id of the
        // Task/Agent tool that spawned the subagent). The server suppresses the
        // terminal `output` message for these (stdout pipeline skips them when
        // parentToolUseId is set), so they never reach the `output` case and are
        // invisible in the parent terminal. Render them here as real tool cards,
        // attributed to the subagent. Parent-agent tools have NO parentToolUseId
        // and already render via the `output` message, so this guard guarantees
        // the non-wrapped case is never double-rendered.
        if (event.parentToolUseId && event.toolName !== 'Task' && event.toolName !== 'Agent') {
          const sub = store.getSubagentByToolUseId(event.parentToolUseId);
          store.addOutput(event.agentId, {
            text: `Using tool: ${event.toolName}`,
            isStreaming: false,
            timestamp: serverNow(),
            toolName: event.toolName,
            toolInput: event.toolInput,
            uuid: event.uuid,
            subagentName: sub?.name,
          });
        }
      } else if (event.type === 'tool_result') {
        // Mirror of the server-side behavior: any tool_result clears the badge.
        store.setAgentCurrentTool(event.agentId, undefined);
        if (event.parentToolUseId && event.toolName === 'Bash') {
          // Mirror the parent-agent behavior (only Bash results get a terminal
          // card) for a subagent's Bash commands so their output is visible too.
          // Guarded on parentToolUseId — top-level Bash results already arrive via
          // the `output` message and must not be duplicated here.
          const sub = store.getSubagentByToolUseId(event.parentToolUseId);
          store.addOutput(event.agentId, {
            text: `Bash output:\n${event.toolOutput || '(no output)'}`,
            isStreaming: false,
            timestamp: serverNow(),
            toolOutput: event.toolOutput,
            uuid: event.uuid,
            subagentName: sub?.name,
          });
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
      noteServerTimestamp(output.timestamp);
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

    case 'context_update': {
      const { agentId, contextUsed, contextLimit } = message.payload as {
        agentId: string;
        contextUsed: number;
        contextLimit: number;
      };
      store.updateAgentContext(agentId, contextUsed, contextLimit);
      break;
    }

    case 'compacting_status': {
      const { agentId, active } = message.payload as { agentId: string; active: boolean };
      store.setAgentCompacting(agentId, active);
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
      // An agent's session file was updated - refresh its history
      const { agentId } = message.payload as { agentId: string };
      // Reload the tool history to get the latest updates from the detached process
      store.loadToolHistory();
      // Trigger a conversation history refresh so the terminal catches up
      // on any events that were missed (e.g. during a backend disconnect)
      store.triggerHistoryRefresh(agentId);
      // Also update the agent to trigger a UI refresh
      const agent = store.getState().agents.get(agentId);
      if (agent) {
        store.updateAgent({ ...agent });
      }
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

    case 'agent_prompt_request': {
      const prompt = message.payload as import('../../shared/types').AgentPrompt;
      store.addAgentPrompt(prompt);
      break;
    }

    case 'agent_prompt_resolved': {
      const { requestId, approved } = message.payload as { requestId: string; approved: boolean };
      store.resolveAgentPromptLocal(requestId, approved);
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

    case 'session_history': {
      const { agentId, entries } = message.payload as {
        agentId: string;
        entries: import('../../shared/types').SessionHistoryEntry[];
      };
      store.setSessionHistory(agentId, entries);
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
      const { bossId, subordinateId, output, isStreaming, timestamp, subagentName, toolName, toolInput, toolOutput } = message.payload as {
        bossId: string;
        subordinateId: string;
        output: string;
        isStreaming?: boolean;
        timestamp?: number;
        subagentName?: string;
        toolName?: string;
        toolInput?: Record<string, unknown>;
        toolOutput?: string;
      };
      store.handleAgentTaskOutput(bossId, subordinateId, {
        text: output,
        isStreaming: isStreaming || false,
        timestamp: timestamp || serverNow(),
        subagentName,
        toolName,
        toolInput,
        toolOutput,
      });
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
    // Agent Notification Messages
    // ========================================================================

    case 'agent_notification': {
      const notification = message.payload as import('../../shared/types').AgentNotification;
      console.log(`[WebSocket] Agent notification from ${notification.agentName}: ${notification.title}`);
      cb.onAgentNotification?.(notification);
      break;
    }

    case 'whatsapp_message': {
      const wa = message.payload;
      cb.onWhatsAppMessage?.(wa);
      break;
    }

    case 'focus_agent': {
      const { agentId, openTerminal } = message.payload as {
        agentId: string;
        openTerminal: boolean;
      };
      const agent = store.getState().agents.get(agentId);
      if (!agent) {
        console.warn(`[WebSocket] focus_agent ignored - agent not found: ${agentId}`);
        break;
      }
      store.selectAgent(agentId);
      if (openTerminal) {
        store.setTerminalOpen(true);
      }
      // Best-effort browser-side activation to complement KWin focus calls.
      const focusDelays = [0, 80, 220, 500, 1000];
      for (const delay of focusDelays) {
        window.setTimeout(() => {
          window.focus();
        }, delay);
      }
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
    // Test Run Messages (Streaming Test Execution)
    // ========================================================================

    case 'test_run_started': {
      const { runId, runnerType, moduleRoot, command, label, targetPath, agentId } = message.payload as {
        runId: string;
        runnerType: import('../../shared/types').TestRunnerType;
        moduleRoot: string;
        command: string;
        label: string;
        targetPath: string;
        agentId?: string;
      };
      store.handleTestRunStarted({ runId, runnerType, moduleRoot, command, label, targetPath, agentId });
      break;
    }

    case 'test_run_output': {
      const { runId, output, isError, agentId } = message.payload as {
        runId: string;
        output: string;
        isError?: boolean;
        agentId?: string;
      };
      store.handleTestRunOutput(runId, output, isError, agentId);
      break;
    }

    case 'test_run_progress': {
      const { runId, result } = message.payload as {
        runId: string;
        result: import('../../shared/types').TestRunResult;
      };
      store.handleTestRunProgress(runId, result);
      break;
    }

    case 'test_run_completed': {
      const { runId, status, exitCode, result, error, agentId } = message.payload as {
        runId: string;
        status: import('../../shared/types').TestRunStatus;
        exitCode: number | null;
        result: import('../../shared/types').TestRunResult;
        error?: string;
        agentId?: string;
      };
      console.log(`[WebSocket] Test run completed: ${runId}, status: ${status}`);
      store.handleTestRunCompleted(runId, status, exitCode, result, error, agentId);
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
      // Activity is shown inline in the Task tool-use line via the subagent activity panel
      break;
    }

    case 'subagent_output': {
      const { subagentId, parentAgentId, text, timestamp } = message.payload as {
        subagentId: string;
        parentAgentId: string;
        text: string;
        isStreaming: boolean;
        timestamp: number;
      };

      // Parse tool activity from text (format: "ToolName: description" or "Using ToolName")
      const colonIdx = text.indexOf(':');
      if (colonIdx > 0) {
        const toolName = text.slice(0, colonIdx).trim();
        const description = text.slice(colonIdx + 1).trim();
        store.addSubagentActivity(subagentId, parentAgentId, {
          toolName,
          description,
          timestamp,
        });
      } else if (text.startsWith('Using ')) {
        store.addSubagentActivity(subagentId, parentAgentId, {
          toolName: text.slice(6).trim(),
          description: '',
          timestamp,
        });
      }
      // Activity is shown inline in the subagent activity panel - no separate output line needed
      break;
    }

    case 'subagent_completed': {
      const { subagentId, parentAgentId, success, resultPreview, subagentName: completedSubName, durationMs, tokensUsed, toolUseCount } = message.payload as {
        subagentId: string;
        parentAgentId: string;
        success: boolean;
        resultPreview?: string;
        subagentName?: string;
        durationMs?: number;
        tokensUsed?: number;
        toolUseCount?: number;
      };
      console.log(`[WebSocket] Subagent completed: ${subagentId} for agent ${parentAgentId}, success: ${success}`);

      // Update stats before completing (so the subagent has stats when rendered)
      if (durationMs || tokensUsed || toolUseCount) {
        store.updateSubagentStats(subagentId, parentAgentId, {
          durationMs: durationMs || 0,
          tokensUsed: tokensUsed || 0,
          toolUseCount: toolUseCount || 0,
        });
      }

      store.completeSubagent(subagentId, parentAgentId, success);
      cb.onSubagentCompleted?.(subagentId);
      // Resolve name: prefer server-provided name, then store lookup, then ID
      const sub = store.getSubagent(subagentId) || store.getSubagentByToolUseId(subagentId);
      const subName = completedSubName || sub?.name || subagentId;
      const statusEmoji = success ? '✅' : '❌';
      const statsStr = durationMs
        ? ` (${(durationMs / 1000).toFixed(0)}s · ${((tokensUsed || 0) / 1000).toFixed(1)}K tokens · ${toolUseCount || 0} tools)`
        : '';
      store.addOutput(parentAgentId, {
        text: `${statusEmoji} Subagent ${subName} ${success ? 'completed' : 'failed'}${statsStr}`,
        isStreaming: false,
        timestamp: serverNow(),
        subagentName: subName,
        toolOutput: resultPreview,
      });
      break;
    }

    case 'subagent_stream': {
      const { toolUseId, parentAgentId: streamParentId, entries } = message.payload as {
        toolUseId: string;
        parentAgentId: string;
        entries: import('../../shared/types').SubagentStreamEntry[];
      };
      store.addSubagentStreamEntries(toolUseId, streamParentId, entries);
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
      const { buildingId, connectionId, requestId, success, error, serverVersion } = message.payload as {
        buildingId: string;
        connectionId: string;
        requestId?: string;
        success: boolean;
        error?: string;
        serverVersion?: string;
      };
      // Transient (unsaved) connection tests carry a requestId and no buildingId.
      // Hand them off via a window event so the modal can resolve its pending test.
      if (requestId) {
        window.dispatchEvent(new CustomEvent('tide:db-test-result', {
          detail: { requestId, connectionId, success, error, serverVersion },
        }));
      } else {
        store.setConnectionStatus(buildingId, connectionId, { connected: success, error, serverVersion });
      }
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

    case 'silent_query_result': {
      const { buildingId, query, requestId, success, affectedRows, error } = message.payload as {
        buildingId: string;
        query: string;
        requestId?: string;
        success: boolean;
        affectedRows?: number;
        error?: string;
      };
      store.setSilentQueryResult(buildingId, { query, requestId, success, affectedRows, error });
      console.log(`[WebSocket] Silent query ${success ? 'succeeded' : 'failed'}: ${affectedRows ?? 0} affected rows`);
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
