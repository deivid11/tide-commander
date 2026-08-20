import type { Agent } from '../../shared/types.js';
import {
  getPiCredentialProfilesUsage,
  type PiQuotaWindow,
} from './pi-subscription-usage-service.js';

export interface OpencodeUsageSnapshot {
  provider: 'opencode';
  fetchedAt: number;
  modelProvider: string | null;
  plan: 'free' | 'go' | 'unavailable';
  session: {
    tokensUsed: number;
    contextUsed: number;
    contextLimit: number;
    taskCount: number;
    lastActivity: number;
  };
  rateLimits: null;
  quotaWindows: PiQuotaWindow[];
  rateLimitsError: string | null;
  cliHint: string;
}

function modelProvider(model: string | undefined): string | null {
  const slash = model?.indexOf('/') ?? -1;
  return slash > 0 ? model!.slice(0, slash) : null;
}

/**
 * Usage for native OpenCode agents is determined by the selected model's own
 * provider. OpenCode's built-in `opencode/*-free` pool is dynamic/unmetered and
 * intentionally has no published weekly quota. OpenCode Go uses the same
 * authenticated usage endpoint and credential as Pi's opencode-go provider.
 */
export async function buildOpencodeUsageSnapshot(agent: Agent): Promise<OpencodeUsageSnapshot> {
  const provider = modelProvider(agent.opencodeModel);
  let plan: OpencodeUsageSnapshot['plan'] = 'unavailable';
  let quotaWindows: PiQuotaWindow[] = [];
  let rateLimitsError: string | null = null;
  let cliHint = 'This OpenCode model provider does not expose subscription usage.';

  if (provider === 'opencode') {
    plan = 'free';
    cliHint = 'OpenCode free-model capacity is dynamic; no weekly quota percentage is published.';
  } else if (provider === 'opencode-go') {
    plan = 'go';
    const profiles = await getPiCredentialProfilesUsage('opencode-go');
    const active = profiles.usage.find((entry) => entry.id === 'active');
    quotaWindows = active?.quotaWindows ?? [];
    rateLimitsError = active?.error ?? (active ? null : 'No active OpenCode Go credential');
    cliHint = rateLimitsError
      ? rateLimitsError
      : 'OpenCode Go active-account subscription limits.';
  }

  return {
    provider: 'opencode',
    fetchedAt: Date.now(),
    modelProvider: provider,
    plan,
    session: {
      tokensUsed: agent.tokensUsed ?? 0,
      contextUsed: agent.contextUsed ?? 0,
      contextLimit: agent.contextLimit ?? 200_000,
      taskCount: agent.taskCount ?? 0,
      lastActivity: agent.lastActivity ?? 0,
    },
    rateLimits: null,
    quotaWindows,
    rateLimitsError,
    cliHint,
  };
}
