#!/usr/bin/env node
// Tide Commander — Streaming-exec guard (Claude Code PreToolUse hook).
//
// Registered by backend.ts (`--settings` → hooks.PreToolUse, matcher "Bash")
// for every Claude agent the Commander launches. On each Bash tool call it
// asks the Commander whether the command looks LONG-RUNNING and should have
// gone through the Streaming Exec API (POST /api/exec) instead. When the
// server says so, the call is DENIED and the reason — which contains the
// ready-to-run curl for the same command — is fed back to the model.
//
// Fail OPEN: any problem (server down, timeout, malformed event, non-Bash
// tool) → exit 0 with no output → the tool call proceeds normally. This hook
// must never be the reason an agent gets stuck.
//
// Environment (inherited from the CLI process spawned by process-lifecycle.ts):
//   TIDE_SERVER    - Commander base URL (default http://localhost:5174)
//   TIDE_AGENT_ID  - the calling agent's id
//   AUTH_TOKEN     - shared auth token for /api requests
//
// Hook contract (Claude Code): stdin = JSON event {hook_event_name, tool_name,
// tool_input, tool_use_id, session_id, cwd}; stdout JSON with
// hookSpecificOutput.permissionDecision = "deny" blocks the call.

const TIDE_SERVER = process.env.TIDE_SERVER || 'http://localhost:5174';
const TIDE_AGENT_ID = process.env.TIDE_AGENT_ID || '';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const TIMEOUT_MS = 4000;

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => { void main(); });
// Safety net: never hang the tool call if stdin never closes.
setTimeout(() => process.exit(0), TIMEOUT_MS + 2000).unref();

async function main() {
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return process.exit(0);
  }
  if (!event || event.hook_event_name !== 'PreToolUse' || event.tool_name !== 'Bash') {
    return process.exit(0);
  }
  const input = event.tool_input || {};
  const command = typeof input.command === 'string' ? input.command : '';
  if (!command.trim()) return process.exit(0);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${TIDE_SERVER}/api/exec/guard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(AUTH_TOKEN ? { 'X-Auth-Token': AUTH_TOKEN } : {}),
      },
      body: JSON.stringify({
        agentId: TIDE_AGENT_ID || undefined,
        sessionId: event.session_id,
        toolUseId: event.tool_use_id,
        cwd: event.cwd,
        command,
        runInBackground: input.run_in_background === true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return process.exit(0);
    const verdict = await res.json();
    if (verdict && verdict.allow === false && typeof verdict.reason === 'string') {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: verdict.reason,
        },
      }));
    }
  } catch {
    // fail open
  } finally {
    clearTimeout(timer);
  }
  process.exit(0);
}
