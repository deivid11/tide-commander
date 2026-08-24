import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import {
  cancelShellCommandSudoPrompt,
  dismissShellCommandExecutionError,
  submitShellCommandSudoPassword,
  useShellCommandExecutionState,
} from './execution';

export function ShellCommandExecutionHost() {
  const { prompt, backgroundError } = useShellCommandExecutionState();
  const [password, setPassword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPassword('');
    if (prompt) window.setTimeout(() => inputRef.current?.focus(), 30);
  }, [prompt?.challengeId]);

  useEffect(() => {
    if (!prompt) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || prompt.busy) return;
      event.preventDefault();
      event.stopPropagation();
      cancelShellCommandSudoPrompt();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [prompt]);

  if (prompt) {
    return (
      <div className="shell-command-sudo-overlay" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !prompt.busy) cancelShellCommandSudoPrompt();
      }}>
        <form className="shell-command-sudo-modal" role="dialog" aria-modal="true" aria-labelledby="shell-sudo-title" onSubmit={(event) => {
          event.preventDefault();
          void submitShellCommandSudoPassword(password).finally(() => setPassword(''));
        }}>
          <header>
            <span className="shell-command-sudo-modal__icon"><Icon name="lock" size={18} /></span>
            <div>
              <h2 id="shell-sudo-title">Sudo authorization</h2>
              <p>This script may invoke sudo on the Commander host.</p>
            </div>
          </header>
          <code>{prompt.invocation}</code>
          {prompt.insecureRemoteTransport && (
            <div className="shell-command-sudo-modal__transport-warning" role="alert">
              <Icon name="warn" size={13} />
              <span><strong>HTTP connection</strong>Your password will be sent without HTTPS transport encryption. Continue only if you trust this network or VPN.</span>
            </div>
          )}
          <label htmlFor="shell-command-sudo-password">Password</label>
          <input
            ref={inputRef}
            id="shell-command-sudo-password"
            type="password"
            value={password}
            disabled={prompt.busy}
            autoComplete="current-password"
            spellCheck={false}
            onChange={(event) => setPassword(event.target.value)}
          />
          {prompt.error && <div className="shell-command-sudo-modal__error"><Icon name="warn" size={12} /> {prompt.error}</div>}
          <div className="shell-command-sudo-modal__security">
            <Icon name="shield" size={11} /> The password uses a private sudo channel and is never persisted, logged, or streamed.
          </div>
          <footer>
            <button type="button" disabled={prompt.busy} onClick={cancelShellCommandSudoPrompt}>Cancel</button>
            <button type="submit" className="is-primary" disabled={prompt.busy || !password}>
              {prompt.busy ? 'Authorizing…' : 'Authorize and run'}
            </button>
          </footer>
        </form>
      </div>
    );
  }

  if (!backgroundError) return null;
  return (
    <div className="shell-command-error-toast" role="alert">
      <Icon name="failure" size={15} />
      <div><strong>Shell command failed</strong><span>{backgroundError}</span></div>
      <button type="button" onClick={dismissShellCommandExecutionError} aria-label="Close"><Icon name="close" size={12} /></button>
    </div>
  );
}
