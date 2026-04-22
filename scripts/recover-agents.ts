#!/usr/bin/env tsx
/**
 * recover-agents — rebuild ~/.local/share/tide-commander/agents.json from logs.
 *
 * When the persisted agent registry gets truncated or corrupted (e.g. server
 * crash mid-write, accidental in-memory state with only a few agents written
 * back, manual file mishap) this script reconstructs as many agents as it can
 * from durable side-channel data:
 *
 *   - delegation-history.json     boss IDs + boss/subordinate edges
 *   - session-history.json        sessionId per agent over time
 *   - running-processes.json[.bak]  live agents w/ full prompt + customAgent
 *   - custom-agent-classes.json   class registry (informational)
 *   - tmux ls (sessions tc-<id>)  liveness signal
 *   - ~/.claude/projects/<dir>/<sessionId>.jsonl
 *       Claude Code session transcripts. We grep API response payloads for
 *       (id, name, class) tuples that the running agents reported via curl.
 *
 * Usage:
 *   tsx scripts/recover-agents.ts                   # dry run, write agents.json.recovered
 *   tsx scripts/recover-agents.ts --apply           # also stop server, swap files, restart
 *   tsx scripts/recover-agents.ts --output FILE     # write to a custom path
 *   tsx scripts/recover-agents.ts --data-dir DIR    # use a custom data dir
 *
 * --apply requires the server is being run via `bun run dev` (i.e. tsx watch),
 * because it triggers a restart by touching src/packages/server/index.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { execSync, spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Types (mirror src/packages/server/data/index.ts StoredAgent)
// ---------------------------------------------------------------------------

interface StoredAgent {
  id: string;
  name: string;
  class: string;
  provider?: 'claude' | 'codex' | 'opencode';
  position: { x: number; y: number; z: number };
  cwd: string;
  tokensUsed: number;
  contextUsed?: number;
  contextLimit?: number;
  taskCount?: number;
  permissionMode?: string;
  useChrome?: boolean;
  model?: string;
  createdAt: number;
  lastActivity: number;
  sessionId?: string;
  isBoss?: boolean;
  subordinateIds?: string[];
  bossId?: string;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (k: string) => args.includes(k);
const argVal = (k: string): string | undefined => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};

const APPLY = flag('--apply');
const DATA_DIR = argVal('--data-dir') || path.join(os.homedir(), '.local/share/tide-commander');
const OUTPUT = argVal('--output') || path.join(DATA_DIR, 'agents.json.recovered');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SERVER_FILE = path.join(PROJECT_ROOT, 'src/packages/server/index.ts');
const SERVER_URL = process.env.TC_URL || 'http://localhost:5174';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'abcd';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const readJson = <T,>(p: string): T | null => {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
};

const log = (msg: string) => console.log(msg);
const warn = (msg: string) => console.warn(`! ${msg}`);

// Pokemon agent ID format: 8 lowercase alphanumerics
const AGENT_ID_RE = /^[a-z0-9]{8}$/;

// ---------------------------------------------------------------------------
// Source 1: agent metadata (id → name, class) from JSONL transcripts
// ---------------------------------------------------------------------------

interface AgentMeta {
  name: string;
  class: string;
  mtime: number; // unix seconds
}

/**
 * Walk ~/.claude/projects/*\/*.jsonl and grep for the API response payload
 * pattern `"id":"<8>","name":"X","class":"Y"`. These are the responses the
 * running agents got back when they called `PATCH /api/agents/<id>` to set
 * their task label etc. — so they're authoritative for (name, class).
 */
function extractAgentMetaFromTranscripts(): Map<string, AgentMeta> {
  const meta = new Map<string, AgentMeta>();
  const projectsDir = path.join(os.homedir(), '.claude/projects');
  if (!fs.existsSync(projectsDir)) {
    warn('~/.claude/projects not found — skipping JSONL transcript scan');
    return meta;
  }

  // Embedded JSON pattern (escaped quotes, since it lives inside a JSON string)
  const pattern = /\\"id\\":\\"([a-z0-9]{8})\\",\\"name\\":\\"([^"\\]+)\\",\\"class\\":\\"([a-z0-9-]+)\\"/g;

  let scanned = 0;
  for (const project of fs.readdirSync(projectsDir)) {
    const projDir = path.join(projectsDir, project);
    let entries: string[];
    try { entries = fs.readdirSync(projDir); } catch { continue; }
    for (const file of entries) {
      if (!file.endsWith('.jsonl')) continue;
      const fp = path.join(projDir, file);
      let stat: fs.Stats;
      try { stat = fs.statSync(fp); } catch { continue; }
      const mtime = Math.floor(stat.mtimeMs / 1000);
      let content: string;
      try { content = fs.readFileSync(fp, 'utf-8'); } catch { continue; }
      scanned++;
      let m: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((m = pattern.exec(content))) {
        const [, id, name, cls] = m;
        const existing = meta.get(id);
        if (!existing || existing.mtime < mtime) {
          meta.set(id, { name, class: cls, mtime });
        }
      }
    }
  }
  log(`  scanned ${scanned} transcript file(s) → ${meta.size} agent(s) with name/class`);
  return meta;
}

// ---------------------------------------------------------------------------
// Source 2: sessionId & cwd per agent (from JSONL transcripts)
// ---------------------------------------------------------------------------

interface AgentSession {
  sessionId: string;
  cwd: string;
  mtime: number;
  encodedDir: string;
}

function extractAgentSessionsFromTranscripts(): Map<string, AgentSession> {
  // Map agentId → most-recent session
  const sessions = new Map<string, AgentSession>();
  const projectsDir = path.join(os.homedir(), '.claude/projects');
  if (!fs.existsSync(projectsDir)) return sessions;

  // Find each agent's session by looking for `tc-<agentId>` references in
  // the transcript (e.g. spawn commands, log paths) OR by the agent ID being
  // mentioned in customAgent.definition.id contexts.
  const idMention = /\b(?:tc-|prompt-|tc-agent-|tc-initial-)([a-z0-9]{8})\b/g;
  // also: prompt path `/home/riven/.tide-commander/prompts/prompt-<id>-project.md`

  for (const project of fs.readdirSync(projectsDir)) {
    const projDir = path.join(projectsDir, project);
    let entries: string[];
    try { entries = fs.readdirSync(projDir); } catch { continue; }
    for (const file of entries) {
      if (!file.endsWith('.jsonl')) continue;
      const sessId = file.slice(0, -6); // strip .jsonl
      const fp = path.join(projDir, file);
      let stat: fs.Stats; try { stat = fs.statSync(fp); } catch { continue; }
      const mtime = Math.floor(stat.mtimeMs / 1000);
      // Pull cwd field from first ~10 lines (it's set per-message but stable)
      let cwd = '';
      try {
        const head = fs.readFileSync(fp, 'utf-8').split('\n', 50);
        for (const line of head) {
          if (!line) continue;
          try {
            const obj = JSON.parse(line);
            if (typeof obj.cwd === 'string') { cwd = obj.cwd; break; }
          } catch { /* skip */ }
        }
      } catch { continue; }

      // Find which agent ID(s) this transcript belongs to
      let content: string;
      try { content = fs.readFileSync(fp, 'utf-8'); } catch { continue; }
      const ids = new Set<string>();
      let m: RegExpExecArray | null;
      idMention.lastIndex = 0;
      while ((m = idMention.exec(content))) ids.add(m[1]);

      for (const aid of ids) {
        const existing = sessions.get(aid);
        if (!existing || existing.mtime < mtime) {
          sessions.set(aid, {
            sessionId: sessId,
            cwd: cwd || '',
            mtime,
            encodedDir: project,
          });
        }
      }
    }
  }
  log(`  found ${sessions.size} agent session(s) in transcripts`);
  return sessions;
}

// ---------------------------------------------------------------------------
// Source 3: encoded project path → real cwd
// ---------------------------------------------------------------------------

/**
 * Claude Code encodes both `/` and `_` as `-` in project directory names,
 * which is irreversible without filesystem inspection. This walks segments
 * left-to-right, greedy-matching the longest prefix that exists on disk.
 */
function decodeCwdFromEncoded(encoded: string): string | null {
  if (!encoded.startsWith('-')) return null;
  let parts = encoded.slice(1).split('-');
  let current = '/';
  while (parts.length) {
    let found: string | null = null;
    let took = 1;
    for (let take = parts.length; take > 0; take--) {
      const candDash = parts.slice(0, take).join('-');
      const candUs = parts.slice(0, take).join('_');
      const baseDash = path.join(current, candDash);
      const baseUs = path.join(current, candUs);
      if (fs.existsSync(baseDash) && fs.statSync(baseDash).isDirectory()) {
        found = candDash; took = take; break;
      }
      if (fs.existsSync(baseUs) && fs.statSync(baseUs).isDirectory()) {
        found = candUs; took = take; break;
      }
    }
    if (!found) { found = parts[0]; took = 1; }
    current = path.join(current, found);
    parts = parts.slice(took);
  }
  return current;
}

// ---------------------------------------------------------------------------
// Source 4: tmux liveness signal
// ---------------------------------------------------------------------------

interface TmuxInfo { createdAt: number; lastActivity: number; }

function getTmuxSessions(): Map<string, TmuxInfo> {
  const map = new Map<string, TmuxInfo>();
  const r = spawnSync('tmux', ['ls', '-F', '#{session_name} #{session_created} #{session_activity}'], { encoding: 'utf-8' });
  if (r.status !== 0) return map;
  for (const line of r.stdout.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (!parts[0]?.startsWith('tc-')) continue;
    const aid = parts[0].slice(3);
    if (!AGENT_ID_RE.test(aid)) continue;
    map.set(aid, {
      createdAt: parseInt(parts[1]) * 1000,
      lastActivity: parseInt(parts[2]) * 1000,
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Source 5: running-processes.json (live agents with full state)
// ---------------------------------------------------------------------------

interface RunningProcess {
  agentId: string;
  sessionId?: string;
  lastRequest?: any;
}

function loadRunningProcesses(dataDir: string): Map<string, RunningProcess> {
  const map = new Map<string, RunningProcess>();
  for (const fname of ['running-processes.json', 'running-processes.json.bak']) {
    const fp = path.join(dataDir, fname);
    const data = readJson<{ processes?: RunningProcess[] }>(fp);
    if (data?.processes) {
      for (const p of data.processes) {
        if (!map.has(p.agentId)) map.set(p.agentId, p);
      }
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Spiral position layout — keeps recovered agents from stacking on top of each other
// ---------------------------------------------------------------------------

function spiralPosition(idx: number): { x: number; y: number; z: number } {
  const a = 1.5, b = 0.55;
  const t = idx * 0.6;
  const r = a + b * t;
  return {
    x: parseFloat((r * Math.cos(t)).toFixed(6)),
    y: 0,
    z: parseFloat((r * Math.sin(t)).toFixed(6)),
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function loadSeedAgents(dataDir: string): Map<string, StoredAgent> {
  // Any existing agents.json or before-recovery backup is a strong seed:
  // it has agents the logs may no longer reference.
  const seed = new Map<string, StoredAgent>();
  const candidates = [
    path.join(dataDir, 'agents.json'),
    ...fs.readdirSync(dataDir)
      .filter(f => f.startsWith('agents.json.before-recovery-'))
      .sort()
      .reverse() // newest first
      .map(f => path.join(dataDir, f)),
    path.join(dataDir, 'agents.json.bak'),
  ];
  for (const fp of candidates) {
    const data = readJson<{ agents?: StoredAgent[] }>(fp);
    if (!data?.agents) continue;
    for (const a of data.agents) {
      if (!seed.has(a.id)) seed.set(a.id, a);
    }
  }
  log(`  loaded ${seed.size} agent(s) from existing agents.json + backups`);
  return seed;
}

function build(): { agents: StoredAgent[]; stats: Record<string, number> } {
  log('Loading sources…');
  const delegation = readJson<{ histories: Record<string, any[]> }>(path.join(DATA_DIR, 'delegation-history.json')) || { histories: {} };
  const sessionHist = readJson<{ histories: Record<string, any[]> }>(path.join(DATA_DIR, 'session-history.json')) || { histories: {} };

  const seed = loadSeedAgents(DATA_DIR);
  const meta = extractAgentMetaFromTranscripts();
  const agentSessions = extractAgentSessionsFromTranscripts();
  const tmux = getTmuxSessions();
  const running = loadRunningProcesses(DATA_DIR);

  // Boss IDs (agents with delegation history entries)
  const bossIds = new Set(Object.keys(delegation.histories));

  // Subordinate → most recent boss
  const subordToBoss = new Map<string, { bossId: string; ts: number }>();
  const bossSubords = new Map<string, Set<string>>();
  for (const [bossId, entries] of Object.entries(delegation.histories)) {
    const subs = new Set<string>();
    for (const d of entries) {
      const sid: string = d.selectedAgentId;
      const ts: number = d.timestamp || 0;
      if (!sid) continue;
      subs.add(sid);
      const cur = subordToBoss.get(sid);
      if (!cur || cur.ts < ts) subordToBoss.set(sid, { bossId, ts });
    }
    if (subs.size) bossSubords.set(bossId, subs);
  }

  // ========== TARGET LIST ==========
  // Include: anyone in the seed, anyone with name/class in logs, anyone running.
  const targetIds = new Set<string>([...seed.keys(), ...meta.keys(), ...running.keys()]);

  // Sort by recency (most recent activity first) for deterministic spiral
  const activity = (id: string) => Math.max(
    meta.get(id)?.mtime || 0,
    agentSessions.get(id)?.mtime || 0,
    Math.floor((tmux.get(id)?.lastActivity || 0) / 1000),
  );
  const sortedIds = [...targetIds].sort((a, b) => activity(b) - activity(a));

  // ========== BUILD ==========
  const agents: StoredAgent[] = [];
  for (const [idx, aid] of sortedIds.entries()) {
    const seedA = seed.get(aid);
    const m = meta.get(aid);
    const sess = agentSessions.get(aid);
    const tm = tmux.get(aid);
    const proc = running.get(aid);

    // Name + class — priority: running process > transcripts > seed
    let name = m?.name || seedA?.name;
    let cls = m?.class || seedA?.class;
    if (proc?.lastRequest?.customAgent) {
      const ca = proc.lastRequest.customAgent;
      if (ca.name) cls = ca.name;
      const promptText: string = ca.definition?.prompt || '';
      const nameMatch = promptText.match(/You are agent \*\*([^*]+)\*\*/);
      if (nameMatch) name = nameMatch[1].trim();
    }
    if (!name) name = `Agent ${aid.slice(0, 6)}`;
    if (!cls) cls = 'caterpie';

    // CWD — priority: running process > seed > session > decoded encoded dir
    let cwd = seedA?.cwd || '/home/riven/d/';
    if (proc?.lastRequest?.workingDir) {
      cwd = proc.lastRequest.workingDir;
    } else if (sess?.cwd) {
      cwd = sess.cwd;
    } else if (sess?.encodedDir) {
      cwd = decodeCwdFromEncoded(sess.encodedDir) || cwd;
    }
    if (!cwd.endsWith('/')) cwd += '/';

    // sessionId — priority: running process > new scan > seed
    const sessionId = proc?.sessionId || sess?.sessionId || seedA?.sessionId;

    // Timestamps — prefer tmux (most accurate), then session, then transcript mtime, then seed
    let createdAt: number;
    let lastActivity: number;
    if (tm) {
      createdAt = tm.createdAt;
      lastActivity = tm.lastActivity;
    } else if (sess) {
      createdAt = sess.mtime * 1000;
      lastActivity = sess.mtime * 1000;
    } else if (seedA) {
      createdAt = seedA.createdAt;
      lastActivity = seedA.lastActivity;
    } else {
      createdAt = (m?.mtime || Math.floor(Date.now() / 1000)) * 1000;
      lastActivity = createdAt;
    }
    // Pull min/max from session-history if available
    const sh = sessionHist.histories[aid];
    if (sh?.length) {
      const earliest = Math.min(...sh.map((s: any) => s.startedAt));
      const latest = Math.max(...sh.map((s: any) => s.endedAt));
      if (earliest && earliest < createdAt) createdAt = earliest;
      if (latest && latest > lastActivity) lastActivity = latest;
    }

    const agent: StoredAgent = {
      id: aid,
      name,
      class: cls,
      provider: 'claude',
      position: spiralPosition(idx),
      cwd,
      tokensUsed: 0,
      contextUsed: 0,
      contextLimit: 200000,
      taskCount: 0,
      permissionMode: 'bypass',
      useChrome: false,
      model: 'sonnet',
      createdAt,
      lastActivity,
    };

    if (sessionId) agent.sessionId = sessionId;
    if (bossIds.has(aid)) {
      agent.isBoss = true;
      const subs = [...(bossSubords.get(aid) || [])].filter(s => targetIds.has(s));
      if (subs.length) agent.subordinateIds = subs;
    } else {
      const sb = subordToBoss.get(aid);
      if (sb && targetIds.has(sb.bossId)) agent.bossId = sb.bossId;
    }

    // Pull running-process model/permission overrides
    if (proc?.lastRequest) {
      agent.model = proc.lastRequest.model || agent.model;
      agent.useChrome = proc.lastRequest.useChrome ?? agent.useChrome;
      agent.permissionMode = proc.lastRequest.permissionMode || agent.permissionMode;
    }

    agents.push(agent);
  }

  const stats = {
    total: agents.length,
    boss: agents.filter(a => a.isBoss).length,
    withSession: agents.filter(a => a.sessionId).length,
    liveTmux: agents.filter(a => tmux.has(a.id)).length,
    runningProcesses: agents.filter(a => running.has(a.id)).length,
  };

  return { agents, stats };
}

// ---------------------------------------------------------------------------
// Apply (server restart sequence)
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

async function checkServer(): Promise<boolean> {
  try {
    const r = await fetch(`${SERVER_URL}/api/agents/simple`, { headers: { 'X-Auth-Token': AUTH_TOKEN } });
    return r.ok;
  } catch { return false; }
}

async function findServerPid(): Promise<number | null> {
  try {
    const out = execSync(`pgrep -f "node.*src/packages/server/index.ts" || true`, { encoding: 'utf-8' });
    const pid = parseInt(out.trim().split('\n').pop() || '');
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}

async function apply(stagedFile: string, agentsFile: string): Promise<void> {
  log('');
  log('=== APPLY ===');

  const wasUp = await checkServer();
  if (!wasUp) {
    warn('Server is not running — copying files but skipping restart.');
    fs.copyFileSync(stagedFile, agentsFile);
    fs.rmSync(agentsFile + '.bak', { force: true });
    log('Wrote agents.json. Start the server and it will load the recovered agents.');
    return;
  }

  const pid = await findServerPid();
  if (!pid) {
    throw new Error('Could not find server process (looked for "node.*src/packages/server/index.ts"). Stop the server manually, run again with --apply.');
  }

  log(`Killing server (PID ${pid})…`);
  process.kill(pid, 'SIGTERM');

  // Wait for port to free
  for (let i = 0; i < 30; i++) {
    if (!await checkServer()) { log(`  port freed after ${i * 200}ms`); break; }
    await sleep(200);
  }

  log('Copying recovered file…');
  fs.copyFileSync(stagedFile, agentsFile);
  fs.rmSync(agentsFile + '.bak', { force: true });

  log('Triggering tsx watch restart (touch index.ts)…');
  const now = Date.now() / 1000;
  fs.utimesSync(SERVER_FILE, now, now);

  log('Waiting for server to come back…');
  for (let i = 0; i < 60; i++) {
    if (await checkServer()) { log(`  server back after ${i + 1}s`); break; }
    await sleep(1000);
  }

  // Verify
  await sleep(2000);
  const r = await fetch(`${SERVER_URL}/api/agents/simple`, { headers: { 'X-Auth-Token': AUTH_TOKEN } });
  const live = await r.json();
  const onDisk = readJson<{ agents: any[] }>(agentsFile);
  log(`Server: ${live.length} agent(s) in memory; disk: ${onDisk?.agents.length ?? 0}`);
  if (live.length < 5) {
    warn('Server reports very few agents — check the data dir manually.');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!fs.existsSync(DATA_DIR)) {
    console.error(`Data dir not found: ${DATA_DIR}`);
    process.exit(1);
  }

  const agentsFile = path.join(DATA_DIR, 'agents.json');
  const ts = Date.now();

  // Back up current agents.json (if any) before we even attempt anything
  if (fs.existsSync(agentsFile)) {
    const backup = `${agentsFile}.before-recovery-${ts}`;
    fs.copyFileSync(agentsFile, backup);
    log(`Backed up current agents.json → ${path.basename(backup)}`);
  }

  const { agents, stats } = build();

  log('');
  log('=== STATS ===');
  for (const [k, v] of Object.entries(stats)) log(`  ${k}: ${v}`);

  const out = { agents, savedAt: Date.now(), version: '1.0.0' };
  fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2));
  log('');
  log(`Wrote ${stats.total} agent(s) → ${OUTPUT}`);

  if (APPLY) {
    await apply(OUTPUT, agentsFile);
  } else {
    log('');
    log('Dry run complete. To apply:');
    log(`  tsx scripts/recover-agents.ts --apply`);
    log('');
    log('Or manually:');
    log(`  1. Stop the Tide Commander server`);
    log(`  2. cp ${OUTPUT} ${agentsFile}`);
    log(`  3. rm -f ${agentsFile}.bak`);
    log(`  4. Restart the server`);
  }
}

main().catch(err => {
  console.error('Recovery failed:', err);
  process.exit(1);
});
