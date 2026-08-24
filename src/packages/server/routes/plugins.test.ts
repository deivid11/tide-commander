import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

const pluginManagerMock = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  matchSlashCommand: vi.fn(),
  setExternalSlashCommands: vi.fn(),
  install: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  readClientEntry: vi.fn(),
  executeCommand: vi.fn(),
  executeAction: vi.fn(),
  publishOutput: vi.fn(),
  publishPatch: vi.fn(),
}));

const shellCommandServiceMock = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  prepare: vi.fn(),
  authorizeSudo: vi.fn(),
}));

vi.mock('../services/plugin-shell-command-service.js', () => {
  class PluginShellCommandError extends Error {
    constructor(
      message: string,
      public readonly statusCode = 400,
      public readonly code = 'SHELL_COMMAND_ERROR',
    ) {
      super(message);
    }
  }
  return { pluginShellCommandService: shellCommandServiceMock, PluginShellCommandError };
});

vi.mock('../plugins/index.js', () => {
  class PluginRuntimeError extends Error {
    constructor(
      message: string,
      public readonly statusCode = 400,
      public readonly code = 'PLUGIN_ERROR',
    ) {
      super(message);
    }
  }
  return { pluginManager: pluginManagerMock, PluginRuntimeError };
});

import pluginsRouter from './plugins.js';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/plugins', pluginsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  vi.clearAllMocks();
  pluginManagerMock.get.mockReturnValue({ id: 'shell-commands', enabled: true });
  pluginManagerMock.matchSlashCommand.mockReturnValue(null);
  shellCommandServiceMock.list.mockResolvedValue([]);
});

async function postJson(urlPath: string, body: unknown) {
  return fetch(`${baseUrl}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const output = {
  pluginId: 'example-plugin',
  rendererId: 'task-list',
  instanceId: 'instance-1',
  data: { kind: 'task-list', items: [] },
};

describe('plugin routes', () => {
  it('returns the catalog as {plugins:[...]}', async () => {
    pluginManagerMock.list.mockReturnValue([{ id: 'bolba-tasks', enabled: true }]);
    const response = await fetch(`${baseUrl}/api/plugins`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ plugins: [{ id: 'bolba-tasks', enabled: true }] });
  });

  it('returns a safe unified slash-command discovery catalog', async () => {
    pluginManagerMock.list.mockReturnValue([{
      id: 'tasks',
      enabled: true,
      contributes: { slashCommands: [{ name: '/tasks', summary: 'Tasks', aliases: ['/todo'] }] },
    }]);
    shellCommandServiceMock.list.mockResolvedValue([{
      id: 'shell-1',
      name: '/deploy',
      summary: 'Deploy',
      script: 'secret script body',
      enabled: true,
      runAsSudo: false,
    }]);

    const response = await fetch(`${baseUrl}/api/plugins/slash-commands`);
    const body = await response.json() as { commands: Array<Record<string, unknown>> };
    expect(response.status).toBe(200);
    expect(body.commands).toMatchObject([
      { kind: 'plugin', pluginId: 'tasks', name: '/tasks' },
      { kind: 'shell', commandId: 'shell-1', name: '/deploy', requiresSudo: false },
    ]);
    expect(JSON.stringify(body)).not.toContain('secret script body');
  });

  it('creates, updates, and removes managed shell commands', async () => {
    const command = { id: 'shell-1', name: '/deploy', summary: 'Deploy', script: 'true' };
    shellCommandServiceMock.create.mockResolvedValue(command);
    shellCommandServiceMock.update.mockResolvedValue({ ...command, summary: 'Deploy now' });

    const created = await postJson('/api/plugins/shell-commands', command);
    expect(created.status).toBe(201);
    expect(shellCommandServiceMock.create).toHaveBeenCalledWith(expect.objectContaining({ name: '/deploy' }));

    const updated = await fetch(`${baseUrl}/api/plugins/shell-commands/shell-1`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...command, summary: 'Deploy now' }),
    });
    expect(updated.status).toBe(200);
    expect(shellCommandServiceMock.update).toHaveBeenCalledWith('shell-1', expect.objectContaining({ summary: 'Deploy now' }));

    const removed = await fetch(`${baseUrl}/api/plugins/shell-commands/shell-1`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(shellCommandServiceMock.remove).toHaveBeenCalledWith('shell-1');
  });

  it('warns but permits sudo authorization over remote HTTP transports', async () => {
    shellCommandServiceMock.authorizeSudo.mockResolvedValue(undefined);
    const response = await fetch(`${baseUrl}/api/plugins/shell-commands/sudo/authorize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'http',
      },
      body: JSON.stringify({ challengeId: 'challenge-1', password: 'secret' }),
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      authorized: true,
      authorizationId: 'challenge-1',
      warning: expect.stringContaining('without HTTPS'),
    });
    expect(shellCommandServiceMock.authorizeSudo).toHaveBeenCalledWith('challenge-1', 'secret');
  });

  it('installs, enables, and disables plugins with wrapped catalog entries', async () => {
    pluginManagerMock.install.mockResolvedValue({ id: 'example-plugin', enabled: true });
    pluginManagerMock.enable.mockResolvedValue({ id: 'example-plugin', enabled: true });
    pluginManagerMock.disable.mockResolvedValue({ id: 'example-plugin', enabled: false });

    const installed = await postJson('/api/plugins/install', { sourcePath: '/plugins/example' });
    expect(installed.status).toBe(201);
    expect(await installed.json()).toEqual({ plugin: { id: 'example-plugin', enabled: true } });
    expect(pluginManagerMock.install).toHaveBeenCalledWith('/plugins/example');

    expect(await (await postJson('/api/plugins/example-plugin/enable', {})).json())
      .toEqual({ plugin: { id: 'example-plugin', enabled: true } });
    expect(await (await postJson('/api/plugins/example-plugin/disable', {})).json())
      .toEqual({ plugin: { id: 'example-plugin', enabled: false } });
  });

  it('serves browser modules as private JavaScript', async () => {
    pluginManagerMock.readClientEntry.mockResolvedValue({
      source: 'export function activate() {}',
      filePath: '/plugins/example/browser.js',
    });
    const response = await fetch(`${baseUrl}/api/plugins/example-plugin/client`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/javascript');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).toBe('export function activate() {}');
  });

  it('returns command output envelopes and publishes them for agent calls', async () => {
    pluginManagerMock.executeCommand.mockResolvedValue(output);
    const response = await postJson('/api/plugins/example-plugin/commands/tasks', {
      agentId: 'agent-1',
      args: ['pending'],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ output });
    expect(pluginManagerMock.publishOutput).toHaveBeenCalledWith('agent-1', output);
  });

  it('returns action output and publishes plugin_output_patch data', async () => {
    const patched = { ...output, data: { kind: 'task-list', items: [{ id: 7, title: 'Still pending' }] } };
    pluginManagerMock.executeAction.mockResolvedValue(patched);
    const response = await postJson('/api/plugins/example-plugin/actions/refresh', {
      agentId: 'agent-1',
      instanceId: 'instance-1',
      rendererId: 'task-list',
      data: null,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ output: patched });
    expect(pluginManagerMock.publishPatch).toHaveBeenCalledWith(
      'agent-1',
      'example-plugin',
      'instance-1',
      patched.data,
    );
  });
});
