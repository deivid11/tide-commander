import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PluginManager, type BuiltinPluginDefinition } from './manager.js';

let testRoot: string;

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-plugins-'));
});

afterEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function testBuiltin(onDeactivate = vi.fn()): BuiltinPluginDefinition {
  return {
    manifest: {
      id: 'test-builtin',
      name: 'Test Builtin',
      version: '1.0.0',
      contributes: {
        slashCommands: [{
          name: '/hello',
          aliases: ['/hi'],
          summary: 'Say hello',
          handler: 'hello',
          renderer: 'message',
        }],
        outputRenderers: ['message'],
      },
    },
    activate: (api) => {
      api.registerCommand('hello', ({ agentId, args }) => ({ greeting: `hello ${args.join(' ')}`, agentId }));
      api.registerAction('replace', ({ data }) => ({ replacement: data }));
      return onDeactivate;
    },
  };
}

describe('PluginManager lifecycle and dispatch', () => {
  it('intercepts aliases, emits structured output, and persists builtin disabled state', async () => {
    const broadcasts: unknown[] = [];
    const onDeactivate = vi.fn();
    const manager = new PluginManager({
      dataDir: path.join(testRoot, 'state'),
      builtins: [testBuiltin(onDeactivate)],
      broadcast: (message) => broadcasts.push(message),
    });
    await manager.initialize();

    expect(manager.matchSlashCommand('/HI Tide')?.pluginId).toBe('test-builtin');
    const output = await manager.executeSlashCommand('agent-1', '/hi "Tide Commander"');
    expect(output).toMatchObject({
      pluginId: 'test-builtin',
      rendererId: 'message',
      data: { greeting: 'hello Tide Commander', agentId: 'agent-1' },
    });
    manager.publishOutput('agent-1', output);
    expect(broadcasts).toContainEqual({
      type: 'plugin_output',
      payload: { agentId: 'agent-1', output },
    });

    await manager.disable('test-builtin');
    expect(onDeactivate).toHaveBeenCalledOnce();
    expect(manager.matchSlashCommand('/hello')).toBeNull();
    await manager.shutdown();

    const restarted = new PluginManager({
      dataDir: path.join(testRoot, 'state'),
      builtins: [testBuiltin()],
    });
    await restarted.initialize();
    expect(restarted.get('test-builtin')).toMatchObject({ enabled: false, builtin: true });
    await restarted.shutdown();
  });

  it('installs an external plugin, serves its browser entry, and invokes actions', async () => {
    const sourcePath = path.join(testRoot, 'external');
    fs.mkdirSync(sourcePath);
    fs.writeFileSync(path.join(sourcePath, 'package.json'), JSON.stringify({
      name: 'external-greeter',
      version: '2.1.0',
      tideCommander: {
        id: 'external-greeter',
        name: 'External Greeter',
        main: './server.mjs',
        browser: './browser.js',
        contributes: {
          slashCommands: [{ name: '/greet', aliases: ['/g'], summary: 'Greet', handler: 'greet', renderer: 'message' }],
          outputRenderers: ['message'],
        },
      },
    }));
    fs.writeFileSync(path.join(sourcePath, 'browser.js'), 'export function activate() {}\n');
    fs.writeFileSync(path.join(sourcePath, 'server.mjs'), `
      export function activate(api) {
        api.registerCommand('greet', (ctx) => ({ text: ctx.args.join('-') }));
        api.registerAction('replace', (ctx) => ({ replaced: ctx.data }));
      }
    `);

    const manager = new PluginManager({ dataDir: path.join(testRoot, 'state') });
    await manager.initialize();
    const installed = await manager.install(sourcePath);
    expect(installed).toMatchObject({
      id: 'external-greeter',
      version: '2.1.0',
      enabled: true,
      source: 'installed',
      clientEntry: '/api/plugins/external-greeter/client',
    });

    const commandOutput = await manager.executeCommand('external-greeter', 'g', {
      agentId: 'agent-2',
      args: ['one', 'two'],
    });
    expect(commandOutput.data).toEqual({ text: 'one-two' });

    const actionOutput = await manager.executeAction('external-greeter', 'replace', {
      agentId: 'agent-2',
      instanceId: commandOutput.instanceId,
      rendererId: 'message',
      data: { value: 7 },
    });
    expect(actionOutput).toMatchObject({
      instanceId: commandOutput.instanceId,
      rendererId: 'message',
      data: { replaced: { value: 7 } },
    });
    await expect(manager.readClientEntry('external-greeter')).resolves.toMatchObject({
      source: 'export function activate() {}\n',
    });
    await manager.shutdown();
  });

  it('rejects entry paths that escape the trusted plugin directory', async () => {
    const sourcePath = path.join(testRoot, 'escaping');
    fs.mkdirSync(sourcePath);
    fs.writeFileSync(path.join(testRoot, 'outside.js'), 'export default {}');
    fs.writeFileSync(path.join(sourcePath, 'manifest.json'), JSON.stringify({
      id: 'escaping-plugin',
      name: 'Escaping Plugin',
      version: '1.0.0',
      browser: '../outside.js',
    }));

    const manager = new PluginManager({ dataDir: path.join(testRoot, 'state') });
    await manager.initialize();
    await expect(manager.install(sourcePath)).rejects.toMatchObject({
      code: 'PLUGIN_ERROR',
    });
    expect(manager.list()).toEqual([]);
    await manager.shutdown();
  });

  it('reserves dynamically managed slash commands against installed plugins', async () => {
    const manager = new PluginManager({ dataDir: path.join(testRoot, 'state') });
    manager.setExternalSlashCommands('shell-commands', ['/deploy']);
    await manager.initialize();

    const sourcePath = path.join(testRoot, 'dynamic-collision');
    fs.mkdirSync(sourcePath);
    fs.writeFileSync(path.join(sourcePath, 'tide-plugin.json'), JSON.stringify({
      id: 'deploy-plugin',
      name: 'Deploy Plugin',
      version: '1.0.0',
      main: './server.mjs',
      contributes: { slashCommands: [{ name: '/deploy', summary: 'Deploy' }] },
    }));
    fs.writeFileSync(path.join(sourcePath, 'server.mjs'), 'export function activate() {}\n');

    await expect(manager.install(sourcePath)).rejects.toMatchObject({ code: 'PLUGIN_ACTIVATION_FAILED' });
    await manager.shutdown();
  });

  it('rejects duplicate slash commands across enabled plugins', async () => {
    const manager = new PluginManager({
      dataDir: path.join(testRoot, 'state'),
      builtins: [testBuiltin()],
    });
    await manager.initialize();

    const sourcePath = path.join(testRoot, 'collision');
    fs.mkdirSync(sourcePath);
    fs.writeFileSync(path.join(sourcePath, 'tide-plugin.json'), JSON.stringify({
      id: 'collision-plugin',
      name: 'Collision Plugin',
      version: '1.0.0',
      main: './server.mjs',
      contributes: {
        slashCommands: [{ name: '/different', aliases: ['/hello'], summary: 'Collision' }],
      },
    }));
    fs.writeFileSync(path.join(sourcePath, 'server.mjs'), 'export function activate() {}\n');

    await expect(manager.install(sourcePath)).rejects.toMatchObject({
      code: 'PLUGIN_ACTIVATION_FAILED',
      statusCode: 422,
    });
    expect(manager.get('collision-plugin')).toMatchObject({ enabled: false });
    await manager.shutdown();
  });
});
