const RECENT_AGENTS_STORAGE_KEY = 'tide-commander:spotlight-recent-agents';
const RECENT_AGENTS_MAX = 15;

/**
 * Read the map of agentId -> last-selected timestamp (epoch ms). Safe if storage
 * is unavailable. Legacy values (a plain id array from older builds) are ignored
 * — recency cleanly falls back to server activity until new selections are made.
 */
export function getRecentAgentTimes(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_AGENTS_STORAGE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === 'number'));
  } catch {
    return {};
  }
}

/** Record an agent as just-picked from a palette (stamps it with the current time). */
export function recordRecentAgent(agentId: string): void {
  try {
    const times = getRecentAgentTimes();
    times[agentId] = Date.now();
    const trimmed = Object.entries(times).sort((a, b) => b[1] - a[1]).slice(0, RECENT_AGENTS_MAX);
    localStorage.setItem(RECENT_AGENTS_STORAGE_KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    // localStorage may be unavailable in private/restricted contexts.
  }
}

/**
 * Absolute "recently used" timestamp for an agent (epoch ms): the later of its
 * server-side last activity and its last explicit palette pick. A pick never
 * outranks genuinely newer activity — merely clicking/opening an agent must not
 * present it as more recently active than agents that actually worked since.
 */
export function agentRecency(agentId: string | undefined, lastActivity: number | undefined, recentTimes: Record<string, number>): number {
  const selected = agentId ? recentTimes[agentId] ?? 0 : 0;
  return Math.max(lastActivity ?? 0, selected);
}
