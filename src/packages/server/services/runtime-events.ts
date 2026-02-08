import type { AgentProvider, ContextStats } from '../../shared/types.js';
import type { SessionMessage } from '../claude/session-loader.js';
import { loadSession } from '../claude/session-loader.js';
import type { RuntimeEvent } from '../runtime/index.js';
import * as agentService from './agent-service.js';
import * as supervisorService from './supervisor-service.js';
import {
  clearPendingSilentContextRefresh,
  consumeStepCompleteReceived,
  hasPendingSilentContextRefresh,
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
  parseUsageOutput: (raw: string) => unknown;
  executeCommand: (
    agentId: string,
    command: string,
    systemPrompt?: string,
    forceNewSession?: boolean
  ) => Promise<void>;
  scheduleSilentContextRefresh: (agentId: string, reason: 'step_complete' | 'handle_complete') => void;
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
    scheduleSilentContextRefresh,
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

      case 'step_complete': {
        markStepCompleteReceived(agentId);

        const isClaudeProvider = (agent.provider ?? 'claude') === 'claude';
        const isCodexProvider = (agent.provider ?? 'claude') === 'codex';
        const lastTask = agent.lastAssignedTask?.trim() || '';
        const isContextCommand = lastTask === '/context' || lastTask === '/cost' || lastTask === '/compact';

        let contextUsed = agent.contextUsed || 0;
        let contextLimit = agent.contextLimit || 200000;

        if (event.modelUsage) {
          const cacheRead = event.modelUsage.cacheReadInputTokens || 0;
          const cacheCreation = event.modelUsage.cacheCreationInputTokens || 0;
          const inputTokens = event.modelUsage.inputTokens || 0;
          const outputTokens = event.modelUsage.outputTokens || 0;
          contextLimit = event.modelUsage.contextWindow || 200000;
          if (isCodexProvider) {
            const turnGrowthEstimate = estimateTokensFromText(agent.lastAssignedTask) + outputTokens;
            const rollingEstimate = updateCodexRollingContextEstimate(agentId, turnGrowthEstimate);
            const plausibleSnapshotLimit = contextLimit * CODEX_PLAUSIBLE_USAGE_MULTIPLIER;
            const hasPlausibleSnapshot = inputTokens > 0 && inputTokens <= plausibleSnapshotLimit;
            contextUsed = hasPlausibleSnapshot
              ? Math.max(rollingEstimate, inputTokens + outputTokens)
              : rollingEstimate;
          } else {
            contextUsed = cacheRead + cacheCreation + inputTokens + outputTokens;
          }
        } else if (event.tokens) {
          if (isClaudeProvider) {
            const cacheRead = event.tokens.cacheRead || 0;
            const cacheCreation = event.tokens.cacheCreation || 0;
            const inputTokens = event.tokens.input || 0;
            const outputTokens = event.tokens.output || 0;
            contextUsed = cacheRead + cacheCreation + inputTokens + outputTokens;
          } else {
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
        }

        const hasZeroTokenUsage = !!event.tokens
          && (event.tokens.input || 0) === 0
          && (event.tokens.output || 0) === 0
          && (event.tokens.cacheRead || 0) === 0
          && (event.tokens.cacheCreation || 0) === 0;
        const hasNoModelUsage = !event.modelUsage;
        if (isClaudeProvider && hasZeroTokenUsage && hasNoModelUsage && !isContextCommand) {
          contextUsed = agent.contextUsed || 0;
          contextLimit = agent.contextLimit || 200000;
          log.log(`[step_complete] Claude empty usage detected for ${agentId}; preserving previous context`);
        }

        contextUsed = Math.max(0, Math.min(contextUsed, contextLimit));

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

        const hasPendingSilentRefresh = hasPendingSilentContextRefresh(agentId);

        log.log(`[step_complete] Auto-refresh check: agentId=${agentId}, lastTask="${lastTask}", isContextCmd=${isContextCommand}, hasPending=${hasPendingSilentRefresh}`);

        clearPendingSilentContextRefresh(agentId);

        const currentAgent = agentService.getAgent(agentId);
        const hasSession = !!currentAgent?.sessionId;
        const shouldRefresh = isClaudeProvider && hasSession && !isContextCommand && !hasPendingSilentRefresh;

        log.log(`[step_complete] sessionId=${currentAgent?.sessionId}, shouldRefresh=${shouldRefresh}`);

        if (shouldRefresh) {
          scheduleSilentContextRefresh(agentId, 'step_complete');
        }
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

    if (!receivedStepComplete && success) {
      const agent = agentService.getAgent(agentId);
      const lastTask = agent?.lastAssignedTask?.trim() || '';
      const isContextCommand = lastTask === '/context' || lastTask === '/cost' || lastTask === '/compact';
      const hasSession = !!agent?.sessionId;
      const hasPendingSilentRefresh = hasPendingSilentContextRefresh(agentId);

      log.log(`[handleComplete] Fallback /context check: agentId=${agentId}, receivedStepComplete=${receivedStepComplete}, lastTask="${lastTask}", isContextCmd=${isContextCommand}, hasSession=${hasSession}, hasPending=${hasPendingSilentRefresh}`);

      const isClaudeProvider = (agent?.provider ?? 'claude') === 'claude';
      if (isClaudeProvider && hasSession && !isContextCommand && !hasPendingSilentRefresh) {
        log.log(`[handleComplete] Triggering fallback /context refresh for agent ${agentId}`);
        scheduleSilentContextRefresh(agentId, 'handle_complete');
      }
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
