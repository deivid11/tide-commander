/**
 * Crash-recovery persistence for interactive-TUI agents.
 *
 * The interactive `claude` TUI runs in a detached tmux session that survives a
 * commander restart. To keep streaming resilient across restarts we persist, for
 * each active interactive agent, enough state to reconnect: the session id, the
 * transcript path, and the byte offset we have read up to. On startup the runner
 * reconnects to any still-alive session and resumes tailing from that offset —
 * no gap, no full-history replay.
 *
 * This is a dedicated, isolated file (NOT the shared running-processes.json used
 * by the headless/codex/opencode runners) so the two persistence schemes can't
 * interfere with each other's recovery or cross-kill tmux sessions.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { RunnerRequest } from '../types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('Interactive');

const DATA_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
  'tide-commander',
);
const STORE_FILE = path.join(DATA_DIR, 'interactive-processes.json');

export interface InteractivePersistedProcess {
  agentId: string;
  sessionId: string;
  workingDir: string;
  jsonlPath: string;
  /** Byte offset reached in the transcript at persist time. */
  jsonlOffset: number;
  tmuxSession: string;
  startTime: number;
  turnState: 'processing' | 'waiting_for_input';
  /** The agent's status at persist time (used to decide finalize vs keep-working). */
  agentStatus?: string;
  /** Last run request, so a dead session could be resumed if needed. */
  lastRequest?: RunnerRequest;
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function saveInteractiveProcesses(processes: InteractivePersistedProcess[]): void {
  ensureDataDir();
  try {
    // Atomic-ish write: temp file + rename, so a crash mid-write can't corrupt
    // the store and leave us unable to recover anything.
    const tmp = `${STORE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(processes, null, 2), 'utf-8');
    fs.renameSync(tmp, STORE_FILE);
  } catch (err) {
    log.error('Failed to persist interactive processes:', err);
  }
}

export function loadInteractiveProcesses(): InteractivePersistedProcess[] {
  try {
    if (!fs.existsSync(STORE_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
    return Array.isArray(raw) ? (raw as InteractivePersistedProcess[]) : [];
  } catch (err) {
    log.error('Failed to load interactive processes:', err);
    return [];
  }
}

export function clearInteractiveProcesses(): void {
  try {
    if (fs.existsSync(STORE_FILE)) {
      fs.unlinkSync(STORE_FILE);
    }
  } catch (err) {
    log.error('Failed to clear interactive processes:', err);
  }
}
