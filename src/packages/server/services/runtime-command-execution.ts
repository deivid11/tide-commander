import type { AgentProvider } from '../../shared/types.js';
import type { CustomAgentDefinition, RuntimeRunner } from '../runtime/index.js';
import * as agentService from './agent-service.js';
import {
  clearPendingSilentContextRefresh,
  clearStdinWatchdog,
  hasPendingSilentContextRefresh,
  markPendingSilentContextRefresh,
  startStdinWatchdog,
} from './runtime-watchdog.js';

export interface CustomAgentConfig {
  name: string;
  definition: CustomAgentDefinition;
}

interface RuntimeCommandExecutionDeps {
  log: {
    log: (message: string) => void;
    warn: (message: string) => void;
  };
  getRunner: (provider: AgentProvider) => RuntimeRunner | null;
  getRunnerForAgent: (agentId: string) => RuntimeRunner | null;
  notifyCommandStarted: (agentId: string, command: string) => void;
  emitOutput: (agentId: string, text: string, isStreaming?: boolean, subagentName?: string, uuid?: string) => void;
  killDetachedProviderProcessInCwd: (provider: AgentProvider, cwd: string) => Promise<boolean>;
}

export interface RuntimeCommandExecutionApi {
  executeCommand: (
    agentId: string,
    command: string,
    systemPrompt?: string,
    forceNewSession?: boolean,
    customAgent?: CustomAgentConfig,
    silent?: boolean,
    skipNotify?: boolean
  ) => Promise<void>;
  sendCommand: (
    agentId: string,
    command: string,
    systemPrompt?: string,
    forceNewSession?: boolean,
    customAgent?: CustomAgentConfig
  ) => Promise<void>;
  sendSilentCommand: (agentId: string, command: string) => Promise<void>;
  stopAgent: (agentId: string) => Promise<void>;
}

export function createRuntimeCommandExecution(deps: RuntimeCommandExecutionDeps): RuntimeCommandExecutionApi {
  const {
    log,
    getRunner,
    getRunnerForAgent,
    notifyCommandStarted,
    emitOutput,
    killDetachedProviderProcessInCwd,
  } = deps;

  async function executeCommand(
    agentId: string,
    command: string,
    systemPrompt?: string,
    forceNewSession?: boolean,
    customAgent?: CustomAgentConfig,
    silent?: boolean,
    skipNotify?: boolean
  ): Promise<void> {
    const agent = agentService.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    const runner = getRunner(agent.provider ?? 'claude');
    if (!runner) {
      throw new Error(`Runtime provider not initialized: ${agent.provider}`);
    }

    if (!silent && !skipNotify) {
      notifyCommandStarted(agentId, command);
    }

    const isSystemMessage = command.startsWith('[System:');
    const updateData: Partial<Parameters<typeof agentService.updateAgent>[1]> = {};

    if (!silent) {
      updateData.status = 'working' as const;
      updateData.currentTask = command.substring(0, 100);
      updateData.isDetached = false;
    }

    if (!isSystemMessage) {
      updateData.lastAssignedTask = command;
      updateData.lastAssignedTaskTime = Date.now();
      updateData.taskLabel = undefined; // Clear for agent to regenerate via skill
    }

    if (Object.keys(updateData).length > 0) {
      agentService.updateAgent(agentId, updateData);
    }

    let resolvedCustomAgent = customAgent;
    if (!resolvedCustomAgent && agent.class !== 'boss') {
      try {
        const { buildCustomAgentConfig } = await import('../websocket/handlers/command-handler.js');
        resolvedCustomAgent = buildCustomAgentConfig(agentId, agent.class);
      } catch (err) {
        log.warn(`[executeCommand] Failed to build fallback customAgentConfig for ${agentId}: ${String(err)}`);
      }
    }

    await runner.run({
      agentId,
      prompt: command,
      workingDir: agent.cwd,
      sessionId: agent.sessionId,
      model: agent.provider === 'claude'
        ? agentService.sanitizeModelForProvider(agent.provider, agent.model)
        : agent.provider === 'opencode'
          ? agentService.sanitizeOpencodeModel(agent.opencodeModel)
          : agentService.sanitizeCodexModel(agent.codexModel),
      effort: agent.provider === 'claude' ? agent.effort : undefined,
      useChrome: agent.useChrome,
      permissionMode: agent.permissionMode,
      codexConfig: agent.codexConfig,
      systemPrompt,
      customAgent: resolvedCustomAgent,
      forceNewSession,
    });
  }

  async function sendCommand(
    agentId: string,
    command: string,
    systemPrompt?: string,
    forceNewSession?: boolean,
    customAgent?: CustomAgentConfig
  ): Promise<void> {
    const agent = agentService.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    const runner = getRunner(agent.provider ?? 'claude');
    if (!runner) {
      throw new Error(`Runtime provider not initialized: ${agent.provider}`);
    }

    const processRunning = runner.isRunning(agentId);

    // For backends that close stdin after the initial prompt (codex, opencode),
    // a new user prompt arriving while the process is alive should INTERRUPT
    // the current work and RESTART the session with the new prompt — not wait
    // for the current turn to finish and then deliver the queued message via
    // session-resume (which is the default queue-based behavior).
    //
    // Why no turnState gate: stdin is closed, so there's literally no way to
    // deliver a follow-up prompt without respawning. 'waiting_for_input' is
    // also not a reliable "turn is over" signal across these backends —
    // opencode's NDJSON emits `step_finish` per LLM step (see
    // src/packages/server/opencode/json-event-parser.ts:197-207), so during a
    // single conversational turn the runner's turnState oscillates
    // processing → waiting_for_input → processing → … between steps. Gating
    // on 'waiting_for_input' would strand the new prompt on those mid-turn
    // windows: sendMessage would queue it, but the process isn't exiting
    // (it's starting the next step), so the queue-respawn path never fires.
    // Codex happens to emit `step_complete` once per turn (via
    // src/packages/server/codex/json-event-parser.ts:300-301), so the old
    // gate looked fine there — but the correct invariant for ALL stdin-closed
    // backends is: process-alive + new-prompt ⇒ interrupt + respawn.
    //
    // SIGINT on a process already at true turn-end (about to exit cleanly on
    // its own) is harmless — process-lifecycle's stop() just short-circuits
    // the natural exit, and the fresh spawn still resumes the same sessionId.
    //
    // Safe for tmux mode: runner.stop() routes through
    // src/packages/server/claude/runner/process-lifecycle.ts:281-284 which
    // calls killTmuxSession — this destroys only the agent's detached tmux
    // session (created by spawnInTmux), NOT the user's own pane/window. The
    // subsequent executeCommand spawns a fresh tmux session for the new turn.
    //
    // clearQueue=true is intentional: user is replacing whatever was pending
    // with this new command, so any queued messages from prior mid-turn sends
    // are stale and must be dropped.
    const backendClosesStdin = runner.closesStdinAfterPrompt?.() === true;
    if (processRunning && backendClosesStdin && !forceNewSession) {
      const turnState = runner.getTurnState?.(agentId);
      log.log(`[sendCommand] Agent ${agentId} (${agent.provider}): in-flight prompt (turnState=${turnState ?? 'unknown'}) — interrupting current work and restarting session with new prompt`);
      emitOutput(
        agentId,
        '🛑 [System] Interrupting current work to process new prompt…',
        false,
        undefined,
        'system-interrupt-restart'
      );
      await runner.stop(agentId, true);
      agentService.updateAgent(agentId, { taskCount: (agent.taskCount || 0) + 1 });
      await executeCommand(agentId, command, systemPrompt, forceNewSession, customAgent);
      return;
    }

    if (processRunning && !forceNewSession) {
      if (runner.supportsStdin()) {
        const turnState = runner.getTurnState?.(agentId) || 'unknown';
        log.log(`[sendCommand] Agent ${agentId}: Process alive, reusing via stdin (turnState=${turnState}, cmd=${command.substring(0, 60)})`);
        const sent = runner.sendMessage(agentId, command);
        if (sent) {
          notifyCommandStarted(agentId, command);
          const isSystemMessage = command.startsWith('[System:');
          const updateData: Record<string, unknown> = {
            status: 'working' as const,
            taskCount: (agent.taskCount || 0) + 1,
          };
          if (!isSystemMessage) {
            updateData.lastAssignedTask = command;
            updateData.lastAssignedTaskTime = Date.now();
            updateData.taskLabel = undefined; // Clear for agent to regenerate via skill
          }
          agentService.updateAgent(agentId, updateData);

          // Only start the stdin watchdog when the message was written directly to stdin
          // (i.e. the agent was idle/waiting_for_input on a stdin-open backend).
          // When the agent was mid-turn (turnState === 'processing'), or the backend
          // closes stdin after the initial prompt (codex/opencode), the runner queues
          // the message and delivers it via the step_complete handler or the
          // respawn-on-close path — no watchdog needed since delivery is guaranteed.
          // Starting the watchdog here would cause double-execution for stdin-closed
          // backends because the watchdog's onRespawn path and the queue-drain path
          // would both deliver the same command.
          const backendClosesStdin = runner.closesStdinAfterPrompt?.() === true;
          if (turnState !== 'processing' && !backendClosesStdin) {
            startStdinWatchdog({
              agentId,
              command,
              systemPrompt,
              customAgent,
              runner: getRunnerForAgent(agentId),
              onRespawn: async (retryAgentId, retryCommand, retrySystemPrompt, retryCustomAgent) => {
                // User was already notified via command_started when the message was first sent;
                // skip re-emitting it to prevent the duplicate message in the UI.
                await executeCommand(
                  retryAgentId,
                  retryCommand,
                  retrySystemPrompt,
                  false,
                  retryCustomAgent as CustomAgentConfig | undefined,
                  undefined,
                  true // skipNotify: command_started already broadcast on initial send
                );
              },
            });
          }

          return;
        }
        log.warn(`[sendCommand] Agent ${agentId}: stdin sendMessage returned false, falling through to respawn`);
      } else {
        log.log(`[sendCommand] Agent ${agentId} (${agent.provider}): backend does not support stdin, stopping current process to respawn with resume`);
        // Preserve queued messages — they will be drained after the new process completes its turn
        await runner.stop(agentId, false);
      }
    } else if (!processRunning) {
      log.log(`[sendCommand] Agent ${agentId}: Process not running, spawning new (sessionId=${agent.sessionId || 'none'})`);
    }

    agentService.updateAgent(agentId, { taskCount: (agent.taskCount || 0) + 1 });

    if (agent.isDetached && agent.sessionId && !forceNewSession) {
      log.log(`[sendCommand] Agent ${agentId} is detached, reattaching to existing session ${agent.sessionId}`);
      setImmediate(() => {
        emitOutput(agentId, `🔄 [System] Reattaching to existing session... (Session: ${agent.sessionId})`, false, undefined, 'system-reattach');
        emitOutput(agentId, `📋 [System] Resuming task: ${command.substring(0, 100)}${command.length > 100 ? '...' : ''}`, false, undefined, 'system-reattach');
      });
      await executeCommand(agentId, command, systemPrompt, false, customAgent);
      return;
    }

    await executeCommand(agentId, command, systemPrompt, forceNewSession, customAgent);
  }

  async function sendSilentCommand(agentId: string, command: string): Promise<void> {
    const agent = agentService.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    const runner = getRunner(agent.provider ?? 'claude');
    if (!runner) {
      throw new Error(`Runtime provider not initialized: ${agent.provider}`);
    }

    const isContextCommand = command.trim() === '/context' || command.trim() === '/cost' || command.trim() === '/compact';
    if (isContextCommand) {
      markPendingSilentContextRefresh(agentId);
    }

    if (!runner.supportsStdin()) {
      log.log(`[sendSilentCommand] Backend for ${agentId} (${agent.provider}) does not support stdin, skipping silent command: ${command}`);
      clearPendingSilentContextRefresh(agentId);
      return;
    }

    if (runner.isRunning(agentId)) {
      log.log(`[sendSilentCommand] Sending command via stdin for agent ${agentId} (command: ${command}) - status unchanged`);

      const sent = runner.sendMessage(agentId, command);
      if (sent) {
        log.log(`[sendSilentCommand] Command sent via stdin for agent ${agentId}`);
        return;
      }
    }

    log.log(`[sendSilentCommand] Spawning new process for silent command for agent ${agentId} (command: ${command}) - status unchanged`);
    await executeCommand(agentId, command, undefined, undefined, undefined, true);
  }

  async function stopAgent(agentId: string): Promise<void> {
    // Cancel any pending stdin watchdog timer to prevent it from respawning
    // the process after we've stopped it
    clearStdinWatchdog(agentId);

    const runner = getRunnerForAgent(agentId);
    if (runner) {
      await runner.stop(agentId);
    }

    const agent = agentService.getAgent(agentId);
    if (agent?.cwd && agent.isDetached) {
      const provider = agent.provider ?? 'claude';
      const killed = await killDetachedProviderProcessInCwd(provider, agent.cwd);
      if (killed) {
        log.log(`Killed detached ${provider} process for agent ${agentId}`);
      }
    }

    if (hasPendingSilentContextRefresh(agentId)) {
      clearPendingSilentContextRefresh(agentId);
    }

    agentService.updateAgent(agentId, {
      status: 'idle',
      currentTask: undefined,
      currentTool: undefined,
      isDetached: false,
    });
  }

  return {
    executeCommand,
    sendCommand,
    sendSilentCommand,
    stopAgent,
  };
}
