import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ServerMessage } from '../../../shared/types.js';
import type { PluginCommandContext } from '../../../shared/plugin-types.js';
import { EXECUTE_SUDO_COMMAND_ID } from '../../services/plugin-shell-command-service.js';
import { PluginManager } from '../manager.js';
import {
  createExecuteSudoCommandPlugin,
  resolveSudoCommandArgs,
} from './execute-sudo-command.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-execute-sudo-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function context(overrides: Partial<PluginCommandContext> = {}): PluginCommandContext {
  return {
    pluginId: 'execute-sudo-command',
    command: '/execute-sudo-command',
    agentId: 'agent-1',
    invokedAs: '/execute-sudo-command',
    rawCommand: '/execute-sudo-command',
    argsText: '',
    args: [],
    body: {},
    ...overrides,
  };
}

describe('Execute Sudo Command plugin', () => {
  it('accepts literal argv or a command field without evaluating shell syntax', () => {
    expect(resolveSudoCommandArgs(context({ args: ['touch', '/opt/test'] })))
      .toEqual(['touch', '/opt/test']);
    expect(resolveSudoCommandArgs(context({ body: { command: "sh -c 'echo ok | tee /opt/test'" } })))
      .toEqual(['sh', '-c', 'echo ok | tee /opt/test']);
  });

  it('emits the private challenge card but returns only a safe agent acknowledgement', async () => {
    const prepareArgs = vi.fn(async () => ({
      commandId: EXECUTE_SUDO_COMMAND_ID,
      invocation: "/execute-sudo-command 'touch' '/opt/test'",
      args: ['touch', '/opt/test'],
      requiresSudo: true,
      challengeId: 'private-challenge',
      expiresAt: Date.now() + 600_000,
    }));
    const manager = new PluginManager({
      dataDir: path.join(root, 'state'),
      builtins: [createExecuteSudoCommandPlugin({ shellCommands: { prepareArgs } })],
    });
    const broadcasts: ServerMessage[] = [];
    manager.setBroadcast((message) => broadcasts.push(message));
    await manager.initialize();

    const output = await manager.executeCommand('execute-sudo-command', 'execute-sudo-command', {
      agentId: 'agent-1',
      args: ['touch', '/opt/test'],
    });

    expect(prepareArgs).toHaveBeenCalledWith(
      EXECUTE_SUDO_COMMAND_ID,
      'agent-1',
      ['touch', '/opt/test'],
      true,
    );
    expect(output).toMatchObject({
      rendererId: 'sudo-command-requested',
      data: {
        kind: 'sudo-command-requested',
        status: 'awaiting-user-authorization',
      },
    });
    expect(JSON.stringify(output)).not.toContain('private-challenge');
    expect(broadcasts).toContainEqual(expect.objectContaining({
      type: 'plugin_output',
      payload: expect.objectContaining({
        agentId: 'agent-1',
        output: expect.objectContaining({
          pluginId: 'shell-commands',
          rendererId: 'shell-command-sudo-request',
          data: expect.objectContaining({ challengeId: 'private-challenge' }),
        }),
      }),
    }));
    await manager.shutdown();
  });
});
