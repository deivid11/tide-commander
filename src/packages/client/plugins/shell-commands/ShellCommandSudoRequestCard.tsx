import React, { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { store } from '../../store';
import { apiUrl, authFetch } from '../../utils/storage';
import type {
  PluginOutputRendererProps,
  PluginShellCommandPrepareResult,
  PluginShellCommandSudoRequestData,
} from '../types';
import { startStreamedExec, usesInsecureRemoteTransport } from './execution';

function isSudoRequestData(value: unknown): value is PluginShellCommandSudoRequestData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<PluginShellCommandSudoRequestData>;
  return data.kind === 'shell-command-sudo-request'
    && typeof data.commandId === 'string'
    && typeof data.invocation === 'string'
    && Array.isArray(data.args)
    && data.args.every((argument) => typeof argument === 'string')
    && typeof data.challengeId === 'string'
    && typeof data.expiresAt === 'number'
    && (data.tail === undefined || typeof data.tail === 'number')
    && (data.grep === undefined || typeof data.grep === 'string');
}

function responseError(body: unknown, status: number): string {
  return body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
    ? (body as { error: string }).error
    : `Sudo authorization failed (${status})`;
}

export function ShellCommandSudoRequestCard({ output, agentId }: PluginOutputRendererProps) {
  const data = isSudoRequestData(output.data) ? output.data : null;
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const insecureTransport = useMemo(usesInsecureRemoteTransport, []);
  const localExpiresAt = useMemo(() => {
    if (!data) return 0;
    const serverLifetime = output.createdAt
      ? Math.max(0, data.expiresAt - output.createdAt)
      : 10 * 60_000;
    return Date.now() + serverLifetime;
  }, [data?.challengeId, data?.expiresAt, output.createdAt]);

  useEffect(() => {
    if (!data || started) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [data, started]);

  if (!data) return <div className="shell-command-exec-missing">Invalid sudo request</div>;
  const expired = now >= localExpiresAt;
  const dismiss = () => {
    if (agentId) store.dismissPluginOutput(agentId, output.instanceId);
  };

  const authorize = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!agentId) {
      setError('The requesting agent is no longer available');
      return;
    }
    if (expired) {
      setError('This sudo authorization request expired. Ask the agent to run the command again.');
      return;
    }
    if (!password) {
      setError('Enter your sudo password');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await authFetch(apiUrl('/api/plugins/shell-commands/sudo/authorize'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: data.challengeId, password }),
      });
      const body = await response.json().catch(() => null) as { authorizationId?: string } | null;
      if (!response.ok || !body?.authorizationId) {
        throw new Error(responseError(body, response.status));
      }
      const prepared: PluginShellCommandPrepareResult = {
        commandId: data.commandId,
        invocation: data.invocation,
        args: data.args,
        requiresSudo: true,
        challengeId: data.challengeId,
        expiresAt: data.expiresAt,
      };
      startStreamedExec(prepared, agentId, body.authorizationId, {
        ...(data.tail ? { tail: data.tail } : {}),
        ...(data.grep ? { grep: data.grep } : {}),
      });
      setStarted(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPassword('');
      setBusy(false);
    }
  };

  return (
    <section className={`shell-command-sudo-request${started ? ' is-started' : ''}`}>
      <header>
        <span className="shell-command-sudo-request__icon"><Icon name={started ? 'check' : 'lock'} size={15} /></span>
        <div>
          <strong>{started ? 'Execution started' : 'Sudo authorization requested'}</strong>
          <span>{started ? 'Output is streaming in a new command card.' : 'An agent requested this trusted slash command.'}</span>
        </div>
        <button type="button" onClick={dismiss} aria-label="Dismiss sudo request"><Icon name="close" size={11} /></button>
      </header>
      <code>{data.invocation}</code>
      {(data.grep || data.tail) && (
        <div className="shell-command-sudo-request__filters">
          <Icon name="search" size={10} /> Result only:
          {data.grep && <code>grep {JSON.stringify(data.grep)}</code>}
          {data.tail && <code>tail -{data.tail}</code>}
        </div>
      )}
      {!started && (
        <form onSubmit={authorize}>
          {insecureTransport && (
            <div className="shell-command-sudo-request__warning" role="alert">
              <Icon name="warn" size={12} />
              <span><strong>HTTP connection</strong>Your password will be sent without HTTPS transport encryption. Continue only if you trust this network or VPN.</span>
            </div>
          )}
          <label htmlFor={`shell-command-sudo-${data.challengeId}`}>Password</label>
          <input
            id={`shell-command-sudo-${data.challengeId}`}
            type="password"
            value={password}
            disabled={busy || expired}
            autoComplete="current-password"
            spellCheck={false}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error && <div className="shell-command-sudo-request__error"><Icon name="warn" size={11} /> {error}</div>}
          <div className="shell-command-sudo-request__security">
            <Icon name="shield" size={10} /> The password is handled only by Commander and is never exposed to the agent.
          </div>
          <footer>
            <button type="button" onClick={dismiss} disabled={busy}>Dismiss</button>
            <button type="submit" className="is-primary" disabled={busy || expired || !password}>
              {expired ? 'Request expired' : busy ? 'Authorizing…' : 'Authorize and run'}
            </button>
          </footer>
        </form>
      )}
    </section>
  );
}
