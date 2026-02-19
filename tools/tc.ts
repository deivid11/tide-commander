#!/usr/bin/env tsx
/**
 * tc - Minimal CLI client for Tide Commander
 *
 * Usage:
 *   tc agents                          List all agents with status
 *   tc send <agent> <message>          Send message and stream response
 *   tc history <agent> [--limit N]     Show conversation history
 *   tc context <agent>                 Show context/token stats
 *   tc search <agent> <query>          Search agent conversation
 *   tc watch <agent>                   Attach to live output stream
 *   tc stop <agent>                    Stop agent's current task
 *   tc clear <agent>                   Clear agent session
 *
 * Environment:
 *   TC_URL        Server URL (default: http://localhost:5174)
 *   AUTH_TOKEN    Authentication token (if server auth is enabled)
 */

import WebSocket from 'ws';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = (process.env.TC_URL || 'http://localhost:5174').replace(/\/+$/, '');
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const WS_URL = BASE_URL.replace(/^http/, 'ws') + '/ws' + (AUTH_TOKEN ? `?token=${AUTH_TOKEN}` : '');

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (AUTH_TOKEN) h['X-Auth-Token'] = AUTH_TOKEN;
  return h;
}

async function httpGet<T = any>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

async function httpPost<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// WebSocket helpers
// ---------------------------------------------------------------------------

interface WsMsg {
  type: string;
  payload?: any;
}

function wsConnect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.once('open', () => resolve(ws));
    ws.once('error', (err) => reject(err));
  });
}

function wsSend(ws: WebSocket, msg: WsMsg): void {
  ws.send(JSON.stringify(msg));
}

function wsOnMessage(ws: WebSocket, handler: (msg: WsMsg) => void): void {
  ws.on('message', (data) => {
    try {
      handler(JSON.parse(data.toString()));
    } catch { /* ignore malformed */ }
  });
}

// ---------------------------------------------------------------------------
// Agent resolution
// ---------------------------------------------------------------------------

interface SimpleAgent {
  id: string;
  name: string;
}

interface Agent {
  id: string;
  name: string;
  status: string;
  class: string;
  currentTask?: string;
  currentTool?: string;
  cwd?: string;
  provider?: string;
  model?: string;
  tokensUsed?: number;
  contextUsed?: number;
  contextLimit?: number;
  isBoss?: boolean;
  sessionId?: string;
  createdAt?: number;
}

async function resolveAgent(query: string): Promise<Agent> {
  const agents = await httpGet<Agent[]>('/api/agents');

  // Exact ID match
  let match = agents.find((a) => a.id === query);
  if (match) return match;

  // ID prefix match
  const prefixMatches = agents.filter((a) => a.id.startsWith(query.toLowerCase()));
  if (prefixMatches.length === 1) return prefixMatches[0];
  if (prefixMatches.length > 1) {
    die(`Ambiguous ID prefix "${query}" matches: ${prefixMatches.map((a) => `${a.id} (${a.name})`).join(', ')}`);
  }

  // Case-insensitive name substring
  const q = query.toLowerCase();
  const nameMatches = agents.filter((a) => a.name.toLowerCase().includes(q));
  if (nameMatches.length === 1) return nameMatches[0];
  if (nameMatches.length > 1) {
    die(`Ambiguous name "${query}" matches: ${nameMatches.map((a) => `${a.id} (${a.name})`).join(', ')}`);
  }

  die(`Agent not found: "${query}". Available: ${agents.map((a) => `${a.name} [${a.id}]`).join(', ')}`);
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function die(msg: string): never {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
}

function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

const STATUS_COLORS: Record<string, string> = {
  idle: '\x1b[32m',      // green
  working: '\x1b[33m',   // yellow
  waiting: '\x1b[36m',   // cyan
  waiting_permission: '\x1b[35m', // magenta
  error: '\x1b[31m',     // red
  offline: '\x1b[90m',   // gray
  orphaned: '\x1b[91m',  // light red
};
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

function colorStatus(status: string): string {
  const c = STATUS_COLORS[status] || '';
  return `${c}${status}${RESET}`;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdAgents(): Promise<void> {
  const agents = await httpGet<Agent[]>('/api/agents');

  if (agents.length === 0) {
    console.log('No agents found.');
    return;
  }

  // Header
  console.log(
    `${BOLD}${pad('ID', 10)} ${pad('Name', 20)} ${pad('Status', 20)} ${pad('Class', 12)} ${pad('Task', 40)}${RESET}`
  );
  console.log('-'.repeat(105));

  for (const a of agents) {
    const task = a.currentTask ? a.currentTask.slice(0, 40) : (a.currentTool ? `[tool: ${a.currentTool}]` : '-');
    console.log(
      `${pad(a.id, 10)} ${pad(a.name, 20)} ${pad(colorStatus(a.status), 29)} ${pad(a.class, 12)} ${DIM}${task}${RESET}`
    );
  }

  console.log(`\n${DIM}${agents.length} agent(s)${RESET}`);
}

async function cmdSend(agentQuery: string, message: string): Promise<void> {
  const agent = await resolveAgent(agentQuery);
  process.stderr.write(`${DIM}Sending to ${agent.name} [${agent.id}]...${RESET}\n`);

  const ws = await wsConnect();
  let gotFirstOutput = false;
  let lastOutputTime = Date.now();
  const IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes

  // Track if agent was working at some point
  let wasWorking = false;

  wsOnMessage(ws, (msg) => {
    if (msg.type === 'output' && msg.payload?.agentId === agent.id) {
      const text = msg.payload.text as string;
      if (!text) return;

      // Skip skill update messages (empty text with skillUpdate data)
      if (msg.payload.skillUpdate) return;

      if (!gotFirstOutput) {
        gotFirstOutput = true;
        process.stderr.write(`${DIM}--- streaming response ---${RESET}\n`);
      }

      lastOutputTime = Date.now();

      // Print streaming text
      if (msg.payload.isStreaming) {
        process.stdout.write(text);
      } else {
        // Non-streaming: complete lines
        console.log(text);
      }
    }

    if (msg.type === 'agent_updated' && msg.payload?.id === agent.id) {
      const status = msg.payload.status as string;
      if (status === 'working') {
        wasWorking = true;
      }
      if (wasWorking && (status === 'idle' || status === 'error')) {
        // Agent finished
        setTimeout(() => {
          process.stderr.write(`\n${DIM}--- ${agent.name} is now ${status} ---${RESET}\n`);
          ws.close();
          process.exit(status === 'error' ? 1 : 0);
        }, 300); // Small delay to catch trailing output
      }
    }
  });

  // Send the command
  wsSend(ws, { type: 'send_command', payload: { agentId: agent.id, command: message } });

  // Idle timeout check
  const timer = setInterval(() => {
    if (Date.now() - lastOutputTime > IDLE_TIMEOUT) {
      process.stderr.write(`\n${DIM}--- timeout: no output for 10 minutes ---${RESET}\n`);
      ws.close();
      clearInterval(timer);
      process.exit(1);
    }
  }, 30_000);

  ws.on('close', () => {
    clearInterval(timer);
  });
}

async function cmdHistory(agentQuery: string, limit: number): Promise<void> {
  const agent = await resolveAgent(agentQuery);
  const data = await httpGet<any>(`/api/agents/${agent.id}/history?limit=${limit}&offset=0`);

  if (!data.messages || data.messages.length === 0) {
    console.log(`No history for ${agent.name}.`);
    return;
  }

  console.log(`${BOLD}History for ${agent.name} [${agent.id}]${RESET}`);
  console.log(`${DIM}Session: ${data.sessionId || 'unknown'} | Messages: ${data.messages.length}${RESET}\n`);

  for (const msg of data.messages) {
    const role = (msg.role || 'unknown').toUpperCase();
    const roleColor = role === 'USER' ? '\x1b[34m' : role === 'ASSISTANT' ? '\x1b[32m' : '\x1b[33m';

    // Extract text content
    let text = '';
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n');

      // Note tool uses
      const toolUses = msg.content.filter((b: any) => b.type === 'tool_use');
      if (toolUses.length > 0) {
        const tools = toolUses.map((t: any) => t.name).join(', ');
        text += `\n${DIM}[tools: ${tools}]${RESET}`;
      }

      // Note tool results
      const toolResults = msg.content.filter((b: any) => b.type === 'tool_result');
      if (toolResults.length > 0) {
        text += `\n${DIM}[${toolResults.length} tool result(s)]${RESET}`;
      }
    }

    if (!text.trim()) continue;

    // Truncate long messages
    const maxLen = 500;
    const display = text.length > maxLen ? text.slice(0, maxLen) + `\n${DIM}... (${text.length} chars total)${RESET}` : text;

    console.log(`${roleColor}${BOLD}[${role}]${RESET}`);
    console.log(display);
    console.log('');
  }
}

async function cmdContext(agentQuery: string): Promise<void> {
  const agent = await resolveAgent(agentQuery);

  // Use WebSocket to request context stats
  const ws = await wsConnect();
  const timeout = setTimeout(() => {
    process.stderr.write(`${DIM}Timeout waiting for context stats${RESET}\n`);
    // Fallback: show what we have from agent object
    printBasicContext(agent);
    ws.close();
    process.exit(0);
  }, 10_000);

  let receivedInitialSync = false;

  wsOnMessage(ws, (msg) => {
    // Wait for initial agents_update before requesting stats
    if (msg.type === 'agents_update' && !receivedInitialSync) {
      receivedInitialSync = true;
      wsSend(ws, { type: 'request_context_stats', payload: { agentId: agent.id } });
    }

    if (msg.type === 'context_stats' && msg.payload?.agentId === agent.id) {
      clearTimeout(timeout);
      const stats = msg.payload.stats;
      console.log(`${BOLD}Context Stats for ${agent.name} [${agent.id}]${RESET}\n`);

      if (stats.totalTokens !== undefined) {
        const pct = stats.contextLimit ? Math.round((stats.totalTokens / stats.contextLimit) * 100) : 0;
        console.log(`  Total tokens:   ${stats.totalTokens.toLocaleString()} / ${(stats.contextLimit || 0).toLocaleString()} (${pct}% used)`);
      }
      if (stats.userTokens !== undefined) console.log(`  User tokens:    ${stats.userTokens.toLocaleString()}`);
      if (stats.assistantTokens !== undefined) console.log(`  Assistant:      ${stats.assistantTokens.toLocaleString()}`);
      if (stats.systemTokens !== undefined) console.log(`  System:         ${stats.systemTokens.toLocaleString()}`);
      if (stats.cacheRead !== undefined) console.log(`  Cache read:     ${stats.cacheRead.toLocaleString()}`);
      if (stats.cacheWrite !== undefined) console.log(`  Cache write:    ${stats.cacheWrite.toLocaleString()}`);
      if (stats.conversationTurns !== undefined) console.log(`  Turns:          ${stats.conversationTurns}`);
      if (stats.raw) console.log(`\n${DIM}Raw: ${stats.raw}${RESET}`);

      ws.close();
      process.exit(0);
    }

    // Also handle output messages that contain context info (for Codex agents)
    if (msg.type === 'output' && msg.payload?.agentId === agent.id) {
      const text = msg.payload.text as string;
      if (text && text.startsWith('Context')) {
        clearTimeout(timeout);
        console.log(`${BOLD}Context for ${agent.name} [${agent.id}]${RESET}\n`);
        console.log(`  ${text}`);
        ws.close();
        process.exit(0);
      }
    }
  });
}

function printBasicContext(agent: Agent): void {
  console.log(`${BOLD}Context for ${agent.name} [${agent.id}]${RESET}\n`);
  const used = agent.contextUsed || 0;
  const limit = agent.contextLimit || 200_000;
  const pct = Math.round((used / limit) * 100);
  console.log(`  Used:   ${used.toLocaleString()} / ${limit.toLocaleString()} (${pct}%)`);
  console.log(`  Tokens: ${(agent.tokensUsed || 0).toLocaleString()}`);
  console.log(`\n${DIM}(Basic stats from agent object. Agent may not have a running session.)${RESET}`);
}

async function cmdSearch(agentQuery: string, query: string): Promise<void> {
  const agent = await resolveAgent(agentQuery);
  const data = await httpGet<any>(`/api/agents/${agent.id}/search?q=${encodeURIComponent(query)}&limit=20`);

  if (!data.results || data.results.length === 0) {
    console.log(`No results for "${query}" in ${agent.name}'s history.`);
    return;
  }

  console.log(`${BOLD}Search results for "${query}" in ${agent.name} [${agent.id}]${RESET}\n`);

  for (const result of data.results) {
    const role = (result.role || '?').toUpperCase();
    const roleColor = role === 'USER' ? '\x1b[34m' : '\x1b[32m';
    const text = typeof result.content === 'string'
      ? result.content
      : Array.isArray(result.content)
        ? result.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
        : JSON.stringify(result.content);

    // Highlight search term
    const highlighted = text.replace(
      new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
      `\x1b[43m\x1b[30m$1${RESET}`
    );

    const preview = highlighted.length > 300 ? highlighted.slice(0, 300) + `${DIM}...${RESET}` : highlighted;
    console.log(`${roleColor}[${role}]${RESET} ${preview}\n`);
  }

  console.log(`${DIM}${data.results.length} result(s)${RESET}`);
}

async function cmdWatch(agentQuery: string): Promise<void> {
  const agent = await resolveAgent(agentQuery);
  process.stderr.write(`${DIM}Watching ${agent.name} [${agent.id}] — press Ctrl+C to stop${RESET}\n`);

  const ws = await wsConnect();

  wsOnMessage(ws, (msg) => {
    if (msg.type === 'output' && msg.payload?.agentId === agent.id) {
      const text = msg.payload.text as string;
      if (!text || msg.payload.skillUpdate) return;

      if (msg.payload.isStreaming) {
        process.stdout.write(text);
      } else {
        console.log(text);
      }
    }

    if (msg.type === 'agent_updated' && msg.payload?.id === agent.id) {
      const status = msg.payload.status as string;
      process.stderr.write(`${DIM}[status: ${status}]${RESET}\n`);
    }

    if (msg.type === 'activity' && msg.payload?.agentId === agent.id) {
      process.stderr.write(`${DIM}[activity: ${msg.payload.message}]${RESET}\n`);
    }
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    process.stderr.write(`\n${DIM}Disconnected.${RESET}\n`);
    ws.close();
    process.exit(0);
  });
}

async function cmdStop(agentQuery: string): Promise<void> {
  const agent = await resolveAgent(agentQuery);
  const ws = await wsConnect();

  // Wait a moment for connection handshake
  await new Promise((r) => setTimeout(r, 200));

  wsSend(ws, { type: 'stop_agent', payload: { agentId: agent.id } });
  process.stderr.write(`Sent stop to ${agent.name} [${agent.id}]\n`);

  setTimeout(() => {
    ws.close();
    process.exit(0);
  }, 500);
}

async function cmdClear(agentQuery: string): Promise<void> {
  const agent = await resolveAgent(agentQuery);
  const ws = await wsConnect();

  await new Promise((r) => setTimeout(r, 200));

  wsSend(ws, { type: 'send_command', payload: { agentId: agent.id, command: '/clear' } });
  process.stderr.write(`Sent /clear to ${agent.name} [${agent.id}]\n`);

  // Wait for activity confirmation
  wsOnMessage(ws, (msg) => {
    if (msg.type === 'activity' && msg.payload?.agentId === agent.id) {
      console.log(msg.payload.message);
      ws.close();
      process.exit(0);
    }
  });

  setTimeout(() => {
    ws.close();
    process.exit(0);
  }, 3000);
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log(`${BOLD}tc${RESET} — Tide Commander CLI

${BOLD}Usage:${RESET}
  tc agents                          List all agents
  tc send <agent> <message>          Send message and stream response
  tc history <agent> [--limit N]     Conversation history (default: 20)
  tc context <agent>                 Token/context stats
  tc search <agent> <query>          Search conversation
  tc watch <agent>                   Live output stream (Ctrl+C to stop)
  tc stop <agent>                    Stop current task
  tc clear <agent>                   Clear session

${BOLD}Agent resolution:${RESET}
  <agent> can be a full ID, ID prefix, or name substring (case-insensitive)

${BOLD}Environment:${RESET}
  TC_URL        Server URL (default: http://localhost:5174)
  AUTH_TOKEN    Auth token (if server requires authentication)

${BOLD}Examples:${RESET}
  tc agents
  tc send dragonite "fix the login bug"
  tc send xrr "run the tests"
  tc history dragonite --limit 10
  tc context dragonite
  tc search dragonite "authentication"
  tc watch dragonite
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  const command = args[0];

  try {
    switch (command) {
      case 'agents':
      case 'ls':
        await cmdAgents();
        break;

      case 'send':
      case 's': {
        if (args.length < 3) die('Usage: tc send <agent> <message>');
        const agentQ = args[1];
        const message = args.slice(2).join(' ');
        await cmdSend(agentQ, message);
        break;
      }

      case 'history':
      case 'h': {
        if (args.length < 2) die('Usage: tc history <agent> [--limit N]');
        const limitIdx = args.indexOf('--limit');
        const limit = limitIdx > 0 ? parseInt(args[limitIdx + 1]) || 20 : 20;
        await cmdHistory(args[1], limit);
        break;
      }

      case 'context':
      case 'ctx': {
        if (args.length < 2) die('Usage: tc context <agent>');
        await cmdContext(args[1]);
        break;
      }

      case 'search': {
        if (args.length < 3) die('Usage: tc search <agent> <query>');
        await cmdSearch(args[1], args.slice(2).join(' '));
        break;
      }

      case 'watch':
      case 'w': {
        if (args.length < 2) die('Usage: tc watch <agent>');
        await cmdWatch(args[1]);
        break;
      }

      case 'stop': {
        if (args.length < 2) die('Usage: tc stop <agent>');
        await cmdStop(args[1]);
        break;
      }

      case 'clear': {
        if (args.length < 2) die('Usage: tc clear <agent>');
        await cmdClear(args[1]);
        break;
      }

      default:
        die(`Unknown command: "${command}". Run "tc --help" for usage.`);
    }
  } catch (err: any) {
    if (err.code === 'ECONNREFUSED') {
      die(`Cannot connect to Tide Commander at ${BASE_URL}. Is the server running?`);
    }
    die(err.message || String(err));
  }
}

main();
