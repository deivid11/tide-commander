import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

const pluginManagerMock = vi.hoisted(() => ({
  list: vi.fn(),
  install: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  readClientEntry: vi.fn(),
  executeCommand: vi.fn(),
  executeAction: vi.fn(),
  publishOutput: vi.fn(),
  publishPatch: vi.fn(),
}));

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
