/**
 * Persistence for the restart-surviving OpenCode `serve` daemon.
 *
 * Mirrors the Codex app-server recovery store. Persists, in a dedicated file:
 *  1. Daemon info — the HTTP port + pid of the detached `opencode serve` process,
 *     so a restarted commander probes it and reconnects instead of respawning.
 *  2. Per-agent session state — agentId ↔ OpenCode sessionID + turn state, so we
 *     can re-attach the SSE stream and finalize any turn that was mid-flight
 *     during the restart.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { RunnerRequest } from '../../claude/types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('OpencodeServerStore');

const DATA_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
  'tide-commander',
);
const DAEMON_FILE = path.join(DATA_DIR, 'opencode-server-daemon.json');
const AGENTS_FILE = path.join(DATA_DIR, 'opencode-server-agents.json');
export const OPENCODE_SERVER_LOG_FILE = path.join(DATA_DIR, 'opencode-server.log');

export interface DaemonInfo {
  port: number;
  pid: number;
  startedAt: number;
}

export interface PersistedOpencodeAgent {
  agentId: string;
  sessionId: string;
  workingDir: string;
  turnState: 'processing' | 'waiting_for_input';
  agentStatus?: string;
  lastRequest: RunnerRequest;
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadDaemonInfo(): DaemonInfo | null {
  try {
    if (!fs.existsSync(DAEMON_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(DAEMON_FILE, 'utf-8'));
    if (typeof data.port === 'number' && typeof data.pid === 'number') return data;
  } catch (err: any) {
    log.warn(`Failed to load daemon info: ${err.message}`);
  }
  return null;
}

export function saveDaemonInfo(info: DaemonInfo): void {
  ensureDataDir();
  try {
    fs.writeFileSync(DAEMON_FILE, JSON.stringify(info, null, 2), 'utf-8');
  } catch (err: any) {
    log.error(`Failed to save daemon info: ${err.message}`);
  }
}

export function clearDaemonInfo(): void {
  try {
    if (fs.existsSync(DAEMON_FILE)) fs.unlinkSync(DAEMON_FILE);
  } catch { /* ignore */ }
}

export function loadOpencodeAgents(): PersistedOpencodeAgent[] {
  try {
    if (!fs.existsSync(AGENTS_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch (err: any) {
    log.warn(`Failed to load opencode agents: ${err.message}`);
    return [];
  }
}

export function saveOpencodeAgents(agents: PersistedOpencodeAgent[]): void {
  ensureDataDir();
  try {
    fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2), 'utf-8');
  } catch (err: any) {
    log.error(`Failed to save opencode agents: ${err.message}`);
  }
}
