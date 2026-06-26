/**
 * Instruction refresh registry.
 *
 * The stdin backends (OpenCode, Codex) have no system-prompt channel, so the
 * injected instruction block (system prompt, skills, area rules, class
 * instructions, Tide Commander rules) is embedded inside a user turn. To avoid
 * duplicating that block into the conversation history on every message, those
 * backends inject it only when a session STARTS and send just the user prompt on
 * resume — the block is already in the resumed history.
 *
 * That optimization breaks down when an instruction source changes mid-session
 * (e.g. a skill's content is edited, or the global system prompt is updated): the
 * change would never reach a resumed agent. This registry carries a one-shot
 * "re-inject on the next turn" signal for those agents. The prompt builders call
 * consumeInstructionsDirty() and re-inject the full block once when it returns true.
 *
 * Claude does NOT use this — it re-applies the block via --append-system-prompt-file
 * on every invocation, so changes always take effect on resume.
 */

const pendingRefresh = new Set<string>();

/** Flag an agent so its next resumed turn re-injects the full instruction block. */
export function markInstructionsDirty(agentId: string): void {
  if (agentId) pendingRefresh.add(agentId);
}

/** Flag every given agent (used when a global source like the system prompt changes). */
export function markInstructionsDirtyForAll(agentIds: Iterable<string>): void {
  for (const id of agentIds) markInstructionsDirty(id);
}

/**
 * Returns true (and clears the flag) if the agent's instructions were marked
 * dirty since the session started. Safe to call with undefined.
 */
export function consumeInstructionsDirty(agentId: string | undefined): boolean {
  if (!agentId) return false;
  return pendingRefresh.delete(agentId);
}

/**
 * True when the user prompt is a bare CLI slash command (e.g. `/compact`,
 * `/clear`) with no arguments.
 *
 * Such commands must reach the CLI verbatim. The stdin backends (Codex,
 * OpenCode) embed the instruction block (system prompt, skills, area rules,
 * Tide Commander rules — i.e. "the page context or other info") inside the user
 * turn when a session starts or instructions refresh. That would bury the slash
 * under "## User Request" and stop the CLI from recognizing it, so the command
 * never actually runs. The prompt builders call this and, when true, send only
 * the bare command — no block, no echo. (Claude is unaffected: its block goes
 * via --append-system-prompt-file, so the user turn is always just the command.)
 */
export function isBareSlashCommand(prompt: string | undefined): boolean {
  return !!prompt && /^\/[a-z][a-z0-9_-]*$/i.test(prompt.trim());
}
