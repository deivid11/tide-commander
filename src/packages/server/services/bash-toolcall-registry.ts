/**
 * In-flight Bash tool calls, per agent — the server-side half of pairing a
 * streamed exec task (POST /api/exec) with the terminal row of the Bash tool
 * call that issued the curl.
 *
 * Why: the terminal used to attach the live exec card to its curl row by
 * re-parsing the curl body on the client (shell quoting → JSON → command) or,
 * failing that, by a time window. Both are heuristics with real failure modes
 * (exotic quoting, truncated commands, clock skew, parallel calls). The server
 * SEES the Bash tool_start (uuid + full command) and then RECEIVES the exec
 * request from the same agent — so it can hand the client the exact
 * `toolUseId` and the card attaches by identity, no parsing, no clocks.
 *
 * Fail-soft: when nothing matches the exec simply carries no toolUseId and the
 * client falls back to the previous heuristics.
 */

interface InflightBashCall {
  toolUseId: string;
  command: string;
  startedAt: number;
}

/** agentId → in-flight Bash calls (parent agent AND its subagents share the id). */
const inflight = new Map<string, InflightBashCall[]>();

/** Never let a leaked entry (a tool_result we never saw) grow the list unbounded. */
const MAX_PER_AGENT = 32;
/** Entries older than this are dropped on the next touch (a Bash call that
 * outlives it is a background job we would not want to pair anyway). */
const STALE_MS = 6 * 3600_000;

function prune(list: InflightBashCall[], now: number): InflightBashCall[] {
  const fresh = list.filter((c) => now - c.startedAt < STALE_MS);
  return fresh.length > MAX_PER_AGENT ? fresh.slice(fresh.length - MAX_PER_AGENT) : fresh;
}

/** Record a Bash tool call that just started for `agentId`. */
export function registerBashToolCall(agentId: string, toolUseId: string | undefined, command: string | undefined, now = Date.now()): void {
  if (!agentId || !toolUseId || typeof command !== 'string' || !command) return;
  const list = prune(inflight.get(agentId) ?? [], now).filter((c) => c.toolUseId !== toolUseId);
  list.push({ toolUseId, command, startedAt: now });
  inflight.set(agentId, list);
}

/** Forget a Bash tool call once its result arrived (or the turn ended). */
export function completeBashToolCall(agentId: string, toolUseId: string | undefined): void {
  if (!agentId || !toolUseId) return;
  const list = inflight.get(agentId);
  if (!list) return;
  const next = list.filter((c) => c.toolUseId !== toolUseId);
  if (next.length === 0) inflight.delete(agentId); else inflight.set(agentId, next);
}

/** Drop everything for an agent (turn complete / error / process gone). */
export function clearBashToolCalls(agentId: string): void {
  inflight.delete(agentId);
}

/**
 * Which in-flight Bash call of `agentId` issued this exec? Candidates are the
 * calls whose command targets /api/exec; among them the one whose curl body
 * carries the exec command wins (checked in JSON-escaped form — that is how it
 * sits inside the `-d` body — and raw, for bodies passed through a heredoc),
 * newest first. A single candidate is accepted even without a textual hit
 * (bodies that use exotic shell quoting the JSON form cannot mirror).
 */
export function findBashToolUseForExec(agentId: string, execCommand: string, now = Date.now()): string | undefined {
  const list = inflight.get(agentId);
  if (!list || list.length === 0) return undefined;
  const fresh = prune(list, now);
  const candidates = fresh.filter((c) => c.command.includes('/api/exec')).reverse(); // newest first
  if (candidates.length === 0) return undefined;
  const escaped = JSON.stringify(execCommand).slice(1, -1);
  const hit = candidates.find((c) => c.command.includes(escaped) || c.command.includes(execCommand));
  if (hit) return hit.toolUseId;
  return candidates.length === 1 ? candidates[0].toolUseId : undefined;
}

/** Test hook. */
export function _resetBashToolCallRegistry(): void {
  inflight.clear();
}
