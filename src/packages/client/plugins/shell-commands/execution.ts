import { useSyncExternalStore } from 'react';
import { apiUrl, authFetch } from '../../utils/storage';
import { getPluginSlashCommands } from '../registry';
import type { PluginShellCommandPrepareResult, RegisteredPluginSlashCommand } from '../types';

export const SHELL_COMMAND_PLUGIN_ID = 'shell-commands';

export interface ShellCommandExecutionResult {
  kind: 'started';
  command: string;
}

interface PasswordPromptSnapshot {
  challengeId: string;
  commandId: string;
  invocation: string;
  agentId: string;
  args: string[];
  busy: boolean;
  insecureRemoteTransport: boolean;
  error?: string;
}

interface ExecutionSnapshot {
  prompt: PasswordPromptSnapshot | null;
  backgroundError: string | null;
}

interface PendingPrompt {
  prepared: PluginShellCommandPrepareResult;
  agentId: string;
  resolve: (result: ShellCommandExecutionResult) => void;
  reject: (error: Error) => void;
}

const listeners = new Set<() => void>();
let pendingPrompt: PendingPrompt | null = null;
let snapshot: ExecutionSnapshot = { prompt: null, backgroundError: null };

function emit(next: ExecutionSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useShellCommandExecutionState(): ExecutionSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

function responseError(body: unknown, status: number, fallback: string): string {
  return body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
    ? (body as { error: string }).error
    : `${fallback} (${status})`;
}

export function usesInsecureRemoteTransport(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.location.protocol === 'https:') return false;
  const hostname = window.location.hostname.toLowerCase();
  return !['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
}

function argsTextFromInvocation(invocation: string): string {
  const trimmed = invocation.trim();
  const token = trimmed.split(/\s+/, 1)[0] ?? '';
  return trimmed.slice(token.length).trim();
}

async function prepareExecution(
  commandId: string,
  invocation: string,
  agentId: string,
): Promise<PluginShellCommandPrepareResult> {
  const response = await authFetch(apiUrl(
    `/api/plugins/shell-commands/${encodeURIComponent(commandId)}/prepare`,
  ), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, argsText: argsTextFromInvocation(invocation) }),
  });
  const body = await response.json().catch(() => null) as { prepared?: PluginShellCommandPrepareResult } | null;
  if (!response.ok || !body?.prepared) {
    throw new Error(responseError(body, response.status, 'Unable to prepare shell command'));
  }
  return body.prepared;
}

export function startStreamedExec(
  prepared: PluginShellCommandPrepareResult,
  agentId: string,
  sudoAuthorization?: string,
  outputFilters: { tail?: number; grep?: string } = {},
): void {
  // POST /api/exec intentionally remains open until completion. Do not await it:
  // exec_task_* WebSocket events drive the live Guake widget immediately.
  void authFetch(apiUrl('/api/exec'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId,
      shellCommandId: prepared.commandId,
      shellArgs: prepared.args,
      ...(sudoAuthorization ? { sudoAuthorization } : {}),
      ...(outputFilters.tail ? { tail: outputFilters.tail } : {}),
      ...(outputFilters.grep ? { grep: outputFilters.grep } : {}),
    }),
  }).then(async (response) => {
    if (response.ok) return;
    const body = await response.json().catch(() => null);
    emit({ ...snapshot, backgroundError: responseError(body, response.status, 'Shell command failed to start') });
  }).catch((error) => {
    emit({ ...snapshot, backgroundError: error instanceof Error ? error.message : String(error) });
  });
}

export async function executeShellSlashCommand(
  commandId: string,
  invocation: string,
  explicitAgentId?: string,
): Promise<ShellCommandExecutionResult> {
  const agentId = explicitAgentId ?? '';
  if (!agentId) throw new Error('Select an active agent before running this command');
  if (pendingPrompt) throw new Error('Finish the current sudo authorization first');

  const prepared = await prepareExecution(commandId, invocation, agentId);
  if (!prepared.requiresSudo) {
    startStreamedExec(prepared, agentId);
    return { kind: 'started', command: prepared.invocation };
  }
  if (!prepared.challengeId) throw new Error('Server returned an invalid sudo challenge');

  return new Promise<ShellCommandExecutionResult>((resolve, reject) => {
    pendingPrompt = { prepared, agentId, resolve, reject };
    emit({
      ...snapshot,
      prompt: {
        challengeId: prepared.challengeId!,
        commandId: prepared.commandId,
        invocation: prepared.invocation,
        agentId,
        args: prepared.args,
        busy: false,
        insecureRemoteTransport: usesInsecureRemoteTransport(),
      },
    });
  });
}

export async function submitShellCommandSudoPassword(password: string): Promise<void> {
  const pending = pendingPrompt;
  if (!pending || !snapshot.prompt) return;
  if (!password) {
    emit({ ...snapshot, prompt: { ...snapshot.prompt, error: 'Enter your sudo password' } });
    return;
  }
  emit({ ...snapshot, prompt: { ...snapshot.prompt, busy: true, error: undefined } });
  try {
    const response = await authFetch(apiUrl('/api/plugins/shell-commands/sudo/authorize'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId: pending.prepared.challengeId, password }),
    });
    const body = await response.json().catch(() => null) as { authorizationId?: string } | null;
    if (!response.ok || !body?.authorizationId) {
      throw new Error(responseError(body, response.status, 'Sudo authorization failed'));
    }
    pendingPrompt = null;
    emit({ ...snapshot, prompt: null });
    startStreamedExec(pending.prepared, pending.agentId, body.authorizationId);
    pending.resolve({ kind: 'started', command: pending.prepared.invocation });
  } catch (error) {
    emit({
      ...snapshot,
      prompt: snapshot.prompt ? {
        ...snapshot.prompt,
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      } : null,
    });
  }
}

export function cancelShellCommandSudoPrompt(): void {
  const pending = pendingPrompt;
  pendingPrompt = null;
  emit({ ...snapshot, prompt: null });
  pending?.reject(new Error('Shell command execution cancelled'));
}

export function reportShellCommandExecutionError(error: unknown): void {
  emit({
    ...snapshot,
    backgroundError: error instanceof Error ? error.message : String(error),
  });
}

export function dismissShellCommandExecutionError(): void {
  emit({ ...snapshot, backgroundError: null });
}

export function findShellSlashCommand(invocation: string): RegisteredPluginSlashCommand | undefined {
  const token = invocation.trim().split(/\s+/, 1)[0]?.toLowerCase();
  if (!token) return undefined;
  return getPluginSlashCommands().find((command) => (
    command.pluginId === SHELL_COMMAND_PLUGIN_ID
    && (command.name.toLowerCase() === token || command.aliases?.some((alias) => alias.toLowerCase() === token))
  ));
}
