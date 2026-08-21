import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PluginManager } from '../manager.js';
import { createTideUsagesPlugin, fetchRegisteredProviderUsages } from './tide-usages.js';

let testRoot: string;

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-usages-plugin-'));
});

afterEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

const daily = { utilization: 24, resetsAt: '2026-08-21T00:00:00.000Z' };
const weekly = { utilization: 61, resetsAt: '2026-08-25T00:00:00.000Z' };

function dependencies() {
  return {
    claude: async () => ({
      usage: [{
        id: 'active',
        rateLimits: { fiveHour: daily, sevenDay: weekly },
        error: null,
      }],
    }),
    codex: async () => ({
      usage: [
        { id: 'active', rateLimits: { daily, weekly }, error: null },
        { id: 'Felipe', rateLimits: { daily: null, weekly }, error: null },
      ],
    }),
    grok: async () => ({ rateLimits: { weekly }, error: null }),
    listPiSubscriptions: () => [
      { provider: 'anthropic', label: 'Anthropic Claude Pro/Max' },
      { provider: 'opencode-go', label: 'OpenCode Go' },
    ],
    pi: async (provider: string) => ({
      usage: [{
        id: 'active',
        quotaWindows: provider === 'opencode-go'
          ? [{ key: 'five-hour', ...daily }, { key: 'weekly', ...weekly }]
          : [{ key: 'weekly', ...weekly }],
        error: null,
      }],
    }),
  };
}

describe('Tide Commander /usages plugin', () => {
  it('runs as a local slash command and returns every registered runtime provider', async () => {
    const manager = new PluginManager({
      dataDir: path.join(testRoot, 'state'),
      builtins: [createTideUsagesPlugin(dependencies())],
    });
    await manager.initialize();

    const output = await manager.executeSlashCommand('agent-1', '/usages');

    expect(output).toMatchObject({
      pluginId: 'tide-commander',
      rendererId: 'provider-usages',
      command: '/usages',
      data: {
        kind: 'provider-usages',
        providers: [
          { id: 'claude', accounts: [{ daily: { label: '5 horas', utilization: 24 }, weekly: { utilization: 61 } }] },
          {
            id: 'codex',
            accounts: [
              { id: 'active', active: true, daily: { label: 'Diario' }, weekly: { label: 'Semanal' } },
              { id: 'Felipe', label: 'Felipe', weekly: { utilization: 61 } },
            ],
          },
          { id: 'grok', accounts: [{ daily: null, weekly: { utilization: 61 } }] },
          { id: 'opencode', accounts: [{ id: 'opencode-go:active', daily: { label: '5 horas' }, weekly: { utilization: 61 } }] },
          { id: 'pi', accounts: [{ id: 'anthropic:active' }, { id: 'opencode-go:active' }] },
        ],
      },
    });
    await manager.shutdown();
  });

  it('keeps the report usable when provider usage endpoints fail independently', async () => {
    const failed = async () => { throw new Error('upstream unavailable'); };
    const report = await fetchRegisteredProviderUsages({
      claude: failed,
      codex: failed,
      grok: failed,
      listPiSubscriptions: () => { throw new Error('Pi auth unavailable'); },
      pi: failed,
    });

    expect(report.providers.map((provider) => provider.id)).toEqual([
      'claude', 'codex', 'grok', 'opencode', 'pi',
    ]);
    expect(report.providers.find((provider) => provider.id === 'claude')?.accounts[0]).toMatchObject({
      status: 'unavailable',
      error: 'upstream unavailable',
    });
    expect(report.providers.find((provider) => provider.id === 'opencode')?.accounts[0]).toMatchObject({
      status: 'free',
    });
  });
});
