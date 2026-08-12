import type { AgentProvider } from '../../shared/types.js';
import { providerDisplayName } from '../../shared/types.js';
import type { CustomAgentDefinition, RuntimeRunner } from '../runtime/index.js';
import * as agentService from './agent-service.js';
import { withAgentContext } from '../utils/log-context.js';
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

export interface SendCommandOptions {
  /**
   * Deliver this prompt immediately instead of queueing it behind the
   * in-flight turn. Stdin-closed backends (Grok / Codex exec / OpenCode run)
   * are stopped and respawned with the prompt; persistent-stream backends
   * (Codex app-server / OpenCode serve) get their turn interrupted in place
   * via runner.interruptTurn, keeping the thread/session alive.
   */
  forceInterrupt?: boolean;
}

interface RuntimeCommandExecutionDeps {
  log: {
    log: (message: string) => void;
    warn: (message: string) => void;
  };
  getRunner: (provider: AgentProvider) => RuntimeRunner | null;
  getRunnerForAgent: (agentId: string) => RuntimeRunner | null;
  notifyCommandStarted: (agentId: string, command: string, opts?: { queued?: boolean }) => void;
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
    customAgent?: CustomAgentConfig,
    opts?: SendCommandOptions
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
    return withAgentContext(agentId, () => executeCommandImpl(agentId, command, systemPrompt, forceNewSession, customAgent, silent, skipNotify));
  }

  async function executeCommandImpl(
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

    // First run of a forked agent: resume the SOURCE session and fork it into a
    // new one. agent.sessionId is still empty here; once the fork's own id is
    // captured (handleSessionId) it takes over and forkSourceSessionId is cleared.
    const isFirstForkRun = !!agent.forkSourceSessionId && !agent.sessionId && !forceNewSession;

    await runner.run({
      agentId,
      prompt: command,
      workingDir: agent.cwd,
      sessionId: isFirstForkRun ? agent.forkSourceSessionId : agent.sessionId,
      forkSession: isFirstForkRun,
      model: agent.provider === 'claude'
        ? agentService.sanitizeModelForProvider(agent.provider, agent.model)
        : agent.provider === 'opencode'
          ? agentService.sanitizeOpencodeModel(agent.opencodeModel)
          : agent.provider === 'grok'
            ? agentService.sanitizeGrokModel(agent.grokModel)
            : agent.provider === 'pi'
              ? agentService.sanitizePiModel(agent.piModel)
              : agentService.sanitizeCodexModel(agent.codexModel),
      effort: agent.provider === 'claude' || agent.provider === 'grok' || agent.provider === 'pi' ? agent.effort : undefined,
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
    customAgent?: CustomAgentConfig,
    opts?: SendCommandOptions
  ): Promise<void> {
    return withAgentContext(agentId, () => sendCommandImpl(agentId, command, systemPrompt, forceNewSession, customAgent, opts));
  }

  async function sendCommandImpl(
    agentId: string,
    command: string,
    systemPrompt?: string,
    forceNewSession?: boolean,
    customAgent?: CustomAgentConfig,
    opts?: SendCommandOptions
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

    // Backends that close stdin after the initial prompt (Grok, Codex, OpenCode)
    // cannot receive mid-run follow-ups via a pipe. Two delivery modes:
    //
    //   1. Default — QUEUE until the process exits, then respawn with session
    //      resume and deliver via ClaudeRunner.messageQueue
    //      (respawnWithQueuedMessage). Soft mid-run guidance ("continua",
    //      "also do X") should not burn the in-flight turn.
    //
    //   2. forceInterrupt — stop the process (clearQueue=true so prior queued
    //      mid-run messages are dropped as stale) and immediately respawn with
    //      this prompt. Used when the user explicitly wants "do this now
    //      instead" (UI "Send now" / forceInterrupt flag).
    //
    // Why no turnState gate on the queue path: 'waiting_for_input' is not a
    // reliable "turn is over" signal across these backends — OpenCode's NDJSON
    // emits `step_finish` per LLM step, so turnState oscillates within a single
    // conversational turn. The queue is drained on process exit (the only
    // trustworthy boundary for stdin-closed CLIs).
    //
    // Safe for tmux mode: runner.stop() only kills the agent's detached tmux
    // session (spawnInTmux), not the user's own pane.
    const backendClosesStdin = runner.closesStdinAfterPrompt?.() === true;
    if (processRunning && backendClosesStdin && !forceNewSession) {
      const turnState = runner.getTurnState?.(agentId);
      const providerLabel = providerDisplayName(agent.provider);

      if (opts?.forceInterrupt) {
        log.log(`[sendCommand] Agent ${agentId} (${agent.provider}): forceInterrupt mid-run (turnState=${turnState ?? 'unknown'}) — interrupting and restarting with new prompt`);
        emitOutput(
          agentId,
          '🛑 [System] Interrupting current work to process new prompt…',
          false,
          undefined,
          'system-interrupt-restart'
        );
        // clearQueue=false: other queued mid-run messages survive the interrupt
        // (visible as chips in the queue bar) and drain after the forced turn.
        await runner.stop(agentId, false);
        agentService.updateAgent(agentId, { taskCount: (agent.taskCount || 0) + 1 });
        await executeCommand(agentId, command, systemPrompt, forceNewSession, customAgent);
        return;
      }

      // Default: queue for delivery after the current turn completes.
      const queued = runner.sendMessage(agentId, command);
      if (queued) {
        log.log(`[sendCommand] Agent ${agentId} (${agent.provider}): mid-run prompt queued (turnState=${turnState ?? 'unknown'}, ${command.length} chars)`);
        notifyCommandStarted(agentId, command, { queued: true });
        emitOutput(
          agentId,
          `⏳ [System] Mid-run message for ${providerLabel} will be sent when the agent is free`,
          false,
          undefined,
          `system-midrun-queued-${Date.now()}`
        );
        const isSystemMessage = command.startsWith('[System:');
        if (!isSystemMessage) {
          agentService.updateAgent(agentId, {
            taskCount: (agent.taskCount || 0) + 1,
            lastAssignedTask: command,
            lastAssignedTaskTime: Date.now(),
          });
        } else {
          agentService.updateAgent(agentId, { taskCount: (agent.taskCount || 0) + 1 });
        }
        return;
      }

      // sendMessage failed (no active process race) — fall through to interrupt
      // so the prompt is not dropped.
      log.warn(`[sendCommand] Agent ${agentId}: mid-run queue failed, falling through to interrupt+respawn`);
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

    // Persistent-stream backends (Codex app-server, OpenCode serve) keep one
    // daemon alive across turns, so "Send now" cannot stop+respawn like the
    // stdin-closed CLIs above — runner.stop() would abandon the live thread/
    // session. Instead interrupt the in-flight turn in place (clearQueue=true:
    // the user is replacing pending mid-run work) and hand the prompt to the
    // runner queue; it is delivered the moment the aborted turn finalizes.
    if (
      processRunning &&
      !forceNewSession &&
      opts?.forceInterrupt &&
      runner.interruptTurn &&
      runner.getTurnState?.(agentId) === 'processing'
    ) {
      log.log(`[sendCommand] Agent ${agentId} (${agent.provider}): forceInterrupt mid-turn on persistent runner — interrupting turn in place`);
      emitOutput(
        agentId,
        '🛑 [System] Interrupting current work to process new prompt…',
        false,
        undefined,
        'system-interrupt-restart'
      );
      // Snapshot other queued messages so the forced prompt can jump the line
      // without dropping them: clear, send the forced prompt (queue head),
      // then re-append the siblings behind it.
      const siblings = runner.getQueuedMessages?.(agentId) ?? [];
      const interrupted = await runner.interruptTurn(agentId, true);
      if (interrupted) {
        const sentNow = runner.sendMessage(agentId, command);
        for (const sibling of siblings) {
          if (!runner.sendMessage(agentId, sibling)) {
            log.warn(`[sendCommand] Agent ${agentId}: could not restore a queued message after interrupt (${sibling.length} chars dropped)`);
          }
        }
        if (sentNow) {
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
          return;
        }
      }
      log.warn(`[sendCommand] Agent ${agentId}: in-place turn interrupt failed — falling through to default delivery`);
    }

    if (processRunning && !forceNewSession) {
      if (runner.supportsStdin()) {
        const turnState = runner.getTurnState?.(agentId) || 'unknown';
        log.log(`[sendCommand] Agent ${agentId}: Process alive, reusing via stdin (turnState=${turnState}, cmd=${command.substring(0, 60)})`);
        // Persistent-stream runners (codex app-server, opencode serve) queue
        // mid-turn messages internally instead of writing them through. Detect
        // that via the queue length so the client sees the same queued
        // feedback (⏳ + queued command_started) as the stdin-closed path.
        const queueLenBefore = runner.getQueuedMessages?.(agentId).length ?? 0;
        const sent = runner.sendMessage(agentId, command);
        const wasQueued = (runner.getQueuedMessages?.(agentId).length ?? 0) > queueLenBefore;
        if (sent) {
          if (wasQueued) {
            notifyCommandStarted(agentId, command, { queued: true });
          } else {
            notifyCommandStarted(agentId, command);
          }
          if (wasQueued) {
            emitOutput(
              agentId,
              `⏳ [System] Mid-run message for ${providerDisplayName(agent.provider)} will be sent when the agent is free`,
              false,
              undefined,
              `system-midrun-queued-${Date.now()}`
            );
          }
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
    return withAgentContext(agentId, () => sendSilentCommandImpl(agentId, command));
  }

  async function sendSilentCommandImpl(agentId: string, command: string): Promise<void> {
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
    return withAgentContext(agentId, () => stopAgentImpl(agentId));
  }

  async function stopAgentImpl(agentId: string): Promise<void> {
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

    // Clear tracking-board state on explicit stop so stale taskLabel /
    // trackingStatus / trackingStatusDetail don't linger on the tracking board
    // after the agent is killed. Natural task completion does NOT funnel
    // through stopAgent — its final-turn PATCH sets need-review /
    // can-clear-context, and we want to keep that visible.
    agentService.updateAgent(agentId, {
      status: 'idle',
      currentTask: undefined,
      currentTool: undefined,
      isDetached: false,
      taskLabel: undefined,
      trackingStatus: null,
      trackingStatusDetail: undefined,
      trackingStatusTimestamp: undefined,
    });
  }

  return {
    executeCommand,
    sendCommand,
    sendSilentCommand,
    stopAgent,
  };
}
