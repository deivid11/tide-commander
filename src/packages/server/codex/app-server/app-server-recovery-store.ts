/**
 * Persistence for the restart-surviving Codex app-server.
 *
 * Two things are persisted, in a dedicated file (never the shared
 * running-processes.json), so a restarted commander can rejoin a still-running
 * app-server and its in-flight turns:
 *
 *  1. Daemon info — the `ws://` port + pid of the detached `codex app-server`
 *     process. On boot we probe it; if alive we reconnect instead of spawning.
 *  2. Per-agent thread state — agentId ↔ threadId (== sessionId) + turn state, so
 *     we can re-subscribe (thread/resume) to each agent's thread and finalize any
 *     turn that was mid-flight during the restart.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { RunnerRequest } from '../../claude/types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('CodexAppServerStore');

const DATA_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
  'tide-commander',
);
const DAEMON_FILE = path.join(DATA_DIR, 'codex-app-server-daemon.json');
const AGENTS_FILE = path.join(DATA_DIR, 'codex-app-server-agents.json');
export const APP_SERVER_LOG_FILE = path.join(DATA_DIR, 'codex-app-server.log');

export interface DaemonInfo {
  port: number;
  pid: number;
  startedAt: number;
}

export interface PersistedAppServerAgent {
  agentId: string;
  threadId: string;
  workingDir: string;
  turnState: 'processing' | 'waiting_for_input';
  /** Agent status at persist time — decides finalize vs keep-working on recovery. */
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

export function loadAppServerAgents(): PersistedAppServerAgent[] {
  try {
    if (!fs.existsSync(AGENTS_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch (err: any) {
    log.warn(`Failed to load app-server agents: ${err.message}`);
    return [];
  }
}

export function saveAppServerAgents(agents: PersistedAppServerAgent[]): void {
  ensureDataDir();
  try {
    fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2), 'utf-8');
  } catch (err: any) {
    log.error(`Failed to save app-server agents: ${err.message}`);
  }
}
