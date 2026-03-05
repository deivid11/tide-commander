import type { Agent, ContextStats } from '../../shared/types';

const DEFAULT_CLAUDE_CONTEXT_LIMIT = 200000;
const DEFAULT_CODEX_CONTEXT_LIMIT = 258400;

export interface DisplayContextInfo {
  totalTokens: number;
  contextWindow: number;
  usedPercent: number;
  freePercent: number;
}

type DisplayContextAgent = {
  contextUsed?: number;
  contextLimit?: number;
  provider?: Agent['provider'] | string;
  contextStats?: ContextStats;
};

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function getDisplayContextInfo(agent: DisplayContextAgent): DisplayContextInfo {
  const defaultContextLimit = agent.provider === 'codex'
    ? DEFAULT_CODEX_CONTEXT_LIMIT
    : DEFAULT_CLAUDE_CONTEXT_LIMIT;
  const trackedWindow = Math.max(1, Math.round(agent.contextLimit || defaultContextLimit));
  const trackedTokens = Math.max(0, Math.min(Math.round(agent.contextUsed || 0), trackedWindow));
  const trackedUsedPercent = clampPercent(Number(((trackedTokens / trackedWindow) * 100).toFixed(1)));

  const stats = agent.contextStats;
  if (!stats) {
    return {
      totalTokens: trackedTokens,
      contextWindow: trackedWindow,
      usedPercent: trackedUsedPercent,
      freePercent: clampPercent(Number((100 - trackedUsedPercent).toFixed(1))),
    };
  }

  const statsWindow = Math.max(1, Math.round(stats.contextWindow || trackedWindow));
  const statsTokens = Math.max(0, Math.min(Math.round(stats.totalTokens || 0), statsWindow));
  const statsUsedPercent = clampPercent(Number((stats.usedPercent ?? ((statsTokens / statsWindow) * 100)).toFixed(1)));
  const trackedDiffersFromStats = trackedWindow !== statsWindow || trackedTokens !== statsTokens;

  if (trackedDiffersFromStats) {
    return {
      totalTokens: trackedTokens,
      contextWindow: trackedWindow,
      usedPercent: trackedUsedPercent,
      freePercent: clampPercent(Number((100 - trackedUsedPercent).toFixed(1))),
    };
  }

  return {
    totalTokens: statsTokens,
    contextWindow: statsWindow,
    usedPercent: statsUsedPercent,
    freePercent: clampPercent(Number((100 - statsUsedPercent).toFixed(1))),
  };
}
