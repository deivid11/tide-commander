import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Agent } from '../../../shared/types.js';
import type { PluginAgentNameProposalsData } from '../../../shared/plugin-types.js';
import { PluginManager } from '../manager.js';
import {
  buildAiRenamePrompt,
  createRenameAgentPlugin,
  preservesAgentIdentity,
  validateAiNameProposals,
  type RenameAgentSnapshot,
} from './rename-agent.js';

let testRoot: string;

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-rename-agent-'));
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(testRoot, { recursive: true, force: true });
});

function agent(overrides: Partial<RenameAgentSnapshot> = {}): RenameAgentSnapshot {
  return {
    id: 'agent-1',
    name: 'Plugins TC',
    class: 'developer' as Agent['class'],
    cwd: '/home/riven/d/tide-commander',
    taskLabel: 'Improve Guake terminal input',
    trackingStatusDetail: 'Styling the message placeholder and terminal controls',
    latestTodos: [],
    ...overrides,
  };
}

const aiProposals = [
  { name: 'Plugins Release TC', reason: 'Conserva el nombre y refleja entregas de Commander.' },
  { name: 'Developer Terminal Tailor', reason: 'Conserva la clase y el trabajo sobre el terminal.' },
  { name: 'Plugins Console TC', reason: 'Mantiene la identidad y destaca los controles de consola.' },
];

describe('Rename Agent plugin', () => {
  it('builds a same-agent AI callback prompt and strictly validates its proposals', () => {
    const prompt = buildAiRenamePrompt(agent(), 'request-1', 'http://localhost:5174');
    expect(prompt).toContain('Analiza tu conversación, contexto, tareas y actividad reciente');
    expect(prompt).toContain('/api/plugins/rename-agent/actions/proposals');
    expect(prompt).toContain('"instanceId": "request-1"');
    expect(prompt).toContain('X-Auth-Token');
    expect(prompt).toContain('Mark Releases Transfer Connect');
    expect(prompt).toContain('Charizard Liberaciones');
    expect(preservesAgentIdentity('Mark Releases Transfer Connect', 'Mark Transfer Connect', 'charizard')).toBe(true);
    expect(preservesAgentIdentity('Charizard Liberaciones', 'Mark Transfer Connect', 'charizard')).toBe(true);
    expect(preservesAgentIdentity('Release Commander', 'Mark Transfer Connect', 'charizard')).toBe(false);
    expect(validateAiNameProposals(aiProposals, 'Plugins TC', 'developer')).toEqual(aiProposals);
    expect(() => validateAiNameProposals(aiProposals.slice(0, 2), 'Plugins TC', 'developer'))
      .toThrow(/exactamente tres/);
    expect(() => validateAiNameProposals([
      ...aiProposals.slice(0, 2),
      { name: 'Console Crafter', reason: 'No conserva ninguna identidad.' },
    ], 'Plugins TC', 'developer')).toThrow(/conservar el nombre/);
  });

  it('asks the same agent and keeps the three proposals selectable without expiration', async () => {
    let current = agent();
    const askAgent = vi.fn(async () => undefined);
    const renameAgent = vi.fn((id: string, name: string) => {
      if (id !== current.id) return null;
      current = { ...current, name };
      return current;
    });
    const manager = new PluginManager({
      dataDir: path.join(testRoot, 'state'),
      builtins: [createRenameAgentPlugin({
        getAgent: (id) => id === current.id ? current : undefined,
        renameAgent,
        askAgent,
        baseUrl: () => 'http://localhost:5174',
      })],
    });
    await manager.initialize();

    const output = await manager.executeSlashCommand('agent-1', '/rename-agent');
    expect(output).toMatchObject({
      pluginId: 'rename-agent',
      rendererId: 'agent-name-proposals',
      command: '/rename-agent',
      data: {
        kind: 'agent-name-proposals',
        agentId: 'agent-1',
        previousName: 'Plugins TC',
        proposals: [],
        status: 'generating',
      },
    });
    await vi.waitFor(() => expect(askAgent).toHaveBeenCalledWith(
      'agent-1',
      expect.stringContaining(output.instanceId),
    ));

    const ready = await manager.executeAction('rename-agent', 'proposals', {
      agentId: 'agent-1',
      instanceId: output.instanceId,
      rendererId: output.rendererId,
      requestId: output.instanceId,
      contextSummary: 'Diseño y ajustes recientes del terminal Guake.',
      proposals: aiProposals,
    });
    expect(ready.data).toMatchObject({
      status: 'ready',
      contextSummary: 'Diseño y ajustes recientes del terminal Guake.',
      proposals: aiProposals,
    });
    expect((ready.data as PluginAgentNameProposalsData).expiresAt).toBeUndefined();

    const proposalData = ready.data as PluginAgentNameProposalsData;
    await expect(manager.executeAction('rename-agent', 'rename', {
      agentId: 'agent-1',
      data: proposalData,
      name: 'Arbitrary Name',
    })).rejects.toMatchObject({ code: 'AGENT_NAME_INVALID' });

    vi.useFakeTimers();
    vi.advanceTimersByTime(30 * 24 * 60 * 60_000);

    const renamed = await manager.executeAction('rename-agent', 'rename', {
      agentId: 'agent-1',
      instanceId: output.instanceId,
      rendererId: output.rendererId,
      data: proposalData,
      name: aiProposals[1].name,
    });
    expect(renameAgent).toHaveBeenCalledWith('agent-1', 'Developer Terminal Tailor');
    expect(renamed.data).toMatchObject({ status: 'renamed', selectedName: 'Developer Terminal Tailor' });

    await manager.shutdown();
  });
});
