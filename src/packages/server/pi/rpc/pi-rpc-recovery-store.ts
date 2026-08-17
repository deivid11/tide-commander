import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { RunnerRequest } from '../../claude/types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('PiRpcStore');

const DATA_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
  'tide-commander',
);
const STORE_FILE = path.join(DATA_DIR, 'pi-rpc-processes.json');

export interface PersistedPiRpcProcess {
  agentId: string;
  sessionId?: string;
  workingDir: string;
  model?: string;
  effort?: string;
  startTime: number;
  turnState: 'processing' | 'waiting_for_input';
  agentStatus?: string;
  tmuxSession: string;
  tmuxLogOffset: number;
  lastRequest?: RunnerRequest;
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadPiRpcProcesses(): PersistedPiRpcProcess[] {
  try {
    if (!fs.existsSync(STORE_FILE)) return [];
    const value = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
    return Array.isArray(value) ? value : [];
  } catch (err) {
    log.error('Failed to load Pi RPC recovery state:', err);
    return [];
  }
}

export function savePiRpcProcesses(processes: PersistedPiRpcProcess[]): void {
  ensureDataDir();
  try {
    const tmp = `${STORE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(processes, null, 2), 'utf-8');
    fs.renameSync(tmp, STORE_FILE);
  } catch (err) {
    log.error('Failed to persist Pi RPC recovery state:', err);
  }
}

export function clearPiRpcProcesses(): void {
  try {
    if (fs.existsSync(STORE_FILE)) fs.unlinkSync(STORE_FILE);
  } catch (err) {
    log.error('Failed to clear Pi RPC recovery state:', err);
  }
}
