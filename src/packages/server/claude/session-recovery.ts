/**
 * Lost-session detection for `claude --resume`.
 *
 * Claude Code deletes transcripts that have not been touched for
 * `cleanupPeriodDays` (30 by default). Resuming one of those makes the CLI die
 * on the spot: a single `result` event with `is_error`, `num_turns: 0` and
 * `errors: ["No conversation found with session ID: …"]` (the same text goes
 * to stderr), then exit. Until 2026-10-27 Tide Commander read that result as a
 * normal end of turn: the agent went idle, nothing was retried and nobody was
 * told — a Slack message to Hoppip waited three hours. These helpers classify
 * that result so the runtime can clear the stale session id, retry the same
 * prompt once in a fresh session and say so in the agent's feed.
 */

export const MISSING_SESSION_RE = /No conversation found with session ID/i;

export type ZeroTurnErrorKind = 'session_missing' | 'zero_turn';

export interface ZeroTurnError {
  kind: ZeroTurnErrorKind;
  message: string;
}

/** Shape of the raw `result` event fields this module cares about. */
export interface ResultLike {
  subtype?: string;
  is_error?: boolean;
  num_turns?: number;
  errors?: unknown;
  result?: unknown;
}

export function isMissingSessionError(text: string | null | undefined): boolean {
  return !!text && MISSING_SESSION_RE.test(text);
}

/** The human-readable reason carried by an error `result` (errors[], then result text, then subtype). */
export function zeroTurnErrorMessage(raw: ResultLike): string {
  const errors = Array.isArray(raw.errors)
    ? raw.errors.filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
    : [];
  if (errors.length) return errors.join(' | ');
  if (typeof raw.result === 'string' && raw.result.trim()) return raw.result.trim();
  return raw.subtype ? `claude exited with ${raw.subtype}` : 'claude exited with an error before doing anything';
}

/**
 * A `result` that ends the run before a single turn happened. Anything else
 * (a real turn that failed midway, a success) is not ours to classify.
 */
export function classifyZeroTurnResult(raw: ResultLike): ZeroTurnError | null {
  if (!raw.is_error) return null;
  if ((raw.num_turns ?? 0) > 0) return null;
  const message = zeroTurnErrorMessage(raw);
  return { kind: isMissingSessionError(message) ? 'session_missing' : 'zero_turn', message };
}

/**
 * The retried prompt. The `[System:` prefix is deliberate: `executeCommand`
 * does not overwrite `lastAssignedTask` for system messages, so the agent's
 * recorded task stays the original user message.
 */
export function buildLostSessionRetryPrompt(originalPrompt: string, sessionId: string | undefined): string {
  const which = sessionId ? ` (${sessionId})` : '';
  return (
    `[System: your previous Claude Code session${which} no longer exists on this machine — its transcript was ` +
    'deleted — so this is a brand-new session without any of the earlier conversation. Re-read whatever ' +
    'context you need from the repository and your notes before acting. The pending message follows.]\n\n' +
    originalPrompt
  );
}

/** Short id for feed/notification text. */
export function shortSessionId(sessionId: string | undefined): string {
  return sessionId ? sessionId.slice(0, 8) : 'unknown';
}
