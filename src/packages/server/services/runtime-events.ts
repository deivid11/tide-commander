import type { Agent, ContextStats } from '../../shared/types.js';
import type { SessionMessage } from '../claude/session-loader.js';
import { loadSession } from '../claude/session-loader.js';
import type { RuntimeEvent } from '../runtime/index.js';
import * as agentService from './agent-service.js';
import {
  clearPendingSilentContextRefresh,
  consumeStepCompleteReceived,
  markStepCompleteReceived,
} from './runtime-watchdog.js';
import {
  addPendingBackgroundTask,
  clearPendingBackgroundTasks,
  getActiveSubagentByToolUseId,
  handleTaskToolResult,
  handleTaskToolStart,
  hasPendingBackgroundTasks,
  resolvePendingBackgroundTask,
  resolvePendingBackgroundTaskByTaskId,
} from './runtime-subagents.js';

const DEFAULT_CLAUDE_CONTEXT_WINDOW = 200000;
const DEFAULT_CODEX_CONTEXT_WINDOW = 258400;
/** Practical Grok Build window observed in session signals.json (model catalog may list 2M). */
const DEFAULT_GROK_CONTEXT_WINDOW = 500000;
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
  executeCommand: (
    agentId: string,
    command: string,
    systemPrompt?: string,
    forceNewSession?: boolean
  ) => Promise<void>;
  isAgentProcessActive?: (agentId: string) => boolean;
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

function getDefaultContextWindow(provider: 'claude' | 'codex' | 'opencode' | 'grok' | 'pi' | undefined): number {
  if (provider === 'codex') return DEFAULT_CODEX_CONTEXT_WINDOW;
  if (provider === 'opencode') return DEFAULT_CLAUDE_CONTEXT_WINDOW;
  if (provider === 'grok') return DEFAULT_GROK_CONTEXT_WINDOW;
  if (provider === 'pi') return DEFAULT_CLAUDE_CONTEXT_WINDOW;
  return DEFAULT_CLAUDE_CONTEXT_WINDOW;
}

/** Context window tiers Claude models ship with, smallest first. */
const CLAUDE_CONTEXT_WINDOW_TIERS = [200_000, 1_000_000];

/**
 * Widen a stale Claude context limit to fit an observed prompt size.
 *
 * A Claude usage_snapshot is the token count of a *single* request
 * (cacheRead + cacheCreation + input of one assistant message), so it can
 * never be a cumulative session total. If it exceeds the limit we have on
 * file, the limit is what's wrong — typically because the window was learned
 * from a turn where an auxiliary model was billed alongside the main one.
 * Returns null when the value is beyond anything Claude offers, so the caller
 * can fall back to discarding it.
 */
function widenClaudeContextLimit(observedTokens: number): number | null {
  return CLAUDE_CONTEXT_WINDOW_TIERS.find((tier) => observedTokens <= tier) ?? null;
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

function buildEstimatedContextStats(totalTokens: number, contextWindow: number, model?: string): ContextStats {
  const safeWindow = contextWindow > 0 ? contextWindow : DEFAULT_CLAUDE_CONTEXT_WINDOW;
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

/**
 * Update an existing contextStats with new totalTokens, keeping authoritative
 * category breakdowns (from /context) if they exist, but always refreshing
 * the top-level totalTokens/usedPercent/freeSpace so the value never goes stale.
 */
function updateContextStatsTokens(existing: ContextStats, totalTokens: number, contextWindow?: number): ContextStats {
  const safeWindow = contextWindow && contextWindow > 0 ? contextWindow : existing.contextWindow;
  const usedPercent = Math.min(100, Math.max(0, Math.round((totalTokens / safeWindow) * 100)));
  const freeTokens = Math.max(0, safeWindow - totalTokens);
  const freePercent = Number(((freeTokens / safeWindow) * 100).toFixed(1));

  const cats = existing.categories;
  const hasAuthoritativeBreakdown = (cats.systemPrompt?.tokens || 0) > 0 || (cats.systemTools?.tokens || 0) > 0;
  let updatedCategories: ContextStats['categories'];

  if (hasAuthoritativeBreakdown) {
    // Authoritative breakdown from /context — keep systemPrompt/systemTools/autocompactBuffer,
    // adjust messages to account for the difference
    const fixedTokens = (cats.systemPrompt?.tokens || 0) + (cats.systemTools?.tokens || 0)
      + (cats.autocompactBuffer?.tokens || 0);
    const messagesTokens = Math.max(0, totalTokens - fixedTokens);
    const messagesPercent = Number(((messagesTokens / safeWindow) * 100).toFixed(1));
    updatedCategories = {
      systemPrompt: cats.systemPrompt,
      systemTools: cats.systemTools,
      messages: { tokens: messagesTokens, percent: messagesPercent },
      freeSpace: { tokens: freeTokens, percent: freePercent },
      autocompactBuffer: cats.autocompactBuffer,
    };
  } else {
    // Estimated mode — all tokens attributed to messages
    const messagesPercent = Number(((totalTokens / safeWindow) * 100).toFixed(1));
    updatedCategories = {
      systemPrompt: { tokens: 0, percent: 0 },
      systemTools: { tokens: 0, percent: 0 },
      messages: { tokens: totalTokens, percent: messagesPercent },
      freeSpace: { tokens: freeTokens, percent: freePercent },
      autocompactBuffer: { tokens: 0, percent: 0 },
    };
  }

  return {
    ...existing,
    contextWindow: safeWindow,
    totalTokens,
    usedPercent,
    categories: updatedCategories,
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
    executeCommand,
    isAgentProcessActive,
  } = deps;

  function handleEvent(agentId: string, event: RuntimeEvent): void {
    const agent = agentService.getAgent(agentId);
    if (!agent) {
      return;
    }

    // Guard: after stop() is called, the process is removed from activeProcesses
    // but may still flush buffered stdout events. Ignore events that would set
    // the agent back to 'working' if its process is no longer tracked.
    const processActive = !isAgentProcessActive || isAgentProcessActive(agentId);

    switch (event.type) {
      case 'init':
        if (processActive) {
          agentService.updateAgent(agentId, { status: 'working' });
        }
        break;

      case 'tool_start':
        if (processActive) {
          agentService.updateAgent(agentId, {
            status: 'working',
            currentTool: event.toolName,
          });
        }
        if (handleTaskToolStart(agentId, event, log)) {
          emitEvent(agentId, {
            ...event,
            type: 'tool_start',
          });
        }
        break;

      case 'tool_result':
        handleTaskToolResult(agentId, event, log);
        if (event.toolUseId) {
          // Any tool_result for a tracked toolUseId means that task delivered its
          // result. The CLI assigns task_ids to slow Bash commands too, so resolution
          // must NOT be limited to Task/Agent tools — that gap pinned agents 'working'.
          resolvePendingBackgroundTask(agentId, event.toolUseId);
        }
        agentService.updateAgent(agentId, { currentTool: undefined });
        break;

      case 'task_started':
        // Tool promoted to a background task (async Task/Agent, slow Bash): it can
        // outlive the parent turn, so step_complete must not flip the agent idle
        // while it runs.
        if (event.toolUseId) {
          addPendingBackgroundTask(agentId, event.toolUseId, event.taskId);
          log.log(`[task] Background task pending for ${agentId}: toolUseId=${event.toolUseId}${event.taskId ? `, taskId=${event.taskId}` : ''}`);
        }
        break;

      case 'task_notification': {
        // A background task finished and the CLI is waking the model with its result.
        if (!event.toolUseId && event.taskId) {
          resolvePendingBackgroundTaskByTaskId(agentId, event.taskId);
        }
        if (event.toolUseId) {
          resolvePendingBackgroundTask(agentId, event.toolUseId);
          // Complete the subagent now (its launch-stub tool_result was suppressed).
          if (getActiveSubagentByToolUseId(event.toolUseId)) {
            const completion: RuntimeEvent = {
              type: 'tool_result',
              toolName: 'Agent',
              toolUseId: event.toolUseId,
            };
            handleTaskToolResult(agentId, completion, log);
            emitEvent(agentId, completion);
          }
        }
        if (processActive && agent.status === 'idle') {
          agentService.updateAgent(agentId, { status: 'working' });
        }
        break;
      }

      case 'text':
      case 'thinking':
        // The model produced output — it's working, even right after a step_complete
        // (background-task wakes often start with text/thinking, not a tool call).
        // Subagent-bridged events (parentToolUseId set) don't count: the JSONL watcher
        // can drain trailing lines after the parent is genuinely done.
        if (processActive && agent.status === 'idle' && !event.parentToolUseId) {
          agentService.updateAgent(agentId, { status: 'working' });
        }
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
        // Grok: session-watcher maps signals.json contextTokensUsed → tokens.input.
        if (event.tokens) {
          const isClaudeProvider = (agent.provider ?? 'claude') === 'claude';
          const isOpencodeProvider = (agent.provider ?? 'claude') === 'opencode';
          const isGrokProvider = (agent.provider ?? 'claude') === 'grok';
          const isPiProvider = (agent.provider ?? 'claude') === 'pi';
          if (isClaudeProvider || isOpencodeProvider || isGrokProvider || isPiProvider) {
            const cacheRead = event.tokens.cacheRead || 0;
            const cacheCreation = event.tokens.cacheCreation || 0;
            const inputTokens = event.tokens.input || 0;
            // Context window = input side only (system prompt + tools + messages).
            // Output tokens are the model's response and don't count toward the limit.
            // For Grok, inputTokens is already the full context fill from signals.json.
            const snapshotContextUsed = cacheRead + cacheCreation + inputTokens;

            if (snapshotContextUsed > 0) {
              // Grok signals also carry the authoritative window size.
              const modelWindow = event.modelUsage?.contextWindow;
              let effectiveLimit = Math.max(
                1,
                modelWindow || agent.contextLimit || getDefaultContextWindow(agent.provider)
              );

              // Claude snapshots are per-request, never cumulative, so one that
              // overflows the tracked window means the *window* is stale (it is
              // only learned at end of turn). Widen it instead of discarding a
              // good reading — the old behaviour also zeroed contextUsed, which
              // is what made the meter collapse to 0k mid-conversation.
              if (isClaudeProvider && snapshotContextUsed > effectiveLimit) {
                const widened = widenClaudeContextLimit(snapshotContextUsed);
                if (widened) {
                  log.log(`[usage_snapshot] ${agentId}: snapshot ${snapshotContextUsed} exceeds tracked limit ${effectiveLimit}; widening to ${widened}`);
                  effectiveLimit = widened;
                }
              }
              // Guard against cumulative session totals: if the sum exceeds the
              // context window, it can't represent per-request context fill.
              // Grok signals can report used slightly over window during compaction —
              // clamp instead of skip so the bar still moves.
              if (snapshotContextUsed > effectiveLimit && !isGrokProvider) {
                log.log(`[usage_snapshot] ${agentId}: sum ${snapshotContextUsed} exceeds limit ${effectiveLimit} (likely cumulative); skipping`);
                // If the agent's existing contextUsed is also stale (exceeds limit),
                // reset it to 0 so the UI doesn't keep showing an impossible value.
                if ((agent.contextUsed || 0) > effectiveLimit) {
                  agentService.updateAgent(agentId, { contextUsed: 0 }, false);
                  log.log(`[usage_snapshot] ${agentId}: reset stale contextUsed ${agent.contextUsed} to 0`);
                }
              } else {
                const safeContextUsed = Math.max(0, Math.min(snapshotContextUsed, effectiveLimit));
                const updates: Record<string, unknown> = {
                  contextUsed: safeContextUsed,
                  contextLimit: effectiveLimit,
                };
                // Always keep contextStats.totalTokens in sync with contextUsed.
                // If authoritative stats exist (from /context), merge the new total
                // while preserving category breakdowns. Otherwise build estimated stats.
                if (agent.contextStats && agent.contextStats.lastUpdated) {
                  updates.contextStats = updateContextStatsTokens(
                    agent.contextStats,
                    safeContextUsed,
                    effectiveLimit,
                  );
                } else {
                  const modelLabel = isClaudeProvider
                    ? (agent.model || 'claude')
                    : isOpencodeProvider
                      ? (agent.opencodeModel || 'opencode')
                      : isPiProvider
                        ? (agent.piModel || 'pi')
                        : (agent.grokModel || 'grok');
                  updates.contextStats = buildEstimatedContextStats(
                    safeContextUsed,
                    effectiveLimit,
                    modelLabel
                  );
                }
                // Lifetime tokensUsed: for Grok we don't get per-turn usage, so
                // keep the high-water mark of context fill as a lower bound on work done.
                if (isGrokProvider) {
                  const prev = agent.tokensUsed || 0;
                  if (safeContextUsed > prev) {
                    updates.tokensUsed = safeContextUsed;
                  }
                }
                agentService.updateAgent(agentId, updates, false);
                log.log(`[usage_snapshot] ${agentId}: input=${inputTokens} + cacheRead=${cacheRead} + cacheCreation=${cacheCreation} = ${snapshotContextUsed} (output=${event.tokens.output || 0}) limit=${effectiveLimit}${isGrokProvider ? ' [grok]' : ''}`);
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
        const isOpencodeProvider = (agent.provider ?? 'claude') === 'opencode';
        const isGrokProviderStep = (agent.provider ?? 'claude') === 'grok';
        const isPiProviderStep = (agent.provider ?? 'claude') === 'pi';
        const lastTask = agent.lastAssignedTask?.trim() || '';
        const isContextCommand = lastTask === '/context' || lastTask === '/cost' || lastTask === '/compact';

        let contextUsed = agent.contextUsed || 0;
        let contextLimit = agent.contextLimit || getDefaultContextWindow(agent.provider);

        // IMPORTANT: event.modelUsage is often {} (empty object) which is truthy.
        // We must check that it has actual data before using it, otherwise we'd
        // zero out contextUsed (since all fields would be undefined → 0).
        const hasModelUsageData = event.modelUsage && Object.keys(event.modelUsage).length > 0;

        // For CLAUDE and OPENCODE agents: the usage_snapshot handler already set
        // the authoritative per-turn contextUsed value. The step_complete's
        // modelUsage/tokens may contain CUMULATIVE session-wide totals which would
        // inflate the tracked context. Only extract contextLimit (window size) from
        // modelUsage — never override contextUsed for Claude/OpenCode agents.
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
        } else if (isOpencodeProvider) {
          // OpenCode: preserve contextUsed from usage_snapshot, use stored contextLimit
          contextUsed = agent.contextUsed || 0;
          contextLimit = agent.contextLimit || getDefaultContextWindow('opencode');
          log.log(`[step_complete] OpenCode agent ${agentId}: preserving usage_snapshot contextUsed=${contextUsed}, contextLimit=${contextLimit}`);
        } else if (isPiProviderStep) {
          // Pi: usage_snapshot (from assistant message_end usage) already set the
          // per-request context fill; preserve it here.
          contextUsed = agent.contextUsed || 0;
          contextLimit = agent.contextLimit || getDefaultContextWindow('pi');
          log.log(`[step_complete] Pi agent ${agentId}: preserving usage_snapshot contextUsed=${contextUsed}, contextLimit=${contextLimit}`);
        } else if (isGrokProviderStep) {
          // Grok: streaming-json has no usage; session-watcher feeds usage_snapshot
          // from signals.json. Preserve those values on step_complete.
          contextUsed = agent.contextUsed || 0;
          contextLimit = agent.contextLimit || getDefaultContextWindow('grok');
          if (hasModelUsageData && event.modelUsage?.contextWindow) {
            contextLimit = event.modelUsage.contextWindow;
          }
          log.log(`[step_complete] Grok agent ${agentId}: preserving signals usage_snapshot contextUsed=${contextUsed}, contextLimit=${contextLimit}`);
        } else if (hasModelUsageData && event.modelUsage) {
          const inputTokens = event.modelUsage.inputTokens || 0;
          const outputTokens = event.modelUsage.outputTokens || 0;
          if (event.modelUsage.contextWindow) {
            contextLimit = event.modelUsage.contextWindow;
          }
          const turnGrowthEstimate = estimateTokensFromText(agent.lastAssignedTask) + outputTokens;
          updateCodexRollingContextEstimate(agentId, turnGrowthEstimate);
          const plausibleSnapshotLimit = contextLimit * CODEX_PLAUSIBLE_USAGE_MULTIPLIER;
          const hasAuthoritativeSnapshot = inputTokens > 0 && inputTokens <= plausibleSnapshotLimit;
          if (hasAuthoritativeSnapshot) {
            contextUsed = inputTokens;
          } else {
            const rollingEstimate = updateCodexRollingContextEstimate(agentId, 0);
            contextUsed = rollingEstimate;
          }
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
          // For Claude/OpenCode with tokens but no modelUsage — usage_snapshot already handled it
        }

        // For /context, /cost, /compact: the context_stats event already set the
        // authoritative contextUsed/contextLimit values. Don't overwrite them with
        // zero-token step_complete data from the local command.
        if (isContextCommand) {
          const stats = agent.contextStats;
          if (stats && stats.contextWindow > 0) {
            contextUsed = Math.max(0, stats.totalTokens || 0);
            contextLimit = Math.max(1, stats.contextWindow || getDefaultContextWindow(agent.provider));
            log.log(`[step_complete] Context command for ${agentId}; preserving context from context_stats ${contextUsed}/${contextLimit}`);
          } else {
            contextUsed = agent.contextUsed || 0;
            contextLimit = agent.contextLimit || getDefaultContextWindow(agent.provider);
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
        // Always keep contextStats in sync. If authoritative stats exist (from
        // /context), merge the updated totalTokens while preserving category
        // breakdowns. Otherwise build fresh estimated stats.
        const isGrokProvider = (agent.provider ?? 'claude') === 'grok';
        const modelForStats = isClaudeProvider
          ? (agent.model || 'claude')
          : isCodexProvider
            ? (agent.codexModel || agent.model)
            : isOpencodeProvider
              ? (agent.opencodeModel || 'opencode')
              : isGrokProvider
                ? (agent.grokModel || 'grok')
                : isPiProviderStep
                  ? (agent.piModel || 'pi')
                  : (agent.model || 'unknown');
        if (agent.contextStats && agent.contextStats.lastUpdated) {
          updates.contextStats = updateContextStatsTokens(
            agent.contextStats,
            Math.max(0, Math.round(contextUsed)),
            Math.max(1, Math.round(contextLimit)),
          );
        } else {
          updates.contextStats = buildEstimatedContextStats(
            Math.max(0, Math.round(contextUsed)),
            Math.max(1, Math.round(contextLimit)),
            modelForStats
          );
        }
        agentService.updateAgent(agentId, updates);

        if (!isCodexProvider && !isOpencodeProvider) {
          if (hasPendingBackgroundTasks(agentId)) {
            // The turn ended but background tasks are still running — the CLI will wake
            // the model with a <task-notification> when they finish. Not idle yet.
            log.log(`[step_complete] Agent ${agentId} has pending background task(s) — keeping status '${agent.status}'`);
            agentService.updateAgent(agentId, { currentTool: undefined });
          } else {
            setTimeout(() => {
              if (hasPendingBackgroundTasks(agentId)) {
                log.log(`[step_complete] Agent ${agentId} gained pending background task(s) — skipping idle`);
                return;
              }
              log.log(`[step_complete] Setting status to idle for agent ${agentId} (lastTask: ${agent.lastAssignedTask})`);
              agentService.updateAgent(agentId, {
                status: 'idle',
                currentTask: undefined,
                currentTool: undefined,
              });
            }, 200);
          }
        } else {
          log.log(`[step_complete] ${isCodexProvider ? 'Codex' : 'OpenCode'} agent ${agentId} will be set idle on process completion`);
        }

        // Real-time context tracking via usage_snapshot events replaces automatic /context refresh.
        // The /context command is now only triggered manually via the UI refresh button.
        clearPendingSilentContextRefresh(agentId);
        break;
      }

      case 'error':
        // Background tasks are children of the CLI process — an errored run means
        // they're gone; a stale pending set would pin the agent 'working' forever.
        clearPendingBackgroundTasks(agentId);
        agentService.updateAgent(agentId, { status: 'error' });
        break;

      case 'context_stats':
        break;
    }

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
      // Capture the new session id. If this agent was a pending fork, the new id
      // is the FORKED session — clear the fork marker so later runs resume it
      // normally instead of re-forking the source.
      const updates: Partial<Agent> = { sessionId };
      if (agent?.forkSourceSessionId) updates.forkSourceSessionId = undefined;
      agentService.updateAgent(agentId, updates);
    } else if (existingSessionId !== sessionId) {
      // Grok session ids are stable across resumes, so a different id from the
      // runtime means the persisted one is wrong (directory-based discovery
      // could capture a neighboring agent's session) — follow the CLI.
      if ((agent?.provider ?? 'claude') === 'grok') {
        log.log(`Grok session corrected for ${agentId}: ${existingSessionId} → ${sessionId}`);
        agentService.updateAgent(agentId, { sessionId });
      } else {
        log.log(`Session mismatch for ${agentId}: expected ${existingSessionId}, got ${sessionId}`);
      }
    }
  }

  function handleComplete(agentId: string, success: boolean): void {
    // Process closed — any background tasks died with it.
    clearPendingBackgroundTasks(agentId);
    const receivedStepComplete = consumeStepCompleteReceived(agentId);
    const agent = agentService.getAgent(agentId);
    const isCodexProvider = (agent?.provider ?? 'claude') === 'codex';
    const finalCodexSnapshot = isCodexProvider
      ? agentService.getCodexContextSnapshotFromSession(agent?.sessionId)
      : null;

    const completionUpdates: Record<string, unknown> = {
      status: 'idle',
      currentTask: undefined,
      currentTool: undefined,
      isDetached: false,
    };

    if (finalCodexSnapshot) {
      completionUpdates.contextUsed = finalCodexSnapshot.contextUsed;
      completionUpdates.contextLimit = finalCodexSnapshot.contextLimit;
      // Build proper contextStats from the snapshot. Don't blindly copy
      // finalCodexSnapshot.contextStats — CodexContextSnapshot doesn't have
      // that field, so it would be `undefined` and wipe the valid stats
      // set by step_complete.
      const existingStats = agent?.contextStats;
      if (existingStats && existingStats.lastUpdated) {
        completionUpdates.contextStats = updateContextStatsTokens(
          existingStats,
          finalCodexSnapshot.contextUsed,
          finalCodexSnapshot.contextLimit,
        );
      } else {
        completionUpdates.contextStats = buildEstimatedContextStats(
          finalCodexSnapshot.contextUsed,
          finalCodexSnapshot.contextLimit,
          agent?.codexModel || agent?.model,
        );
      }
      log.log(`[complete] Refreshed Codex context for ${agentId}: ${finalCodexSnapshot.contextUsed}/${finalCodexSnapshot.contextLimit}`);
    }

    agentService.updateAgent(agentId, completionUpdates);
    emitComplete(agentId, success);

    // Real-time context tracking via usage_snapshot events replaces automatic /context refresh.
    // The /context command is now only triggered manually via the UI refresh button.
    if (!receivedStepComplete && success) {
      clearPendingSilentContextRefresh(agentId);
    }
  }

  function handleError(agentId: string, error: string): void {
    // Same as 'error' events: a failed run takes its background tasks with it.
    clearPendingBackgroundTasks(agentId);
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
      lastError: error,
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
