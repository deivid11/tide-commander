#!/usr/bin/env node
// Tide Commander permission-prompt MCP server.
//
// Wired in via `claude -p --mcp-config <cfg> --permission-prompt-tool
// mcp__tideperm__permission_prompt`. The CLI invokes this single tool whenever
// a permission gate (or interactive-only tool like AskUserQuestion /
// ExitPlanMode) needs a decision in non-interactive mode.
//
// Behavior:
//   - For AskUserQuestion / ExitPlanMode: POST to Tide Commander's
//     /api/agent-prompt, which holds the request and forwards it to the UI.
//     We block on the HTTP response (server resolves once user answers).
//   - For any other tool: auto-allow (the parent shell already runs the agent
//     under --dangerously-skip-permissions, so the only calls that reach us
//     are the interactive-only ones).
//   - If the Tide Commander API is unreachable, fall back to a safe
//     auto-answer so the agent never hangs forever.
//
// Wire format (extracted from the Claude Code 2.1.x binary):
//   request  : tools/call args { tool_name, input, tool_use_id, permission_suggestions? }
//   response : MCP tool_result content = JSON-encoded
//              { behavior: "allow", updatedInput }  |  { behavior: "deny", message }
//
// Env vars:
//   TIDE_SERVER   - base URL of Tide Commander (set by process-lifecycle.ts)
//   TIDE_AGENT_ID - the spawning agent's id (set by process-lifecycle.ts)
//   AUTH_TOKEN    - shared auth token for /api requests

import { createInterface } from 'node:readline';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const LOG_FILE = join(homedir(), '.tide-commander', 'logs', 'permission-prompt.jsonl');
try { mkdirSync(dirname(LOG_FILE), { recursive: true }); } catch {}

function log(obj) {
  try { appendFileSync(LOG_FILE, JSON.stringify({ t: Date.now(), ...obj }) + '\n'); } catch {}
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

const TOOL_NAME = 'permission_prompt';
const SERVER_INFO = { name: 'tideperm', version: '1.1.0' };
const TIDE_SERVER = process.env.TIDE_SERVER || 'http://localhost:5174';
const TIDE_AGENT_ID = process.env.TIDE_AGENT_ID || '';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'abcd';

const TOOL_SCHEMA = {
  name: TOOL_NAME,
  description: 'Tide Commander permission-prompt handler for headless --print runs. Routes AskUserQuestion / ExitPlanMode to the UI.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_name: { type: 'string' },
      input: { type: 'object', additionalProperties: true },
      tool_use_id: { type: 'string' },
      permission_suggestions: { type: 'array' },
    },
    required: ['tool_name'],
  },
};

function autoAnswer(args) {
  const toolName = args.tool_name;
  const input = args.input || {};
  if (toolName === 'AskUserQuestion') {
    const questions = Array.isArray(input.questions) ? input.questions : [];
    const answers = {};
    for (const q of questions) {
      const firstOpt = Array.isArray(q.options) && q.options[0]
        ? q.options[0].label
        : 'OK';
      answers[q && q.question] = firstOpt;
    }
    return { behavior: 'allow', updatedInput: { questions, answers } };
  }
  return { behavior: 'allow', updatedInput: input };
}

async function askUiForDecision(args) {
  const toolName = args.tool_name;
  if (toolName !== 'AskUserQuestion' && toolName !== 'ExitPlanMode') {
    return autoAnswer(args);
  }
  if (!TIDE_AGENT_ID) {
    log({ event: 'no_agent_id', toolName });
    return autoAnswer(args);
  }

  const requestId = args.tool_use_id || `tideperm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const body = {
    id: requestId,
    agentId: TIDE_AGENT_ID,
    tool: toolName,
    input: args.input || {},
  };

  try {
    const res = await fetch(`${TIDE_SERVER}/api/agent-prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': AUTH_TOKEN,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      log({ event: 'http_error', toolName, status: res.status });
      return autoAnswer(args);
    }
    const payload = await res.json();
    log({ event: 'ui_responded', requestId, approved: payload.approved });

    if (!payload.approved) {
      return {
        behavior: 'deny',
        message: payload.reason || 'User declined',
      };
    }

    if (toolName === 'AskUserQuestion') {
      const questions = Array.isArray(args.input?.questions) ? args.input.questions : [];
      return {
        behavior: 'allow',
        updatedInput: { questions, answers: payload.answers || {} },
      };
    }

    return { behavior: 'allow', updatedInput: args.input || {} };
  } catch (err) {
    log({ event: 'fetch_failed', toolName, error: String(err) });
    return autoAnswer(args);
  }
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch (e) {
    log({ event: 'parse_error', error: String(e), line: line.slice(0, 200) });
    return;
  }
  const { jsonrpc = '2.0', id, method, params } = req;

  if (method === 'initialize') {
    send({
      jsonrpc, id,
      result: {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    });
    return;
  }

  if (method === 'notifications/initialized') return;

  if (method === 'tools/list') {
    send({ jsonrpc, id, result: { tools: [TOOL_SCHEMA] } });
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    if (name !== TOOL_NAME) {
      send({ jsonrpc, id, error: { code: -32601, message: `Unknown tool: ${name}` } });
      return;
    }
    const decision = await askUiForDecision(args || {});
    log({ event: 'decide', toolName: args?.tool_name, decisionBehavior: decision.behavior });
    send({
      jsonrpc, id,
      result: { content: [{ type: 'text', text: JSON.stringify(decision) }] },
    });
    return;
  }

  if (id !== undefined) {
    send({ jsonrpc, id, error: { code: -32601, message: `Unknown method: ${method}` } });
  }
});

log({ event: 'startup', pid: process.pid, agentId: TIDE_AGENT_ID || '<none>', server: TIDE_SERVER });
