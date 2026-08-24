import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createConnection } from 'node:net';
import {
  parsePluginShellCommandArgs,
  PluginShellCommandError,
  PluginShellCommandService,
} from './plugin-shell-command-service.js';

const dirs: string[] = [];
function service(validate = vi.fn(async () => true)) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-shell-commands-'));
  dirs.push(dataDir);
  return {
    service: new PluginShellCommandService({
      dataDir,
      sudoSocketDir: path.join(dataDir, 'sockets'),
      sudoPasswordValidator: validate,
    }),
    validate,
    dataDir,
  };
}

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('parsePluginShellCommandArgs', () => {
  it('parses quoted values without evaluating shell syntax', () => {
    expect(parsePluginShellCommandArgs(`staging "two words" 'three words' '$HOME'`)).toEqual([
      'staging',
      'two words',
      'three words',
      '$HOME',
    ]);
  });

  it('rejects unclosed quotes', () => {
    expect(() => parsePluginShellCommandArgs(`"unfinished`)).toThrow(/Unclosed quote/);
  });
});

describe('PluginShellCommandService', () => {
  it('persists validated command definitions with private permissions', async () => {
    const first = service();
    const created = await first.service.create({
      name: '/Deploy',
      summary: 'Deploy safely',
      script: 'set -e\necho "$1"',
      cwd: '/tmp',
      pty: false,
    });

    expect(created).toMatchObject({ name: '/deploy', runAsSudo: false, enabled: true, pty: false });
    const reloaded = new PluginShellCommandService({ dataDir: first.dataDir });
    expect(await reloaded.list()).toMatchObject([{ id: created.id, name: '/deploy' }]);
    expect(fs.statSync(path.join(first.dataDir, 'commands.json')).mode & 0o777).toBe(0o600);
  });

  it('prepares positional arguments and rejects duplicate names', async () => {
    const { service: commands } = service();
    const command = await commands.create({ name: '/ship', summary: 'Ship', script: 'echo "$1"' });
    await expect(commands.create({ name: 'SHIP', summary: 'Other', script: 'true' }))
      .rejects.toMatchObject({ code: 'SHELL_COMMAND_EXISTS' });

    await expect(commands.prepare(command.id, 'agent-1', `"release candidate" '; rm -rf /'`)).resolves.toMatchObject({
      invocation: `/ship 'release candidate' '; rm -rf /'`,
      args: ['release candidate', '; rm -rf /'],
      requiresSudo: false,
    });
  });

  it('creates agent-triggered sudo challenges from literal argument arrays', async () => {
    const { service: commands } = service();
    const command = await commands.create({
      name: '/flash',
      summary: 'Flash board',
      script: 'sudo flash "$1"',
      runAsSudo: true,
    });

    const prepared = await commands.prepareArgs(command.id, 'agent-1', ['pcb; echo unsafe']);
    expect(prepared).toMatchObject({
      commandId: command.id,
      invocation: "/flash 'pcb; echo unsafe'",
      args: ['pcb; echo unsafe'],
      requiresSudo: true,
      challengeId: expect.any(String),
      expiresAt: expect.any(Number),
    });
    await commands.authorizeSudo(prepared.challengeId!, 'secret');
    const execution = await commands.prepareExecution(
      command.id,
      'agent-1',
      prepared.args,
      prepared.challengeId,
    );
    expect(execution.requestedByAgent).toBe(true);
    execution.sudoPassword?.fill(0);
  });

  it('requires a matching one-time sudo authorization', async () => {
    const { service: commands, validate } = service();
    const command = await commands.create({
      name: '/upgrade',
      summary: 'Upgrade packages',
      script: 'apt update',
      runAsSudo: true,
    });
    const prepared = await commands.prepare(command.id, 'agent-1', 'safe');

    await expect(commands.prepareExecution(command.id, 'agent-1', prepared.args))
      .rejects.toMatchObject({ statusCode: 428, code: 'SUDO_PASSWORD_REQUIRED' });
    await commands.authorizeSudo(prepared.challengeId!, 'secret');
    expect(validate).toHaveBeenCalledWith('secret');
    await expect(commands.prepareExecution(command.id, 'agent-2', prepared.args, prepared.challengeId))
      .rejects.toMatchObject({ code: 'SUDO_AUTHORIZATION_MISMATCH' });
    const execution = await commands.prepareExecution(command.id, 'agent-1', prepared.args, prepared.challengeId);
    expect(execution).toMatchObject({ invocation: "/upgrade 'safe'", requestedByAgent: false });
    execution.sudoPassword?.fill(0);
    await expect(commands.prepareExecution(command.id, 'agent-1', prepared.args, prepared.challengeId))
      .rejects.toBeInstanceOf(PluginShellCommandError);
  });

  it('materializes sudo helpers without writing a password into files or environment', async () => {
    const { service: commands } = service();
    const materialized = await commands.materializeScript('sudo id', true);
    const wrapper = fs.readFileSync(path.join(path.dirname(materialized.filePath), 'bin', 'sudo'), 'utf8');
    const askpass = fs.readFileSync(materialized.sudoEnv!.SUDO_ASKPASS, 'utf8');

    expect(wrapper).toContain('/usr/bin/sudo -A');
    expect(askpass).toContain('/usr/bin/socat');
    expect(materialized.sudoEnv).toMatchObject({ SUDO_ASKPASS_REQUIRE: 'force' });
    expect(Buffer.byteLength(materialized.sudoSocketPath!)).toBeLessThan(104);
    expect(materialized.sudoSocketPath).not.toContain(path.dirname(materialized.filePath));
    expect(JSON.stringify(materialized.sudoEnv)).not.toContain('secret');

    const password = Buffer.from('secret');
    const channel = await commands.openSudoCredentialChannel(materialized.sudoSocketPath!, password);
    const received = await new Promise<string>((resolve, reject) => {
      const socket = createConnection(materialized.sudoSocketPath!);
      let value = '';
      socket.on('data', (chunk) => { value += chunk.toString(); });
      socket.on('end', () => resolve(value));
      socket.on('error', reject);
    });
    expect(received).toBe('secret\n');
    await channel.close();
    expect(password.every((byte) => byte === 0)).toBe(true);

    await materialized.cleanup();
    expect(fs.existsSync(path.dirname(materialized.filePath))).toBe(false);
  });

  it('does not authorize an incorrect sudo password', async () => {
    const { service: commands } = service(vi.fn(async () => false));
    const command = await commands.create({ name: '/root', summary: 'Root', script: 'id', runAsSudo: true });
    const prepared = await commands.prepare(command.id, 'agent-1', '');
    await expect(commands.authorizeSudo(prepared.challengeId!, 'wrong'))
      .rejects.toMatchObject({ statusCode: 401, code: 'SUDO_PASSWORD_INVALID' });
  });
});
