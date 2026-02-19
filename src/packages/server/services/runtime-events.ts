import type { ContextStats, GlobalUsageStats } from '../../shared/types.js';
import type { SessionMessage } from '../claude/session-loader.js';
import { loadSession } from '../claude/session-loader.js';
import type { RuntimeEvent } from '../runtime/index.js';
import * as agentService from './agent-service.js';
import * as supervisorService from './supervisor-service.js';
import {
  clearPendingSilentContextRefresh,
  consumeStepCompleteReceived,
  markStepCompleteReceived,
} from './runtime-watchdog.js';
import { handleTaskToolResult, handleTaskToolStart } from './runtime-subagents.js';

const DEFAULT_CODEX_CONTEXT_WINDOW = 200000;
const CODEX_ROLLING_CONTEXT_TURNS = 40;
const CODEX_PLAUSIBLE_USAGE_MULTIPLIER = 1.2;
const CODEX_RECOVERABLE_RESUME_ERRORS = [
  'state db missing rollout path for thread',
  'killing the current session',
];
const CODEX_RECOVERY_HISTORY_LIMIT = 12;
const CODEX_RECOVERY_LINE_MAX_CHARS = 400;

const codexRecoveryState = new Map<string, { signature: string; attempts: number }>();
const codexContextGrowthHistory = new Map<string, number[]>();

interface RuntimeEventsDeps {
  log: {
    log: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string, err?: unknown) => void;
  };
  emitEvent: (agentId: string, event: RuntimeEvent) => void;
  emitOutput: (
    agentId: string,
    text: string,
    isStreaming?: boolean,
    subagentName?: string,
    uuid?: string,
    toolMeta?: { toolName?: string; toolInput?: Record<string, unknown> }
  ) => void;
  emitComplete: (agentId: string, success: boolean) => void;
  emitError: (agentId: string, error: string) => void;
  parseUsageOutput: (raw: string) => Pick<GlobalUsageStats, 'session' | 'weeklyAllModels' | 'weeklySonnet'> | null;
  executeCommand: (
    agentId: string,
    command: string,
    systemPrompt?: string,
    forceNewSession?: boolean
  ) => Promise<void>;
}

export interface RuntimeRunnerCallbacks {
  handleEvent: (agentId: string, event: RuntimeEvent) => void;
  handleOutput: (
    agentId: string,
    text: string,
    isStreaming?: boolean,
    subagentName?: string,
    uuid?: string,
    toolMeta?: { toolName?: string; toolInput?: Record<string, unknown> }
  ) => void;
  handleSessionId: (agentId: string, sessionId: string) => void;
  handleComplete: (agentId: string, success: boolean) => void;
  handleError: (agentId: string, error: string) => void;
}

function detectRecoverableCodexResumeError(error: string): string | null {
  const normalizedError = String(error || '').toLowerCase();
  for (const marker of CODEX_RECOVERABLE_RESUME_ERRORS) {
    if (normalizedError.includes(marker)) {
      return marker;
    }
  }
  return null;
}

function truncateRecoveryText(text: string, maxChars: number = CODEX_RECOVERY_LINE_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function estimateTokensFromText(text: string | undefined): number {
  if (!text) return 0;
  const normalized = text.trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function updateCodexRollingContextEstimate(agentId: string, turnGrowth: number): number {
  const history = codexContextGrowthHistory.get(agentId) || [];
  history.push(Math.max(0, Math.round(turnGrowth)));
  if (history.length > CODEX_ROLLING_CONTEXT_TURNS) {
    history.splice(0, history.length - CODEX_ROLLING_CONTEXT_TURNS);
  }
  codexContextGrowthHistory.set(agentId, history);
  return history.reduce((sum, tokens) => sum + tokens, 0);
}

function buildCodexRecoverySystemPrompt(sessionId: string, messages: SessionMessage[]): string {
  const lines = messages.slice(-CODEX_RECOVERY_HISTORY_LIMIT).map((msg) => {
    const role = msg.type === 'assistant'
      ? 'Assistant'
      : msg.type === 'user'
        ? 'User'
        : msg.type === 'tool_use'
          ? `ToolUse(${msg.toolName || 'unknown'})`
          : `ToolResult(${msg.toolName || 'unknown'})`;
    const content = truncateRecoveryText((msg.content || '').replace(/\s+/g, ' ').trim());
    return `${role}: ${content}`;
  });

  return [
    `Previous Codex session (${sessionId}) could not be resumed due to stale state.`,
    'Use this recovered recent transcript to continue seamlessly:',
    lines.join('\n'),
    'Continue with the latest user request. If context is still ambiguous, ask a focused clarifying question.',
  ].join('\n\n');
}

function buildEstimatedCodexContextStats(totalTokens: number, contextWindow: number, model?: string): ContextStats {
  const safeWindow = contextWindow > 0 ? contextWindow : DEFAULT_CODEX_CONTEXT_WINDOW;
  const usedPercent = Math.min(100, Math.max(0, Math.round((totalTokens / safeWindow) * 100)));
  const freeTokens = Math.max(0, safeWindow - totalTokens);
  const messagesPercent = Number(((totalTokens / safeWindow) * 100).toFixed(1));
  const freePercent = Number(((freeTokens / safeWindow) * 100).toFixed(1));

  return {
    model: model || 'codex',
    contextWindow: safeWindow,
    totalTokens,
    usedPercent,
    categories: {
      systemPrompt: { tokens: 0, percent: 0 },
      systemTools: { tokens: 0, percent: 0 },
      messages: { tokens: totalTokens, percent: messagesPercent },
      freeSpace: { tokens: freeTokens, percent: freePercent },
      autocompactBuffer: { tokens: 0, percent: 0 },
    },
    lastUpdated: Date.now(),
  };
}

export function createRuntimeEventHandlers(deps: RuntimeEventsDeps): RuntimeRunnerCallbacks {
  const {
    log,
    emitEvent,
    emitOutput,
    emitComplete,
    emitError,
    parseUsageOutput,
    executeCommand,
  } = deps;

  function handleEvent(agentId: string, event: RuntimeEvent): void {
    const agent = agentService.getAgent(agentId);
    if (!agent) {
      return;
    }

    switch (event.type) {
      case 'init':
        agentService.updateAgent(agentId, { status: 'working' });
        break;

      case 'tool_start':
        agentService.updateAgent(agentId, {
          status: 'working',
          currentTool: event.toolName,
        });
        if (handleTaskToolStart(agentId, event, log)) {
          emitEvent(agentId, {
            ...event,
            type: 'tool_start',
          });
        }
        break;

      case 'tool_result':
        handleTaskToolResult(agentId, event, log);
        agentService.updateAgent(agentId, { currentTool: undefined });
        break;

      case 'usage_snapshot': {
        // Skip subagent events — their token counts reflect the subagent's context,
        // not the parent's. Updating the parent's contextUsed here would corrupt it.
        if (event.parentToolUseId) {
          break;
        }
        // Real-time context tracking from streaming usage data.
        // Context window usage = input tokens only (output tokens don't count toward the limit).
        // total_input = cache_read + cache_creation + input_tokens (the full prompt size).
        if (event.tokens) {
          const isClaudeProvider = (agent.provider ?? 'claude') === 'claude';
          if (isClaudeProvider) {
            const cacheRead = event.tokens.cacheRead || 0;
            const cacheCreation = event.tokens.cacheCreation || 0;
            const inputTokens = event.tokens.input || 0;
            // Context window = input side only (system prompt + tools + messages).
            // Output tokens are the model's response and don't count toward the limit.
            const snapshotContextUsed = cacheRead + cacheCreation + inputTokens;

            if (snapshotContextUsed > 0) {
              const effectiveLimit = agent.contextLimit || 200000;
              // Guard against cumulative session totals: if the sum exceeds the
              // context window, it can't represent per-request context fill.
              if (snapshotContextUsed > effectiveLimit) {
                log.log(`[usage_snapshot] ${agentId}: sum ${snapshotContextUsed} exceeds limit ${effectiveLimit} (likely cumulative); skipping`);
                // If the agent's existing contextUsed is also stale (exceeds limit),
                // reset it to 0 so the UI doesn't keep showing an impossible value.
                if ((agent.contextUsed || 0) > effectiveLimit) {
                  agentService.updateAgent(agentId, { contextUsed: 0 }, false);
                  log.log(`[usage_snapshot] ${agentId}: reset stale contextUsed ${agent.contextUsed} to 0`);
                }
              } else {
                const updates: Record<string, unknown> = {
                  contextUsed: Math.max(0, snapshotContextUsed),
                };
                agentService.updateAgent(agentId, updates, false);
                log.log(`[usage_snapshot] ${agentId}: input=${inputTokens} + cacheRead=${cacheRead} + cacheCreation=${cacheCreation} = ${snapshotContextUsed} (output=${event.tokens.output || 0}) limit=${effectiveLimit}`);
              }
            }
          }
        }
        break;
      }

      case 'step_complete': {
        // For subagent events, only accumulate cost (tokensUsed) but don't touch
        // contextUsed/contextLimit/status — those belong to the subagent's context
        // window, not the parent's.
        if (event.parentToolUseId) {
          const subTokensUsed = (event.tokens?.input || 0) + (event.tokens?.output || 0);
          if (subTokensUsed > 0) {
            agentService.updateAgent(agentId, {
              tokensUsed: (agent.tokensUsed || 0) + subTokensUsed,
            }, false);
          }
          log.log(`[step_complete] Subagent event for ${agentId} (parentToolUseId=${event.parentToolUseId}); skipping context update, added ${subTokensUsed} to tokensUsed`);
          break;
        }

        markStepCompleteReceived(agentId);

        const isClaudeProvider = (agent.provider ?? 'claude') === 'claude';
        const isCodexProvider = (agent.provider ?? 'claude') === 'codex';
        const lastTask = agent.lastAssignedTask?.trim() || '';
        const isContextCommand = lastTask === '/context' || lastTask === '/cost' || lastTask === '/compact';

        let contextUsed = agent.contextUsed || 0;
        let contextLimit = agent.contextLimit || 200000;

        // IMPORTANT: event.modelUsage is often {} (empty object) which is truthy.
        // We must check that it has actual data before using it, otherwise we'd
        // zero out contextUsed (since all fields would be undefined → 0).
        const hasModelUsageData = event.modelUsage && Object.keys(event.modelUsage).length > 0;

        // For CLAUDE agents: the usage_snapshot handler (from the streaming assistant
        // event) already set the authoritative per-turn contextUsed value. The
        // step_complete's modelUsage/tokens may contain CUMULATIVE session-wide totals
        // which would inflate the tracked context. Only extract contextLimit (window
        // size) from modelUsage — never override contextUsed for Claude agents.
        //
        // For CODEX agents: there's no usage_snapshot, so step_complete is the only
        // source of context estimation.
        if (isClaudeProvider) {
          // Extract contextLimit from modelUsage if available
          if (hasModelUsageData && event.modelUsage?.contextWindow) {
            contextLimit = event.modelUsage.contextWindow;
          }
          // Preserve contextUsed from usage_snapshot (set during streaming)
          contextUsed = agent.contextUsed || 0;
          log.log(`[step_complete] Claude agent ${agentId}: preserving usage_snapshot contextUsed=${contextUsed}, contextLimit=${contextLimit}`);
        } else if (hasModelUsageData && event.modelUsage) {
          const inputTokens = event.modelUsage.inputTokens || 0;
          const outputTokens = event.modelUsage.outputTokens || 0;
          if (event.modelUsage.contextWindow) {
            contextLimit = event.modelUsage.contextWindow;
          }
          const turnGrowthEstimate = estimateTokensFromText(agent.lastAssignedTask) + outputTokens;
          const rollingEstimate = updateCodexRollingContextEstimate(agentId, turnGrowthEstimate);
          const plausibleSnapshotLimit = contextLimit * CODEX_PLAUSIBLE_USAGE_MULTIPLIER;
          const hasPlausibleSnapshot = inputTokens > 0 && inputTokens <= plausibleSnapshotLimit;
          contextUsed = hasPlausibleSnapshot
            ? Math.max(rollingEstimate, inputTokens + outputTokens)
            : rollingEstimate;
          log.log(`[step_complete] Codex modelUsage for ${agentId}: input=${inputTokens}, contextWindow=${event.modelUsage.contextWindow || 'none'}`);
        } else if (event.tokens) {
          if (isCodexProvider) {
            const inputTokens = event.tokens.input || 0;
            const outputTokens = event.tokens.output || 0;
            const turnGrowthEstimate = estimateTokensFromText(agent.lastAssignedTask) + outputTokens;
            const rollingEstimate = updateCodexRollingContextEstimate(agentId, turnGrowthEstimate);
            const plausibleSnapshotLimit = contextLimit * CODEX_PLAUSIBLE_USAGE_MULTIPLIER;
            const hasPlausibleSnapshot = inputTokens > 0 && inputTokens <= plausibleSnapshotLimit;
            contextUsed = hasPlausibleSnapshot
              ? Math.max(rollingEstimate, inputTokens + outputTokens)
              : rollingEstimate;
            contextLimit = agent.contextLimit || DEFAULT_CODEX_CONTEXT_WINDOW;
          }
          // For Claude with tokens but no modelUsage — usage_snapshot already handled it
        }

        // For /context, /cost, /compact: the context_stats event already set the
        // authoritative contextUsed/contextLimit values. Don't overwrite them with
        // zero-token step_complete data from the local command.
        if (isContextCommand) {
          const stats = agent.contextStats;
          if (stats && stats.contextWindow > 0) {
            contextUsed = Math.max(0, stats.totalTokens || 0);
            contextLimit = Math.max(1, stats.contextWindow || 200000);
            log.log(`[step_complete] Context command for ${agentId}; preserving context from context_stats ${contextUsed}/${contextLimit}`);
          } else {
            contextUsed = agent.contextUsed || 0;
            contextLimit = agent.contextLimit || 200000;
            log.log(`[step_complete] Context command for ${agentId}; preserving context values from tracked fields`);
          }
        }

        // Don't clamp contextUsed to contextLimit - models can have up to 1M context.
        // The contextLimit comes from modelUsage.contextWindow which is authoritative.
        contextUsed = Math.max(0, contextUsed);

        log.log(`[step_complete] Final for ${agentId}: contextUsed=${contextUsed}, contextLimit=${contextLimit}, hasModelUsageData=${hasModelUsageData}, tokens=${JSON.stringify(event.tokens)}`);

        const newTokensUsed = (agent.tokensUsed || 0) + (event.tokens?.input || 0) + (event.tokens?.output || 0);
        const updates: Record<string, unknown> = {
          tokensUsed: newTokensUsed,
          contextUsed,
          contextLimit,
        };
        if (!isClaudeProvider) {
          updates.contextStats = buildEstimatedCodexContextStats(
            Math.max(0, Math.round(contextUsed)),
            Math.max(1, Math.round(contextLimit)),
            agent.codexModel || agent.model
          );
        }
        agentService.updateAgent(agentId, updates);

        if (!isCodexProvider) {
          setTimeout(() => {
            log.log(`[step_complete] Setting status to idle for agent ${agentId} (lastTask: ${agent.lastAssignedTask})`);
            agentService.updateAgent(agentId, {
              status: 'idle',
              currentTask: undefined,
              currentTool: undefined,
            });
          }, 200);
        } else {
          log.log(`[step_complete] Codex agent ${agentId} will be set idle on process completion`);
        }

        // Real-time context tracking via usage_snapshot events replaces automatic /context refresh.
        // The /context command is now only triggered manually via the UI refresh button.
        clearPendingSilentContextRefresh(agentId);
        break;
      }

      case 'error':
        agentService.updateAgent(agentId, { status: 'error' });
        break;

      case 'context_stats':
        break;

      case 'usage_stats':
        console.log('[Claude] Received usage_stats event');
        console.log('[Claude] usageStatsRaw:', event.usageStatsRaw?.substring(0, 200));
        if (event.usageStatsRaw) {
          const usageStats = parseUsageOutput(event.usageStatsRaw);
          console.log('[Claude] Parsed usage stats:', usageStats);
          if (usageStats) {
            supervisorService.updateGlobalUsage(agentId, agent.name, usageStats);
          } else {
            console.log('[Claude] Failed to parse usage stats');
          }
        } else {
          console.log('[Claude] No usageStatsRaw in event');
        }
        break;
    }

    supervisorService.generateNarrative(agentId, event);
    emitEvent(agentId, event);
  }

  function handleOutput(
    agentId: string,
    text: string,
    isStreaming?: boolean,
    subagentName?: string,
    uuid?: string,
    toolMeta?: { toolName?: string; toolInput?: Record<string, unknown> }
  ): void {
    emitOutput(agentId, text, isStreaming, subagentName, uuid, toolMeta);
  }

  function handleSessionId(agentId: string, sessionId: string): void {
    const agent = agentService.getAgent(agentId);
    const existingSessionId = agent?.sessionId;

    if (!existingSessionId) {
      agentService.updateAgent(agentId, { sessionId });
    } else if (existingSessionId !== sessionId) {
      log.log(`Session mismatch for ${agentId}: expected ${existingSessionId}, got ${sessionId}`);
    }
  }

  function handleComplete(agentId: string, success: boolean): void {
    const receivedStepComplete = consumeStepCompleteReceived(agentId);

    agentService.updateAgent(agentId, {
      status: 'idle',
      currentTask: undefined,
      currentTool: undefined,
      isDetached: false,
    });
    emitComplete(agentId, success);

    // Real-time context tracking via usage_snapshot events replaces automatic /context refresh.
    // The /context command is now only triggered manually via the UI refresh button.
    if (!receivedStepComplete && success) {
      clearPendingSilentContextRefresh(agentId);
    }
  }

  function handleError(agentId: string, error: string): void {
    const agent = agentService.getAgent(agentId);
    const timestamp = new Date().toISOString();

    const isCodexProvider = (agent?.provider ?? 'claude') === 'codex';
    const matchedRecoverableError = detectRecoverableCodexResumeError(error);
    const isRecoverableCodexResumeError =
      isCodexProvider
      && !!matchedRecoverableError
      && !!agent?.sessionId
      && !!agent?.lastAssignedTask?.trim();

    if (isRecoverableCodexResumeError && agent) {
      const signature = `${matchedRecoverableError}:${agent.sessionId}`;
      const previous = codexRecoveryState.get(agentId);
      const attemptsForSignature = previous?.signature === signature ? previous.attempts : 0;

      if (attemptsForSignature < 1) {
        codexRecoveryState.set(agentId, { signature, attempts: attemptsForSignature + 1 });
        const taskToRetry = agent.lastAssignedTask!.trim();
        const staleSessionId = agent.sessionId!;
        const staleCwd = agent.cwd;

        log.warn(`[Codex] Recoverable resume error for ${agent.name} (${agentId}), resetting session and retrying once`);
        agentService.updateAgent(agentId, {
          sessionId: undefined,
          status: 'idle',
          currentTask: undefined,
          currentTool: undefined,
        }, false);
        emitOutput(agentId, '[System] Codex session state was stale. Retrying with a fresh session…', false, undefined, 'system-codex-retry');

        setTimeout(async () => {
          try {
            let recoverySystemPrompt: string | undefined;
            if (staleCwd) {
              try {
                const recovered = await loadSession(staleCwd, staleSessionId, CODEX_RECOVERY_HISTORY_LIMIT, 0);
                const recoveredMessages = recovered?.messages || [];
                if (recoveredMessages.length > 0) {
                  recoverySystemPrompt = buildCodexRecoverySystemPrompt(staleSessionId, recoveredMessages);
                  log.warn(`[Codex] Loaded ${recoveredMessages.length} recovered message(s) from stale session ${staleSessionId} for retry`);
                  emitOutput(agentId, `[System] Recovered ${recoveredMessages.length} recent message(s) from the previous Codex session.`, false, undefined, 'system-codex-retry-context');
                } else {
                  log.warn(`[Codex] No recoverable messages found for stale session ${staleSessionId}; retrying without recovered context`);
                }
              } catch (sessionErr) {
                log.warn(`[Codex] Failed to load stale session ${staleSessionId} context for retry: ${String(sessionErr)}`);
              }
            } else {
              log.warn(`[Codex] No cwd available for ${agentId}; retrying stale-session recovery without recovered context`);
            }

            await executeCommand(agentId, taskToRetry, recoverySystemPrompt, true);
          } catch (retryErr) {
            log.error(`[Codex] Recovery retry failed for ${agentId}:`, retryErr);
            agentService.updateAgent(agentId, {
              status: 'error',
              currentTask: undefined,
              currentTool: undefined,
            });
            emitError(agentId, `Codex auto-retry failed: ${String(retryErr)}`);
          }
        }, 500);

        return;
      }
    }

    log.error(`❌ [ERROR] Agent ${agent?.name || agentId} (${agentId})`);
    log.error(`   Time: ${timestamp}`);
    log.error(`   Message: ${error}`);
    log.error(`   Status before: ${agent?.status}`);
    log.error(`   Last task: ${agent?.lastAssignedTask}`);
    log.error(`   Current tool: ${agent?.currentTool}`);
    log.error(`   Session ID: ${agent?.sessionId}`);

    agentService.updateAgent(agentId, {
      status: 'error',
      currentTask: undefined,
      currentTool: undefined,
    });
    emitError(agentId, error);
  }

  return {
    handleEvent,
    handleOutput,
    handleSessionId,
    handleComplete,
    handleError,
  };
}
