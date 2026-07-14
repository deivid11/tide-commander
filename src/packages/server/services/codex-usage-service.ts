import { spawn } from 'child_process';
import type { Agent } from '../../shared/types.js';
import { getCodexBinaryPath } from './system-prompt-service.js';

export interface CodexRateLimitWindow {
  utilization: number;
  resetsAt: string;
  windowDurationMins: number | null;
}

export interface CodexUsageSnapshot {
  provider: 'codex';
  fetchedAt: number;
  rateLimits: { daily: CodexRateLimitWindow | null; weekly: CodexRateLimitWindow | null } | null;
  rateLimitsError: string | null;
  cliHint: string;
}

interface RawWindow { usedPercent?: unknown; resetsAt?: unknown; windowDurationMins?: unknown }

export function classifyCodexRateLimits(raw: { primary?: RawWindow | null; secondary?: RawWindow | null } | null | undefined) {
  const result: { daily: CodexRateLimitWindow | null; weekly: CodexRateLimitWindow | null } = { daily: null, weekly: null };
  for (const value of [raw?.primary, raw?.secondary]) {
    if (!value || typeof value.usedPercent !== 'number') continue;
    const mins = typeof value.windowDurationMins === 'number' ? value.windowDurationMins : null;
    const resetsAtSeconds = typeof value.resetsAt === 'number' ? value.resetsAt : 0;
    const window = {
      utilization: Math.max(0, Math.min(100, value.usedPercent)),
      resetsAt: resetsAtSeconds > 0 ? new Date(resetsAtSeconds * 1000).toISOString() : '',
      windowDurationMins: mins,
    };
    // App-server identifies windows by duration rather than by name. Anything
    // up to two days is the daily allowance; longer periods are weekly.
    if (mins !== null && mins <= 2 * 24 * 60) result.daily = window;
    else result.weekly = window;
  }
  return result;
}

function readNativeRateLimits(): Promise<{ primary?: RawWindow | null; secondary?: RawWindow | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(getCodexBinaryPath(), ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (err?: Error, value?: { primary?: RawWindow | null; secondary?: RawWindow | null }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGTERM');
      if (err) reject(err); else resolve(value ?? {});
    };
    const timer = setTimeout(() => finish(new Error('Codex usage request timed out')), 10_000);
    child.on('error', (err) => finish(err));
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
      const lines = stdout.split('\n');
      stdout = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.id === 1 && message.result) {
            child.stdin?.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
            child.stdin?.write(`${JSON.stringify({ id: 2, method: 'account/rateLimits/read', params: {} })}\n`);
          } else if (message.id === 2) {
            if (message.error) finish(new Error(message.error.message || 'Codex rejected the usage request'));
            else finish(undefined, message.result?.rateLimits ?? {});
          }
        } catch { /* wait for the next complete JSON line */ }
      }
    });
    child.on('close', (code) => {
      if (!settled) finish(new Error(stderr.trim() || `Codex app-server exited with code ${code}`));
    });
    child.stdin?.write(`${JSON.stringify({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'tide-commander', title: 'Tide Commander', version: '1.0.0' }, capabilities: { experimentalApi: true } },
    })}\n`);
  });
}

let cache: { expiresAt: number; snapshot: CodexUsageSnapshot } | null = null;

export async function buildCodexUsageSnapshot(_agent: Agent): Promise<CodexUsageSnapshot> {
  if (cache && cache.expiresAt > Date.now()) return cache.snapshot;
  let snapshot: CodexUsageSnapshot;
  try {
    const rateLimits = classifyCodexRateLimits(await readNativeRateLimits());
    snapshot = { provider: 'codex', fetchedAt: Date.now(), rateLimits, rateLimitsError: null, cliHint: 'Run /status in Codex to see current usage limits.' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    snapshot = { provider: 'codex', fetchedAt: Date.now(), rateLimits: null, rateLimitsError: message, cliHint: 'Run /status in Codex to see current usage limits.' };
  }
  cache = { expiresAt: Date.now() + 60_000, snapshot };
  return snapshot;
}
